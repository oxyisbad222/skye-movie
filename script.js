// script.js

// --- Constants & Config ---
const TMDB_API_KEY = 'cf4df30d74d9e322e596d876fd7db13e';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500'; // For posters
const TMDB_DETAIL_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w780'; // For detail view poster

const WATCHMODE_API_KEY = 'GnIdrvUyNWlSVmLnZcuxdSCB4jSy18icYwMEojuP';
const WATCHMODE_BASE_URL = 'https://api.watchmode.com/v1';

// This will be fetched from /api/get-config
let CONFIG_SKYE_MOVIE_ACCESS_CODE = null;

const SITE_MAIN_THEME_COLOR = '181818'; // Dark theme for player (hex without #)

const firebaseConfig = {
  apiKey: "AIzaSyCfzT7R2S4zezUeH7BayyQtKSTZ0fDfMGw",
  authDomain: "skye-movie.firebaseapp.com",
  projectId: "skye-movie",
  storageBucket: "skye-movie.firebasestorage.app",
  messagingSenderId: "622740998651",
  appId: "1:622740998651:web:d89656336aea5994c3a35e",
  measurementId: "G-GXEW4WYS30"
};

// --- Firebase Initialization ---
let fbApp;
let fbAuth;
let fbFirestore;

try {
  fbApp = firebase.initializeApp(firebaseConfig);
  fbAuth = firebase.auth();
  fbFirestore = firebase.firestore();
} catch (e) {
  console.error("Firebase initialization error:", e);
  alert("Could not initialize Firebase. Some features may not work.");
}

// --- State Variables ---
let currentUser = null;
let currentWatchmodeRateLimits = {};
let lastActiveListView = 'discover-view'; // To track which main list view was active for back button
let currentOpenDetail = null; // Store details of the item in detail-view for player/back navigation
let userFavorites = new Set();

