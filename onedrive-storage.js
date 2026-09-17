// ===== OneDrive-backed storage, standing in for server.js =====
//
// The local version of this app talks to a little Node server (server.js)
// that reads/writes plain JSON files next to it. This version has no
// server at all - it's just static files sitting on a webpage. Instead,
// this file intercepts every one of those same fetch('/combos') etc. calls
// script.js/log.js/notes.js/combo-detail.js already make (completely
// unmodified - they have no idea any of this is happening) and redirects
// each one to Microsoft Graph, reading/writing the exact same files inside
// a dedicated "Steep It Together" folder in your own OneDrive instead.
//
// Existing pictures (every icon/photo already in Images/ as of when this
// version was built) are shipped as plain static files alongside this page
// - they load instantly and never touch OneDrive at all. A picture you
// upload *after* switching to this version does get saved to OneDrive (so
// it's never lost), and ingredient icons re-resolve it live on a 404 (see
// the usePlaceholderOnError patch at the bottom) - but the Pairing-outcomes
// graph and Drink-card picture don't yet do that same live lookup, so a
// brand new upload may show the placeholder there until a future update
// teaches them to check OneDrive too.

(function() {
    const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';

    // Route (as script.js/log.js/etc. already call it) -> OneDrive filename
    // + what a brand-new account should start with, mirroring
    // FILE_DEFAULTS in server.js exactly.
    const JSON_ROUTES = {
        '/combos': { file: 'data.json', default: [] },
        '/ingredients': { file: 'ingredients.json', default: [] },
        '/pairings': { file: 'pairings.json', default: {} },
        '/ingredient-colors': { file: 'ingredient-colors.json', default: {} },
        '/category-colors': { file: 'category-colors.json', default: {} },
        '/notes': { file: 'notes.json', default: [] },
        '/hard-to-get': { file: 'hard-to-get.json', default: [] },
        '/avoid-flask': { file: 'avoid-flask.json', default: [] }
    };

    // EXPORT_FILES in server.js uses camelCase keys distinct from the
    // route paths above - same mapping, needed by both /export and /import.
    const EXPORT_KEY_BY_ROUTE = {
        '/combos': 'combos', '/ingredients': 'ingredients', '/pairings': 'pairings',
        '/ingredient-colors': 'ingredientColors', '/category-colors': 'categoryColors',
        '/notes': 'notes', '/hard-to-get': 'hardToGet', '/avoid-flask': 'avoidFlask'
    };

    // ===== Sign-in =====

    const msalApp = new msal.PublicClientApplication(MSAL_CONFIG);
    // MSAL Browser v3+ requires this explicit async init before any other
    // method on the instance is safe to call - awaited at the top of
    // trySilentSignIn() below, the earliest point anything here actually
    // touches msalApp.
    const msalInitPromise = msalApp.initialize();
    let activeAccount = null;

    function buildOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'onedrive-signin-overlay';
        overlay.innerHTML =
            '<div class="onedrive-signin-card">' +
            '<h1>Steep It Together</h1>' +
            '<p>Sign in with your personal Microsoft account to load your synced tea data from OneDrive.</p>' +
            '<button id="onedrive-signin-btn" type="button">Sign in with Microsoft</button>' +
            '<p class="onedrive-signin-note" id="onedrive-signin-status"></p>' +
            '</div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function setStatus(message) {
        const status = document.getElementById('onedrive-signin-status');
        if (status) status.textContent = message;
    }

    async function trySilentSignIn() {
        await msalInitPromise;
        const cached = msalApp.getAllAccounts();
        if (cached.length === 0) return false;
        msalApp.setActiveAccount(cached[0]);
        activeAccount = cached[0];
        return true;
    }

    async function interactiveSignIn() {
        const overlay = buildOverlay();
        return new Promise(function(resolve) {
            document.getElementById('onedrive-signin-btn').addEventListener('click', async function() {
                setStatus('Opening sign-in window...');
                try {
                    const result = await msalApp.loginPopup({ scopes: MSAL_SCOPES });
                    msalApp.setActiveAccount(result.account);
                    activeAccount = result.account;
                    overlay.remove();
                    resolve();
                } catch (err) {
                    setStatus('Sign-in failed: ' + (err.errorMessage || err.message || 'unknown error') + ' - try again.');
                }
            });
        });
    }

    // script.js fires off several fetch() calls in a row on page load
    // (/combos, /ingredients, /pairings, ...) - each one needs to wait for
    // sign-in via getAccessToken() below, but they all start at nearly the
    // same instant. Without memoizing the in-flight attempt here, every one
    // of them would independently call interactiveSignIn() and stack up
    // that many duplicate overlays. Caching the promise itself (not just a
    // flag) means every concurrent caller shares the exact same attempt -
    // one overlay, one click needed, everyone unblocks together.
    let ensureSignedInPromise = null;
    function ensureSignedIn() {
        if (activeAccount) return Promise.resolve();
        if (!ensureSignedInPromise) {
            ensureSignedInPromise = trySilentSignIn().then(function(hadCached) {
                return hadCached ? undefined : interactiveSignIn();
            });
        }
        return ensureSignedInPromise;
    }

    async function getAccessToken() {
        await ensureSignedIn();
        try {
            const result = await msalApp.acquireTokenSilent({ scopes: MSAL_SCOPES, account: activeAccount });
            return result.accessToken;
        } catch (err) {
            // Silent renewal can fail (e.g. needs fresh consent) - fall back
            // to an interactive popup rather than just breaking.
            const result = await msalApp.acquireTokenPopup({ scopes: MSAL_SCOPES, account: activeAccount });
            return result.accessToken;
        }
    }

    ensureSignedIn(); // kicks off immediately on page load - see getAccessToken() for how callers wait on it

    // Captured now, before fetch gets overridden below, so every Graph call
    // this file makes goes straight to the network - relying on "a
    // graph.microsoft.com URL just won't match any of the special-cased
    // routes further down anyway" would also technically work, but this is
    // more obviously correct (and one call cheaper) than routing every
    // single Graph request through that whole dispatch chain first.
    const realFetch = window.fetch.bind(window);

    // ===== Graph API helpers =====

    async function graphRequest(pathAndQuery, options) {
        const token = await getAccessToken();
        const headers = Object.assign({ Authorization: 'Bearer ' + token }, (options && options.headers) || {});
        return realFetch(GRAPH_ROOT + pathAndQuery, Object.assign({}, options, { headers: headers }));
    }

    async function graphGetJson(filename, defaultValue) {
        const res = await graphRequest(':/' + encodeURIComponent(filename) + ':/content');
        if (res.status === 404) {
            await graphPutJson(filename, defaultValue);
            return defaultValue;
        }
        if (!res.ok) throw new Error('Couldn\'t read ' + filename + ' from OneDrive (' + res.status + ')');
        return res.json();
    }

    async function graphPutJson(filename, value) {
        const res = await graphRequest(':/' + encodeURIComponent(filename) + ':/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value, null, 2)
        });
        if (!res.ok) throw new Error('Couldn\'t save ' + filename + ' to OneDrive (' + res.status + ')');
    }

    async function graphUploadImageDataUrl(filename, dataUrl) {
        const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
        if (!match) throw new Error('Expected a base64 PNG data URL');
        const bytes = Uint8Array.from(atob(match[1]), function(c) { return c.charCodeAt(0); });
        const res = await graphRequest(':/Images/' + encodeURIComponent(filename) + ':/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'image/png' },
            body: bytes
        });
        if (!res.ok) throw new Error('Upload failed (' + res.status + ')');
    }

    async function graphDeleteImage(filename) {
        const res = await graphRequest(':/Images/' + encodeURIComponent(filename));
        if (res.status === 404) return false;
        const del = await graphRequest(':/Images/' + encodeURIComponent(filename), { method: 'DELETE' });
        return del.ok;
    }

    async function graphCopyImage(oldFilename, newFilename) {
        const existing = await graphRequest(':/Images/' + encodeURIComponent(oldFilename));
        if (existing.status === 404) return false;
        const dest = await graphRequest(':/Images/' + encodeURIComponent(newFilename));
        if (dest.ok) return false; // already something there - don't clobber it, same rule as server.js
        // The existence check above hits the metadata path (no :/content),
        // which returns a JSON description of the file, not its actual
        // bytes - need a separate request to the :/content path to get
        // something actually copyable.
        const content = await graphRequest(':/Images/' + encodeURIComponent(oldFilename) + ':/content');
        const bytes = await content.arrayBuffer();
        const put = await graphRequest(':/Images/' + encodeURIComponent(newFilename) + ':/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'image/png' },
            body: bytes
        });
        return put.ok;
    }

    // Small helper so intercepted routes can hand back a real, standard
    // Response object - every caller in script.js/log.js/etc already does
    // response.json()/response.ok exactly like it would against a real
    // server, so nothing there needs to know the difference.
    function jsonResponse(body, status) {
        return new Response(JSON.stringify(body), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ===== fetch() interception =====

    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const method = ((init && init.method) || 'GET').toUpperCase();
        const body = init && init.body ? JSON.parse(init.body) : null;

        // Plain JSON data files - same GET-reads/POST-replaces-whole-file
        // shape as every route in server.js.
        if (JSON_ROUTES[url]) {
            const route = JSON_ROUTES[url];
            try {
                if (method === 'GET') return jsonResponse(await graphGetJson(route.file, route.default));
                if (method === 'POST') {
                    await graphPutJson(route.file, body);
                    return jsonResponse({ success: true });
                }
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/export' && method === 'GET') {
            try {
                const bundle = {};
                for (const route in JSON_ROUTES) {
                    bundle[EXPORT_KEY_BY_ROUTE[route]] = await graphGetJson(JSON_ROUTES[route].file, JSON_ROUTES[route].default);
                }
                return jsonResponse(bundle);
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/import' && method === 'POST') {
            const missing = Object.values(EXPORT_KEY_BY_ROUTE).filter(function(key) {
                return !(key in body);
            });
            if (missing.length > 0) {
                return jsonResponse({ success: false, error: 'Missing data: ' + missing.join(', ') }, 400);
            }
            try {
                for (const route in EXPORT_KEY_BY_ROUTE) {
                    await graphPutJson(JSON_ROUTES[route].file, body[EXPORT_KEY_BY_ROUTE[route]]);
                }
                return jsonResponse({ success: true });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/upload-image' && method === 'POST') {
            try {
                if (!body.filename || /[\\/]/.test(body.filename) || body.filename.indexOf('..') !== -1) {
                    return jsonResponse({ success: false, error: 'Invalid filename' }, 400);
                }
                await graphUploadImageDataUrl(body.filename, body.dataUrl);
                return jsonResponse({ success: true });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/copy-image' && method === 'POST') {
            try {
                const copied = await graphCopyImage(body.oldFilename, body.newFilename);
                return jsonResponse({ success: true, copied: copied });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/delete-image' && method === 'POST') {
            try {
                const deleted = await graphDeleteImage(body.filename);
                return jsonResponse({ success: true, deleted: deleted });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        // Anything else (the page's own html/css/js/image files) - a real
        // request, let it through untouched.
        return realFetch(input, init);
    };

    // ===== Live lookup for brand-new ingredient icons =====
    //
    // Every icon that existed when this version was built is a real static
    // file (see the top of this file) and just loads normally - this only
    // ever fires for a picture uploaded *after* that, which won't be in the
    // static set and so 404s first. Patches the same fallback hook
    // script.js already calls per-icon (usePlaceholderOnError) - script.js
    // itself is completely unmodified; a plain <script> file's top-level
    // functions are just properties of window, so this can be redefined
    // from here same as overriding fetch above.
    //
    // Deferred via setTimeout - this file's own <script> tag runs *before*
    // script.js's (it has to, so the fetch override above is already in
    // place for script.js's very first fetch() calls), but that means
    // script.js's own top-level "function usePlaceholderOnError(img)"
    // declaration hasn't been hoisted onto window yet at this point in
    // *this* file's execution - it would silently overwrite an
    // un-deferred assignment here the instant script.js's <script> tag
    // ran. Scheduling this for "as soon as the current script queue is
    // idle" instead guarantees it runs after script.js has finished
    // declaring its own version, so this one applies last and sticks.
    setTimeout(function() {
        window.usePlaceholderOnError = function(img) {
            img.addEventListener('error', function() {
                if (img.dataset.triedOnedrive) {
                    if (img.dataset.usedPlaceholder) { img.remove(); return; }
                    img.dataset.usedPlaceholder = 'true';
                    img.src = 'Images/placeholder.png';
                    return;
                }
                img.dataset.triedOnedrive = 'true';
                const filename = img.src.split('/').pop().split('?')[0];
                graphRequest(':/Images/' + encodeURIComponent(filename) + ':/content')
                    .then(function(res) { return res.ok ? res.blob() : Promise.reject(); })
                    .then(function(blob) { img.src = URL.createObjectURL(blob); })
                    .catch(function() {
                        img.dataset.usedPlaceholder = 'true';
                        img.src = 'Images/placeholder.png';
                    });
            });
        };
    }, 0);
})();
