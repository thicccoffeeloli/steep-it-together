// Small shared UI pieces used by every page (loaded after tooltip.js).

// A two-way toggle switch for any "this mode or that mode" choice - used
// instead of two separate pill buttons. Clicking anywhere on it flips to
// the other side; onChange gets the newly chosen value.
//   makeModeSwitch({ id, left: [value, label], right: [value, label], value, onChange, title })
window.makeModeSwitch = function(opts) {
    const onRight = opts.value === opts.right[0];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-switch';
    if (opts.id) btn.id = opts.id;
    if (opts.title) btn.title = opts.title;
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', onRight ? 'true' : 'false');
    btn.dataset.value = opts.value;

    function label(side, text, active) {
        const span = document.createElement('span');
        span.className = 'mode-switch-label mode-switch-' + side + (active ? ' is-on' : '');
        span.textContent = text;
        return span;
    }
    const track = document.createElement('span');
    track.className = 'mode-switch-track';
    const knob = document.createElement('span');
    knob.className = 'mode-switch-knob';
    track.appendChild(knob);

    btn.appendChild(label('left', opts.left[1], !onRight));
    btn.appendChild(track);
    btn.appendChild(label('right', opts.right[1], onRight));

    // Flip the knob first so it visibly slides, then let the caller redraw
    // (which usually replaces this whole element). No pause with reduced motion.
    btn.addEventListener('click', function() {
        if (btn.dataset.busy) return;
        btn.dataset.busy = '1';
        btn.setAttribute('aria-checked', onRight ? 'false' : 'true');
        btn.querySelector('.mode-switch-left').classList.toggle('is-on', onRight);
        btn.querySelector('.mode-switch-right').classList.toggle('is-on', !onRight);
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(function() {
            opts.onChange(onRight ? opts.left[0] : opts.right[0]);
            delete btn.dataset.busy;
        }, reduced ? 0 : 170);
    });
    return btn;
};

// A small colour key ("legend") explaining what the colours/symbols in a
// chart or table mean. Each entry is either:
//   { gradient: 'css gradient', from: '0', to: '10', label: 'Rating' }
//   { swatch: 'css background', text: '✗', label: 'Not brewed yet' }
//   { line: 'css colour', dashed: true, label: 'Suggested' }
window.makeColorKey = function(entries, title) {
    const key = document.createElement('div');
    key.className = 'color-key';
    if (title) {
        const t = document.createElement('span');
        t.className = 'color-key-title';
        t.textContent = title;
        key.appendChild(t);
    }
    entries.forEach(function(entry) {
        const item = document.createElement('span');
        item.className = 'color-key-item';
        if (entry.gradient) {
            if (entry.from) {
                const from = document.createElement('span');
                from.className = 'color-key-end';
                from.textContent = entry.from;
                item.appendChild(from);
            }
            const bar = document.createElement('span');
            bar.className = 'color-key-bar';
            bar.style.background = entry.gradient;
            item.appendChild(bar);
            if (entry.to) {
                const to = document.createElement('span');
                to.className = 'color-key-end';
                to.textContent = entry.to;
                item.appendChild(to);
            }
        } else if (entry.line) {
            const line = document.createElement('span');
            line.className = 'color-key-line' + (entry.dashed ? ' is-dashed' : '');
            line.style.borderColor = entry.line;
            item.appendChild(line);
        } else {
            const sw = document.createElement('span');
            sw.className = 'color-key-swatch';
            sw.style.background = entry.swatch || 'transparent';
            if (entry.border) sw.style.border = entry.border;
            if (entry.text) sw.textContent = entry.text;
            item.appendChild(sw);
        }
        const text = document.createElement('span');
        text.className = 'color-key-label';
        text.textContent = entry.label;
        item.appendChild(text);
        key.appendChild(item);
    });
    return key;
};

