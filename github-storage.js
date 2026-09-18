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
        '/avoid-flask': { file: 'avoid-flask.json', default: [] }
    };

    // EXPORT_FILES in server.js uses camelCase keys distinct from the
    // route paths above - same mapping, needed by both /export and /import.
    const EXPORT_KEY_BY_ROUTE = {
        '/combos': 'combos', '/ingredients': 'ingredients', '/pairings': 'pairings',
        '/ingredient-colors': 'ingredientColors', '/category-colors': 'categoryColors',
        '/notes': 'notes', '/hard-to-get': 'hardToGet', '/avoid-flask': 'avoidFlask'
    };

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
    async function validateConfig(owner, repo, token) {
        const res = await realFetch(API_ROOT + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), {
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            cache: 'no-store'
        });
        return res.ok;
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
    function ensureConfigured() {
        if (activeConfig) return Promise.resolve();
        if (!ensureConfiguredPromise) {
            ensureConfiguredPromise = (async function() {
                const saved = getConfig();
                if (saved && await validateConfig(saved.owner, saved.repo, saved.token).catch(function() { return false; })) {
                    activeConfig = saved;
                    return;
                }
                if (saved) clearConfig(); // stale/broken - fall through to asking again
                await interactiveConfigure();
                activeConfig = getConfig();
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

    async function listImages() {
        const res = await githubRequest('Images');
        if (!res.ok) return [];
        const entries = await res.json();
        entries.forEach(function(entry) { shaCache.set(entry.path, entry.sha); });
        return entries;
    }

    async function uploadImageDataUrl(filename, dataUrl) {
        const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
        if (!match) throw new Error('Expected a base64 PNG data URL');
        const path = 'Images/' + filename;
        return enqueueWrite(async function() {
            const body = { message: 'upload ' + path, content: match[1] };
            const sha = shaCache.get(path);
            if (sha) body.sha = sha;
            const res = await githubRequest(path, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error('Upload failed (' + res.status + ')');
            const data = await res.json();
            shaCache.set(path, data.content.sha);
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
            if (res.ok) shaCache.delete(path);
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
            const existing = await githubRequest(oldPath);
            if (existing.status === 404) return false;
            const dest = await githubRequest(newPath);
            if (dest.ok) return false; // already something there - don't clobber it
            const existingData = await existing.json();
            const res = await githubRequest(newPath, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'copy ' + oldPath + ' to ' + newPath, content: existingData.content })
            });
            if (!res.ok) return false;
            const data = await res.json();
            shaCache.set(newPath, data.content.sha);
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
                return !(key in body);
            });
            if (missing.length > 0) {
                return jsonResponse({ success: false, error: 'Missing data: ' + missing.join(', ') }, 400);
            }
            try {
                for (const route in EXPORT_KEY_BY_ROUTE) {
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

    // ===== Live lookup for brand-new ingredient icons =====
    //
    // Every icon that existed when this version was built is a real static
    // file and just loads normally - this only ever fires for a picture
    // uploaded *after* that, which won't be in the static set and so 404s
    // first. Patches the same fallback hook script.js already calls
    // per-icon (usePlaceholderOnError).
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
    }, 0);
})();
