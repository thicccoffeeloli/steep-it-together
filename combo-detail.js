// Shows whatever was saved (name/description/notes, per temperature) for
// the ingredient combination passed in the URL as repeated ?ingredient=
// params. Linked to from a matrix cell, the ratings table, or the
// multi-ingredient list on log.html - each entry can be edited or deleted
// right here, no need to re-brew on the main page just to fix a typo.

const requestedIngredients = new URLSearchParams(window.location.search).getAll('ingredient');
const container = document.getElementById('combo-detail');
const navContainer = document.getElementById('combo-nav');
const notesPageEl = document.querySelector('.notes-page');

// 'category' | 'alphabetical' - which order Previous/Next step through
// entries in. Carried across navigation via the URL's own ?order= param
// (see entryUrl), so picking a mode doesn't silently reset back to the
// default every time you move to a new entry.
let navOrder = new URLSearchParams(window.location.search).get('order') === 'alphabetical'
    ? 'alphabetical' : 'category';

// Kept in sync with the same helpers in script.js/log.js - no shared module
// setup here, so every page that needs CJK-aware sorting keeps its own copy.
function isChineseText(str) {
    return /[一-鿿]/.test(str);
}
function alphabeticalCompare(a, b) {
    const aChinese = isChineseText(a);
    const bChinese = isChineseText(b);
    if (aChinese !== bChinese) return aChinese ? 1 : -1;
    return a.localeCompare(b, aChinese ? 'zh' : undefined);
}

// The top "Brew this" link was previously just a static href="index.html"
// with no ingredients attached, so it always landed on an empty cauldron -
// give it the same ?ingredient= params script.js's own preload logic reads
// on load (see cauldronUrl in log.js, which this mirrors).
(function() {
    const params = new URLSearchParams();
    requestedIngredients.forEach(function(name) { params.append('ingredient', name); });
    document.getElementById('brew-this-link').href = 'index.html?' + params.toString();
})();

// The full combos list, kept around (rather than just the filtered matches)
// so a delete/save can write back the other, unrelated entries untouched.
let allCombos = [];

// Only needed for category-ordered Previous/Next (see categoryIndexOf) -
// the page's own content doesn't care about categories at all.
let ingredientsData = [];

// category name -> hex color *override*, loaded from category-colors.json -
// see categoryColorHex.
let categoryColors = {};

// Which combos currently have their edit form open, and what their fields
// looked like when editing started - editField() below binds directly to
// the live combo object on every keystroke (same pattern as notes.js), so
// this snapshot is what Cancel restores if you back out without saving.
let editingCombos = new Map();

Promise.all([
    fetch('/combos').then(function(r) { return r.json(); }),
    fetch('/ingredients').then(function(r) { return r.json(); }),
    fetch('/category-colors').then(function(r) { return r.json(); })
]).then(function(results) {
    allCombos = results[0];
    ingredientsData = results[1];
    categoryColors = results[2];
    render();
    // Only on this first render - a little "page settling into place"
    // flourish for actually arriving here (a fresh link, or a Previous/
    // Next click, both real page loads) - not replayed on every in-place
    // edit/save/cancel further down, since nothing "turned" for those.
    if (notesPageEl) notesPageEl.classList.add('page-turn-in');
});

function isRequestedCombo(combo) {
    return combo.ingredients.length === requestedIngredients.length &&
        combo.ingredients.every(function(ing) { return requestedIngredients.includes(ing); });
}

// ===== Journal-style Previous/Next between distinct logged combos =====

// A stable identity for a set of ingredients regardless of order - used to
// tell two combos apart by *what's in them*, not by which temperature
// variant they are (hot/cold entries for the same ingredients are one
// "entry" here, already shown together on this same page).
function comboKey(ingredients) {
    return ingredients.slice().sort().join('|||');
}

function getDistinctEntries() {
    const seen = new Map();
    allCombos.forEach(function(combo) {
        const key = comboKey(combo.ingredients);
        if (!seen.has(key)) seen.set(key, combo.ingredients);
    });
    return Array.from(seen.values());
}

