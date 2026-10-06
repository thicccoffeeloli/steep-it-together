// Shared app settings (see settings.html). Saved to settings.json in the repo
// through the same fetch('/settings') route as everything else, so a choice
// made on one device applies on every device. A copy is also kept in
// localStorage so a page can start out with the right value immediately
// instead of flashing the default while the real file is still loading.
(function() {
    const CACHE_KEY = 'steepItTogetherSettingsCache';
    const DEFAULTS = { displayMode: 'icon' }; // 'icon' | 'word'

    function readCache() {
        try {
            const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (saved && typeof saved === 'object' && !Array.isArray(saved)) return Object.assign({}, DEFAULTS, saved);
        } catch (e) { /* private window etc - just use defaults */ }
        return Object.assign({}, DEFAULTS);
    }

    function writeCache(settings) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)); } catch (e) { /* not critical */ }
    }

    function fromFile(data) {
        return Object.assign({}, DEFAULTS, data && typeof data === 'object' && !Array.isArray(data) ? data : {});
    }

    let current = readCache();

    window.AppSettings = {
        // Synchronous - whatever's known right now (cached copy, or the defaults).
        get: function() { return current; },

        // The real, synced values.
        load: function() {
            return fetch('/settings').then(function(r) { return r.json(); }).then(function(data) {
                current = fromFile(data);
                writeCache(current);
                return current;
            });
        },

        // Applies right away locally, then merges into the saved file (so a
        // setting changed elsewhere in the meantime isn't overwritten).
        save: function(partial) {
            current = Object.assign({}, current, partial);
            writeCache(current);
            return fetch('/settings').then(function(r) { return r.json(); }).then(function(data) {
                const merged = Object.assign({}, fromFile(data), partial);
                current = merged;
                writeCache(merged);
                return fetch('/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(merged)
                });
            }).then(function(r) { return r.json(); }).then(function(result) {
                if (!result.success) throw new Error(result.error || 'save failed');
                return current;
            });
        }
    };
})();
