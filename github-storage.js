// ===== GitHub-repo-backed storage, standing in for server.js =====
//
// Replaces onedrive-storage.js. Same idea: the local version of this app
// talks to a little Node server (server.js) that reads/writes plain JSON
// files next to it. This version has no server at all - it's just static
// files on a webpage. This file intercepts every one of those same
// fetch('/combos') etc. calls the unmodified page scripts already make and
// redirects each one to the GitHub Contents API instead, reading/writing
// the exact same files in a GitHub repo you own (any private repo works -
// you paste in the owner/repo/token once per device, see the settings
// screen below).
//
// Existing pictures (every icon/photo already in Images/ as of when this
// version was built) are shipped as plain static files alongside this page
// and never touch GitHub at all - same as before. A picture uploaded
// *after* switching to this version gets saved to the repo (so it's never
// lost), and ingredient icons re-resolve it live on a 404 (see the
// usePlaceholderOnError patch at the bottom) - the Pairing-outcomes graph
// and Drink-card picture don't yet do that same live lookup, so a brand
// new upload may show the placeholder there until a future update.

(function() {
    const API_ROOT = 'https://api.github.com';
    const CONFIG_KEY = 'steepItTogetherGitHubConfig';

    // Route (as script.js/log.js/etc. already call it) -> repo filename +
    // what a brand-new repo should start with, mirroring FILE_DEFAULTS in
    // server.js exactly.
    const JSON_ROUTES = {
        '/combos': { file: 'data.json', default: [] },
        '/ingredients': { file: 'ingredients.json', default: [] },
        '/pairings': { file: 'pairings.json', default: {} },
        '/ingredient-colors': { file: 'ingredient-colors.json', default: {} },
        '/category-colors': { file: 'category-colors.json', default: {} },
        '/notes': { file: 'notes.json', default: [] },
        '/hard-to-get': { file: 'hard-to-get.json', default: [] },
        '/avoid-flask': { file: 'avoid-flask.json', default: [] },
        '/custom-lists': { file: 'custom-lists.json', default: [] },
        '/settings': { file: 'settings.json', default: {} }
    };

    // EXPORT_FILES in server.js uses camelCase keys distinct from the
    // route paths above - same mapping, needed by both /export and /import.
    const EXPORT_KEY_BY_ROUTE = {
        '/combos': 'combos', '/ingredients': 'ingredients', '/pairings': 'pairings',
        '/ingredient-colors': 'ingredientColors', '/category-colors': 'categoryColors',
        '/notes': 'notes', '/hard-to-get': 'hardToGet', '/avoid-flask': 'avoidFlask',
        '/custom-lists': 'customLists', '/settings': 'settings'
    };

    // Same as OPTIONAL_EXPORT_KEYS in server.js - an import file made before
    // user-created Notepad tabs existed won't have this key, which
    // shouldn't make it unimportable (or wipe the tabs already saved).
    const OPTIONAL_EXPORT_KEYS = ['customLists', 'settings'];

    // Captured now, before fetch gets overridden below, so every GitHub API
    // call this file makes goes straight to the network.
    const realFetch = window.fetch.bind(window);

    // ===== UTF-8-safe base64 helpers =====
    // Plain atob()/btoa() on a JSON string mangles anything outside ASCII
    // (this app has plenty - Chinese ingredient names, °, etc.) - these go
    // through TextEncoder/TextDecoder instead for a correct round trip.
    // Built in chunks rather than String.fromCharCode(...bytes) spread,
    // which blows the call stack on anything but a small file.
    function utf8ToBase64(str) {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function base64ToUtf8(base64) {
        const binary = atob(base64.replace(/\n/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    // ===== Settings (owner/repo/token) =====

    function getConfig() {
        try {
            return JSON.parse(localStorage.getItem(CONFIG_KEY));
        } catch (e) {
            return null;
        }
    }

    function saveConfigToStorage(owner, repo, token) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify({ owner: owner, repo: repo, token: token }));
    }

    function clearConfig() {
        localStorage.removeItem(CONFIG_KEY);
    }

    function buildConfigOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'github-config-overlay';
        overlay.innerHTML =
            '<div class="github-config-card">' +
            '<h1>Steep It Together</h1>' +
            '<p>Connect the private GitHub repo you\'re using to store your tea data.</p>' +
            '<label>GitHub username<input type="text" id="gh-owner-input" autocomplete="off"></label>' +
            '<label>Repo name<input type="text" id="gh-repo-input" autocomplete="off"></label>' +
            '<label>Personal access token<input type="password" id="gh-token-input" autocomplete="off"></label>' +
            '<button id="gh-connect-btn" type="button">Connect</button>' +
            '<p class="github-config-note" id="gh-config-status"></p>' +
            '</div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function setConfigStatus(message) {
        const status = document.getElementById('gh-config-status');
        if (status) status.textContent = message;
    }

    // Plain GET to confirm owner/repo/token actually work together before
    // trusting them - same check on first entry and on every later page
    // load, so a revoked token or renamed repo surfaces here instead of
    // confusingly on the first real data request.
    async function configStatus(owner, repo, token) {
        const res = await realFetch(API_ROOT + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), {
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            cache: 'no-store'
        });
        return res.status;
    }

    async function validateConfig(owner, repo, token) {
        const status = await configStatus(owner, repo, token);
        return status >= 200 && status < 300;
    }

    // A one-click "friend login" link (?owner=x&repo=y&token=z) connects
    // automatically - no typing or pasting a token required. Query params
    // aren't part of the public repo/source anywhere; they only ever exist
    // in a link shared privately (e.g. a text message), same trust level
    // as sharing a Google Doc or Dropbox link. Stripped from the address
    // bar immediately either way, so the token doesn't linger visibly
    // there or end up copied along with the page URL afterward.
    async function tryUrlAutoConnect() {
        const params = new URLSearchParams(window.location.search);
        const owner = params.get('owner');
        const repo = params.get('repo');
        const token = params.get('token');
        if (!owner || !repo || !token) return false;
        history.replaceState(null, '', window.location.pathname + window.location.hash);
        const ok = await validateConfig(owner, repo, token).catch(function() { return false; });
        if (!ok) return false;
        saveConfigToStorage(owner, repo, token);
        return true;
    }

    async function interactiveConfigure() {
        const overlay = buildConfigOverlay();
        return new Promise(function(resolve) {
            document.getElementById('gh-connect-btn').addEventListener('click', async function() {
                const owner = document.getElementById('gh-owner-input').value.trim();
                const repo = document.getElementById('gh-repo-input').value.trim();
                const token = document.getElementById('gh-token-input').value.trim();
                if (!owner || !repo || !token) {
                    setConfigStatus('Fill in all three fields.');
                    return;
                }
                setConfigStatus('Checking...');
                try {
                    const ok = await validateConfig(owner, repo, token);
                    if (!ok) {
                        setConfigStatus('Couldn\'t access that repo with that token - double check all three fields.');
                        return;
                    }
                    saveConfigToStorage(owner, repo, token);
                    overlay.remove();
                    resolve();
                } catch (err) {
                    setConfigStatus('Connection failed: ' + err.message + ' - try again.');
                }
            });
        });
    }

    // Same concurrency problem as the OneDrive version had: script.js fires
    // off several fetch() calls in a row on page load, each needing
    // configuration first - memoizing the in-flight attempt means they all
    // share one settings screen instead of stacking duplicates.
    let ensureConfiguredPromise = null;
    let activeConfig = null;

    // Every page in this app (cauldron, reference, notes...) is a separate
    // full navigation, not a SPA route - so without this, validateConfig
    // paid for a full extra GitHub API round trip, before any real data
    // could even start loading, on *every single page visited this
    // session*, even though the token just got confirmed good a minute
    // ago on the previous page. A token doesn't go bad mid-session, so
    // once validated it's trusted for the rest of this tab's session; if
    // it somehow does go bad, the real request fails with a 401 and
    // githubRequest's own handling below drops it and asks again.
    const VALIDATED_SESSION_KEY = 'gh-storage-validated-config';
    function configIdentity(cfg) { return cfg.owner + '/' + cfg.repo + '/' + cfg.token; }
    function markValidatedThisSession(cfg) {
        try { sessionStorage.setItem(VALIDATED_SESSION_KEY, configIdentity(cfg)); } catch (e) { /* private window etc - just re-validates next time */ }
    }
    function wasValidatedThisSession(cfg) {
        try { return sessionStorage.getItem(VALIDATED_SESSION_KEY) === configIdentity(cfg); } catch (e) { return false; }
    }

    function ensureConfigured() {
        if (activeConfig) return Promise.resolve();
        if (!ensureConfiguredPromise) {
            ensureConfiguredPromise = (async function() {
                const saved = getConfig();
                if (saved) {
                    // Use the saved token straight away instead of waiting a
                    // full network round trip for a check before ANY data
                    // request can even start - the token is almost always
                    // still good. The check still happens, alongside the
                    // real requests, and only a definite "no" (401 bad
                    // token / 404 repo gone) throws it out and asks again.
                    // A network error or rate limit says nothing about the
                    // token, so those leave it alone.
                    activeConfig = saved;
                    if (!wasValidatedThisSession(saved)) {
                        configStatus(saved.owner, saved.repo, saved.token).then(function(status) {
                            if (status >= 200 && status < 300) markValidatedThisSession(saved);
                            else if (status === 401 || status === 404) {
                                clearConfig();
                                window.location.reload();
                            }
                        }).catch(function() { /* offline etc - not evidence the token is bad */ });
                    }
                    return;
                }
                if (await tryUrlAutoConnect()) {
                    activeConfig = getConfig();
                    markValidatedThisSession(activeConfig);
                    return;
                }
                await interactiveConfigure();
                activeConfig = getConfig();
                markValidatedThisSession(activeConfig);
            })();
        }
        return ensureConfiguredPromise;
    }

    // Exposed for the "Disconnect / change token" control on the Data tab.
    window.disconnectGitHubStorage = function() {
        clearConfig();
        window.location.reload();
    };

    // ===== GitHub Contents API =====

    const shaCache = new Map(); // path -> sha, so writes know whether they're creating or updating

    function contentsUrl(path) {
        // Encode each segment separately - a filename can have spaces/
        // Chinese characters, but the "/" separators themselves must stay
        // literal or GitHub reads the whole thing as one escaped segment.
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        return API_ROOT + '/repos/' + encodeURIComponent(activeConfig.owner) + '/' +
            encodeURIComponent(activeConfig.repo) + '/contents/' + encodedPath;
    }

    async function githubRequest(path, options) {
        await ensureConfigured();
        const isGet = !options || !options.method || options.method === 'GET';
        const headers = Object.assign({
            Authorization: 'Bearer ' + activeConfig.token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }, (options && options.headers) || {});
        const fetchOptions = Object.assign({}, options, { headers: headers });
        if (isGet) fetchOptions.cache = 'no-store';

        const res = await realFetch(contentsUrl(path), fetchOptions);
        if (res.status === 401) {
            // Token's no good (revoked, expired, typo'd) - drop it and make
            // the next attempt to use this file prompt fresh instead of
            // failing the same way forever.
            clearConfig();
            activeConfig = null;
            ensureConfiguredPromise = null;
        }
        return res;
    }

    async function readJsonFile(path, defaultValue) {
        const res = await githubRequest(path);
        if (res.status === 404) {
            shaCache.delete(path);
            return defaultValue;
        }
        if (!res.ok) throw new Error('Couldn\'t read ' + path + ' (' + res.status + ')');
        const data = await res.json();
        shaCache.set(path, data.sha);
        if (!data.content) {
            // Empty "content" means the file's over 1MB and GitHub didn't
            // inline it - ask again specifically for the raw bytes instead.
            const raw = await githubRequest(path, { headers: { Accept: 'application/vnd.github.raw+json' } });
            if (!raw.ok) throw new Error('Couldn\'t read ' + path + ' (' + raw.status + ')');
            return JSON.parse(await raw.text());
        }
        return JSON.parse(base64ToUtf8(data.content));
    }

    async function writeJsonFileNow(path, value) {
        const body = {
            message: 'update ' + path,
            content: utf8ToBase64(JSON.stringify(value, null, 2))
        };
        const sha = shaCache.get(path);
        if (sha) body.sha = sha;

        const res = await githubRequest(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.status === 409 || res.status === 422) {
            showConflictBanner();
            throw new Error('This data was changed on another device. Reload to get the latest version.');
        }
        if (!res.ok) throw new Error('Couldn\'t save ' + path + ' (' + res.status + ')');
        const data = await res.json();
        shaCache.set(path, data.content.sha);
    }

    // ===== Write queue =====
    // All PUT/DELETE calls (JSON and images alike) go through this so they
    // run strictly one at a time - two writes to the same repo racing each
    // other is exactly what produces the 409s handled above.
    let writeQueueTail = Promise.resolve();
    let pendingWrites = 0;

    function enqueueWrite(fn) {
        pendingWrites++;
        showSaveStatus('saving');
        const runAfter = writeQueueTail;
        const result = runAfter.then(fn, fn);
        writeQueueTail = result.then(function() {}, function() {}); // never blocks the queue itself
        result.then(function() {
            pendingWrites--;
            if (pendingWrites === 0) showSaveStatus('saved');
        }, function() {
            pendingWrites--;
            if (pendingWrites === 0) showSaveStatus('error');
        });
        return result;
    }

    function writeJsonFile(path, value) {
        return enqueueWrite(function() { return writeJsonFileNow(path, value); });
    }

    // ===== Save status indicator + conflict banner =====

    function showSaveStatus(state) {
        let el = document.getElementById('gh-save-status');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gh-save-status';
            document.body.appendChild(el);
        }
        el.textContent = state === 'saving' ? 'Saving...' : state === 'error' ? 'Save failed' : 'Saved';
        el.className = 'gh-save-status-' + state;
        el.classList.add('visible');
        clearTimeout(el._hideTimer);
        if (state !== 'error') {
            el._hideTimer = setTimeout(function() { el.classList.remove('visible'); }, 1500);
        }
    }

    function showConflictBanner() {
        if (document.getElementById('gh-conflict-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'gh-conflict-banner';
        banner.innerHTML =
            '<span>This data was changed on another device.</span>' +
            '<button type="button" id="gh-conflict-reload-btn">Reload</button>';
        document.body.appendChild(banner);
        document.getElementById('gh-conflict-reload-btn').addEventListener('click', function() {
            window.location.reload();
        });
    }

    // ===== Images =====

    // Every icon that existed when this version was built ships as a real
    // static file next to the page (see the top of this file) - fast, and
    // correct for the overwhelming majority that are never touched again.
    // But once one of *those* specific filenames gets uploaded over,
    // renamed, or removed through the app, the static file itself can't
    // change (that would need a code deploy, not something a data-repo
    // token can do) - it just sits there, unchanged, silently shadowing
    // the real edit in the data repo forever. That's what made updating an
    // icon look like it needed a delete-then-reupload, and made delete
    // look like it needed a tab close/reopen to "take": the *data* was
    // always right, the *display* just kept trusting a static file that
    // was now stale.
    //
    // Persisted (not just in-memory) so this sticks across page loads -
    // the moment a filename is touched through the app it's added here
    // and never removed, same spirit as the sha cache but durable, since
    // there's no cheap way to ask "does this filename have a data-repo
    // version" up front without fetching it.
    const FORCE_OVERRIDE_KEY = 'steepItTogetherForcedImageOverrides';
    let forceOverrideFilenames;
    try {
        const saved = JSON.parse(localStorage.getItem(FORCE_OVERRIDE_KEY));
        forceOverrideFilenames = new Set(Array.isArray(saved) ? saved : []);
    } catch (e) {
        forceOverrideFilenames = new Set();
    }

    function addForceOverride(filename) {
        if (forceOverrideFilenames.has(filename)) return;
        forceOverrideFilenames.add(filename);
        localStorage.setItem(FORCE_OVERRIDE_KEY, JSON.stringify(Array.from(forceOverrideFilenames)));
    }

    async function uploadImageDataUrl(filename, dataUrl) {
        const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
        if (!match) throw new Error('Expected a base64 PNG data URL');
        const path = 'Images/' + filename;
        return enqueueWrite(async function() {
            const body = { message: 'upload ' + path, content: match[1] };
            let sha = shaCache.get(path);
            if (!sha) {
                // Replacing an icon that already exists in the repo (e.g. one
                // of the original baked-in ones, which this page never
                // fetched, so no sha was ever cached) - GitHub rejects a PUT
                // over an existing file with a 422 unless it's told that
                // file's current sha.
                const existing = await githubRequest(path);
                if (existing.ok) sha = (await existing.json()).sha;
            }
            if (sha) body.sha = sha;
            const res = await githubRequest(path, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error('Upload failed (' + res.status + ')');
            const data = await res.json();
            shaCache.set(path, data.content.sha);
            // The data repo now has the authoritative version of this
            // filename - make sure display stops trusting a same-named
            // static file from here on (see the comment above
            // forceOverrideFilenames), and drop any previously-cached blob
            // for it so the *next* live lookup actually re-fetches instead
            // of handing back whatever was cached before this upload.
            addForceOverride(filename);
            imageBlobUrlCache.delete(path);
        });
    }

    async function deleteImage(filename) {
        const path = 'Images/' + filename;
        return enqueueWrite(async function() {
            const existing = await githubRequest(path);
            if (existing.status === 404) return false;
            const data = await existing.json();
            const res = await githubRequest(path, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'delete ' + path, sha: data.sha })
            });
            if (res.ok) {
                shaCache.delete(path);
                // There WAS a data-repo version (that's the only way this
                // branch runs), so this filename needs forcing too, same
                // reasoning as upload - otherwise "removed" an icon that
                // started life as a static file just silently kept
                // showing the old picture, looking like delete did nothing.
                addForceOverride(filename);
                imageBlobUrlCache.delete(path);
            }
            return res.ok;
        });
    }

    // Copies (never deletes the old file) - matches server.js's own
    // /copy-image exactly: a shared legacy icon used by more than one
    // ingredient shouldn't get pulled out from under whichever other name
    // still points at it. GitHub's contents API has no copy endpoint, but
    // since the source's own GET already hands back base64 content, this
    // can just re-PUT that same base64 string at the new path with no
    // decode/re-encode round trip needed.
    async function copyImage(oldFilename, newFilename) {
        const oldPath = 'Images/' + oldFilename;
        const newPath = 'Images/' + newFilename;
        return enqueueWrite(async function() {
            let contentBase64;
            const existing = await githubRequest(oldPath);
            if (existing.status === 404) {
                // No data-repo copy - but the name being renamed *from* may
                // still be one of the static baked-in icons (never
                // uploaded/edited through the app, so it was never in the
                // data repo to begin with). Fetch it the same way the page
                // itself would (a plain same-origin request, no auth
                // needed) rather than giving up - otherwise renaming any
                // ingredient that still had its original icon silently
                // lost the picture.
                const staticRes = await realFetch(oldPath);
                if (!staticRes.ok) return false;
                const blob = await staticRes.blob();
                contentBase64 = await new Promise(function(resolve, reject) {
                    const reader = new FileReader();
                    reader.onload = function() { resolve(reader.result.split(',')[1]); };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } else {
                const existingData = await existing.json();
                contentBase64 = existingData.content;
            }
            // A rename is a deliberate "this icon now belongs to the new
            // name" action, so this overwrites whatever's already at the
            // destination rather than refusing to touch it - silently
            // skipping the copy because some unrelated leftover (a stale
            // test upload, a coincidental slug collision) happened to
            // already be sitting there used to leave the renamed
            // ingredient showing that wrong picture with no error at all.
            // GitHub's PUT needs the destination's current sha to allow
            // overwriting it (unlike a plain filesystem copy) - fetch it
            // first if something's there.
            const dest = await githubRequest(newPath);
            const putBody = { message: 'copy ' + oldPath + ' to ' + newPath, content: contentBase64 };
            if (dest.ok) {
                const destData = await dest.json();
                putBody.sha = destData.sha;
            }
            const res = await githubRequest(newPath, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(putBody)
            });
            if (!res.ok) return false;
            const data = await res.json();
            shaCache.set(newPath, data.content.sha);
            // The new name now has its own data-repo copy - same reasoning
            // as upload/delete above. (The old name is deliberately left
            // alone - copyImage never deletes it, see the comment above.)
            addForceOverride(newFilename);
            imageBlobUrlCache.delete(newPath);
            return true;
        });
    }

    // Cached per path so an already-displayed image is only ever fetched
    // once per page load, not re-fetched every time something re-renders.
    const imageBlobUrlCache = new Map();
    async function getImageBlobUrl(path) {
        if (imageBlobUrlCache.has(path)) return imageBlobUrlCache.get(path);
        const promise = (async function() {
            const res = await githubRequest(path, { headers: { Accept: 'application/vnd.github.raw+json' } });
            if (!res.ok) throw new Error('not found');
            const blob = await res.blob();
            return URL.createObjectURL(blob);
        })();
        imageBlobUrlCache.set(path, promise);
        return promise;
    }

    // ===== fetch() interception =====
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

    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const method = ((init && init.method) || 'GET').toUpperCase();
        const body = init && init.body ? JSON.parse(init.body) : null;

        if (JSON_ROUTES[url]) {
            const route = JSON_ROUTES[url];
            try {
                if (method === 'GET') return jsonResponse(await readJsonFile(route.file, route.default));
                if (method === 'POST') {
                    await writeJsonFile(route.file, body);
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
                    bundle[EXPORT_KEY_BY_ROUTE[route]] = await readJsonFile(JSON_ROUTES[route].file, JSON_ROUTES[route].default);
                }
                return jsonResponse(bundle);
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/import' && method === 'POST') {
            const missing = Object.values(EXPORT_KEY_BY_ROUTE).filter(function(key) {
                return !(key in body) && OPTIONAL_EXPORT_KEYS.indexOf(key) === -1;
            });
            if (missing.length > 0) {
                return jsonResponse({ success: false, error: 'Missing data: ' + missing.join(', ') }, 400);
            }
            try {
                for (const route in EXPORT_KEY_BY_ROUTE) {
                    // An absent optional key means "this export predates it" -
                    // leave whatever's already saved alone (and writeJsonFile
                    // can't take undefined anyway).
                    if (!(EXPORT_KEY_BY_ROUTE[route] in body)) continue;
                    await writeJsonFile(JSON_ROUTES[route].file, body[EXPORT_KEY_BY_ROUTE[route]]);
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
                await uploadImageDataUrl(body.filename, body.dataUrl);
                return jsonResponse({ success: true });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/copy-image' && method === 'POST') {
            try {
                const copied = await copyImage(body.oldFilename, body.newFilename);
                return jsonResponse({ success: true, copied: copied });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        if (url === '/delete-image' && method === 'POST') {
            try {
                const deleted = await deleteImage(body.filename);
                return jsonResponse({ success: true, deleted: deleted });
            } catch (err) {
                return jsonResponse({ success: false, error: err.message }, 500);
            }
        }

        // Anything else (the page's own html/css/js/image files) - a real
        // request, let it through untouched.
        return realFetch(input, init);
    };

    ensureConfigured(); // kicks off immediately on page load

    // ===== Live lookup for brand-new/edited ingredient icons =====
    //
    // Every icon that existed when this version was built is a real static
    // file and just loads normally, instantly, for free. Two patches below,
    // both to functions script.js declares at its own top level
    // (imagePathFor, usePlaceholderOnError) - deferred via setTimeout since
    // this file's own <script> tag runs *before* script.js's (it has to,
    // so the fetch override above is already in place for script.js's very
    // first fetch() calls), but that means those declarations haven't been
    // hoisted onto window yet at this point in *this* file's execution - an
    // un-deferred assignment here would get silently overwritten the
    // instant script.js's <script> tag ran. Scheduling this for "as soon as
    // the current script queue is idle" instead guarantees both run after
    // script.js has finished declaring its own versions, so these apply
    // last and stick.
    function applyLiveIconPatches() {
        // Patches displayIconSrc, NOT imagePathFor itself - script.js calls
        // imagePathFor for two very different purposes, and only one of
        // them wants this redirect. Upload/delete/rename code calls it to
        // find the *real* filename to read/write; the icon <img src> calls
        // displayIconSrc (which just defers to imagePathFor by default) to
        // find what to *show*. An earlier version of this patched
        // imagePathFor directly, which also silently redirected the
        // upload/rename code - so re-uploading an icon that had just been
        // removed computed a "filename" of
        // "__force-live__/apple.png" (only the leading "Images/" gets
        // stripped before it's sent to the server) and the save rejected
        // it as an invalid filename, since the request now contained a
        // literal "/", with no indication this redirect path was ever the
        // actual cause.
        //
        // For anything in forceOverrideFilenames, this routes display
        // through a path that's guaranteed to 404 against the static file
        // server (no such subfolder exists) while keeping the real
        // filename as the URL's last segment, which is exactly what
        // usePlaceholderOnError's error handler below parses back out
        // (img.src.split('/').pop()...) to know what to look up in the
        // data repo. That forced 404 is what gives a freshly
        // uploaded/removed icon a chance to actually be looked up live,
        // instead of the plain static path matching first (nothing 404s,
        // so the error handler never even runs) and silently winning
        // forever with whatever it originally shipped with.
        if (typeof window.imagePathFor === 'function') {
            window.displayIconSrc = function(name) {
                const real = window.imagePathFor(name);
                const filename = real.replace(/^Images\//, '');
                return forceOverrideFilenames.has(filename) ? 'Images/__force-live__/' + filename : real;
            };
        }

        window.usePlaceholderOnError = function(img) {
            img.addEventListener('error', function() {
                if (img.dataset.triedGithub) {
                    if (img.dataset.usedPlaceholder) { img.remove(); return; }
                    img.dataset.usedPlaceholder = 'true';
                    img.src = 'Images/placeholder.png';
                    return;
                }
                img.dataset.triedGithub = 'true';
                const filename = img.src.split('/').pop().split('?')[0];
                getImageBlobUrl('Images/' + filename)
                    .then(function(blobUrl) { img.src = blobUrl; })
                    .catch(function() {
                        img.dataset.usedPlaceholder = 'true';
                        img.src = 'Images/placeholder.png';
                    });
            });
        };
    }
    // Not setTimeout(0): script.js is a separate network fetch, so that timer
    // could fire BEFORE it had even loaded - the patches then found nothing
    // to patch (or got overwritten by script.js's own declarations a moment
    // later) and silently never applied. DOMContentLoaded only fires once
    // every classic script on the page has actually run.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyLiveIconPatches);
    else applyLiveIconPatches();
})();