function categoryIndexOf(name) {
    for (let i = 0; i < ingredientsData.length; i++) {
        if (ingredientsData[i].items.includes(name)) return i;
    }
    return ingredientsData.length; // unknown ingredient - sorts last
}

// A palette used by the notebook-style divider tab (see renderComboNav) to
// color itself by whichever category the entry is currently filed under.
// Kept in sync with the identical copy in script.js/log.js/notes.js.
const CATEGORY_PALETTE = [
    '#6b4226', '#4c7a3f', '#b5541d', '#d9a441', '#a68a5b',
    '#5b2a86', '#c0392b', '#2f8f9d', '#7a1f3d', '#6b6155'
];

// A stable hash of the category's own *name* (never its position in
// ingredients.json) picks its default palette color - see the identical
// reasoning in script.js/log.js/notes.js (indexOf into the live section
// order meant a category's color changed just from dragging sections
// around). categoryColors holds explicit user overrides, set via the
// section right-click menu on the main page.
function defaultCategoryColorHex(categoryName) {
    let hash = 0;
    for (let i = 0; i < categoryName.length; i++) {
        hash = (hash * 31 + categoryName.charCodeAt(i)) | 0;
    }
    return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

function categoryColorHex(categoryName) {
    return categoryColors[categoryName] || defaultCategoryColorHex(categoryName);
}

// Dark ink or white, whichever reads better against a given category color -
// same ITU-R BT.601 brightness weighting used in log.js's readableTextStyle.
function readableTextColor(hex) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 150 ? '#2e2a24' : '#ffffff';
}

// The divider tab's label + color for one entry - its category (whichever
// section its first ingredient, in the current sort order, belongs to) when
// browsing by category, or just that ingredient's first letter when
// browsing alphabetically - the same idea as an address book's tabs.
function dividerFor(ingredients) {
    const sorted = ingredients.slice().sort(compareIngredientNames);
    const first = sorted[0];
    if (navOrder === 'alphabetical') {
        return { label: first.charAt(0).toUpperCase(), color: null };
    }
    const section = ingredientsData[categoryIndexOf(first)];
    const category = section ? section.section : 'Uncategorized';
    return { label: category, color: categoryColorHex(category) };
}

function compareIngredientNames(a, b) {
    if (navOrder === 'category') {
        const catA = categoryIndexOf(a);
        const catB = categoryIndexOf(b);
        if (catA !== catB) return catA - catB;
    }
    return alphabeticalCompare(a, b);
}

// Compares two entries by their own ingredients (each sorted under the
// current order) position by position - the same idea as comparing two
// words letter by letter, just using each ingredient's sort position
// instead of a character.
function compareEntries(entryA, entryB) {
    const sortedA = entryA.slice().sort(compareIngredientNames);
    const sortedB = entryB.slice().sort(compareIngredientNames);
    const len = Math.min(sortedA.length, sortedB.length);
    for (let i = 0; i < len; i++) {
        const cmp = compareIngredientNames(sortedA[i], sortedB[i]);
        if (cmp !== 0) return cmp;
    }
    return sortedA.length - sortedB.length;
}

function entryUrl(ingredients) {
    const params = new URLSearchParams();
    ingredients.forEach(function(name) { params.append('ingredient', name); });
    params.set('order', navOrder);
    return 'combo-detail.html?' + params.toString();
}

