// ===== Display setting =====

const statusEl = document.getElementById('settings-status');
let statusTimer = null;

function flashStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('settings-status-error', !!isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function() { statusEl.textContent = ''; }, 2500);
}

function renderModeButtons() {
    const mode = AppSettings.get().displayMode;
    document.querySelectorAll('[data-display-mode]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.displayMode === mode);
    });
}

renderModeButtons();
// The cached value above paints instantly; this swaps in the real, synced one.
AppSettings.load().then(renderModeButtons).catch(function() {});

document.querySelectorAll('[data-display-mode]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        AppSettings.save({ displayMode: btn.dataset.displayMode }).then(function() {
            flashStatus('✓ Saved');
        }).catch(function(err) {
            flashStatus('⚠️ Couldn\'t save: ' + err.message, true);
        });
        renderModeButtons();
    });
});

// ===== Data export / import =====

// Unlike the local version, this can't just navigate straight to
// /export - there's no real server here for the browser to
// download a response from, so github-storage.js can only
// intercept an actual fetch() call, not a page navigation. Same
// end result (a downloaded file), just triggered via a temporary
// blob link instead of the browser's native download prompt.
document.getElementById('export-data-btn').addEventListener('click', function() {
    fetch('/export').then(function(r) { return r.blob(); }).then(function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'steep-it-together-export.json';
        a.click();
        URL.revokeObjectURL(url);
    });
});

document.getElementById('import-data-btn').addEventListener('click', function() {
    const file = document.getElementById('import-data-input').files[0];
    if (!file) {
        alert('Choose an exported file first.');
        return;
    }
    if (!confirm('This replaces ALL current data with the contents of this file. Continue?')) return;

    const reader = new FileReader();
    reader.onload = function() {
        let bundle;
        try {
            bundle = JSON.parse(reader.result);
        } catch (e) {
            alert('That file isn\'t valid JSON.');
            return;
        }
        fetch('/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bundle)
        }).then(function(r) { return r.json(); }).then(function(result) {
            if (result.success) {
                alert('Imported! Reloading...');
                window.location.reload();
            } else {
                alert('Import failed: ' + (result.error || 'unknown error'));
            }
        });
    };
    reader.readAsText(file);
});

// ===== GitHub connection =====

// disconnectGitHubStorage (github-storage.js) clears the saved
// owner/repo/token and reloads, which puts the connect screen
// straight back up - same effect as a sign-out.
document.getElementById('gh-disconnect-btn').addEventListener('click', function() {
    if (confirm('Disconnect this device from its current GitHub repo? You\'ll need to reconnect (or connect to a different repo) to use the app again.')) {
        window.disconnectGitHubStorage();
    }
});