// Pinned Save/Cancel bars stick just below the sticky site header, not
// behind it. The header's height changes with the window (it wraps onto two
// rows on a phone), so keep --sticky-top in step with it.
(function trackHeaderHeight() {
    function apply() {
        const header = document.querySelector('.site-header');
        const h = header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty('--sticky-top', Math.round(h) + 'px');
    }
    function start() {
        apply();
        const header = document.querySelector('.site-header');
        if (header && window.ResizeObserver) new ResizeObserver(apply).observe(header);
        window.addEventListener('resize', apply);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();

// Quick ⭐ / 🔁 toggles for a logged combo - like a "favourite" button in any
// app: one click flips it and saves, no need to open the entry and edit it.
//   makeFlagToggles(combo, { save: () => Promise<Response>, onChange: (flag) => void })
// The button repaints immediately; if the save is refused or fails (e.g. guest
// view), it flips back. onChange runs after a successful save so the caller can
// refresh whatever else shows the flag.
window.makeFlagToggles = function(combo, opts) {
    const wrap = document.createElement('span');
    wrap.className = 'flag-toggles';
    wrap.addEventListener('click', function(e) { e.stopPropagation(); });

    const defs = [
        { flag: 'starred', cls: 'flag-star', on: '★', off: '☆', onTitle: 'Favourite - click to unmark', offTitle: 'Mark as a favourite' },
        { flag: 'tryAgain', cls: 'flag-again', on: '🔁', off: '🔁', onTitle: 'Marked to try again - click to unmark', offTitle: 'Mark to try again (e.g. the ratio was off)' }
    ];
    defs.forEach(function(def) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flag-btn ' + def.cls;
        function paint() {
            const on = !!combo[def.flag];
            btn.classList.toggle('is-on', on);
            btn.textContent = on ? def.on : def.off;
            btn.title = on ? def.onTitle : def.offTitle;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        paint();
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const was = !!combo[def.flag];
            combo[def.flag] = !was;
            paint();
            function revert() { combo[def.flag] = was; paint(); }
            opts.save().then(function(res) {
                if (!res || !res.ok) { revert(); return; }
                if (opts.onChange) opts.onChange(def.flag);
            }).catch(revert);
        });
        wrap.appendChild(btn);
    });
    return wrap;
};

// Editable note boxes: any .note-callout with a data-callout-id (the lavender
// boxes on Notepad and Settings) gets a small ✏️. Click it to rewrite the text
// in place; it saves to settings.json (so it follows you between devices),
// and "Reset to original" puts the built-in wording back. Write **words** to
// make them bold.
(function editableCallouts() {
    function escapeText(t) { return t; }

    // The built-in text as editable plain text: bold becomes **bold**, the
    // source file's line wrapping collapses to normal spaces.
    function defaultToText(html) {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        holder.querySelectorAll('strong, b').forEach(function(s) { s.replaceWith('**' + s.textContent + '**'); });
        return holder.textContent.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/ {2,}/g, ' ').trim();
    }

    // Custom text -> DOM: line breaks stay, **bold** becomes <strong>. Built
    // from text nodes (never innerHTML), so whatever is typed can't inject markup.
    function renderCustom(body, text) {
        body.textContent = '';
        text.split('\n').forEach(function(line, i) {
            if (i > 0) body.appendChild(document.createElement('br'));
            line.split(/(\*\*[^*]+\*\*)/).forEach(function(piece) {
                if (!piece) return;
                if (/^\*\*[^*]+\*\*$/.test(piece)) {
                    const strong = document.createElement('strong');
                    strong.textContent = piece.slice(2, -2);
                    body.appendChild(strong);
                } else {
                    body.appendChild(document.createTextNode(piece));
                }
            });
        });
    }

    const boxes = [];

    function setup(el) {
        const id = el.dataset.calloutId;
        const body = document.createElement('span');
        body.className = 'callout-body';
        while (el.firstChild) body.appendChild(el.firstChild);
        el.appendChild(body);
        const original = body.innerHTML;
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'callout-edit-btn';
        editBtn.textContent = '✏️';
        editBtn.title = 'Edit this note';
        editBtn.setAttribute('aria-label', 'Edit this note');
        el.classList.add('is-editable');
        el.appendChild(editBtn);

        const box = { id: id, el: el, body: body, original: original, editBtn: editBtn, custom: undefined, editing: false };
        boxes.push(box);

        function show() {
            box.editing = false;
            editBtn.hidden = false;
            if (box.custom) renderCustom(body, box.custom); else body.innerHTML = original;
        }
        box.show = show;

        editBtn.addEventListener('click', function() {
            box.editing = true;
            editBtn.hidden = true;
            const area = document.createElement('textarea');
            area.className = 'callout-textarea';
            area.value = box.custom || defaultToText(original);
            area.rows = Math.max(3, Math.min(10, Math.ceil(area.value.length / 70) + 1));
            const hint = document.createElement('span');
            hint.className = 'callout-hint';
            hint.textContent = 'Tip: put **double stars** around words to make them bold.';
            const msg = document.createElement('span');
            msg.className = 'callout-msg';
            const actions = document.createElement('span');
            actions.className = 'callout-actions';
            function mk(label, handler) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = label;
                b.addEventListener('click', handler);
                actions.appendChild(b);
                return b;
            }
            function commit(text) {
                msg.textContent = 'Saving...';
                return AppSettings.load().then(function(s) {
                    const merged = Object.assign({}, s.callouts || {});
                    if (text) merged[id] = text; else delete merged[id];
                    return AppSettings.save({ callouts: merged }).then(function() { box.custom = text || undefined; show(); });
                }).catch(function(err) {
                    msg.textContent = '⚠️ Couldn\'t save: ' + err.message;
                });
            }
            mk('Save', function() { commit(area.value.trim()); }).classList.add('callout-save');
            mk('Cancel', show);
            if (box.custom) mk('Reset to original', function() { commit(''); });
            body.textContent = '';
            body.appendChild(area);
            body.appendChild(document.createElement('br'));
            body.appendChild(hint);
            body.appendChild(actions);
            body.appendChild(msg);
            area.focus();
        });
    }

    function applySaved(callouts) {
        boxes.forEach(function(box) {
            if (box.editing) return; // never yank text out from under someone typing
            const text = callouts && callouts[box.id];
            box.custom = typeof text === 'string' && text.trim() ? text : undefined;
            box.show();
        });
    }

    function start() {
        document.querySelectorAll('.note-callout[data-callout-id]').forEach(setup);
        if (!boxes.length || !window.AppSettings) return;
        applySaved(AppSettings.get().callouts);               // cached copy first - instant
        AppSettings.load().then(function(s) { applySaved(s.callouts); }).catch(function() {});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