function renderComboNav() {
    navContainer.innerHTML = '';

    const entries = getDistinctEntries().sort(compareEntries);
    const currentKey = comboKey(requestedIngredients);
    const currentIndex = entries.findIndex(function(e) { return comboKey(e) === currentKey; });

    // A little colored index tab showing what section of the "notebook"
    // you're currently on - the category (by color) in Category order, or
    // just the starting letter in Alphabetical order, same idea as a
    // physical address book's thumb tabs.
    if (currentIndex !== -1) {
        const divider = dividerFor(entries[currentIndex]);
        const tab = document.createElement('div');
        tab.className = 'combo-nav-divider hand-label';
        tab.textContent = divider.label;
        if (divider.color) {
            tab.style.background = divider.color;
            tab.style.borderColor = divider.color;
            tab.style.color = readableTextColor(divider.color);
        }
        navContainer.appendChild(tab);
    }

    const nav = document.createElement('div');
    nav.className = 'combo-nav';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'combo-nav-btn combo-nav-btn--prev';
    prevBtn.textContent = '‹ Previous';
    if (currentIndex > 0) {
        const prevUrl = entryUrl(entries[currentIndex - 1]);
        prevBtn.addEventListener('click', function() { window.location.href = prevUrl; });
    } else {
        prevBtn.disabled = true;
    }
    nav.appendChild(prevBtn);

    const orderToggle = document.createElement('div');
    orderToggle.className = 'combo-nav-order';
    [['category', 'Category'], ['alphabetical', 'Alphabetical']].forEach(function(pair) {
        const btn = document.createElement('button');
        btn.className = 'sort-toggle-btn';
        btn.textContent = pair[1];
        btn.classList.toggle('active', navOrder === pair[0]);
        btn.addEventListener('click', function() {
            navOrder = pair[0];
            renderComboNav();
        });
        orderToggle.appendChild(btn);
    });
    nav.appendChild(orderToggle);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'combo-nav-btn combo-nav-btn--next';
    nextBtn.textContent = 'Next ›';
    if (currentIndex !== -1 && currentIndex < entries.length - 1) {
        const nextUrl = entryUrl(entries[currentIndex + 1]);
        nextBtn.addEventListener('click', function() { window.location.href = nextUrl; });
    } else {
        nextBtn.disabled = true;
    }
    nav.appendChild(nextBtn);

    navContainer.appendChild(nav);

    if (currentIndex !== -1) {
        const position = document.createElement('p');
        position.className = 'combo-nav-position';
        position.textContent = 'Entry ' + (currentIndex + 1) + ' of ' + entries.length;
        navContainer.appendChild(position);
    }
}

function render() {
    // Called up front (not at the end) so it still runs even when there's
    // nothing to show below and the rest of this function returns early.
    renderComboNav();

    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = requestedIngredients.join(' + ');
    container.appendChild(heading);

    const matches = allCombos.filter(isRequestedCombo);

    if (matches.length === 0) {
        const p = document.createElement('p');
        p.className = 'note-callout';
        p.textContent = 'No saved notes found for this combination.';
        container.appendChild(p);
        return;
    }

    matches.forEach(function(combo) {
        const article = document.createElement('article');
        article.className = 'note-item';

        const editing = editingCombos.has(combo);

        const editBtn = document.createElement('span');
        editBtn.className = 'remove-ingredient reference-remove';
        editBtn.textContent = ' ✏️';
        editBtn.title = 'Edit this entry';
        editBtn.addEventListener('click', function() {
            // Snapshot so Cancel (inside the edit form) has something to
            // restore - editField() below mutates the live combo directly.
            editingCombos.set(combo, {
                name: combo.name,
                description: combo.description,
                notes: combo.notes,
                rating: combo.rating,
                starred: combo.starred
            });
            render();
        });
        article.appendChild(editBtn);

        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'remove-ingredient reference-remove';
        deleteBtn.textContent = ' x';
        deleteBtn.title = 'Delete this entry';
        deleteBtn.addEventListener('click', function() {
            if (!confirm('Delete "' + combo.name + '"? This can\'t be undone.')) return;
            const updated = allCombos.filter(function(c) { return c !== combo; });
            fetch('/combos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            }).then(function() {
                allCombos = updated;
                render();
            });
        });
        article.appendChild(deleteBtn);

        // Combos saved before the Hot/Cold feature existed have no
        // temperature field - treat those as "hot", same rule as everywhere
        // else this data gets read.
        let temp = '🔥 Hot';
        if (combo.temperature === 'cold') temp = '❄️ Cold';
        else if (combo.temperature === 'stovetop') temp = '🍳 Stovetop';

        if (editing) {
            article.appendChild(buildEditForm(combo, temp));
        } else {
            const h3 = document.createElement('h3');
            h3.textContent = combo.name + ' — ' + temp;
            if (combo.starred) {
                h3.textContent += ' ⭐';
            }
            article.appendChild(h3);

            if (combo.rating) {
                const p = document.createElement('p');
                p.className = 'note-desc';
                const strong = document.createElement('strong');
                strong.textContent = 'Rating: ';
                p.appendChild(strong);
                p.appendChild(document.createTextNode(combo.rating + ' / 10'));
                article.appendChild(p);
            }

            if (combo.description) {
                const p = document.createElement('p');
                p.className = 'note-desc';
                p.textContent = combo.description;
                article.appendChild(p);
            }

            if (combo.notes) {
                const p = document.createElement('p');
                p.className = 'note-desc';
                const strong = document.createElement('strong');
                strong.textContent = 'Notes: ';
                p.appendChild(strong);
                p.appendChild(document.createTextNode(combo.notes));
                article.appendChild(p);
            }
        }

        container.appendChild(article);
    });
}

