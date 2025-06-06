// script.js

// --- Constants & Config ---
const TMDB_API_KEY = 'cf4df30d74d9e322e596d876fd7db13e';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const TMDB_DETAIL_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w780';

const WATCHMODE_API_KEY = 'GnIdrvUyNWlSVmLnZcuxdSCB4jSy18icYwMEojuP';
const WATCHMODE_BASE_URL = 'https://api.watchmode.com/v1';

let CONFIG_SKYE_MOVIE_ACCESS_CODE = null;

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
let googleAuthProvider;

try {
  fbApp = firebase.initializeApp(firebaseConfig);
  fbAuth = firebase.auth();
  fbFirestore = firebase.firestore();
  googleAuthProvider = new firebase.auth.GoogleAuthProvider();
} catch (e) {
  console.error("Firebase initialization error:", e);
  alert("Could not initialize Firebase. Some features may not work.");
}

// --- State Variables ---
let currentUser = null;
let currentWatchmodeRateLimits = {};
let lastActiveListView = 'discover-view';
let currentOpenDetail = null;
let userFavorites = new Set();
let currentRawSearchResults = []; // Stores results from the current page of a keyword search
let currentSearchQuery = '';
let searchCurrentPage = 1;
let searchTotalPages = 1;


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
    googleSignInButton: document.getElementById('google-signin-button'),
    googleSignUpButton: document.getElementById('google-signup-button'),
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

    discoverView: document.getElementById('discover-view'),

    searchView: document.getElementById('search-view'),
    searchInput: document.getElementById('search-input'),
    searchButtonMain: document.getElementById('search-button-main'),
    filterTypeSelect: document.getElementById('filter-type'),
    sortBySelect: document.getElementById('sort-by'),
    applyFiltersButton: document.getElementById('apply-filters-button'),
    searchResultsGrid: document.getElementById('search-results-grid'),
    searchMessage: document.getElementById('search-message'),
    autocompleteSuggestions: document.getElementById('autocomplete-suggestions'),
    paginationControls: document.getElementById('pagination-controls'),
    prevPageButton: document.getElementById('prev-page-button'),
    nextPageButton: document.getElementById('next-page-button'),
    pageInfo: document.getElementById('page-info'),


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
    CACHE_PREFIX: 'skyeMovieCache_v3_',
    DEFAULT_TTL: 3600 * 1000 * 3, 

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
        if (cached) {
            return cached;
        }
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
            if (cached) {
                return cached;
            }
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
    getMappletvPlayerUrl: (mediaType, tmdbId, season, episode) => {
        if (mediaType === 'tv') {
            season = season || 1;
            episode = episode || 1;
            return `https://mappletv.uk/watch/tv/${tmdbId}-${season}-${episode}`;
        } else if (mediaType === 'movie') {
            return `https://mappletv.uk/watch/movie/${tmdbId}`;
        } else {
            console.error("Unsupported media type for Mappletv.uk playback:", mediaType);
            return null;
        }
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
        const isMovieLoose = mediaItem.title && mediaItem.release_date;
        const isTvLoose = mediaItem.name && mediaItem.first_air_date;

        let id = String(mediaItem.id); // TMDB's direct ID from search/discover
        let title = mediaItem.title || mediaItem.name || "Untitled";
        let posterPath = mediaItem.poster_path;
        let rating = mediaItem.vote_average ? parseFloat(mediaItem.vote_average).toFixed(1) : (mediaItem.user_rating ? parseFloat(mediaItem.user_rating).toFixed(1) : null);
        let year = mediaItem.release_date ? mediaItem.release_date.substring(0,4) : (mediaItem.first_air_date ? mediaItem.first_air_date.substring(0,4) : '');
        
        // media_type should be directly from TMDB ('movie' or 'tv') for search results
        let type = mediaItem.media_type || 'unknown'; 

        // If type is still unknown (e.g. from Watchmode results that weren't fully mapped)
        if (type === 'unknown') {
            if (mediaItem.tmdb_id) id = String(mediaItem.tmdb_id); // Ensure id is tmdb_id if from Watchmode
            if (mediaItem.type) { // Watchmode specific 'type'
                 type = (mediaItem.type === 'movie' || mediaItem.type === 'short_film') ? 'movie' : 
                        (mediaItem.type === 'tv_series' || mediaItem.type === 'tv_miniseries' || mediaItem.type === 'tv_special' || mediaItem.type.startsWith('tv')) ? 'tv' : 'unknown';
            } else {
                if (isMovieLoose) type = 'movie';
                else if (isTvLoose) type = 'tv';
            }
        }


        const posterUrl = posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : 'https://via.placeholder.com/180x270.png?text=No+Image';
        const isFavorited = isFavoriteOverride !== null ? isFavoriteOverride : userFavorites.has(id);

        const card = document.createElement('div');
        card.className = 'media-card';
        card.dataset.id = id; // This MUST be the correct TMDB ID for the specific item version
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
    renderMediaRow: (rowContainerElement, items) => {
        rowContainerElement.innerHTML = '';
        if (!items || items.length === 0) {
            rowContainerElement.innerHTML = '<p class="empty-row-message">No items found for this category.</p>';
            return;
        }
        items.forEach(item => {
          if ((item.poster_path || item.image_url) && (item.title || item.name)) {
            rowContainerElement.appendChild(UIService.createMediaCard(item));
          }
        });
    },
    renderGrid: (gridElement, items, messageElement = null, emptyMessage = "No results found.") => {
        gridElement.innerHTML = '';
        if (messageElement) messageElement.textContent = '';

        if (!items || items.length === 0) {
            if (messageElement) messageElement.textContent = emptyMessage;
            else gridElement.innerHTML = `<p class="empty-grid-message">${emptyMessage}</p>`;
            DOMElements.paginationControls.style.display = 'none'; // Hide pagination if no results
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
            div.textContent = `${item.name} (${item.year || 'N/A'})`;
            div.addEventListener('click', () => {
                DOMElements.searchInput.value = item.name;
                UIService.clearAutocomplete();
                AppLogic.triggerSearchOrFilter();
            });
            DOMElements.autocompleteSuggestions.appendChild(div);
        });
        DOMElements.autocompleteSuggestions.style.display = 'block';
        const searchInputRect = DOMElements.searchInput.getBoundingClientRect();
        const searchControlsRect = DOMElements.searchInput.closest('.search-controls-container').getBoundingClientRect();
        
        DOMElements.autocompleteSuggestions.style.left = `${searchInputRect.left - searchControlsRect.left}px`;
        DOMElements.autocompleteSuggestions.style.top = `${searchInputRect.bottom - searchControlsRect.top + 5}px`;
        DOMElements.autocompleteSuggestions.style.width = `${searchInputRect.width}px`;
    },
    renderMediaDetail: async (mediaId, mediaType) => {
        DOMElements.mediaDetailContent.innerHTML = '<p class="loading-message">Loading details...</p>';
        UIService.showView('detail-view');
        currentOpenDetail = null;

        try {
            let details;
            let sources = [];
            let tmdbIdForPlayer = String(mediaId);
            let certification = 'N/A';

            if (mediaType === 'movie') {
                details = await ApiService.fetchTMDB(`movie/${tmdbIdForPlayer}`, { append_to_response: 'credits,videos,release_dates' });
                const releaseDates = details.release_dates;
                if (releaseDates && releaseDates.results) {
                    const usRelease = releaseDates.results.find(r => r.iso_3166_1 === 'US');
                    if (usRelease && usRelease.release_dates) {
                        const certEntry = usRelease.release_dates.find(rd => rd.certification && rd.certification !== "");
                        if (certEntry) certification = certEntry.certification;
                    }
                }
            } else if (mediaType === 'tv') {
                details = await ApiService.fetchTMDB(`tv/${tmdbIdForPlayer}`, { append_to_response: 'credits,videos,content_ratings,external_ids' });
                const contentRatings = details.content_ratings;
                if (contentRatings && contentRatings.results) {
                    const usRating = contentRatings.results.find(r => r.iso_3166_1 === 'US');
                    if (usRating && usRating.rating) certification = usRating.rating;
                }
            } else {
                throw new Error(`Unsupported media type "${mediaType}" for detail fetch.`);
            }
            
            currentOpenDetail = { ...details, id: tmdbIdForPlayer, type: mediaType, certification: certification };
            
            try {
                const watchmodeTmdbType = mediaType === 'movie' ? 'movie' : 'tv';
                const watchmodeTitleLookupId = `tmdb-${watchmodeTmdbType}-${tmdbIdForPlayer}`;
                const sourceData = await ApiService.fetchWatchmode(`title/${watchmodeTitleLookupId}/sources`);
                if (sourceData && Array.isArray(sourceData)) {
                     sources = sourceData
                        .filter(s => s.type === 'sub' || s.type === 'rent' || s.type === 'buy')
                        .map(s => ({name: s.name, type: s.type.replace('_', ' '), web_url: s.web_url }));
                }
            } catch (e) { console.warn("Could not fetch sources from Watchmode:", e.message); }

            const title = details.title || details.name;
            const posterPath = details.poster_path;
            const overview = details.overview;
            const rating = details.vote_average ? parseFloat(details.vote_average).toFixed(1) : null;
            const releaseDate = details.release_date || details.first_air_date;
            const genres = details.genres ? details.genres.map(g => `<span>${g.name}</span>`).join('') : '';
            const posterUrl = posterPath ? `${TMDB_DETAIL_IMAGE_BASE_URL}${posterPath}` : 'https://via.placeholder.com/300x450.png?text=No+Image';
            const certificationDisplay = certification && certification !== 'N/A' ? `<span class="content-rating-tag">${certification}</span>` : '';
            
            let seasonsHtml = '';
            if (mediaType === 'tv' && details.seasons) {
                const displaySeasons = details.seasons.filter(s => s.episode_count > 0 && (s.season_number > 0 || details.seasons.length === 1) );
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
                `<p><strong>Available on:</strong></p><div class="sources-list">${sources.map(s => `<a href="${s.web_url}" target="_blank" rel="noopener noreferrer"><span>${s.name} (${s.type})</span></a>`).join('')}</div>` : '';

            DOMElements.mediaDetailContent.innerHTML = `
                <img src="${posterUrl}" alt="${title}" class="detail-poster">
                <div class="media-info">
                    <h3>${title} ${certificationDisplay}</h3>
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
    renderPlayer: (mediaType, tmdbId, title, season, episode) => {
        const playerUrl = ApiService.getMappletvPlayerUrl(mediaType, tmdbId, season, episode);
        if (!playerUrl) {
            DOMElements.mappletvPlayerContainer.innerHTML = `<p class="error-message">Could not generate player URL for this content.</p>`;
            UIService.showView('player-view');
            DOMElements.playerTitle.textContent = "Playback Error";
            return;
        }
        DOMElements.playerTitle.textContent = (mediaType === 'tv' && season && episode) ? `${title} - S${season} E${episode}` : title;
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
        DOMElements.submitAccessCodeButton.disabled = true;
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
            DOMElements.submitAccessCodeButton.disabled = true;
            return false;
        }
    },
    handleAccessCode: () => {
        if (!CONFIG_SKYE_MOVIE_ACCESS_CODE) {
            DOMElements.accessError.textContent = 'Access code configuration is still loading or failed. Please wait.';
            AuthService.fetchAndSetAccessCode();
            return;
        }
        const code = DOMElements.accessCodeInput.value.trim();
        if (code === CONFIG_SKYE_MOVIE_ACCESS_CODE) {
            DOMElements.accessError.textContent = '';
            localStorage.setItem('skyeMovieAccessGranted', 'true');
            AuthService.observeAuthState();
        } else {
            DOMElements.accessError.textContent = 'Invalid access code.';
            localStorage.removeItem('skyeMovieAccessGranted');
        }
    },
    handleRegister: async () => {
        const email = DOMElements.registerEmailInput.value;
        const password = DOMElements.registerPasswordInput.value;
        DOMElements.registerError.textContent = '';
        DOMElements.loginError.textContent = '';
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
        DOMElements.registerError.textContent = '';
        try {
            await fbAuth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            DOMElements.loginError.textContent = error.message;
        }
    },
    handleGoogleSignIn: async () => {
        DOMElements.loginError.textContent = '';
        DOMElements.registerError.textContent = '';
        try {
            await fbAuth.signInWithPopup(googleAuthProvider);
        } catch (error) {
            console.error("Google Sign-In Error:", error);
            const errorMessage = `Google Sign-In failed: ${error.code === 'auth/popup-closed-by-user' ? 'Popup closed before sign-in completed.' : error.message}`;
            DOMElements.loginError.textContent = errorMessage;
            DOMElements.registerError.textContent = errorMessage;
        }
    },
    handleLogout: async () => {
        try {
            await fbAuth.signOut();
            localStorage.removeItem('skyeMovieAccessGranted');
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
                if (!lastActiveListView || lastActiveListView === 'discover-view' || DOMElements.discoverView.innerHTML.trim() === '') {
                     AppLogic.showDiscover();
                } else {
                    UIService.showView(lastActiveListView);
                }
            } else {
                currentUser = null;
                userFavorites.clear();
                DOMElements.userEmailDisplay.textContent = '';
                
                if (!accessGranted && CONFIG_SKYE_MOVIE_ACCESS_CODE !== null) {
                     UIService.showSection(DOMElements.accessGateSection);
                     DOMElements.accessError.textContent = ''; 
                     DOMElements.submitAccessCodeButton.disabled = false;
                } else if (accessGranted && !user && CONFIG_SKYE_MOVIE_ACCESS_CODE !== null) {
                    UIService.showSection(DOMElements.authSection);
                } else if (CONFIG_SKYE_MOVIE_ACCESS_CODE === null) {
                    UIService.showSection(DOMElements.accessGateSection);
                    DOMElements.accessError.textContent = 'Loading site configuration...';
                    DOMElements.submitAccessCodeButton.disabled = true;
                } else { 
                    UIService.showSection(DOMElements.accessGateSection);
                    DOMElements.accessError.textContent = '';
                    DOMElements.submitAccessCodeButton.disabled = false;
                }
                 DOMElements.loginForm.style.display = 'block';
                 DOMElements.registerForm.style.display = 'none';
                 DOMElements.loginEmailInput.value = ''; DOMElements.loginPasswordInput.value = '';
                 DOMElements.registerEmailInput.value = ''; DOMElements.registerPasswordInput.value = '';
                 DOMElements.loginError.textContent = ''; DOMElements.registerError.textContent = '';
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
            document.querySelectorAll('.media-card .add-to-favorites').forEach(btn => {
                const cardId = btn.dataset.id;
                if (userFavorites.has(cardId)) {
                    btn.classList.add('favorited'); btn.innerHTML = '♥'; btn.title = 'Remove from favorites';
                } else {
                    btn.classList.remove('favorited'); btn.innerHTML = '♡'; btn.title = 'Add to favorites';
                }
            });
        } catch (error) { 
            console.error("Error loading favorites:", error.message); 
        }
    },
    toggleFavorite: async (mediaId, mediaDetails, isCurrentlyFavorited, buttonElement, isDetailButton = false) => {
        if (!currentUser) { 
            alert("Please login to manage favorites."); 
            return; 
        }
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
                const favoriteData = {
                    title: mediaDetails.title || 'N/A',
                    type: mediaDetails.type || 'unknown',
                    poster_path: mediaDetails.poster_path || null,
                    vote_average: mediaDetails.vote_average || null,
                    year: mediaDetails.year || null,
                    tmdb_id: mediaId,
                    addedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await favRef.set(favoriteData);
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
            snapshot.forEach(doc => favoriteItemsData.push({ id: doc.id, ...doc.data() }));
        } catch (error) { 
            console.error("Error fetching favorite details:", error.message); 
        }
        return favoriteItemsData;
    }
};

// --- App Logic & Event Handlers ---
const AppLogic = {
    init: async () => {
        DOMElements.currentYearSpan.textContent = new Date().getFullYear();
        
        const configLoaded = await AuthService.fetchAndSetAccessCode(); 
        AuthService.observeAuthState();

        if (!configLoaded) {
            return; 
        }
        
        DOMElements.submitAccessCodeButton.addEventListener('click', AuthService.handleAccessCode);
        DOMElements.accessCodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') AuthService.handleAccessCode(); });
        
        DOMElements.registerButton.addEventListener('click', AuthService.handleRegister);
        DOMElements.loginButton.addEventListener('click', AuthService.handleLogin);
        DOMElements.googleSignInButton.addEventListener('click', AuthService.handleGoogleSignIn);
        DOMElements.googleSignUpButton.addEventListener('click', AuthService.handleGoogleSignIn);
        DOMElements.logoutButton.addEventListener('click', AuthService.handleLogout);

        DOMElements.showRegisterLink.addEventListener('click', (e) => { e.preventDefault(); DOMElements.loginForm.style.display = 'none'; DOMElements.registerForm.style.display = 'block'; DOMElements.loginError.textContent=''; DOMElements.registerError.textContent='';});
        DOMElements.showLoginLink.addEventListener('click', (e) => { e.preventDefault(); DOMElements.registerForm.style.display = 'none'; DOMElements.loginForm.style.display = 'block'; DOMElements.loginError.textContent=''; DOMElements.registerError.textContent='';});

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
            } else { 
                UIService.clearAutocomplete(); 
            }
        });
        DOMElements.searchInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') { 
                UIService.clearAutocomplete(); 
                AppLogic.triggerSearchOrFilter(true); // Pass true for new API search
            }
        });
        DOMElements.searchButtonMain.addEventListener('click', () => {
            UIService.clearAutocomplete(); 
            AppLogic.triggerSearchOrFilter(true); // Pass true for new API search
        });
        
        DOMElements.applyFiltersButton.addEventListener('click', AppLogic.applyClientSideFiltersAndSort);
        DOMElements.filterTypeSelect.addEventListener('change', AppLogic.applyClientSideFiltersAndSort);
        DOMElements.sortBySelect.addEventListener('change', AppLogic.applyClientSideFiltersAndSort);
        
        // Pagination listeners
        DOMElements.prevPageButton.addEventListener('click', AppLogic.handlePrevPage);
        DOMElements.nextPageButton.addEventListener('click', AppLogic.handleNextPage);

        document.addEventListener('click', (event) => {
            const searchControlsContainer = DOMElements.searchInput.closest('.search-controls-container');
            if (searchControlsContainer && !searchControlsContainer.contains(event.target) && 
                DOMElements.autocompleteSuggestions.style.display === 'block') {
                 UIService.clearAutocomplete();
            }
        });
    },

    featuredNetworks: [
        { name: 'Netflix', id: 203 },
        { name: 'Disney+', id: 372 },
        { name: 'Max', id: 387 },
        { name: 'Prime Video', id: 26 }
    ],

    discoverSectionsConfig: [
        { title: 'Trending Movies This Week', endpoint: 'trending/movie/week', type: 'movie', source: 'tmdb' },
        { title: 'Popular TV Shows', endpoint: 'tv/popular', type: 'tv', source: 'tmdb' },
        { title: 'Top Rated Movies', endpoint: 'movie/top_rated', type: 'movie', source: 'tmdb' },
        { title: 'Trending TV Shows This Week', endpoint: 'trending/tv/week', type: 'tv', source: 'tmdb' },
    ],
    upcomingMoviesConfig: { title: 'Upcoming Movies', endpoint: 'movie/upcoming', type: 'movie', source: 'tmdb' },

    showDiscover: async () => {
        UIService.showView('discover-view');
        DOMElements.discoverView.innerHTML = '';

        const tmdbSections = AppLogic.discoverSectionsConfig.filter(s => s.source === 'tmdb');
        for (const sectionConfig of tmdbSections) {
            await AppLogic.renderDiscoverSection(sectionConfig.title, async () => {
                const data = await ApiService.fetchTMDB(sectionConfig.endpoint, { page: 1 });
                return data.results.map(item => ({ ...item, media_type: item.media_type || sectionConfig.type }));
            });
        }
        
        for (const network of AppLogic.featuredNetworks) {
            await AppLogic.renderDiscoverSection(`Popular on ${network.name}`, async () => {
                const data = await ApiService.fetchWatchmode('list-titles', {
                    source_ids: network.id,
                    sort_by: 'popularity_desc',
                    types: 'movie,tv_series', 
                    limit: 20 
                });
                return (data.titles || []).map(item => ({
                    id: item.tmdb_id || item.id,
                    tmdb_id: item.tmdb_id,
                    imdb_id: item.imdb_id,
                    title: item.title,
                    poster_path: item.poster ? item.poster.replace(TMDB_IMAGE_BASE_URL, '') : null,
                    vote_average: item.user_score,
                    media_type: item.tmdb_type || (item.type === 'movie' ? 'movie' : 'tv'),
                    year: item.year
                }));
            });
        }

        await AppLogic.renderDiscoverSection(AppLogic.upcomingMoviesConfig.title, async () => {
            const data = await ApiService.fetchTMDB(AppLogic.upcomingMoviesConfig.endpoint, { page: 1 });
            return data.results.map(item => ({ ...item, media_type: item.media_type || AppLogic.upcomingMoviesConfig.type }));
        });
    },

    renderDiscoverSection: async (title, fetchDataFunction) => {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'discover-section';
        const titleEl = document.createElement('h2');
        titleEl.className = 'discover-section-title';
        titleEl.textContent = title;
        sectionDiv.appendChild(titleEl);

        const rowWrapper = document.createElement('div');
        rowWrapper.className = 'discover-media-row-wrapper';
        const rowDiv = document.createElement('div');
        rowDiv.className = 'discover-media-row';
        rowDiv.innerHTML = '<p class="loading-message">Loading...</p>';
        rowWrapper.appendChild(rowDiv);

        const prevArrow = document.createElement('button');
        prevArrow.className = 'discover-arrow prev-arrow'; prevArrow.innerHTML = '&#10094;'; prevArrow.title = "Previous";
        const nextArrow = document.createElement('button');
        nextArrow.className = 'discover-arrow next-arrow'; nextArrow.innerHTML = '&#10095;'; nextArrow.title = "Next";
        
        prevArrow.classList.add('hidden-arrow');
        nextArrow.classList.add('hidden-arrow');

        rowWrapper.appendChild(prevArrow); rowWrapper.appendChild(nextArrow);
        sectionDiv.appendChild(rowWrapper);
        DOMElements.discoverView.appendChild(sectionDiv);

        const scrollAmount = () => rowDiv.clientWidth * 0.8;
        prevArrow.addEventListener('click', () => { rowDiv.scrollLeft -= scrollAmount(); });
        nextArrow.addEventListener('click', () => { rowDiv.scrollLeft += scrollAmount(); });

        const updateArrowVisibility = () => {
            const tolerance = 5; 
            const atStart = rowDiv.scrollLeft <= tolerance;
            const isScrollable = rowDiv.scrollWidth > rowDiv.clientWidth + tolerance;
            const atEnd = rowDiv.scrollLeft + rowDiv.clientWidth >= rowDiv.scrollWidth - tolerance;

            if (!isScrollable) {
                prevArrow.classList.add('hidden-arrow'); prevArrow.classList.remove('visible-arrow');
                nextArrow.classList.add('hidden-arrow'); nextArrow.classList.remove('visible-arrow');
            } else {
                prevArrow.classList.toggle('hidden-arrow', atStart); prevArrow.classList.toggle('visible-arrow', !atStart);
                nextArrow.classList.toggle('hidden-arrow', atEnd); nextArrow.classList.toggle('visible-arrow', !atEnd);
            }
        };
        
        const observer = new ResizeObserver(updateArrowVisibility); 
        observer.observe(rowDiv);
        rowDiv.addEventListener('scroll', updateArrowVisibility, { passive: true });

        try {
            const items = await fetchDataFunction();
            UIService.renderMediaRow(rowDiv, items);
            setTimeout(updateArrowVisibility, 100); 
        } catch (error) {
            console.error(`Error loading section "${title}":`, error.message);
            rowDiv.innerHTML = `<p class="error-message">Could not load this section.</p>`;
            updateArrowVisibility();
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
                episodeSelect.disabled = false;
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
            populateEpisodes(parseInt(selectedOption.dataset.episodes));
        });
    },
    showSearch: () => {
        UIService.showView('search-view');
        DOMElements.searchMessage.textContent = 'Type to search for movies and TV shows.';
        DOMElements.searchResultsGrid.innerHTML = '';
        DOMElements.searchInput.value = '';
        currentRawSearchResults = []; 
        searchCurrentPage = 1;
        searchTotalPages = 1;
        AppLogic.updatePaginationControls();
        UIService.clearAutocomplete();
        DOMElements.filterTypeSelect.value = 'all';
        DOMElements.sortBySelect.value = 'relevance';
    },
    performAutocompleteSearch: async (query) => {
        if (query.length < 3) { 
            UIService.renderAutocompleteSuggestions([]); 
            return; 
        }
        try {
            const data = await ApiService.fetchWatchmode('autocomplete-search', { search_value: query, search_type: 2 });
             UIService.renderAutocompleteSuggestions(data && data.results ? data.results : []);
        } catch (error) {
            console.warn("Autocomplete search failed:", error.message);
            UIService.renderAutocompleteSuggestions([]);
        }
    },
    triggerSearchOrFilter: (newSearch = false) => {
        const query = DOMElements.searchInput.value.trim();
        if (newSearch) { // If it's a new keyword search (from Enter or Search button)
            if (query) {
                currentSearchQuery = query; // Store the new query
                searchCurrentPage = 1; // Reset to page 1 for new search
                AppLogic.performSearchAPICall(currentSearchQuery, searchCurrentPage);
            } else {
                DOMElements.searchMessage.textContent = 'Please enter a search term.';
                currentRawSearchResults = [];
                searchCurrentPage = 1;
                searchTotalPages = 1;
                AppLogic.applyClientSideFiltersAndSort(); // Clears grid and updates pagination
            }
        } else { // This case is for applying filters to existing results or if no query
             AppLogic.applyClientSideFiltersAndSort();
        }
    },
    performSearchAPICall: async (query, page = 1) => {
        UIService.clearAutocomplete();
        UIService.showView('search-view'); // Ensure search view is active

        if (!query) {
            DOMElements.searchMessage.textContent = 'Please enter a search term.';
            currentRawSearchResults = [];
            searchCurrentPage = page;
            searchTotalPages = 0; // No query, no pages
            AppLogic.applyClientSideFiltersAndSort(); // Will show "No results"
            AppLogic.updatePaginationControls();
            return;
        }
        
        DOMElements.searchMessage.textContent = `Searching for "${query}" (Page ${page})...`;
        // For a new page fetch, we clear the grid until new results are in
        DOMElements.searchResultsGrid.innerHTML = '<p class="loading-message">Loading results...</p>';


        try {
            const endpoint = 'search/multi';
            const fetchParams = { query: query, page: page, include_adult: 'false' };
            
            console.log(`Keyword Search API Call: endpoint=${endpoint}, params=`, JSON.stringify(fetchParams));
            const data = await ApiService.fetchTMDB(endpoint, fetchParams);
            console.log(`Keyword Search Response Data (Page ${page}):`, data);
            
            currentRawSearchResults = (data.results || [])
                .filter(item => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path) 
                .map(item => ({ ...item, id: String(item.id)}));
            
            searchCurrentPage = data.page || page;
            searchTotalPages = data.total_pages || 0;
            
            // After fetching, apply current dropdown filters/sorts to this new page's data
            AppLogic.applyClientSideFiltersAndSort(); 
            AppLogic.updatePaginationControls();

        } catch (error) {
            console.error("Search API Call failed:", error.message);
            DOMElements.searchMessage.textContent = `Search failed: ${error.message}. Please try again.`;
            currentRawSearchResults = [];
            searchTotalPages = 0;
            AppLogic.applyClientSideFiltersAndSort(); // Will show "No results"
            AppLogic.updatePaginationControls();
        }
    },
    applyClientSideFiltersAndSort: () => {
        let processedResults = [...currentRawSearchResults]; // Operate on the current page's raw results
        const typeFilter = DOMElements.filterTypeSelect.value;
        const sortBy = DOMElements.sortBySelect.value;

        console.log(`Applying client filters: Type='${typeFilter}', SortBy='${sortBy}' on ${processedResults.length} raw items from current page.`);

        if (typeFilter !== 'all') {
            processedResults = processedResults.filter(item => item.media_type === typeFilter);
        }

        if (sortBy !== 'relevance' && processedResults.length > 0) { 
            const [sortField, sortOrder] = sortBy.split('.');
            processedResults.sort((a, b) => {
                let valA, valB;
                const mediaTypeA = a.media_type;
                const mediaTypeB = b.media_type;

                if (sortField === 'release_date') {
                    valA = new Date(mediaTypeA === 'movie' ? a.release_date : a.first_air_date || '1900-01-01').getTime();
                    valB = new Date(mediaTypeB === 'movie' ? b.release_date : b.first_air_date || '1900-01-01').getTime();
                } else if (sortField === 'vote_average') {
                    valA = parseFloat(a.vote_average || 0);
                    valB = parseFloat(b.vote_average || 0);
                } else if (sortField === 'popularity') {
                    valA = parseFloat(a.popularity || 0);
                    valB = parseFloat(b.popularity || 0);
                } else {
                    return 0; 
                }

                if (isNaN(valA)) valA = (sortOrder === 'asc' ? Infinity : -Infinity);
                if (isNaN(valB)) valB = (sortOrder === 'asc' ? Infinity : -Infinity);

                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }
        
        const query = currentSearchQuery; // Use the stored current search query for messages
        if (processedResults.length > 0) {
             DOMElements.searchMessage.textContent = query ? `Results for "${query}":` : 'Displaying items:';
        } else if (query && currentRawSearchResults.length > 0) { // Had raw results, but filters made it empty
             DOMElements.searchMessage.textContent = `No results match your current filters for "${query}".`;
        } else if (query) { // No raw results for the query
             DOMElements.searchMessage.textContent = `No results found for "${query}".`;
        } else { // No query and no raw results (e.g. initial state of search page or after clearing)
            DOMElements.searchMessage.textContent = 'Type to search for movies and TV shows.';
        }

        UIService.renderGrid(DOMElements.searchResultsGrid, processedResults, null);
        AppLogic.updatePaginationControls(); // Update pagination based on current search state
    },
    handleNextPage: () => {
        if (searchCurrentPage < searchTotalPages) {
            AppLogic.performSearchAPICall(currentSearchQuery, searchCurrentPage + 1);
        }
    },
    handlePrevPage: () => {
        if (searchCurrentPage > 1) {
            AppLogic.performSearchAPICall(currentSearchQuery, searchCurrentPage - 1);
        }
    },
    updatePaginationControls: () => {
        if (currentRawSearchResults.length > 0 && searchTotalPages > 0) {
            DOMElements.paginationControls.style.display = 'flex';
            DOMElements.pageInfo.textContent = `Page ${searchCurrentPage} of ${searchTotalPages}`;
            DOMElements.prevPageButton.disabled = searchCurrentPage <= 1;
            DOMElements.nextPageButton.disabled = searchCurrentPage >= searchTotalPages;
        } else {
            DOMElements.paginationControls.style.display = 'none';
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
        const mappedFavorites = favoriteItemsData.map(fav => ({
            id: fav.tmdb_id || fav.id,
            title: fav.title,
            poster_path: fav.poster_path,
            vote_average: fav.vote_average,
            media_type: fav.type,
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
            alert("Error: Media details not loaded."); 
            return;
        }
        const { id: tmdbId, title: mediaTitle, name, type: mediaType } = currentOpenDetail;
        const finalTitle = mediaTitle || name;

        let season, episode;
        if (mediaType === 'tv') {
            const seasonSelect = document.getElementById('season-select');
            const episodeSelect = document.getElementById('episode-select');
            if (seasonSelect && episodeSelect && seasonSelect.value && episodeSelect.value) {
                season = seasonSelect.value;
                episode = episodeSelect.value;
                if (!season || !episode || episodeSelect.disabled) {
                    alert("Please ensure a valid season and episode are selected.");
                    return;
                }
            } else if (currentOpenDetail.seasons && currentOpenDetail.seasons.some(s => s.season_number === 1 && s.episode_count > 0)) {
                season = '1'; episode = '1';
            } else {
                alert("Season and episode information is unavailable for this TV show.");
                return;
            }
        }
        UIService.renderPlayer(mediaType, tmdbId, finalTitle, season, episode);
    }
};

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', AppLogic.init);