// --- DOM Elements ---
const DOMElements = {
    accessGateSection: document.getElementById('access-gate-section'),
    accessCodeInput: document.getElementById('access-code-input'),
    submitAccessCodeButton: document.getElementById('submit-access-code'),
    accessError: document.getElementById('access-error'),

    authSection: document.getElementById('auth-section'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    loginEmailInput: document.getElementById('login-email'),
    loginPasswordInput: document.getElementById('login-password'),
    loginButton: document.getElementById('login-button'),
    loginError: document.getElementById('login-error'),
    registerEmailInput: document.getElementById('register-email'),
    registerPasswordInput: document.getElementById('register-password'),
    registerButton: document.getElementById('register-button'),
    registerError: document.getElementById('register-error'),
    showRegisterLink: document.getElementById('show-register'),
    showLoginLink: document.getElementById('show-login'),

    mainAppSection: document.getElementById('main-app-section'),
    userEmailDisplay: document.getElementById('user-email-display'),
    logoutButton: document.getElementById('logout-button'),

    navDiscover: document.getElementById('nav-discover'),
    navSearch: document.getElementById('nav-search'),
    navFavorites: document.getElementById('nav-favorites'),
    navButtons: [],

    discoverView: document.getElementById('discover-view'), // Container for all discover sections

    searchView: document.getElementById('search-view'),
    searchInput: document.getElementById('search-input'),
    searchButtonMain: document.getElementById('search-button-main'),
    searchResultsGrid: document.getElementById('search-results-grid'),
    searchMessage: document.getElementById('search-message'),
    autocompleteSuggestions: document.getElementById('autocomplete-suggestions'),

    favoritesView: document.getElementById('favorites-view'),
    favoritesGrid: document.getElementById('favorites-grid'),

    detailView: document.getElementById('detail-view'),
    mediaDetailContent: document.getElementById('media-detail-content'),
    backToListButton: document.getElementById('back-to-list-button'),

    playerView: document.getElementById('player-view'),
    playerTitle: document.getElementById('player-title'),
    mappletvPlayerContainer: document.getElementById('mappletv-player-container'),
    closePlayerButton: document.getElementById('close-player-button'),
    currentYearSpan: document.getElementById('current-year')
};
DOMElements.navButtons = [DOMElements.navDiscover, DOMElements.navSearch, DOMElements.navFavorites];


// --- API Cache ---
const ApiCache = {
    CACHE_PREFIX: 'skyeMovieCache_v2_',
    DEFAULT_TTL: 3600 * 1000 * 3, // 3 hours

    get: (key) => {
        const itemStr = localStorage.getItem(ApiCache.CACHE_PREFIX + key);
        if (!itemStr) return null;
        try {
            const item = JSON.parse(itemStr);
            const now = new Date().getTime();
            if (now > item.expiry) {
                localStorage.removeItem(ApiCache.CACHE_PREFIX + key);
                return null;
            }
            return item.value;
        } catch (error) {
            console.error("Cache read error:", error);
            localStorage.removeItem(ApiCache.CACHE_PREFIX + key);
            return null;
        }
    },
    set: (key, value, ttl = ApiCache.DEFAULT_TTL) => {
        const now = new Date().getTime();
        const item = { value: value, expiry: now + ttl };
        try {
            localStorage.setItem(ApiCache.CACHE_PREFIX + key, JSON.stringify(item));
        } catch (error) {
            console.warn("Cache write error (Quota Exceeded?):", error.message);
        }
    },
    updateRateLimits: (headers) => {
        currentWatchmodeRateLimits = {
            limit: headers.get('X-RateLimit-Limit'),
            remaining: headers.get('X-RateLimit-Remaining'),
            quota: headers.get('X-Account-Quota'),
            quotaUsed: headers.get('X-Account-Quota-Used'),
            timestamp: new Date().toLocaleTimeString()
        };
        // console.log('Watchmode Rate Limits Updated:', currentWatchmodeRateLimits);
        if (currentWatchmodeRateLimits.remaining && parseInt(currentWatchmodeRateLimits.remaining) < 10) {
            console.warn("Watchmode API rate limit remaining is low!");
        }
    }
};

// --- API Service ---
const ApiService = {
    fetchTMDB: async (endpoint, params = {}) => {
        const urlParams = new URLSearchParams({ api_key: TMDB_API_KEY, ...params });
        const url = `${TMDB_BASE_URL}/${endpoint}?${urlParams}`;
        const cacheKey = `tmdb_${endpoint}_${JSON.stringify(params)}`;
        const cached = ApiCache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error(`TMDB API Error (${response.status}) for ${url}:`, errorData);
                throw new Error(`TMDB API Error: ${response.statusText} (${response.status})`);
            }
            const data = await response.json();
            ApiCache.set(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Error fetching from TMDB:', error.message);
            throw error;
        }
    },

    fetchWatchmode: async (endpoint, params = {}, useCache = true) => {
        const urlParams = new URLSearchParams({ apiKey: WATCHMODE_API_KEY, ...params });
        const url = `${WATCHMODE_BASE_URL}/${endpoint}/?${urlParams}`;
        
        const cacheKey = `watchmode_${endpoint}_${JSON.stringify(params)}`;
        if (useCache) {
            const cached = ApiCache.get(cacheKey);
            if (cached) return cached;
        }
        
        try {
            const response = await fetch(url);
            ApiCache.updateRateLimits(response.headers);
            if (!response.ok) {
                let errorData = { message: response.statusText };
                try { errorData = await response.json(); } catch (e) { /* ignore if error response not json */ }
                console.error(`Watchmode API Error (${response.status}) for ${url}:`, errorData);
                throw new Error(`Watchmode API Error (${response.status}): ${errorData.detail || errorData.message || response.statusText}`);
            }
            const data = await response.json();
            if (useCache) ApiCache.set(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Error fetching from Watchmode:', error.message);
            throw error;
        }
    },

    getMappletvPlayerUrl: (tmdbId, title, season, episode) => {
        let playerUrl = `https://mappletv.uk/player/${tmdbId}`;
        const playerParams = new URLSearchParams();
        if (season) playerParams.append('season', season);
        if (episode) playerParams.append('episode', episode);
        
        playerParams.append('title', encodeURIComponent(title));
        playerParams.append('poster', '1');
        playerParams.append('autoPlay', '1');
        playerParams.append('theme', SITE_MAIN_THEME_COLOR);
        playerParams.append('nextButton', '1');
        playerParams.append('autoNext', '1');

        const queryString = playerParams.toString();
        if (queryString) playerUrl += `?${queryString}`;
        return playerUrl;
    }
};

// --- UI Service ---
const UIService = {
    showSection: (sectionElement) => {
        [DOMElements.accessGateSection, DOMElements.authSection, DOMElements.mainAppSection].forEach(sec => {
            sec.classList.remove('active-section');
            sec.classList.add('hidden-section');
        });
        sectionElement.classList.add('active-section');
        sectionElement.classList.remove('hidden-section');
    },

    showView: (viewId) => {
        document.querySelectorAll('#main-app-section .view').forEach(view => view.classList.remove('active-view'));
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.add('active-view');
            if (['discover-view', 'search-view', 'favorites-view'].includes(viewId)) {
                lastActiveListView = viewId;
            }
        }
        
        DOMElements.navButtons.forEach(btn => btn.classList.remove('active-nav'));
        const activeNavButton = document.getElementById(`nav-${viewId.replace('-view','')}`);
        if (activeNavButton) activeNavButton.classList.add('active-nav');
        
        window.scrollTo(0,0);
    },

    createMediaCard: (mediaItem, isFavoriteOverride = null) => {
        const isMovie = mediaItem.media_type === 'movie' || (mediaItem.title && mediaItem.release_date);
        const isTv = mediaItem.media_type === 'tv' || (mediaItem.name && mediaItem.first_air_date);

        let id = String(mediaItem.id);
        let title = mediaItem.title || mediaItem.name || "Untitled";
        let posterPath = mediaItem.poster_path;
        let rating = mediaItem.vote_average ? parseFloat(mediaItem.vote_average).toFixed(1) : (mediaItem.user_rating ? parseFloat(mediaItem.user_rating).toFixed(1) : null);
        let year = mediaItem.release_date ? mediaItem.release_date.substring(0,4) : (mediaItem.first_air_date ? mediaItem.first_air_date.substring(0,4) : '');
        
        let type = 'unknown';
        if (mediaItem.tmdb_id) id = String(mediaItem.tmdb_id); // Prefer tmdb_id if from Watchmode
        
        // Determine type more reliably
        if(mediaItem.media_type) { // TMDB often provides this
            type = mediaItem.media_type;
        } else if (mediaItem.type) { // Watchmode provides 'type'
             type = (mediaItem.type === 'movie' || mediaItem.type === 'short_film') ? 'movie' : 
                    (mediaItem.type === 'tv_series' || mediaItem.type === 'tv_miniseries' || mediaItem.type === 'tv_special') ? 'tv' : 'unknown';
        } else { // Infer if possible
            if (isMovie) type = 'movie';
            if (isTv) type = 'tv';
        }


        const posterUrl = posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : 'https://via.placeholder.com/180x270.png?text=No+Image';
        const isFavorited = isFavoriteOverride !== null ? isFavoriteOverride : userFavorites.has(id);

        const card = document.createElement('div');
        card.className = 'media-card';
        card.dataset.id = id;
        card.dataset.type = type;
        card.dataset.title = title;
        if (mediaItem.imdb_id) card.dataset.imdbId = mediaItem.imdb_id;

        card.innerHTML = `
            <img src="${posterUrl}" alt="${title}" loading="lazy">
            ${rating ? `<span class="rating">⭐ ${rating}</span>` : ''}
            <button class="add-to-favorites ${isFavorited ? 'favorited' : ''}" data-id="${id}" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
                ${isFavorited ? '♥' : '♡'}
            </button>
            <div class="card-content">
                <p class="title">${title}</p>
                ${year ? `<p class="year">${year}</p>` : ''}
            </div>
        `;
        
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('add-to-favorites')) return;
            AppLogic.handleMediaItemClick(id, type);
        });
        
        const favButton = card.querySelector('.add-to-favorites');
        favButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentIsFavorited = favButton.classList.contains('favorited');
            const favDetails = { title, type, poster_path: posterPath, vote_average: rating, year };
            FavoritesService.toggleFavorite(id, favDetails, currentIsFavorited, favButton);
        });
        return card;
    },

    renderMediaRow: (containerElement, items) => {
        containerElement.innerHTML = '';
        if (!items || items.length === 0) {
            containerElement.innerHTML = '<p class="empty-row-message">No items found for this category.</p>';
            return;
        }
        items.forEach(item => {
          if ((item.poster_path || item.image_url) && (item.title || item.name)) {
            containerElement.appendChild(UIService.createMediaCard(item));
          }
        });
    },

    renderGrid: (gridElement, items, messageElement = null, emptyMessage = "No results found.") => {
        gridElement.innerHTML = '';
        if (messageElement) messageElement.textContent = '';

        if (!items || items.length === 0) {
            if (messageElement) messageElement.textContent = emptyMessage;
            else gridElement.innerHTML = `<p class="empty-grid-message">${emptyMessage}</p>`;
            return;
        }
        items.forEach(item => {
          if ((item.poster_path || item.image_url) && (item.title || item.name)) {
            gridElement.appendChild(UIService.createMediaCard(item));
          }
        });
    },
    
    renderAutocompleteSuggestions: (suggestions) => {
        DOMElements.autocompleteSuggestions.innerHTML = '';
        if (!suggestions || suggestions.length === 0) {
            DOMElements.autocompleteSuggestions.style.display = 'none';
            return;
        }
        suggestions.slice(0, 5).forEach(item => {
            const div = document.createElement('div');
            div.textContent = `${item.name} (${item.year || 'N/A'})`; // item.year from Watchmode autocomplete
            div.addEventListener('click', () => {
                DOMElements.searchInput.value = item.name;
                UIService.clearAutocomplete();
                AppLogic.performSearch(item.name);
            });
            DOMElements.autocompleteSuggestions.appendChild(div);
        });
        DOMElements.autocompleteSuggestions.style.display = 'block';
    },

    renderMediaDetail: async (mediaId, mediaType) => {
        DOMElements.mediaDetailContent.innerHTML = '<p class="loading-message">Loading details...</p>';
        UIService.showView('detail-view');
        currentOpenDetail = null;

        try {
            let details;
            let sources = [];
            let tmdbIdForPlayer = String(mediaId);

            if (mediaType === 'movie') {
                details = await ApiService.fetchTMDB(`movie/${tmdbIdForPlayer}`, { append_to_response: 'credits,videos,release_dates' });
            } else if (mediaType === 'tv') {
                details = await ApiService.fetchTMDB(`tv/${tmdbIdForPlayer}`, { append_to_response: 'credits,videos,content_ratings,external_ids' });
            } else {
                console.warn("Attempting to fetch details for unknown or non-standard media type:", mediaType, "ID:", mediaId);
                // Try to guess based on ID pattern or a generic find (TMDB has /find endpoint but needs external ID)
                // For now, throw error if type isn't movie/tv
                throw new Error(`Unsupported media type "${mediaType}" for detail fetch.`);
            }
            
            currentOpenDetail = { ...details, id: tmdbIdForPlayer, type: mediaType };
            
            try {
                const watchmodeTmdbType = mediaType === 'movie' ? 'movie' : 'tv'; // Watchmode uses 'tv' for series/miniseries etc.
                const watchmodeTitleLookupId = `tmdb-${watchmodeTmdbType}-${tmdbIdForPlayer}`;
                const sourceData = await ApiService.fetchWatchmode(`title/${watchmodeTitleLookupId}/sources`);
                if (sourceData && Array.isArray(sourceData)) {
                     sources = sourceData
                        .filter(s => s.type === 'sub' || s.type === 'rent' || s.type === 'buy')
                        .map(s => ({name: s.name, type: s.type.replace('_', ' '), web_url: s.web_url })); // make type more readable
                }
            } catch (e) { console.warn("Could not fetch sources from Watchmode:", e.message); }

            const title = details.title || details.name;
            const posterPath = details.poster_path;
            const overview = details.overview;
            const rating = details.vote_average ? parseFloat(details.vote_average).toFixed(1) : null;
            const releaseDate = details.release_date || details.first_air_date;
            const genres = details.genres ? details.genres.map(g => `<span>${g.name}</span>`).join('') : '';
            const posterUrl = posterPath ? `${TMDB_DETAIL_IMAGE_BASE_URL}${posterPath}` : 'https://via.placeholder.com/300x450.png?text=No+Image';

            let seasonsHtml = '';
            if (mediaType === 'tv' && details.seasons) {
                const displaySeasons = details.seasons.filter(s => s.episode_count > 0 && (s.season_number > 0 || details.seasons.length === 1) ); // Exclude season 0 unless it's the only one with episodes
                if (displaySeasons.length > 0) {
                    seasonsHtml = `
                        <div id="season-episode-selector">
                            <label for="season-select">Season:</label>
                            <select id="season-select">
                                ${displaySeasons.map(s => `<option value="${s.season_number}" data-episodes="${s.episode_count}">${s.name} (${s.episode_count} ep.)</option>`).join('')}
                            </select>
                            <label for="episode-select">Episode:</label>
                            <select id="episode-select"></select>
                        </div>`;
                }
            }
            
            const isFavorited = userFavorites.has(tmdbIdForPlayer);
            const sourcesDisplay = sources.length > 0 ? 
                `<p><strong>Available on:</strong></p><div class="sources-list">${sources.map(s => `<a href="${s.web_url}" target="_blank" rel="noopener noreferrer"><span>${s.name} (${s.type})</span></a>`).join('')}</div>` :
                '';

            DOMElements.mediaDetailContent.innerHTML = `
                <img src="${posterUrl}" alt="${title}" class="detail-poster">
                <div class="media-info">
                    <h3>${title}</h3>
                    ${rating ? `<p><strong>Rating:</strong> ⭐ ${rating} / 10</p>`: ''}
                    ${releaseDate ? `<p><strong>Released:</strong> ${new Date(releaseDate).toLocaleDateString()}</p>` : ''}
                    ${genres ? `<p><strong>Genres:</strong></p><div class="genres-list">${genres}</div>` : ''}
                    <p><strong>Plot:</strong> ${overview || 'No overview available.'}</p>
                    ${sourcesDisplay}
                    ${seasonsHtml}
                    <div class="play-button-container">
                        <button id="play-media-button">▶ Play ${mediaType === 'tv' ? 'Episode' : 'Movie'}</button>
                         <button id="detail-favorite-button" class="add-to-favorites ${isFavorited ? 'favorited' : ''}" data-id="${tmdbIdForPlayer}">
                            ${isFavorited ? '♥ Favorited' : '♡ Add to Favorites'}
                        </button>
                    </div>
                </div>`;
            
            const detailFavButton = DOMElements.mediaDetailContent.querySelector('#detail-favorite-button');
            detailFavButton.addEventListener('click', () => {
                 const currentIsFavorited = detailFavButton.classList.contains('favorited');
                 const favDetails = { title, type: mediaType, poster_path: posterPath, vote_average: rating, year: releaseDate ? releaseDate.substring(0,4) : '' };
                 FavoritesService.toggleFavorite(tmdbIdForPlayer, favDetails, currentIsFavorited, detailFavButton, true);
            });

            if (mediaType === 'tv' && document.getElementById('season-select')) {
                AppLogic.setupSeasonEpisodeSelector();
            }

            document.getElementById('play-media-button').addEventListener('click', AppLogic.handlePlayMedia);

        } catch (error) {
            console.error('Error rendering media detail:', error.message);
            DOMElements.mediaDetailContent.innerHTML = `<p class="error-message">Error loading details: ${error.message}. Please try again.</p>`;
        }
    },

    renderPlayer: (tmdbId, title, season, episode) => {
        const playerUrl = ApiService.getMappletvPlayerUrl(tmdbId, title, season, episode);
        DOMElements.playerTitle.textContent = season && episode ? `${title} - S${season} E${episode}` : title;
        DOMElements.mappletvPlayerContainer.innerHTML = `<iframe src="${playerUrl}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
        UIService.showView('player-view');
    },
    clearAutocomplete: () => {
        DOMElements.autocompleteSuggestions.innerHTML = '';
        DOMElements.autocompleteSuggestions.style.display = 'none';
    }
};

// --- Auth Service ---
const AuthService = {
    fetchAndSetAccessCode: async () => {
        DOMElements.submitAccessCodeButton.disabled = true; // Disable while fetching
        DOMElements.accessError.textContent = 'Loading configuration...';
        try {
            const response = await fetch('/api/get-config');
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to fetch config: ${response.status}`);
            }
            const config = await response.json();
            CONFIG_SKYE_MOVIE_ACCESS_CODE = config.skyeMovieAccessCode;
            console.log("Access code configured.");
            if (DOMElements.accessGateSection.classList.contains('active-section')) {
                DOMElements.submitAccessCodeButton.disabled = false;
                DOMElements.accessError.textContent = 'Configuration loaded. Please enter code.';
            }
            return true;
        } catch (error) {
            console.error("Error fetching access code config:", error.message);
            DOMElements.accessError.textContent = `Error: ${error.message}. Site may not function.`;
            DOMElements.submitAccessCodeButton.disabled = true; // Keep disabled on critical error
            return false;
        }
    },
    handleAccessCode: () => {
        if (!CONFIG_SKYE_MOVIE_ACCESS_CODE) {
            DOMElements.accessError.textContent = 'Access code configuration is still loading or failed. Please wait.';
            AuthService.fetchAndSetAccessCode(); // Attempt to re-fetch
            return;
        }
        const code = DOMElements.accessCodeInput.value.trim();
        if (code === CONFIG_SKYE_MOVIE_ACCESS_CODE) {
            DOMElements.accessError.textContent = '';
            localStorage.setItem('skyeMovieAccessGranted', 'true');
            AuthService.observeAuthState(); // Re-check auth state now that access is granted
        } else {
            DOMElements.accessError.textContent = 'Invalid access code.';
            localStorage.removeItem('skyeMovieAccessGranted');
        }
    },
    handleRegister: async () => {
        const email = DOMElements.registerEmailInput.value;
        const password = DOMElements.registerPasswordInput.value;
        DOMElements.registerError.textContent = '';
        try {
            await fbAuth.createUserWithEmailAndPassword(email, password);
        } catch (error) {
            DOMElements.registerError.textContent = error.message;
        }
    },
    handleLogin: async () => {
        const email = DOMElements.loginEmailInput.value;
        const password = DOMElements.loginPasswordInput.value;
        DOMElements.loginError.textContent = '';
        try {
            await fbAuth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            DOMElements.loginError.textContent = error.message;
        }
    },
    handleLogout: async () => {
        try {
            await fbAuth.signOut();
             localStorage.removeItem('skyeMovieAccessGranted'); // Also revoke access grant on logout
        } catch (error) {
            console.error("Logout error:", error);
        }
    },
    observeAuthState: () => {
        fbAuth.onAuthStateChanged(async user => {
            const accessGranted = localStorage.getItem('skyeMovieAccessGranted') === 'true';
            
            if (user && accessGranted) {
                currentUser = user;
                DOMElements.userEmailDisplay.textContent = user.email;
                await FavoritesService.loadFavorites();
                UIService.showSection(DOMElements.mainAppSection);
                if (!lastActiveListView || lastActiveListView === 'discover-view' || DOMElements.discoverView.innerHTML === '') {
                     AppLogic.showDiscover(); // Default to discover if no specific last view or discover is empty
                } else {
                    UIService.showView(lastActiveListView); // Restore last known list view
                }
            } else {
                currentUser = null;
                userFavorites.clear();
                DOMElements.userEmailDisplay.textContent = '';
                
                if (!accessGranted && CONFIG_SKYE_MOVIE_ACCESS_CODE !== null) {
                     UIService.showSection(DOMElements.accessGateSection);
                     DOMElements.accessError.textContent = ''; // Clear previous errors
                     DOMElements.submitAccessCodeButton.disabled = false; // Ensure enabled
                } else if (accessGranted && !user && CONFIG_SKYE_MOVIE_ACCESS_CODE !== null) {
                    UIService.showSection(DOMElements.authSection);
                } else if (CONFIG_SKYE_MOVIE_ACCESS_CODE === null) { // Config not yet loaded
                    UIService.showSection(DOMElements.accessGateSection);
                    DOMElements.accessError.textContent = 'Loading site configuration...';
                    DOMElements.submitAccessCodeButton.disabled = true;
                } else { // Default to access gate if other conditions not met (e.g. logout)
                    UIService.showSection(DOMElements.accessGateSection);
                    DOMElements.accessError.textContent = '';
                    DOMElements.submitAccessCodeButton.disabled = false;
                }
                 DOMElements.loginForm.style.display = 'block';
                 DOMElements.registerForm.style.display = 'none';
                 DOMElements.loginError.textContent = '';
                 DOMElements.registerError.textContent = '';
            }
        });
    }
};