// One labelled input/textarea pair bound directly to combo[key] - same
// live-binding pattern as notes.js's editField.
function editField(labelText, combo, key, multiline) {
    const wrapper = document.createElement('div');
    wrapper.className = 'reference-edit-field';

    const label = document.createElement('label');
    label.textContent = labelText;
    wrapper.appendChild(label);

    const input = multiline ? document.createElement('textarea') : document.createElement('input');
    if (!multiline) input.type = 'text';
    input.value = combo[key] || '';
    input.addEventListener('input', function() {
        combo[key] = input.value;
    });
    wrapper.appendChild(input);

    return wrapper;
}

function buildEditForm(combo, temp) {
    const wrapper = document.createElement('div');
    wrapper.className = 'reference-edit-form';

    const tempLabel = document.createElement('p');
    tempLabel.className = 'note-desc';
    const tempStrong = document.createElement('strong');
    tempStrong.textContent = temp;
    tempLabel.appendChild(tempStrong);
    wrapper.appendChild(tempLabel);

    wrapper.appendChild(editField('Name', combo, 'name', false));

    const ratingWrapper = document.createElement('div');
    ratingWrapper.className = 'reference-edit-field';
    const ratingLabel = document.createElement('label');
    ratingLabel.textContent = 'Rating (0 = N/A)';
    ratingWrapper.appendChild(ratingLabel);
    const ratingInput = document.createElement('input');
    ratingInput.type = 'number';
    ratingInput.min = '0';
    ratingInput.max = '10';
    ratingInput.value = combo.rating || 0;
    ratingInput.addEventListener('input', function() {
        const value = Number(ratingInput.value);
        combo.rating = value === 0 ? null : value;
    });
    ratingWrapper.appendChild(ratingInput);
    wrapper.appendChild(ratingWrapper);

    const starWrapper = document.createElement('div');
    starWrapper.className = 'reference-edit-field';
    const starLabel = document.createElement('label');
    const starCheckbox = document.createElement('input');
    starCheckbox.type = 'checkbox';
    starCheckbox.checked = !!combo.starred;
    starCheckbox.addEventListener('change', function() {
        combo.starred = starCheckbox.checked;
    });
    starLabel.appendChild(starCheckbox);
    starLabel.appendChild(document.createTextNode(' ⭐ Starred'));
    starWrapper.appendChild(starLabel);
    wrapper.appendChild(starWrapper);

    wrapper.appendChild(editField('Description', combo, 'description', true));
    wrapper.appendChild(editField('Notes', combo, 'notes', true));

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function() {
        fetch('/combos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allCombos)
        }).then(function() {
            editingCombos.delete(combo);
            render();
        });
    });
    wrapper.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function() {
        const snapshot = editingCombos.get(combo);
        if (snapshot) {
            combo.name = snapshot.name;
            combo.description = snapshot.description;
            combo.notes = snapshot.notes;
            combo.rating = snapshot.rating;
            combo.starred = snapshot.starred;
        }
        editingCombos.delete(combo);
        render();
    });
    wrapper.appendChild(cancelBtn);

    return wrapper;
}
