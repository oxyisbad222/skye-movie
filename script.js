// script.js

// --- Constants & Config ---
const TMDB_API_KEY = 'cf4df30d74d9e322e596d876fd7db13e';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500'; // For posters

const WATCHMODE_API_KEY = 'GnIdrvUyNWlSVmLnZcuxdSCB4jSy18icYwMEojuP'; // WARNING: Exposing this client-side is insecure.
const WATCHMODE_BASE_URL = 'https://api.watchmode.com/v1';

// IMPORTANT: In a Vercel deployment, SKYE_MOVIE_ACCESS_CODE should come from environment variables.
// For this example, it's hardcoded. Ensure this is secured or managed appropriately in production.
// You would typically set this in Vercel project settings and potentially use a serverless function
// to verify it if you wanted more security than just client-side check.
const SKYE_MOVIE_ACCESS_CODE = '123456'; // Replace with your actual Vercel Env Var value or system
const SITE_MAIN_THEME_COLOR = '282c34'; // Dark theme for player (hex without #)
const SITE_ACCENT_COLOR = 'FF69B4'; // Pink for player accents (hex without #)

const firebaseConfig = {
  apiKey: "AIzaSyCfzT7R2S4zezUeH7BayyQtKSTZ0fDfMGw",
  authDomain: "skye-movie.firebaseapp.com",
  projectId: "skye-movie",
  storageBucket: "skye-movie.storagebucket.app", // Corrected: .firebasestorage.app
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
  // const analytics = firebase.analytics(); // Optional
} catch (e) {
  console.error("Firebase initialization error:", e);
  alert("Could not initialize Firebase. Some features may not work.");
}

// --- State Variables ---
let currentUser = null;
let currentWatchmodeRateLimits = {};
let currentView = 'discover'; // To track which main view is active
let lastSelectedMediaDetails = null; // Store details for player/back navigation
let userFavorites = new Set(); // Store IDs of favorited items for quick checks

// --- DOM Elements (cached for performance) ---
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
    navButtons: [], // Will populate later

    discoverView: document.getElementById('discover-view'),
    discoverGrid: document.getElementById('discover-grid'),

    searchView: document.getElementById('search-view'),
    searchInput: document.getElementById('search-input'),
    searchButton: document.getElementById('search-button'),
    searchResultsGrid: document.getElementById('search-results-grid'),
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
};
DOMElements.navButtons = [DOMElements.navDiscover, DOMElements.navSearch, DOMElements.navFavorites];


// --- API Cache (Simple localStorage with TTL) ---
const ApiCache = {
    CACHE_PREFIX: 'skyeMovieCache_',
    DEFAULT_TTL: 3600 * 1000, // 1 hour

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
        const item = {
            value: value,
            expiry: now + ttl,
        };
        try {
            localStorage.setItem(ApiCache.CACHE_PREFIX + key, JSON.stringify(item));
        } catch (error) {
            console.error("Cache write error (Quota Exceeded?):", error);
            // Implement cache cleaning strategy if quota is an issue
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
        console.log('Watchmode Rate Limits Updated:', currentWatchmodeRateLimits);
        if (currentWatchmodeRateLimits.remaining && parseInt(currentWatchmodeRateLimits.remaining) < 10) {
            console.warn("Watchmode API rate limit remaining is low!");
            // Potentially adjust cache TTL or disable some features temporarily
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
            if (!response.ok) throw new Error(`TMDB API Error: ${response.statusText}`);
            const data = await response.json();
            ApiCache.set(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Error fetching from TMDB:', error);
            throw error;
        }
    },

    fetchWatchmode: async (endpoint, params = {}, useCache = true) => {
        const urlParams = new URLSearchParams({ apiKey: WATCHMODE_API_KEY, ...params });
        const url = `${WATCHMODE_BASE_URL}/${endpoint}/?${urlParams}`; // Note the trailing slash for some WM endpoints
        
        const cacheKey = `watchmode_${endpoint}_${JSON.stringify(params)}`;
        if (useCache) {
            const cached = ApiCache.get(cacheKey);
            if (cached) return cached;
        }
        
        try {
            console.log(`Fetching Watchmode: ${url}`); // Log the call
            const response = await fetch(url);
            ApiCache.updateRateLimits(response.headers);
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({})); // Try to parse error
                 console.error('Watchmode API Error Response:', errorData);
                 throw new Error(`Watchmode API Error (${response.status}): ${response.statusText} - ${errorData.message || ''}`);
            }
            const data = await response.json();
            if (useCache) ApiCache.set(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Error fetching from Watchmode:', error);
            throw error; // Re-throw to be caught by UI logic
        }
    },

    getMappletvPlayerUrl: (tmdbId, title, season, episode) => {
        // mappletv.uk structure: https://mappletv.uk/player/{id}?season={s}&episode={e}
        // {id} is TMDB or IMDB ID. We will use TMDB ID.
        let playerUrl = `https://mappletv.uk/player/${tmdbId}`;
        const params = new URLSearchParams();
        if (season) params.append('season', season);
        if (episode) params.append('episode', episode);
        
        params.append('title', encodeURIComponent(title)); // Display media title
        params.append('poster', '1'); // Show poster image
        params.append('autoPlay', '1');
        params.append('theme', SITE_MAIN_THEME_COLOR); // Theme to match our site
        // params.append('accent', SITE_ACCENT_COLOR); // If mappletv supports accent color
        params.append('nextButton', '1'); // Display "Next Episode" button
        params.append('autoNext', '1'); // Auto play next (requires autoPlay)

        const queryString = params.toString();
        if (queryString) playerUrl += `?${queryString}`;
        
        return playerUrl;
    }
};

