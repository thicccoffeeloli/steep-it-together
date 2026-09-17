// A stylized "sticky note" tooltip that replaces the browser's native one -
// the native tooltip is tiny and, with a large system cursor, ends up
// hidden right under the pointer. Works automatically on anything with a
// title attribute (the normal HTML mechanism) or a data-tooltip attribute
// (used by SVG shapes - SVG's own native tooltip is a nested <title>
// element, not an attribute, so it can't be intercepted/restyled the same
// way - see log.js's network graphs). No per-element opt-in needed
// anywhere else in the codebase; loaded once on every page.

(function() {
    const TOOLTIP_SELECTOR = '[title], [data-tooltip]';
    const SHOW_DELAY = 250; // ms - avoids flicker while just passing over several items
    const CURSOR_OFFSET = 26; // px - generous enough to clear a large system cursor

    const note = document.createElement('div');
    note.id = 'sticky-tooltip';
    note.setAttribute('role', 'tooltip');
    document.body.appendChild(note);

    let currentTarget = null;
    let showTimer = null;
    let lastX = 0, lastY = 0;

    function textFor(el) {
        return el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
    }

    function position(x, y) {
        // Defaults to the bottom-right of the cursor; flips to whichever
        // side keeps the note fully on screen once its real size is known.
        const rect = note.getBoundingClientRect();
        let left = x + CURSOR_OFFSET;
        let top = y + CURSOR_OFFSET;
        if (left + rect.width > window.innerWidth - 8) left = x - rect.width - CURSOR_OFFSET;
        if (top + rect.height > window.innerHeight - 8) top = y - rect.height - CURSOR_OFFSET;
        note.style.left = Math.max(8, left) + 'px';
        note.style.top = Math.max(8, top) + 'px';
    }

    function show(el, x, y) {
        const text = textFor(el);
        if (!text) return;
        // Stash and strip the native title so the browser's own tooltip
        // never shows up alongside this one - restored in hide() once the
        // pointer leaves.
        if (el.hasAttribute('title')) {
            el.dataset.nativeTitle = el.getAttribute('title');
            el.removeAttribute('title');
        }
        note.textContent = text;
        note.style.display = 'block';
        position(x, y);
    }

    function hide() {
        note.style.display = 'none';
        clearTimeout(showTimer);
        if (currentTarget && currentTarget.dataset && currentTarget.dataset.nativeTitle !== undefined) {
            currentTarget.setAttribute('title', currentTarget.dataset.nativeTitle);
            delete currentTarget.dataset.nativeTitle;
        }
        currentTarget = null;
    }

    document.addEventListener('mouseover', function(e) {
        const el = e.target.closest ? e.target.closest(TOOLTIP_SELECTOR) : null;
        if (!el || el === currentTarget) return;
        if (currentTarget) hide();
        currentTarget = el;
        lastX = e.clientX; lastY = e.clientY;
        clearTimeout(showTimer);
        showTimer = setTimeout(function() { show(el, lastX, lastY); }, SHOW_DELAY);
    });

    document.addEventListener('mousemove', function(e) {
        lastX = e.clientX; lastY = e.clientY;
        if (currentTarget && note.style.display === 'block') position(lastX, lastY);
    });

    document.addEventListener('mouseout', function(e) {
        if (!currentTarget) return;
        // Moving to a descendant of the same target isn't actually leaving.
        if (e.relatedTarget && currentTarget.contains(e.relatedTarget)) return;
        hide();
    });

    // Keyboard users - show near the focused element instead of the cursor.
    document.addEventListener('focusin', function(e) {
        const el = e.target.closest ? e.target.closest(TOOLTIP_SELECTOR) : null;
        if (!el) return;
        currentTarget = el;
        const rect = el.getBoundingClientRect();
        show(el, rect.left, rect.bottom);
    });
    document.addEventListener('focusout', hide);

    // Most clicks on this site trigger a re-render that can remove the
    // hovered element outright (no guaranteed mouseout in that case) -
    // dropping the note on any click/scroll keeps it from being left
    // pointing at nothing.
    document.addEventListener('click', hide, true);
    document.addEventListener('scroll', hide, true);

    // The Fullscreen API only paints the fullscreened element and its own
    // descendants - anything else still in document.body (like this note,
    // appended there once above) just doesn't render while some other
    // element is fullscreen, even though the show/hide logic above still
    // runs. Reparenting into whichever element is actually fullscreen (and
    // back to body on exit) keeps it visible either way - it stays
    // position:fixed throughout, so this doesn't change how it's placed.
    document.addEventListener('fullscreenchange', function() {
        (document.fullscreenElement || document.body).appendChild(note);
    });
})();