// --- Favorites Service ---
const FavoritesService = {
    loadFavorites: async () => {
        if (!currentUser) return;
        userFavorites.clear();
        try {
            const snapshot = await fbFirestore.collection('users').doc(currentUser.uid).collection('favorites').orderBy('addedAt', 'desc').get();
            snapshot.forEach(doc => userFavorites.add(doc.id));
            
            if (document.getElementById('favorites-view').classList.contains('active-view')) {
                AppLogic.showFavorites();
            }
            // Refresh fav buttons on any currently displayed media cards (e.g. on Discover if loaded before favs)
            document.querySelectorAll('.media-card .add-to-favorites').forEach(btn => {
                const cardId = btn.dataset.id;
                if (userFavorites.has(cardId)) {
                    btn.classList.add('favorited'); btn.innerHTML = '♥'; btn.title = 'Remove from favorites';
                } else {
                    btn.classList.remove('favorited'); btn.innerHTML = '♡'; btn.title = 'Add to favorites';
                }
            });
        } catch (error) { console.error("Error loading favorites:", error.message); }
    },
    toggleFavorite: async (mediaId, mediaDetails, isCurrentlyFavorited, buttonElement, isDetailButton = false) => {
        if (!currentUser) { alert("Please login to manage favorites."); return; }
        mediaId = String(mediaId);

        try {
            const favRef = fbFirestore.collection('users').doc(currentUser.uid).collection('favorites').doc(mediaId);
            if (isCurrentlyFavorited) {
                await favRef.delete();
                userFavorites.delete(mediaId);
                if (buttonElement) {
                    buttonElement.classList.remove('favorited');
                    buttonElement.innerHTML = isDetailButton ? '♡ Add to Favorites' : '♡';
                    buttonElement.title = 'Add to favorites';
                }
            } else {
                await favRef.set({ ...mediaDetails, tmdb_id: mediaId, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
                userFavorites.add(mediaId);
                if (buttonElement) {
                    buttonElement.classList.add('favorited');
                    buttonElement.innerHTML = isDetailButton ? '♥ Favorited' : '♥';
                    buttonElement.title = 'Remove from favorites';
                }
            }
            if (isCurrentlyFavorited && document.getElementById('favorites-view').classList.contains('active-view')) {
                AppLogic.showFavorites();
            }
        } catch (error) {
            console.error("Error toggling favorite:", error.message, error);
            alert(`Error updating favorites: ${error.message}. Check console for details.`);
        }
    },
    getFavoritedItemsDetails: async () => {
        if (!currentUser || userFavorites.size === 0) return [];
        const favoriteItemsData = [];
        try {
            const snapshot = await fbFirestore.collection('users').doc(currentUser.uid).collection('favorites').orderBy('addedAt', 'desc').get();
            snapshot.forEach(doc => favoriteItemsData.push({ id: doc.id, ...doc.data() })); // doc.id is the TMDB_ID
        } catch (error) { console.error("Error fetching favorite details:", error.message); }
        return favoriteItemsData;
    }
};


// --- App Logic & Event Handlers ---
const AppLogic = {
    init: async () => {
        DOMElements.currentYearSpan.textContent = new Date().getFullYear();
        
        // Fetch config first. observeAuthState will be called after success or handle UI for failure.
        const configLoaded = await AuthService.fetchAndSetAccessCode(); 
        AuthService.observeAuthState(); // Crucial: Call observeAuthState regardless of config load to handle all UI states

        if (!configLoaded) {
            // If config failed to load, observeAuthState would have put UI in access gate with error.
            // No further app-specific init beyond basic auth observation should happen here.
            return;
        }
        
        // Event Listeners
        DOMElements.submitAccessCodeButton.addEventListener('click', AuthService.handleAccessCode);
        DOMElements.accessCodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') AuthService.handleAccessCode(); });
        
        DOMElements.registerButton.addEventListener('click', AuthService.handleRegister);
        DOMElements.loginButton.addEventListener('click', AuthService.handleLogin);
        DOMElements.logoutButton.addEventListener('click', AuthService.handleLogout);

        DOMElements.showRegisterLink.addEventListener('click', (e) => { e.preventDefault(); DOMElements.loginForm.style.display = 'none'; DOMElements.registerForm.style.display = 'block'; });
        DOMElements.showLoginLink.addEventListener('click', (e) => { e.preventDefault(); DOMElements.registerForm.style.display = 'none'; DOMElements.loginForm.style.display = 'block'; });

        DOMElements.navDiscover.addEventListener('click', AppLogic.showDiscover);
        DOMElements.navSearch.addEventListener('click', AppLogic.showSearch);
        DOMElements.navFavorites.addEventListener('click', AppLogic.showFavorites);

        DOMElements.backToListButton.addEventListener('click', () => UIService.showView(lastActiveListView || 'discover-view'));
        DOMElements.closePlayerButton.addEventListener('click', () => {
            DOMElements.mappletvPlayerContainer.innerHTML = '';
            UIService.showView('detail-view');
        });
        
        let searchDebounceTimer;
        DOMElements.searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            const query = DOMElements.searchInput.value.trim();
            if (query.length > 2) {
                searchDebounceTimer = setTimeout(() => AppLogic.performAutocompleteSearch(query), 300);
            } else { UIService.clearAutocomplete(); }
        });
        DOMElements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { UIService.clearAutocomplete(); AppLogic.performSearch(DOMElements.searchInput.value.trim()); }
        });
        DOMElements.searchButtonMain.addEventListener('click', () => {
            UIService.clearAutocomplete(); AppLogic.performSearch(DOMElements.searchInput.value.trim());
        });
        document.addEventListener('click', (event) => {
            if (!DOMElements.searchInput.parentElement.contains(event.target) && !DOMElements.autocompleteSuggestions.contains(event.target)) {
                UIService.clearAutocomplete();
            }
        });
    },

    discoverSectionsConfig: [
        { title: 'Trending Movies This Week', endpoint: 'trending/movie/week', type: 'movie' },
        { title: 'Popular TV Shows', endpoint: 'tv/popular', type: 'tv' },
        { title: 'Upcoming Movies', endpoint: 'movie/upcoming', type: 'movie' },
        { title: 'Top Rated Movies', endpoint: 'movie/top_rated', type: 'movie' },
        { title: 'Trending TV Shows This Week', endpoint: 'trending/tv/week', type: 'tv' },
    ],

    showDiscover: async () => {
        UIService.showView('discover-view');
        DOMElements.discoverView.innerHTML = '';

        for (const section of AppLogic.discoverSectionsConfig) {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'discover-section';
            const titleEl = document.createElement('h2');
            titleEl.className = 'discover-section-title';
            titleEl.textContent = section.title;
            sectionDiv.appendChild(titleEl);
            const rowDiv = document.createElement('div');
            rowDiv.className = 'discover-media-row';
            rowDiv.innerHTML = '<p class="loading-message">Loading...</p>';
            sectionDiv.appendChild(rowDiv);
            DOMElements.discoverView.appendChild(sectionDiv);

            try {
                const data = await ApiService.fetchTMDB(section.endpoint, { page: 1 });
                const itemsWithMediaType = data.results.map(item => ({ ...item, media_type: item.media_type || section.type }));
                UIService.renderMediaRow(rowDiv, itemsWithMediaType);
            } catch (error) {
                console.error(`Error loading discover section "${section.title}":`, error.message);
                rowDiv.innerHTML = `<p class="error-message">Could not load this section.</p>`;
            }
        }
    },
    
    setupSeasonEpisodeSelector: () => {
        const seasonSelect = document.getElementById('season-select');
        const episodeSelect = document.getElementById('episode-select');
        if (!seasonSelect || !episodeSelect) return;

        const populateEpisodes = (episodeCount) => {
            episodeSelect.innerHTML = '';
            if (episodeCount > 0) {
                for (let i = 1; i <= episodeCount; i++) {
                    episodeSelect.add(new Option(`Episode ${i}`, i));
                }
            } else {
                 episodeSelect.add(new Option(`No episodes listed`, ''));
                 episodeSelect.disabled = true;
            }
        };
        const initialSeasonOption = seasonSelect.options[seasonSelect.selectedIndex];
        if (initialSeasonOption) {
            populateEpisodes(parseInt(initialSeasonOption.dataset.episodes));
        }
        seasonSelect.addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            episodeSelect.disabled = false; // Re-enable if it was disabled
            populateEpisodes(parseInt(selectedOption.dataset.episodes));
        });
    },

    showSearch: () => {
        UIService.showView('search-view');
        DOMElements.searchMessage.textContent = 'Type to search for movies and TV shows.';
        DOMElements.searchResultsGrid.innerHTML = ''; // Clear previous results
        DOMElements.searchInput.value = ''; // Clear search input
        UIService.clearAutocomplete();
    },
    
    performAutocompleteSearch: async (query) => {
        if (query.length < 3) { UIService.renderAutocompleteSuggestions([]); return; }
        try {
            const data = await ApiService.fetchWatchmode('autocomplete-search', { search_value: query, search_type: 2 });
             UIService.renderAutocompleteSuggestions(data && data.results ? data.results : []);
        } catch (error) {
            console.warn("Autocomplete search failed:", error.message);
            UIService.renderAutocompleteSuggestions([]);
        }
    },

    performSearch: async (query) => {
        UIService.clearAutocomplete();
        if (!query) {
            DOMElements.searchMessage.textContent = 'Please enter a search term.';
            DOMElements.searchResultsGrid.innerHTML = '';
            return;
        }
        DOMElements.searchMessage.textContent = `Searching for "${query}"...`;
        DOMElements.searchResultsGrid.innerHTML = '';
        UIService.showView('search-view');

        try {
            let results = [];
            try {
                // Watchmode's /search endpoint needs type specifications
                const watchmodeParams = {
                    search_field: 'name',
                    search_value: query,
                    types: 'movie,tv_series,tv_special,short_film' // Broaden types
                };
                const watchmodeData = await ApiService.fetchWatchmode('search', watchmodeParams);

                if (watchmodeData && watchmodeData.title_results && watchmodeData.title_results.length > 0) {
                     results = watchmodeData.title_results
                        .filter(item => item.tmdb_id && (item.tmdb_type === 'movie' || item.tmdb_type === 'tv'))
                        .map(item => ({
                            id: String(item.tmdb_id),
                            tmdb_id: String(item.tmdb_id),
                            imdb_id: item.imdb_id,
                            title: item.name,
                            poster_path: item.poster ? item.poster.replace(TMDB_IMAGE_BASE_URL,'').replace(TMDB_DETAIL_IMAGE_BASE_URL,'') : null,
                            vote_average: item.user_score,
                            media_type: item.tmdb_type, // 'movie' or 'tv'
                            year: item.year
                        }));
                }
            } catch (watchmodeError) {
                console.warn("Watchmode search failed, trying TMDB. Error:", watchmodeError.message);
            }

            if (results.length === 0) {
                console.log("Watchmode returned no usable results or failed. Falling back to TMDB search.");
                const tmdbData = await ApiService.fetchTMDB('search/multi', { query: query, include_adult: 'false' });
                results = tmdbData.results
                    .filter(item => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path)
                    .map(item => ({ ...item, id: String(item.id)}));
            }
            
            if (results.length > 0) {
                DOMElements.searchMessage.textContent = `Results for "${query}":`;
            } else {
                DOMElements.searchMessage.textContent = `No results found for "${query}".`;
            }
            UIService.renderGrid(DOMElements.searchResultsGrid, results, null);

        } catch (error) {
            console.error("Search failed:", error.message);
            DOMElements.searchMessage.textContent = `Search failed: ${error.message}. Please try again.`;
            DOMElements.searchResultsGrid.innerHTML = '';
        }
    },

    showFavorites: async () => {
        UIService.showView('favorites-view');
        DOMElements.favoritesGrid.innerHTML = '<p class="loading-message">Loading your favorites...</p>';
        if (!currentUser) {
            DOMElements.favoritesGrid.innerHTML = '<p>Please login to see your favorites.</p>';
            return;
        }
        const favoriteItemsData = await FavoritesService.getFavoritedItemsDetails();
        if (favoriteItemsData.length === 0) {
            DOMElements.favoritesGrid.innerHTML = '<p class="empty-grid-message">You have no favorites yet. Find something you like!</p>';
            return;
        }
        // Map Firestore data to the format createMediaCard expects
        const mappedFavorites = favoriteItemsData.map(fav => ({
            id: fav.tmdb_id || fav.id, // tmdb_id is what we store
            title: fav.title,
            poster_path: fav.poster_path,
            vote_average: fav.vote_average,
            media_type: fav.type, // 'movie' or 'tv'
            year: fav.year
        }));
        UIService.renderGrid(DOMElements.favoritesGrid, mappedFavorites, null, "You haven't favorited anything yet.");
    },

    handleMediaItemClick: async (mediaId, mediaTypeFromCard) => {
        if (!mediaId || !mediaTypeFromCard || mediaTypeFromCard === 'unknown') {
            console.error("Invalid media ID or type for detail view:", mediaId, mediaTypeFromCard);
            alert("Cannot load details for this item due to missing information.");
            return;
        }
        await UIService.renderMediaDetail(String(mediaId), mediaTypeFromCard);
    },

    handlePlayMedia: () => {
        if (!currentOpenDetail || !currentOpenDetail.id) {
            alert("Error: Media details not found to start playback."); return;
        }
        const { id: tmdbId, title: mediaTitle, name, type: mediaType } = currentOpenDetail;
        const finalTitle = mediaTitle || name;

        if (mediaType === 'movie') {
            UIService.renderPlayer(tmdbId, finalTitle);
        } else if (mediaType === 'tv') {
            const seasonSelect = document.getElementById('season-select');
            const episodeSelect = document.getElementById('episode-select');
            if (seasonSelect && episodeSelect && seasonSelect.value && episodeSelect.value) {
                UIService.renderPlayer(tmdbId, finalTitle, seasonSelect.value, episodeSelect.value);
            } else if (currentOpenDetail.seasons && currentOpenDetail.seasons.some(s => s.season_number === 1 && s.episode_count > 0)) {
                 UIService.renderPlayer(tmdbId, finalTitle, 1, 1); // Default to S1E1
            } else {
                alert("Please select a season and episode, or this series might not have episode data available for direct play.");
            }
        } else {
            alert(`Playback for type "${mediaType}" is not currently supported directly.`);
        }
    }
};

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', AppLogic.init);