// --- UI Service ---
const UIService = {
    showSection: (sectionElement) => {
        [DOMElements.accessGateSection, DOMElements.authSection, DOMElements.mainAppSection].forEach(sec => {
            sec.classList.add('hidden-section');
            sec.classList.remove('active-section');
        });
        sectionElement.classList.remove('hidden-section');
        sectionElement.classList.add('active-section');
    },

    showView: (viewId) => {
        currentView = viewId; // Track current view for back button logic etc.
        document.querySelectorAll('#main-app-section .view').forEach(view => {
            view.classList.remove('active-view');
        });
        document.getElementById(viewId).classList.add('active-view');
        
        // Update nav button active state
        DOMElements.navButtons.forEach(btn => btn.classList.remove('active-nav'));
        if (viewId === 'discover-view') DOMElements.navDiscover.classList.add('active-nav');
        else if (viewId === 'search-view') DOMElements.navSearch.classList.add('active-nav');
        else if (viewId === 'favorites-view') DOMElements.navFavorites.classList.add('active-nav');
        
        window.scrollTo(0,0); // Scroll to top on view change
    },

    renderMediaCard: (mediaItem, isFavoriteOverride = null) => {
        // Determine media type and extract common properties
        const isMovie = mediaItem.media_type === 'movie' || mediaItem.title !== undefined && mediaItem.release_date !== undefined;
        const isTv = mediaItem.media_type === 'tv' || mediaItem.name !== undefined && mediaItem.first_air_date !== undefined;

        let id = mediaItem.id; // TMDB ID by default
        let title = mediaItem.title || mediaItem.name;
        let posterPath = mediaItem.poster_path;
        let rating = mediaItem.vote_average ? mediaItem.vote_average.toFixed(1) : (mediaItem.user_rating ? mediaItem.user_rating.toFixed(1) : 'N/A');
        let type = 'unknown';
        if(mediaItem.tmdb_id) id = mediaItem.tmdb_id; // Watchmode often provides tmdb_id
        if(mediaItem.type) type = mediaItem.type; // Watchmode type (movie, tv_series, etc.)

        if (isMovie) type = 'movie';
        if (isTv) type = 'tv';

        const posterUrl = posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : 'https://via.placeholder.com/180x270.png?text=No+Image';
        
        const isFavorited = isFavoriteOverride !== null ? isFavoriteOverride : userFavorites.has(String(id));

        const card = document.createElement('div');
        card.className = 'media-card';
        card.dataset.id = id;
        card.dataset.type = type; // Store type (movie/tv)
        card.dataset.title = title; // Store title for player
        
        // If mediaItem is from Watchmode search results, it might have 'tmdb_id'
        // We need this to fetch full details from TMDB or Watchmode for playback
        if (mediaItem.tmdb_id) card.dataset.tmdbId = mediaItem.tmdb_id;
        if (mediaItem.imdb_id) card.dataset.imdbId = mediaItem.imdb_id;


        card.innerHTML = `
            <img src="${posterUrl}" alt="${title}" loading="lazy">
            <p class="title">${title}</p>
            ${rating !== 'N/A' ? `<span class="rating">⭐ ${rating}</span>` : ''}
            <button class="add-to-favorites ${isFavorited ? 'favorited' : ''}" data-id="${id}" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
                ${isFavorited ? '♥' : '♡'}
            </button>
        `;
        card.querySelector('img').addEventListener('click', () => AppLogic.handleMediaItemClick(id, type));
        card.querySelector('.title').addEventListener('click', () => AppLogic.handleMediaItemClick(id, type));
        
        const favButton = card.querySelector('.add-to-favorites');
        favButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click event
            const currentIsFavorited = favButton.classList.contains('favorited');
            FavoritesService.toggleFavorite(id, title, type, posterPath, rating, currentIsFavorited, favButton);
        });
        return card;
    },

    renderGrid: (gridElement, items, itemRenderer) => {
        gridElement.innerHTML = ''; // Clear previous results
        if (!items || items.length === 0) {
            gridElement.innerHTML = '<p>No results found.</p>';
            return;
        }
        items.forEach(item => {
          // Filter out items without a poster or title for better UX
          if ((item.poster_path || item.image_url) && (item.title || item.name)) {
            gridElement.appendChild(itemRenderer(item));
          }
        });
    },
    
    renderAutocompleteSuggestions: (suggestions) => {
        DOMElements.autocompleteSuggestions.innerHTML = '';
        if (!suggestions || suggestions.length === 0) {
            DOMElements.autocompleteSuggestions.style.display = 'none';
            return;
        }
        suggestions.slice(0, 5).forEach(item => { // Show top 5
            const div = document.createElement('div');
            div.textContent = `${item.name} (${item.year || 'N/A'})`;
            div.addEventListener('click', () => {
                DOMElements.searchInput.value = item.name;
                DOMElements.autocompleteSuggestions.style.display = 'none';
                AppLogic.performSearch(item.name); // Directly search
            });
            DOMElements.autocompleteSuggestions.appendChild(div);
        });
        DOMElements.autocompleteSuggestions.style.display = 'block';
    },

    renderMediaDetail: async (mediaId, mediaType) => {
        DOMElements.mediaDetailContent.innerHTML = '<p>Loading details...</p>';
        UIService.showView('detail-view');

        try {
            let details;
            let sources = [];
            let tmdbIdForPlayer = mediaId; // Assume mediaId is TMDB ID initially

            // Watchmode's /title/{title_id}/details is very comprehensive
            // If we have a watchmode ID (e.g. from search) we could use it
            // For now, assume mediaId is TMDB ID and we fetch from TMDB, then Watchmode for sources
            if (mediaType === 'movie') {
                details = await ApiService.fetchTMDB(`movie/${mediaId}`, { append_to_response: 'credits,videos' });
            } else if (mediaType === 'tv') {
                details = await ApiService.fetchTMDB(`tv/${mediaId}`, { append_to_response: 'credits,videos,external_ids' });
            } else { // If type is unknown, try to get it from Watchmode using TMDB ID
                 const watchmodeTitleLookup = await ApiService.fetchWatchmode(`title/tmdb-${mediaType /*actually tmdb type*/ }-${mediaId}/details`);
                 if(watchmodeTitleLookup && watchmodeTitleLookup.id){
                    details = watchmodeTitleLookup; // Use Watchmode details directly
                    tmdbIdForPlayer = details.tmdb_id || mediaId;
                    mediaType = details.type === 'movie' ? 'movie' : 'tv'; // Normalize type
                 } else {
                    throw new Error("Could not determine media type or fetch details.");
                 }
            }
            
            lastSelectedMediaDetails = { ...details, id: tmdbIdForPlayer, type: mediaType }; // Store for player
            
            // Fetch sources from Watchmode using TMDB ID
            // Watchmode API expects type-id, e.g., tmdb-movie-123 or tmdb-tv-123
            // If we got details from TMDB, mediaId IS the TMDB ID.
            // The `details` object from TMDB for TV shows might not have `external_ids.imdb_id` directly, needs to be checked.
            // Let's try to use Watchmode's title lookup by TMDB ID if it's more reliable for sources.
            const watchmodeTitleId = `tmdb-${mediaType}-${tmdbIdForPlayer}`;
            try {
                const sourceDetails = await ApiService.fetchWatchmode(`title/${watchmodeTitleId}/sources`);
                if(sourceDetails && Array.isArray(sourceDetails)) {
                     sources = sourceDetails
                        .filter(s => s.type === 'sub') // Only subscription sources
                        .map(s => s.name);
                }
            } catch (e) {
                console.warn("Could not fetch sources from Watchmode:", e.message);
            }


            const title = details.title || details.name;
            const posterPath = details.poster_path;
            const overview = details.overview;
            const rating = details.vote_average ? details.vote_average.toFixed(1) : (details.user_rating ? details.user_rating.toFixed(1) : 'N/A');
            const releaseDate = details.release_date || details.first_air_date;
            const genres = details.genres ? details.genres.map(g => g.name).join(', ') : 'N/A';
            const posterUrl = posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : 'https://via.placeholder.com/300x450.png?text=No+Image';

            let seasonsHtml = '';
            if (mediaType === 'tv' && details.seasons) {
                // Filter out "Specials" season (season_number 0) unless it's the only one.
                const displaySeasons = details.seasons.filter(s => s.season_number > 0 || details.seasons.length === 1);

                seasonsHtml = `
                    <div id="season-episode-selector">
                        <label for="season-select">Season:</label>
                        <select id="season-select">
                            ${displaySeasons.map(s => `<option value="${s.season_number}" data-episodes="${s.episode_count}">${s.name} (${s.episode_count} episodes)</option>`).join('')}
                        </select>
                        <label for="episode-select">Episode:</label>
                        <select id="episode-select">
                            </select>
                    </div>
                `;
            }
            
            const isFavorited = userFavorites.has(String(tmdbIdForPlayer));

            DOMElements.mediaDetailContent.innerHTML = `
                <img src="${posterUrl}" alt="${title}" class="detail-poster">
                <div class="media-info">
                    <h3>${title}</h3>
                    <p><strong>Rating:</strong> ⭐ ${rating}</p>
                    <p><strong>Released:</strong> ${releaseDate ? new Date(releaseDate).toLocaleDateString() : 'N/A'}</p>
                    <p><strong>Genres:</strong> ${genres}</p>
                    <p><strong>Plot:</strong> ${overview || 'No overview available.'}</p>
                    ${sources.length > 0 ? `<p><strong>Available on (Watchmode):</strong> ${sources.join(', ')}</p>` : '<p>No subscription sources found on Watchmode.</p>'}
                    ${seasonsHtml}
                    <div class="play-button-container ${mediaType === 'tv' ? 'is-series' : ''}">
                        <button id="play-media-button">▶ Play ${mediaType === 'tv' ? 'Episode' : 'Movie'}</button>
                         <button id="detail-favorite-button" class="add-to-favorites ${isFavorited ? 'favorited' : ''}" data-id="${tmdbIdForPlayer}" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
                            ${isFavorited ? '♥ Favorited' : '♡ Add to Favorites'}
                        </button>
                    </div>
                </div>
            `;
            
            const detailFavButton = DOMElements.mediaDetailContent.querySelector('#detail-favorite-button');
            if(detailFavButton) {
                detailFavButton.addEventListener('click', () => {
                     const currentIsFavorited = detailFavButton.classList.contains('favorited');
                     FavoritesService.toggleFavorite(tmdbIdForPlayer, title, mediaType, posterPath, rating, currentIsFavorited, detailFavButton, true);
                });
            }


            if (mediaType === 'tv') {
                const seasonSelect = document.getElementById('season-select');
                const episodeSelect = document.getElementById('episode-select');
                
                const populateEpisodes = (seasonNumber, episodeCount) => {
                    episodeSelect.innerHTML = '';
                    for (let i = 1; i <= episodeCount; i++) {
                        episodeSelect.add(new Option(`Episode ${i}`, i));
                    }
                };

                if (seasonSelect) {
                     // Initial population for the first season
                    const initialSeasonOption = seasonSelect.options[seasonSelect.selectedIndex];
                    if (initialSeasonOption) {
                        populateEpisodes(initialSeasonOption.value, parseInt(initialSeasonOption.dataset.episodes));
                    }
                    seasonSelect.addEventListener('change', (e) => {
                        const selectedOption = e.target.options[e.target.selectedIndex];
                        populateEpisodes(selectedOption.value, parseInt(selectedOption.dataset.episodes));
                    });
                }
            }

            document.getElementById('play-media-button').addEventListener('click', () => {
                AppLogic.handlePlayMedia(tmdbIdForPlayer, title, mediaType);
            });

        } catch (error) {
            console.error('Error rendering media detail:', error);
            DOMElements.mediaDetailContent.innerHTML = `<p>Error loading details: ${error.message}. Please try again.</p>`;
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
    handleAccessCode: () => {
        const code = DOMElements.accessCodeInput.value.trim();
        if (code === SKYE_MOVIE_ACCESS_CODE) {
            DOMElements.accessError.textContent = '';
            UIService.showSection(DOMElements.authSection); // Move to auth
        } else {
            DOMElements.accessError.textContent = 'Invalid access code.';
        }
    },

    handleRegister: async () => {
        const email = DOMElements.registerEmailInput.value;
        const password = DOMElements.registerPasswordInput.value;
        DOMElements.registerError.textContent = '';
        try {
            await fbAuth.createUserWithEmailAndPassword(email, password);
            // User will be signed in automatically, handled by onAuthStateChanged
        } catch (error) {
            DOMElements.registerError.textContent = error.message;
            console.error("Registration error:", error);
        }
    },

    handleLogin: async () => {
        const email = DOMElements.loginEmailInput.value;
        const password = DOMElements.loginPasswordInput.value;
        DOMElements.loginError.textContent = '';
        try {
            await fbAuth.signInWithEmailAndPassword(email, password);
            // User will be signed in, handled by onAuthStateChanged
        } catch (error) {
            DOMElements.loginError.textContent = error.message;
            console.error("Login error:", error);
        }
    },

    handleLogout: async () => {
        try {
            await fbAuth.signOut();
            // User will be signed out, handled by onAuthStateChanged
        } catch (error) {
            console.error("Logout error:", error);
            alert("Error logging out: " + error.message);
        }
    },

    observeAuthState: () => {
        fbAuth.onAuthStateChanged(async user => {
            if (user) {
                currentUser = user;
                DOMElements.userEmailDisplay.textContent = user.email;
                await FavoritesService.loadFavorites(); // Load favorites for the logged-in user
                UIService.showSection(DOMElements.mainAppSection);
                if (currentView === 'discover-view' || !document.querySelector('.view.active-view')) { // Default to discover on login
                    AppLogic.showDiscover();
                } else { // Or restore current/last view if applicable
                    UIService.showView(currentView);
                }
            } else {
                currentUser = null;
                userFavorites.clear(); // Clear local favorites cache
                DOMElements.userEmailDisplay.textContent = '';
                // Show login form, ensure access gate is passed if it was the entry point
                if (DOMElements.authSection.classList.contains('hidden-section') && DOMElements.accessGateSection.classList.contains('hidden-section')) {
                     UIService.showSection(DOMElements.authSection); // If already past gate, show auth
                } else if (!DOMElements.accessGateSection.classList.contains('active-section')) {
                     UIService.showSection(DOMElements.authSection); // Default to auth if not on access gate
                }
                 DOMElements.loginForm.style.display = 'block';
                 DOMElements.registerForm.style.display = 'none';
            }
        });
    }
};

// --- Favorites Service ---
const FavoritesService = {
    loadFavorites: async () => {
        if (!currentUser) return;
        userFavorites.clear(); // Clear local cache before loading
        try {
            const snapshot = await fbFirestore.collection('users').doc(currentUser.uid).collection('favorites').get();
            snapshot.forEach(doc => {
                userFavorites.add(doc.id); // Store TMDB ID as favorite
                // Optionally store full data if needed elsewhere: userFavorites.set(doc.id, doc.data());
            });
            // If currently on favorites view, refresh it
            if (document.getElementById('favorites-view').classList.contains('active-view')) {
                AppLogic.showFavorites();
            }
            // Refresh favorite buttons on any currently displayed media cards
            document.querySelectorAll('.media-card .add-to-favorites').forEach(btn => {
                const cardId = btn.dataset.id;
                if (userFavorites.has(cardId)) {
                    btn.classList.add('favorited');
                    btn.innerHTML = '♥';
                    btn.title = 'Remove from favorites';
                } else {
                    btn.classList.remove('favorited');
                    btn.innerHTML = '♡';
                    btn.title = 'Add to favorites';
                }
            });
        } catch (error) {
            console.error("Error loading favorites:", error);
        }
    },

    toggleFavorite: async (mediaId, title, type, posterPath, rating, isCurrentlyFavorited, buttonElement, isDetailButton = false) => {
        if (!currentUser) {
            alert("Please login to manage favorites.");
            return;
        }
        mediaId = String(mediaId); // Ensure ID is a string for Firestore doc ID and Set consistency

        try {
            const favRef = fbFirestore.collection('users').doc(currentUser.uid).collection('favorites').doc(mediaId);
            if (isCurrentlyFavorited) { // Remove favorite
                await favRef.delete();
                userFavorites.delete(mediaId);
                if (buttonElement) {
                    buttonElement.classList.remove('favorited');
                    buttonElement.innerHTML = isDetailButton ? '♡ Add to Favorites' : '♡';
                    buttonElement.title = 'Add to favorites';
                }
                console.log(`Removed ${title} from favorites.`);
            } else { // Add favorite
                await favRef.set({
                    title: title,
                    type: type,
                    poster_path: posterPath,
                    rating: rating,
                    addedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                userFavorites.add(mediaId);
                if (buttonElement) {
                    buttonElement.classList.add('favorited');
                    buttonElement.innerHTML = isDetailButton ? '♥ Favorited' : '♥';
                    buttonElement.title = 'Remove from favorites';
                }
                console.log(`Added ${title} to favorites.`);
            }
             // If on favorites view and an item is removed, re-render
            if (isCurrentlyFavorited && document.getElementById('favorites-view').classList.contains('active-view')) {
                AppLogic.showFavorites();
            }
        } catch (error) {
            console.error("Error toggling favorite:", error);
            alert("Error updating favorites: " + error.message);
        }
    },
    
    getFavoritedItemsDetails: async () => {
        if (!currentUser || userFavorites.size === 0) return [];
        const favoriteItems = [];
        try {
            const snapshot = await fbFirestore.collection('users').doc(currentUser.uid).collection('favorites').orderBy('addedAt', 'desc').get();
            snapshot.forEach(doc => {
                favoriteItems.push({ id: doc.id, ...doc.data() });
            });
        } catch (error) {
            console.error("Error fetching favorite details:", error);
        }
        return favoriteItems;
    }
};


// --- App Logic & Event Handlers ---
const AppLogic = {
    init: () => {
        // Initial UI Setup
        if (!currentUser && SKYE_MOVIE_ACCESS_CODE) { // Only show access gate if code is set and no user
            UIService.showSection(DOMElements.accessGateSection);
        } else if (!currentUser) {
            UIService.showSection(DOMElements.authSection); // Skip gate if no code or already passed somehow
        }
        // Auth state observer will handle main app display after login

        // Event Listeners
        DOMElements.submitAccessCodeButton.addEventListener('click', AuthService.handleAccessCode);
        DOMElements.accessCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') AuthService.handleAccessCode();
        });
        
        DOMElements.registerButton.addEventListener('click', AuthService.handleRegister);
        DOMElements.loginButton.addEventListener('click', AuthService.handleLogin);
        DOMElements.logoutButton.addEventListener('click', AuthService.handleLogout);

        DOMElements.showRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            DOMElements.loginForm.style.display = 'none';
            DOMElements.registerForm.style.display = 'block';
        });
        DOMElements.showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            DOMElements.registerForm.style.display = 'none';
            DOMElements.loginForm.style.display = 'block';
        });

        // Navigation
        DOMElements.navDiscover.addEventListener('click', AppLogic.showDiscover);
        DOMElements.navSearch.addEventListener('click', AppLogic.showSearch);
        DOMElements.navFavorites.addEventListener('click', AppLogic.showFavorites);

        // Search
        let searchDebounceTimer;
        DOMElements.searchInput.addEventListener('keyup', (e) => {
            clearTimeout(searchDebounceTimer);
            const query = DOMElements.searchInput.value.trim();
            if (e.key === 'Enter') {
                 UIService.clearAutocomplete();
                 AppLogic.performSearch(query);
            } else if (query.length > 2) { // Autocomplete after 2 chars
                searchDebounceTimer = setTimeout(() => {
                    AppLogic.performAutocompleteSearch(query);
                }, 300); // 300ms debounce
            } else {
                UIService.clearAutocomplete();
            }
        });
        DOMElements.searchButton.addEventListener('click', () => {
            UIService.clearAutocomplete();
            AppLogic.performSearch(DOMElements.searchInput.value.trim());
        });
        // Hide autocomplete if clicked outside
        document.addEventListener('click', (event) => {
            if (!DOMElements.searchInput.contains(event.target) && !DOMElements.autocompleteSuggestions.contains(event.target)) {
                UIService.clearAutocomplete();
            }
        });


        // Detail/Player View Back Buttons
        DOMElements.backToListButton.addEventListener('click', () => UIService.showView(currentView || 'discover-view')); // Go back to last main view
        DOMElements.closePlayerButton.addEventListener('click', () => {
            DOMElements.mappletvPlayerContainer.innerHTML = ''; // Clear player
            UIService.showView('detail-view'); // Go back to detail view
        });
        
        AuthService.observeAuthState(); // Start listening for auth changes
    },

    showDiscover: async () => {
        UIService.showView('discover-view');
        DOMElements.discoverGrid.innerHTML = '<p>Loading popular content...</p>';
        try {
            // Fetch trending from TMDB as a default for discover
            const data = await ApiService.fetchTMDB('trending/all/week');
            UIService.renderGrid(DOMElements.discoverGrid, data.results, UIService.renderMediaCard);
        } catch (error) {
            DOMElements.discoverGrid.innerHTML = '<p>Could not load content. Please try again later.</p>';
        }
    },

    showSearch: () => {
        UIService.showView('search-view');
        // DOMElements.searchResultsGrid.innerHTML = '<p>Enter a search term above.</p>'; // Optional initial message
    },
    
    performAutocompleteSearch: async (query) => {
        if (query.length < 3) {
            UIService.renderAutocompleteSuggestions([]); // Clear if query too short
            return;
        }
        try {
            // Watchmode autocomplete:
            const data = await ApiService.fetchWatchmode('autocomplete-search', { search_value: query, search_type: 2 }); // search_type 2 for titles
             if (data && data.results) {
                UIService.renderAutocompleteSuggestions(data.results);
            } else {
                UIService.renderAutocompleteSuggestions([]);
            }
        } catch (error) {
            console.warn("Autocomplete search failed:", error.message);
            UIService.renderAutocompleteSuggestions([]); // Clear on error
        }
    },

    performSearch: async (query) => {
        UIService.clearAutocomplete();
        if (!query) {
            DOMElements.searchResultsGrid.innerHTML = '<p>Please enter a search term.</p>';
            return;
        }
        DOMElements.searchResultsGrid.innerHTML = `<p>Searching for "${query}"...</p>`;
        UIService.showView('search-view'); // Ensure search view is active

        try {
            // Use Watchmode search first if possible, as it gives source info potential
            const watchmodeData = await ApiService.fetchWatchmode('search', { search_field: 'name', search_value: query, types: 'movie,tv_series' });
            
            let results = [];
            if (watchmodeData && watchmodeData.title_results && watchmodeData.title_results.length > 0) {
                 results = watchmodeData.title_results.map(item => ({
                    id: item.tmdb_id || item.id, // Prefer TMDB ID if available
                    tmdb_id: item.tmdb_id,
                    imdb_id: item.imdb_id,
                    title: item.name,
                    poster_path: item.poster || (item.image_url ? item.image_url.split('/').pop() : null), // Extract path if full URL
                    vote_average: item.user_score, // Watchmode uses user_score
                    media_type: item.type === 'movie' ? 'movie' : 'tv', // Normalize
                    type: item.type, // Keep original Watchmode type
                    year: item.year
                }));

            } else { // Fallback to TMDB if Watchmode yields no results or if preferred
                const tmdbData = await ApiService.fetchTMDB('search/multi', { query: query });
                results = tmdbData.results.filter(item => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path);
            }
            UIService.renderGrid(DOMElements.searchResultsGrid, results, UIService.renderMediaCard);

        } catch (error) {
            DOMElements.searchResultsGrid.innerHTML = `<p>Search failed: ${error.message}. Try TMDB or check console.</p>`;
        }
    },

    showFavorites: async () => {
        UIService.showView('favorites-view');
        DOMElements.favoritesGrid.innerHTML = '<p>Loading your favorites...</p>';
        if (!currentUser) {
            DOMElements.favoritesGrid.innerHTML = '<p>Please login to see your favorites.</p>';
            return;
        }
        const favoriteItems = await FavoritesService.getFavoritedItemsDetails();
        if (favoriteItems.length === 0) {
            DOMElements.favoritesGrid.innerHTML = '<p>You have no favorites yet. Find something you like!</p>';
            return;
        }
        // The renderMediaCard expects items in a TMDB-like format or needs adaptation
        // For now, ensure the data passed has id, title, poster_path, vote_average, media_type
        const mappedFavorites = favoriteItems.map(fav => ({
            id: fav.id, // This is the TMDB ID
            title: fav.title,
            poster_path: fav.poster_path,
            vote_average: fav.rating, // Assuming rating was stored
            media_type: fav.type // movie or tv
        }));

        UIService.renderGrid(DOMElements.favoritesGrid, mappedFavorites, (item) => UIService.renderMediaCard(item, true)); // Pass true for isFavoriteOverride
    },

    handleMediaItemClick: async (mediaId, mediaTypeFromCard) => {
        // mediaId from card is usually TMDB ID.
        // mediaTypeFromCard is 'movie' or 'tv' or from Watchmode 'tv_series' etc.
        // Normalize mediaType for TMDB API calls
        let normalizedType = (mediaTypeFromCard === 'tv_series' || mediaTypeFromCard === 'tv_miniseries') ? 'tv' : mediaTypeFromCard;
        if (normalizedType !== 'movie' && normalizedType !== 'tv') {
             // If type is ambiguous, try to fetch from Watchmode with tmdb_id to confirm
            console.warn(`Ambiguous media type: ${mediaTypeFromCard}. Trying to resolve for ID ${mediaId}`);
            try {
                // This assumes mediaId is a TMDB ID. If it's a Watchmode internal ID, this won't work.
                // The card data-attributes should store tmdb_id if available from Watchmode search.
                const detailCard = document.querySelector(`.media-card[data-id="${mediaId}"]`);
                const tmdbId = detailCard.dataset.tmdbId || mediaId;

                // Attempt to fetch details using a generic Watchmode endpoint for TMDB IDs if type unknown
                // This is tricky without knowing if it's movie or TV for the TMDB type prefix.
                // For now, we'll rely on the card's data-type, or if it's just an ID, we might need a smarter fetch.
                // Let's assume for now mediaTypeFromCard is 'movie' or 'tv' as passed to renderMediaDetail
                // If not, we might need to call Watchmode's /title/tmdb-movie-ID or /title/tmdb-tv-ID
                // and see which one works, or use TMDB's find by external ID if we have IMDB_ID.
                // This part can be complex if the initial type is not clearly 'movie' or 'tv'.
                // For simplicity, if type is not movie/tv, we can't proceed reliably to TMDB directly.
                // We should ensure cards always have a 'movie' or 'tv' type.
                // The renderMediaCard tries to set dataset.type to 'movie' or 'tv'.

                if (normalizedType !== 'movie' && normalizedType !== 'tv') {
                    console.error("Cannot determine media type for detail view.", mediaId, mediaTypeFromCard);
                    alert("Could not load details for this item due to unknown type.");
                    return;
                }

            } catch (e) {
                 console.error("Error trying to resolve media type:", e);
                 alert("Could not load details for this item.");
                 return;
            }
        }
        await UIService.renderMediaDetail(mediaId, normalizedType);
    },

    handlePlayMedia: (tmdbId, title, mediaType) => {
        // lastSelectedMediaDetails should have been set by renderMediaDetail
        if (!lastSelectedMediaDetails) {
            alert("Error: Media details not found to start playback.");
            return;
        }
        
        tmdbId = lastSelectedMediaDetails.id || tmdbId; // Use ID from stored details first
        title = lastSelectedMediaDetails.title || lastSelectedMediaDetails.name || title;
        mediaType = lastSelectedMediaDetails.type || mediaType;


        if (mediaType === 'movie') {
            UIService.renderPlayer(tmdbId, title);
        } else if (mediaType === 'tv') {
            const seasonSelect = document.getElementById('season-select');
            const episodeSelect = document.getElementById('episode-select');
            if (seasonSelect && episodeSelect) {
                const season = seasonSelect.value;
                const episode = episodeSelect.value;
                UIService.renderPlayer(tmdbId, title, season, episode);
            } else {
                // Fallback for TV show if no season/episode selector (e.g. direct play button on a card if implemented)
                // Ask user or default to S1E1
                // For now, assume detail view sets this up.
                alert("Please select a season and episode from the details page.");
                 // Or attempt to play S1E1 if details allow
                if (lastSelectedMediaDetails.seasons && lastSelectedMediaDetails.seasons.find(s => s.season_number === 1)) {
                     UIService.renderPlayer(tmdbId, title, 1, 1);
                } else {
                    alert("Could not determine first episode to play.");
                }
            }
        } else {
            alert(`Playback for type "${mediaType}" is not currently supported directly.`);
        }
    }
};

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', AppLogic.init);
