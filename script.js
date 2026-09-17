// ===== Global state =====
// These arrays hold the data fetched from the server. They start empty and
// get filled in once the fetch() calls below finish (fetch is async, so the
// rest of the page can render before this data arrives).
let combinations = [];    // known ingredient combos, loaded from data.json
let ingredientsData = []; // ingredient sections + items, loaded from ingredients.json
let pairings = {};        // ingredient name -> array of names it pairs well with, loaded from pairings.json
let ingredientColors = {}; // ingredient name -> hex color, loaded from ingredient-colors.json - see mixCauldronColor
let categoryColors = {};  // category name -> hex color *override*, loaded from category-colors.json - see categoryColorHex

// Used for any ingredient that doesn't have its own color set yet (see the
// right-click "Set color" menu) - a neutral warm tan rather than something
// that would skew the mix in a specific, misleading direction.
const DEFAULT_INGREDIENT_COLOR = '#c9a876';

// cauldronItems is the single source of truth for what's currently in the
// cauldron. Everything else (the cauldron's own display, and the checkmark
// badges on ingredient chips) is *derived* from this array rather than
// tracked separately - that way they can never fall out of sync with each
// other. Whenever this array changes, call renderCauldron() and
// buildIngredientsPanel() to redraw both from it.
let cauldronItems = [];

// draggedItem remembers which ingredient is currently being dragged, and which
// section it came from. Needed because a drop can mean three different things
// (move into the cauldron, move to a different section, or reorder within the
// same section) and we have to know where the drag started to tell them apart.
let draggedItem = null; // { name, sectionIndex }

// Same idea, but for dragging whole sections to reorder them.
let draggedSectionIndex = null;

// A combo with no description is just a potential-pairing idea jotted down
// for later, not something actually brewed and evaluated - so it shouldn't
// count as "tried" (see comboIsTried, shared with log.js's matrix).
function comboIsTried(combo) {
    return !!(combo.description && combo.description.trim());
}

// An ingredient counts as "tried" if it shows up in at least one logged
// combo that actually has a description - i.e. there's a real brewed entry
// for it in the brew log (data.json), rather than a separately-maintained
// list that can drift out of sync (the old bug), or a bare idea with
// nothing brewed yet.
function isIngredientTried(name) {
    return combinations.some(function(combo) {
        return combo.ingredients.includes(name) && comboIsTried(combo);
    });
}

// panelMode controls what the Ingredients panel is currently showing:
//   'view'    - normal browsing. Just the "+" button is visible.
//   'editing' - one combined mode for everything: add/rename/delete
//               sections and ingredients at once. Dragging/arrows still
//               work here too (see saveIngredientsIfViewing below) - they
//               just don't persist immediately, same as every other change
//               in this mode, so Cancel can still throw all of it away.
let panelMode = 'view';

// Which sections are currently collapsed, by section name. UI-only state -
// never persisted, so it resets to "all expanded" on page reload.
let collapsedSections = new Set();

// 'word' (text-chip look) or 'icon' (each ingredient shows an image,
// dropped into the pot like a cooking game, instead of/alongside its name).
// Purely a view preference - doesn't touch ingredients.json.
let displayMode = 'icon';

// Turns an ingredient name into the filename we look for in Images/, e.g.
// "Hazelnut Coffee" -> "hazelnut-coffee.png". Lowercased and hyphenated so
// the convention stays predictable regardless of capitalisation/spacing in
// the name itself.
// Hand-mapped filenames for ingredients whose uploaded image doesn't match
// the auto-slug convention (a different name, a shared/generic image, or a
// Chinese filename for an English-named ingredient). Anything not listed
// here falls through to the auto-slug guess in imagePathFor, and anything
// that still doesn't resolve to a real file falls back to placeholder.png
// (see the "error" handlers in createIngredientEl/renderCauldron).
const IMAGE_OVERRIDES = {
    'Cinnamon Stick': 'cinnamon.png',
    'Chamomile': 'teabag-chamomile.png',
    'Cardamom Pods': 'cardamom.png',
    'Kenyan Dark Roast': 'coffee-dark-roast.png',
    'Dark Roast Coffee': 'dark-roast.png',
    'Medium Roast Coffee': 'coffee-medium-roast.png',
    'Apple Cider': 'alcohol-apple-cider.png',
    'Hot Alcoholic Cider': 'alcohol-apple-cider.png',
    'Red Wine': 'alcohol-red-wine.png',
    'Whiskey': 'alcohol-whiskey.png',
    'Rum': 'alcohol-rum.png',
    'CBD Blend': 'cbd.png',
    'Peppermint Teabag': 'teabag-peppermint.png',
    'Dried Coconut Flakes': 'coconut.png',
    'Fresh Lemon Slice': 'lemon-slice.png',
    'Fresh Grapefruit Slice': 'citrus-slice.png',
    'Dried Apple Peel': 'apple.png',
    'Fresh Mint Leaves': 'mint-fresh.png',
    'Star Anise': 'star-anise.png',
    'Black Peppercorn': 'black-peppercorn.png',
    'Black Pepper': 'black-peppercorn.png',
    'Hazelnut Coffee': 'coffee-hazelnut.png',
    'Ginger': 'ginger.png',
    'Dried Ginger': 'ginger.png',
    'Ground Ginger': 'ginger.png',
    'Roasted Corn Tea': 'corn.png',
    'Turmeric': 'tumeric.png',
    'Ground Turmeric': 'tumeric.png',
    '茉莉花茶': '茉莉花.png',
    'Rooibos + Honeybush Blend': 'teabag-rooibos-honeybush.png',
    'Goji Berries': '枸杞.png',
    'Hibiscus Teabag': 'teabag-hibiscus.png',
    'Dried Jujube': '红枣.png',
    'Soba Tea': 'buckwheat.png',
    'Cloves': 'cloves.png',
    'Dried Lychee': 'litchi.png',
    'Rooibos Teabag': 'teabag-rooibos.png',
    'Dried Naartjie Peel': 'naartjie-peel.png',
    'Fresh Naartjie Zest': 'naartjie-peel.png',
    'Toasted Naartjie Zest': 'naartjie-peel.png',
    'Medium-Dark Roast Grounds': 'coffee-medium-roast.png',
    'Barley tea': 'barley.png',
    // No dedicated picture for these - the generic citrus peel/zest image
    // is a closer fallback than the plain placeholder.
    'Grapefruit Zest': 'citrus-general-peel.png',
    'Fresh Orange Zest': 'citrus-general-peel.png',
    'Dried Orange Zest': 'citrus-general-peel.png',
    'Fresh Lemon Zest': 'citrus-general-peel.png',
    'Dried Lemon Zest': 'citrus-general-peel.png',
    'Fresh Tangerine Zest': 'citrus-general-peel.png',
    'Dried Tangerine Zest': 'citrus-general-peel.png',
    'Pomelo Zest': 'citrus-general-peel.png'
};

function imagePathFor(name) {
    if (IMAGE_OVERRIDES[name]) return 'Images/' + IMAGE_OVERRIDES[name];

    // Keeps CJK characters as-is (lowercasing doesn't affect them) rather
    // than stripping them - the original [^a-z0-9] version would have
    // reduced every Chinese-named ingredient (普洱, 菊花...) to an empty
    // filename, since none of those characters are a-z0-9.
    const slug = name.toLowerCase()
        .trim()
        .replace(/[^a-z0-9一-鿿]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return 'Images/' + slug + '.png';
}

// Falls back to a generic placeholder image if the specific one 404s,
// rather than just removing the picture - guarded so a failing
// placeholder.png itself can't retry forever.
//
// Used to also try .jpg/.jpeg/.webp before giving up, for a photo dropped
// straight into Images/ by hand in some format other than .png - reverted
// that, since it made every ingredient *without* a real icon (the common
// case) do up to 4 sequential failed requests instead of 1, every single
// time the Ingredients panel re-renders (which is often - almost every
// interaction rebuilds it), not just once. The in-app upload button
// already always saves as .png regardless of what you picked, so this was
// only ever needed for a manual file-system drop, which never actually
// came up.
function usePlaceholderOnError(img) {
    img.addEventListener('error', function() {
        if (img.dataset.usedPlaceholder) {
            img.remove();
            return;
        }
        img.dataset.usedPlaceholder = 'true';
        img.src = 'Images/placeholder.png';
    });
}

// Bumped after every successful upload so freshly-set image src's don't
// come back from the browser's cache showing the old (or missing) picture.
let iconCacheBust = Date.now();

// Which ingredient the hidden file input below is currently uploading for.
let iconUploadTargetName = null;

const iconUploadInput = document.createElement('input');
iconUploadInput.type = 'file';
iconUploadInput.accept = 'image/*';
iconUploadInput.style.display = 'none';
document.body.appendChild(iconUploadInput);

function openIconUpload(name) {
    iconUploadTargetName = name;
    iconUploadInput.click();
}

iconUploadInput.addEventListener('change', function() {
    const file = iconUploadInput.files[0];
    iconUploadInput.value = ''; // so picking the same file again still fires "change"
    const name = iconUploadTargetName;
    if (!file || !name) return;

    const reader = new FileReader();
    reader.onload = function() {
        const img = new Image();
        img.onload = function() {
            // Normalizes whatever was picked (any size/format) onto a
            // consistent square PNG canvas, centered and scaled to fit -
            // keeps every icon a predictable size regardless of the
            // original file, and PNG is the only format imagePathFor()
            // ever looks for.
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.min(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

            // A pink rose photo should make its tea lean pink without an
            // extra manual step - derive a mixing color from the picture
            // itself (mixCauldronColor's own average-RGB approach, just
            // over pixels instead of ingredients) every time a new photo
            // is uploaded. Deliberately always overwrites - uploading a
            // new picture is a strong enough signal that it's the new
            // source of truth; if you want a specific color instead, set
            // it with the right-click "Set color" picker *after* uploading.
            const derived = averageCanvasColor(ctx, size, size);
            if (derived) {
                ingredientColors[name] = derived;
                saveIngredientColors();
            }

            // imagePathFor() already knows the right filename for this
            // ingredient (an override if one exists, otherwise the
            // auto-slug) - reuse it so the upload lands exactly where the
            // app will actually look for it.
            const filename = imagePathFor(name).replace(/^Images\//, '');

            uploadImage(filename, canvas.toDataURL('image/png')).then(function(ok) {
                if (!ok) return;
                iconCacheBust = Date.now();
                buildIngredientsPanel();
                renderCauldron();
                showToast('✓ Icon uploaded');
            });
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
});

// Whether the Ingredients panel is currently *displayed* alphabetically.
// Purely a view toggle - the underlying custom drag/arrow order in
// ingredientsData is never touched, so switching back to custom order
// always restores it exactly. Applies everywhere (browsing and while
// adding/removing/renaming), so entering an edit session never silently
// switches what order you're looking at.
let alphabeticalView = false;

// Live text filter typed into the Ingredients panel's own search box -
// applies everywhere (browsing and while editing), same "never silently
// changes what you're looking at differently per-mode" philosophy as
// alphabeticalView above. Substring match, case-insensitive.
let ingredientSearchQuery = '';

function ingredientMatchesSearch(name) {
    return !ingredientSearchQuery || name.toLowerCase().includes(ingredientSearchQuery.toLowerCase());
}

// Chinese-character entries sort after everything else, then alphabetically
// among themselves (by their own locale) - used wherever names get put in
// alphabetical order (Ingredients panel, Potential pairings). log.js and
// combo-detail.js keep their own copy since there's no shared module setup.
function isChineseText(str) {
    return /[一-鿿]/.test(str);
}

function alphabeticalCompare(a, b) {
    const aChinese = isChineseText(a);
    const bChinese = isChineseText(b);
    if (aChinese !== bChinese) return aChinese ? 1 : -1;
    return a.localeCompare(b, aChinese ? 'zh' : undefined);
}

// A palette used to tint section-name pills (Ingredients panel, Notepad)
// and the Potential pairings chips by what kind of ingredient they are.
// Kept in sync with the identical copy in log.js/notes.js/combo-detail.js
// (there's no shared module setup on this site).
const CATEGORY_PALETTE = [
    '#6b4226', '#4c7a3f', '#b5541d', '#d9a441', '#a68a5b',
    '#5b2a86', '#c0392b', '#2f8f9d', '#7a1f3d', '#6b6155'
];

// A stable hash of the category's own *name* (never its position in
// ingredients.json) picks its default palette color - previously this used
// indexOf into the live section order, so dragging a section to a new spot
// reassigned its color to whatever used to sit there (e.g. moving Herbal to
// the top made it turn Coffee's brown). Hashing the name means a section
// keeps its own color no matter where it's dragged.
function defaultCategoryColorHex(category) {
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
        hash = (hash * 31 + category.charCodeAt(i)) | 0;
    }
    return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

// categoryColors (loaded from category-colors.json) holds only explicit
// user overrides, set via the section right-click menu's "Set section
// color" - anything not in there just uses its hashed default above.
function categoryColorHex(category) {
    return categoryColors[category] || defaultCategoryColorHex(category);
}

function categoryOfIngredient(name) {
    const section = ingredientsData.find(function(s) { return s.items.includes(name); });
    return section ? section.section : null;
}

// Dark ink or white, whichever reads better against a given category color -
// reuses this file's own object-shaped hexToRgb (defined further down) via
// standard perceived-brightness weighting.
function categoryPillTextColor(hex) {
    const rgb = hexToRgb(hex);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness > 150 ? '#2e2a24' : '#ffffff';
}

// True whenever reorder controls (drag, arrows) should be active - while
// just browsing, and now during an edit session too. Not in alphabetical
// view, since position there is computed at render time - dragging
// wouldn't visibly do anything.
function reorderActive() {
    return (panelMode === 'view' || panelMode === 'editing') && !alphabeticalView;
}

// Pressing Enter in a "type a name, then click Add" field submits it too,
// instead of always requiring an actual click on the button.
function submitOnEnter(input, button) {
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') button.click();
    });
}

// A snapshot of ingredientsData taken the moment editing starts (the "+" click).
// While panelMode !== 'view', every add/delete/move edits ingredientsData in
// memory ONLY - nothing touches the server until "Save" is clicked. "Cancel"
// throws away everything by restoring this snapshot instead. null whenever
// we're not currently editing.
let ingredientsBackup = null;

// Same idea, but for pairings - renaming an ingredient (see
// migratePairingsKey) migrates its pairings entries in memory immediately,
// so Cancel needs its own snapshot to undo that too, same as ingredientsData.
let pairingsBackup = null;

// Renaming an ingredient also needs its icon file copied to match the new
// name (see migrateIngredientImage) - but that's a real network/filesystem
// round trip, not just an in-memory edit, so unlike pairings it can't apply
// immediately on blur without jumping ahead of Save/Cancel. Instead each
// rename just queues {oldName, newName} here; Save fires them all (and waits
// for them) before re-rendering, Cancel just drops the queue untouched.
let pendingImageRenames = [];

// Same snapshot/restore idea as pairingsBackup, for ingredientColors (see
// migrateIngredientColorKey) - a rename migrates its color key in memory
// immediately (cheap, just moving a map entry), so Cancel needs a way to
// undo that too.
let ingredientColorsBackup = null;

// Same idea again, for combinations (data.json) - a rename used to leave
// every already-logged combo pointing at the old name, which is exactly why
// a renamed-but-previously-tried ingredient would flip back to "untried"
// (isIngredientTried can no longer find a combo whose ingredients include
// the *new* name). migrateComboIngredientNames fixes the references in
// memory; this backup is what lets Cancel undo it.
let combinationsBackup = null;

// Snapshots and switches into editing mode, unless already in it - shared by
// the "+" button and every right-click menu action below, so a menu action
// still goes through the exact same Save/Cancel safety net as everything
// else in this mode, rather than applying immediately with no way back.
function enterEditingMode() {
    if (panelMode === 'editing') return;
    ingredientsBackup = JSON.parse(JSON.stringify(ingredientsData));
    pairingsBackup = JSON.parse(JSON.stringify(pairings));
    ingredientColorsBackup = JSON.parse(JSON.stringify(ingredientColors));
    combinationsBackup = JSON.parse(JSON.stringify(combinations));
    pendingImageRenames = [];
    panelMode = 'editing';
}

// outputTemp is which method tab (Hot Steep, Cold Brew, or Stovetop) is
// currently active in the Drink output panel. currentMatches holds whatever
// saved combo exists for the current cauldron contents, split out per
// method, so switching tabs can show the right one without re-searching.
let outputTemp = 'hot';
let currentMatches = { hot: null, cold: null, stovetop: null };

// True once Brew's been clicked for the cauldron's *current* contents -
// false again as soon as those contents change (see resetDrinkOutput) or
// the cauldron's cleared. Save checks this so it can't write an entry for a
// recipe that was never actually brewed (see the Save handler below).
let hasBrewed = false;

// ===== Initial data load =====

fetch('/combos')
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        combinations = data;
        // Tried/untried tints depend on this data - re-render in case the
        // ingredients panel already drew itself (from the separate
        // /ingredients fetch) before this one came back.
        buildIngredientsPanel();
    });

fetch('/ingredients')
    .then(function(response) { return response.json(); })
    .then(function(data) {
        ingredientsData = data;
        // Start with every section collapsed - opening one is a deliberate
        // click, not something the page decides for you.
        data.forEach(function(section) { collapsedSections.add(section.section); });
        buildIngredientsPanel();
    });

fetch('/pairings')
    .then(function(response) { return response.json(); })
    .then(function(data) {
        pairings = data;
        renderPotentialPairings();
    });

fetch('/ingredient-colors')
    .then(function(response) { return response.json(); })
    .then(function(data) {
        ingredientColors = data;
    });

fetch('/category-colors')
    .then(function(response) { return response.json(); })
    .then(function(data) {
        categoryColors = data;
        // Section pills and pairing chips both color themselves by
        // category - re-render whichever's already drawn by the time this
        // comes back.
        buildIngredientsPanel();
        renderPotentialPairings();
    });

// ===== Ingredients panel =====
// This whole panel gets wiped and rebuilt from scratch every time something
// changes (a new ingredient added, panelMode switched, cauldron contents
// changed, etc). That's simpler than trying to patch individual DOM nodes,
// at the cost of being a little less efficient - fine for a list this small.
function buildIngredientsPanel() {
    const panel = document.getElementById('ingredients-panel');
    panel.innerHTML = '';

    // --- Heading row ---
    // No more "+" button - right-click a section or ingredient to add/
    // rename/remove/set its color (see their own contextmenu handlers
    // below). Right-clicking the heading itself covers "add a section" for
    // when there's nothing to right-click yet (an empty list) or you just
    // want a new top-level section.
    const h2 = document.createElement('h2');
    h2.textContent = 'Ingredients';
    h2.title = 'Right-click here to add a section, or right-click any section/ingredient to edit it';
    h2.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
            {
                label: '➕ Add section',
                onClick: function() {
                    enterEditingMode();
                    buildIngredientsPanel();
                    const input = document.querySelector('.add-section-form input');
                    if (input) input.focus();
                }
            }
        ]);
    });
    panel.appendChild(h2);

    // Full teardown/rebuild on every keystroke (same as everywhere else this
    // pattern is used - see the Rating table/Book search boxes in log.js),
    // so focus/cursor position have to be explicitly restored afterward.
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'rating-table-search-input';
    searchInput.placeholder = '🔍 Search ingredients...';
    searchInput.value = ingredientSearchQuery;
    searchInput.addEventListener('input', function() {
        ingredientSearchQuery = searchInput.value;
        const cursor = searchInput.selectionStart;
        buildIngredientsPanel();
        const newInput = document.querySelector('#ingredients-panel .rating-table-search-input');
        if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(cursor, cursor);
        }
    });
    panel.appendChild(searchInput);

    // Expand/collapse-all toggle - always visible, independent of panelMode.
    // Label and behaviour flip based on whether every section is currently
    // collapsed.
    const allCollapsed = ingredientsData.length > 0 && ingredientsData.every(function(section) {
        return collapsedSections.has(section.section);
    });

    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.id = 'toggle-all-btn';
    toggleAllBtn.textContent = allCollapsed ? '▼ Expand all' : '▲ Collapse all';
    toggleAllBtn.addEventListener('click', function() {
        if (allCollapsed) {
            collapsedSections.clear();
        } else {
            ingredientsData.forEach(function(section) { collapsedSections.add(section.section); });
        }
        buildIngredientsPanel();
    });
    panel.appendChild(toggleAllBtn);

    // Alphabetical/custom order toggle - always visible and always applied,
    // in view mode and while adding/removing/renaming alike, so switching
    // into an edit session never silently changes what order you're looking
    // at. Purely a view preference - the underlying custom drag order in
    // ingredientsData is never touched, so switching back restores it exactly.
    const alphaToggleBtn = document.createElement('button');
    alphaToggleBtn.id = 'alpha-toggle-btn';
    alphaToggleBtn.textContent = alphabeticalView ? '↕ Custom order' : '🔤 A-Z order';
    alphaToggleBtn.title = 'Your custom drag order is kept either way - this only changes what you see';
    alphaToggleBtn.addEventListener('click', function() {
        alphabeticalView = !alphabeticalView;
        buildIngredientsPanel();
    });
    panel.appendChild(alphaToggleBtn);

    // Word/Icon display toggle - Word mode is the existing text-chip look;
    // Icon mode shows a picture per ingredient instead, meant to be dropped
    // into the pot like a cooking game. Images live in Images/<slug>.png
    // (see imagePathFor) - anything without one yet just falls back to
    // showing its name, so this is safe to turn on before every ingredient
    // has an image.
    const displayModeBtn = document.createElement('button');
    displayModeBtn.id = 'display-mode-btn';
    displayModeBtn.textContent = displayMode === 'word' ? '🖼️ Icon mode' : '🔤 Word mode';
    displayModeBtn.addEventListener('click', function() {
        displayMode = displayMode === 'word' ? 'icon' : 'word';
        buildIngredientsPanel();
        renderCauldron();
    });
    panel.appendChild(displayModeBtn);

    // One-off catch-up action, not a live-updating toggle like the buttons
    // above - re-samples every ingredient's mixing color from its actual
    // icon (see refreshAllIngredientColorsFromIcons), for anything
    // uploaded before that auto-derive existed or stuck on an old color.
    const refreshColorsBtn = document.createElement('button');
    refreshColorsBtn.id = 'refresh-colors-btn';
    refreshColorsBtn.textContent = '🎨 Refresh icon colors';
    refreshColorsBtn.title = 'Re-samples every ingredient\'s mixing color from its actual icon picture';
    refreshColorsBtn.addEventListener('click', refreshAllIngredientColorsFromIcons);
    panel.appendChild(refreshColorsBtn);

    // Save/Cancel live in their own bar below the heading.
    if (panelMode === 'editing') {
        const actions = document.createElement('div');
        actions.className = 'edit-actions';

        const editingLabel = document.createElement('span');
        editingLabel.className = 'edit-actions-label';
        editingLabel.textContent = '✏️ Editing';
        actions.appendChild(editingLabel);

        const saveBtn = document.createElement('button');
        saveBtn.id = 'save-edits-btn';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
            saveBtn.disabled = true;
            // Icon copies (see pendingImageRenames/migrateIngredientImage)
            // have to actually finish before the panel re-renders showing
            // the new name - otherwise it'd request the new file before the
            // copy landed, 404, and fall back to the placeholder.
            const imageCopies = pendingImageRenames.map(function(pair) {
                return migrateIngredientImage(pair.oldName, pair.newName);
            });
            Promise.all(imageCopies).then(function() {
                saveIngredients(); // the only place this now gets called - once, on demand
                savePairings(); // persist any in-session rename migrations (see migratePairingsKey)
                saveIngredientColors(); // same, for migrateIngredientColorKey
                saveCombinations(); // same, for migrateComboIngredientNames
                pruneOrphanedPairings(); // drop pairings.json entries for anything actually deleted
                pruneOrphanedIngredientColors(); // same, for ingredient-colors.json
                ingredientsBackup = null;
                pairingsBackup = null;
                ingredientColorsBackup = null;
                combinationsBackup = null;
                pendingImageRenames = [];
                panelMode = 'view';
                iconCacheBust = Date.now(); // so the copied file(s) don't come back from browser cache
                buildIngredientsPanel();
                renderCauldron();
                renderPotentialPairings();
                showToast('✓ Ingredients saved');
            });
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-edits-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
            // Throw away every in-memory change since editing started. The
            // server was never touched, so nothing needs to be re-sent here.
            // Includes pairings/colors/combinations, since a rename migrates
            // all three live (see migratePairingsKey and friends) rather
            // than waiting for Save - and pendingImageRenames just gets
            // dropped, since those copies were never actually fired in the
            // first place (see Save above).
            ingredientsData = ingredientsBackup;
            pairings = pairingsBackup;
            ingredientColors = ingredientColorsBackup;
            combinations = combinationsBackup;
            ingredientsBackup = null;
            pairingsBackup = null;
            ingredientColorsBackup = null;
            combinationsBackup = null;
            pendingImageRenames = [];
            panelMode = 'view';
            buildIngredientsPanel();
            renderPotentialPairings();
        });

        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);
        panel.appendChild(actions);
    }

    // --- "Add section" form - up here, not after the whole list, so you
    // don't have to scroll past every section just to add a new one. ---
    if (panelMode === 'editing') {
        const newSectionForm = document.createElement('div');
        newSectionForm.className = 'add-section-form';

        const newSectionInput = document.createElement('input');
        newSectionInput.type = 'text';
        newSectionInput.placeholder = 'New section name';

        const newSectionBtn = document.createElement('button');
        newSectionBtn.textContent = 'Add section';
        newSectionBtn.addEventListener('click', function() {
            const name = newSectionInput.value.trim();
            if (!name) return;
            ingredientsData.unshift({ section: name, items: [] });
            buildIngredientsPanel();
            flashNewlyAdded('.ingredient-section[data-section="' + CSS.escape(name) + '"]');
        });
        submitOnEnter(newSectionInput, newSectionBtn);

        newSectionForm.appendChild(newSectionInput);
        newSectionForm.appendChild(newSectionBtn);
        panel.appendChild(newSectionForm);
    }

    // --- Render each section ---
    // Displayed order follows the alphabetical toggle (view mode only) but
    // sectionIndex always refers to the real position in ingredientsData -
    // every drag/arrow/rename/delete control below operates on that real
    // index, never the display position.
    const sectionOrder = ingredientsData.map(function(_, i) { return i; });
    if (alphabeticalView) {
        sectionOrder.sort(function(i, j) {
            return alphabeticalCompare(ingredientsData[i].section, ingredientsData[j].section);
        });
    }

    sectionOrder.forEach(function(sectionIndex) {
        const section = ingredientsData[sectionIndex];

        // A section with nothing matching the current search is just noise -
        // skip it entirely (header, add-ingredient form, all of it) rather
        // than rendering an empty shell. Nothing to skip when the search box
        // is empty - every section renders exactly as before.
        if (ingredientSearchQuery && !section.items.some(ingredientMatchesSearch)) return;

        const div = document.createElement('div');
        div.className = 'ingredient-section';
        div.dataset.section = section.section;

        const isCollapsed = collapsedSections.has(section.section);

        const h3 = document.createElement('h3');
        h3.className = 'section-toggle';
        const sectionColor = categoryColorHex(section.section);
        h3.style.background = sectionColor;
        h3.style.borderColor = sectionColor;
        h3.style.color = categoryPillTextColor(sectionColor);

        const arrow = document.createElement('span');
        arrow.className = 'section-arrow';
        arrow.textContent = isCollapsed ? '▶' : '▼';

        h3.appendChild(arrow);

        if (panelMode === 'editing') {
            // Editable in place, so a typo doesn't mean delete-and-recreate.
            // Renaming has to keep collapsedSections in sync since it's
            // keyed by name - migrate the entry on every keystroke rather
            // than re-rendering (which would lose focus/cursor position).
            let currentName = section.section;

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'section-name-input';
            nameInput.value = section.section;
            nameInput.addEventListener('click', function(e) {
                e.stopPropagation(); // don't also toggle collapse
            });
            nameInput.addEventListener('mousedown', function(e) {
                e.stopPropagation(); // don't let the section's own drag hijack text selection here
            });
            nameInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') nameInput.blur();
            });
            nameInput.addEventListener('input', function() {
                const newName = nameInput.value;
                if (collapsedSections.has(currentName)) {
                    collapsedSections.delete(currentName);
                    collapsedSections.add(newName);
                }
                section.section = newName;
                currentName = newName;
            });
            h3.appendChild(nameInput);
        } else {
            const label = document.createElement('span');
            label.textContent = section.section;
            h3.appendChild(label);
        }

        // Clicking the section header expands/collapses it. Buttons added
        // below (reorder arrows, delete) call stopPropagation so they don't
        // also trigger this.
        h3.addEventListener('click', function() {
            if (collapsedSections.has(section.section)) {
                collapsedSections.delete(section.section);
            } else {
                collapsedSections.add(section.section);
            }
            buildIngredientsPanel();
        });

        // Reordering (drag or arrows) works both while browsing and during
        // an edit session - moves only persist immediately while just
        // browsing (see saveIngredientsIfViewing); during editing they're
        // deferred to Save like everything else. Hidden in alphabetical
        // view, since position there is computed at render time - dragging
        // wouldn't visibly do anything.
        if (reorderActive()) {
            div.draggable = true;
            div.addEventListener('dragstart', function() {
                draggedSectionIndex = sectionIndex;
            });
            div.addEventListener('dragover', function(e) {
                e.preventDefault();
                if (draggedSectionIndex === null || draggedSectionIndex === sectionIndex) return;
                clearDragIndicators();
                // Matches the actual drop logic below: dropping here always
                // inserts the dragged section right before this one.
                div.classList.add('drag-target-section');
            });
            div.addEventListener('drop', function(e) {
                e.preventDefault();
                if (draggedSectionIndex === null || draggedSectionIndex === sectionIndex) return;

                const [moved] = ingredientsData.splice(draggedSectionIndex, 1);
                // Find where "section" (the one dropped on) ended up after that
                // removal, and insert the dragged section right before it.
                const insertAt = ingredientsData.indexOf(section);
                ingredientsData.splice(insertAt, 0, moved);

                draggedSectionIndex = null;
                saveIngredientsIfViewing();
                buildIngredientsPanel();
            });
        }

        // Deleting still goes through Save/Cancel, same as renaming above.
        if (panelMode === 'editing') {
            const deleteSectionBtn = document.createElement('span');
            deleteSectionBtn.className = 'remove-ingredient';
            deleteSectionBtn.textContent = ' x';
            deleteSectionBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                ingredientsData.splice(sectionIndex, 1);
                buildIngredientsPanel();
            });
            h3.appendChild(deleteSectionBtn);
        }
        div.appendChild(h3);

        // Right-click for Add ingredient/Rename/Delete - stopPropagation so
        // right-clicking a specific ingredient inside (see createIngredientEl)
        // doesn't also bubble up and show this section's menu on top of/
        // instead of its own.
        div.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, [
                {
                    label: '➕ Add ingredient',
                    onClick: function() {
                        enterEditingMode();
                        collapsedSections.delete(section.section);
                        buildIngredientsPanel();
                        const input = document.querySelector(
                            '.ingredient-section[data-section="' + CSS.escape(section.section) + '"] .add-ingredient-form input'
                        );
                        if (input) input.focus();
                    }
                },
                {
                    label: '✏️ Rename section',
                    onClick: function() {
                        enterEditingMode();
                        buildIngredientsPanel();
                        const input = document.querySelector(
                            '.ingredient-section[data-section="' + CSS.escape(section.section) + '"] .section-name-input'
                        );
                        if (input) { input.focus(); input.select(); }
                    }
                },
                {
                    label: '🎨 Set section color',
                    onClick: function() { openCategoryColorPicker(section.section); }
                },
                {
                    label: '🗑️ Delete section',
                    onClick: function() {
                        enterEditingMode();
                        const idx = ingredientsData.indexOf(section);
                        if (idx !== -1) ingredientsData.splice(idx, 1);
                        buildIngredientsPanel();
                    }
                }
            ]);
        });

        // Dropping directly on the section (rather than on one of its
        // ingredients) moves the dragged ingredient to the end of this
        // section's list - including from the *same* section, since that's
        // the only way to make something the very last item (dropping on an
        // item always inserts before it, so there's otherwise no way to
        // land after the last one). Kept active even while collapsed, so a
        // collapsed section is still a valid drop target.
        if (reorderActive()) {
            div.addEventListener('dragover', function(e) {
                e.preventDefault();
                if (!draggedItem) return;
                clearDragIndicators();
                div.classList.add('drag-target-ingredient-end');
            });
            div.addEventListener('drop', function(e) {
                e.preventDefault();
                if (!draggedItem) return;

                const fromItems = ingredientsData[draggedItem.sectionIndex].items;
                const idx = fromItems.indexOf(draggedItem.name);
                if (idx !== -1) fromItems.splice(idx, 1);

                ingredientsData[sectionIndex].items.push(draggedItem.name);
                draggedItem = null;
                saveIngredientsIfViewing();
                buildIngredientsPanel();
            });
        }

        if (!isCollapsed) {
            // "Add ingredient" form - up here, before the item list, so you
            // don't have to scroll past every ingredient in the section
            // just to add a new one.
            if (panelMode === 'editing') {
                const addForm = document.createElement('div');
                addForm.className = 'add-ingredient-form';

                const newItemInput = document.createElement('input');
                newItemInput.type = 'text';
                newItemInput.placeholder = 'New ingredient';

                const newItemBtn = document.createElement('button');
                newItemBtn.textContent = 'Add';
                newItemBtn.addEventListener('click', function() {
                    const name = newItemInput.value.trim();
                    if (!name) return;
                    section.items.unshift(name);
                    buildIngredientsPanel();
                    flashNewlyAdded('.ingredient[data-name="' + CSS.escape(name) + '"]');
                });
                submitOnEnter(newItemInput, newItemBtn);

                addForm.appendChild(newItemInput);
                addForm.appendChild(newItemBtn);
                div.appendChild(addForm);
            }

            const ul = document.createElement('ul');
            // Same real-index-vs-display-order split as the sections above.
            let itemOrder = section.items.map(function(_, i) { return i; });
            if (alphabeticalView) {
                itemOrder.sort(function(i, j) {
                    return alphabeticalCompare(section.items[i], section.items[j]);
                });
            }
            if (ingredientSearchQuery) {
                itemOrder = itemOrder.filter(function(i) { return ingredientMatchesSearch(section.items[i]); });
            }
            itemOrder.forEach(function(itemIndex) {
                ul.appendChild(createIngredientEl(section.items[itemIndex], sectionIndex, itemIndex));
            });
            div.appendChild(ul);
        }

        panel.appendChild(div);
    });
}

// ===== Right-click context menus =====
// A single reused floating menu, populated fresh and positioned at the
// click each time - a faster shortcut into section/ingredient actions
// (Add/Rename/Delete/Upload icon), rather than a separate system: everything
// a menu item does still goes through enterEditingMode() and the normal
// Save/Cancel flow, same as the "+" button.
function showContextMenu(clientX, clientY, items) {
    let menu = document.getElementById('context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'context-menu';
        document.body.appendChild(menu);
    }
    menu.innerHTML = '';
    items.forEach(function(item) {
        const btn = document.createElement('button');
        btn.textContent = item.label;
        btn.addEventListener('click', function() {
            hideContextMenu();
            item.onClick();
        });
        menu.appendChild(btn);
    });
    menu.style.display = 'flex';

    // Clamped so it never renders partly off-screen regardless of where on
    // the page the right-click happened.
    const maxLeft = window.innerWidth - menu.offsetWidth - 8;
    const maxTop = window.innerHeight - menu.offsetHeight - 8;
    menu.style.left = Math.min(clientX, Math.max(8, maxLeft)) + 'px';
    menu.style.top = Math.min(clientY, Math.max(8, maxTop)) + 'px';
}

function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
}

// Closes the menu on literally anything else - another click, a right-click
// elsewhere, scrolling, resizing, or Escape. Section/ingredient contextmenu
// handlers stop propagation before calling showContextMenu, so opening one
// doesn't immediately trigger this same listener and close itself.
document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', hideContextMenu);
window.addEventListener('scroll', hideContextMenu, true);
window.addEventListener('resize', hideContextMenu);
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideContextMenu();
});

// Brief non-blocking confirmation banner, used wherever something just got
// saved - reuses one element/timer so repeated saves just restart the fade
// instead of stacking up.
let toastTimeout = null;
function showToast(message, duration) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function() {
        toast.classList.remove('visible');
    }, duration || 2000);
}

// Shared by both upload flows (ingredient icon, drink photo) - surfaces
// what actually went wrong (a size-limit rejection, a network error, an
// unexpected server error) instead of just silently doing nothing, which
// made a genuinely failed upload indistinguishable from one that simply
// hadn't finished yet. Resolves true/false rather than rejecting, so a
// caller can just check the result instead of also needing its own catch.
function uploadImage(filename, dataUrl) {
    return fetch('/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename, dataUrl: dataUrl })
    }).then(function(response) {
        // A validation failure (400) sends real JSON with a message; a
        // request-too-large rejection (413) is Express's own default error
        // page, not JSON - .catch() here falls back to {} so *that* still
        // surfaces as a real message (via the status/statusText fallback
        // below) instead of a confusing "Unexpected token" parse error.
        return response.json().catch(function() { return {}; }).then(function(data) {
            if (!response.ok || !data.success) {
                throw new Error(data.error || (response.status + ' ' + response.statusText));
            }
            return true;
        });
    }).catch(function(err) {
        showToast('⚠️ Upload failed: ' + err.message, 5000);
        return false;
    });
}

// Counterpart to uploadImage() - removes whatever's on disk at filename so
// the caller falls back to its default (placeholder icon / temp SVG).
// Resolves { deleted: true/false } on success (deleted is false when there
// was nothing to remove - still a success, just nothing to tell the user
// about), or false if the request itself failed.
function deleteImage(filename) {
    return fetch('/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename })
    }).then(function(response) {
        return response.json().catch(function() { return {}; }).then(function(data) {
            if (!response.ok || !data.success) {
                throw new Error(data.error || (response.status + ' ' + response.statusText));
            }
            return { deleted: !!data.deleted };
        });
    }).catch(function(err) {
        showToast('⚠️ Remove failed: ' + err.message, 5000);
        return false;
    });
}

// Scrolls a just-added section/ingredient into view and briefly flashes
// it, so it's easy to spot no matter where it actually landed (top of the
// custom order, or wherever it sorts to in A-Z view).
function flashNewlyAdded(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('just-added');
    setTimeout(function() { el.classList.remove('just-added'); }, 1500);
}

// Builds a single ingredient <li>. Always draggable (for dragging into the
// cauldron, between sections, or to reorder). In plain "view" mode it's also
// clickable to toggle it in/out of the cauldron, as an alternative to
// dragging. A checkmark badge shows whenever it's currently in the cauldron,
// regardless of mode.
function createIngredientEl(name, sectionIndex, itemIndex) {
    const li = document.createElement('li');
    li.className = 'ingredient';
    li.dataset.name = name; // lets flashNewlyAdded() find a just-added chip
    li.draggable = true;

    // Right-click for Rename/Upload icon/Set color/Delete - works regardless
    // of current mode/display mode, since uploading an icon or setting a
    // color don't need editing mode at all (only Rename/Delete do, and they
    // call enterEditingMode() themselves). stopPropagation so it doesn't
    // also bubble up and show the section's own menu on top of this one.
    li.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
            {
                label: '✏️ Rename',
                onClick: function() {
                    enterEditingMode();
                    buildIngredientsPanel();
                    const input = document.querySelector(
                        '.ingredient[data-name="' + CSS.escape(name) + '"] .ingredient-name-input'
                    );
                    if (input) { input.focus(); input.select(); }
                }
            },
            {
                label: '📷 Upload icon',
                onClick: function() { openIconUpload(name); }
            },
            {
                label: '🗑️ Remove icon',
                onClick: function() {
                    const filename = imagePathFor(name).replace(/^Images\//, '');
                    deleteImage(filename).then(function(result) {
                        if (!result) return;
                        iconCacheBust = Date.now();
                        buildIngredientsPanel();
                        renderCauldron();
                        showToast(result.deleted ? '✓ Icon removed' : 'No custom icon to remove');
                    });
                }
            },
            {
                label: '🎨 Set color',
                onClick: function() { openColorPicker(name); }
            },
            {
                label: '🗑️ Delete',
                onClick: function() {
                    enterEditingMode();
                    ingredientsData[sectionIndex].items.splice(itemIndex, 1);
                    buildIngredientsPanel();
                }
            }
        ]);
    });

    if (panelMode === 'editing') {
        // Editable in place, so a typo doesn't mean delete-and-recreate.
        // Updates ingredientsData directly by index rather than re-rendering
        // on every keystroke (which would lose focus/cursor position).
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'ingredient-name-input';
        nameInput.value = name;
        nameInput.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        nameInput.addEventListener('mousedown', function(e) {
            e.stopPropagation(); // don't let this chip's own drag hijack text selection here
        });
        nameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') nameInput.blur();
        });
        nameInput.addEventListener('input', function() {
            ingredientsData[sectionIndex].items[itemIndex] = nameInput.value;
        });
        // Migrating on every keystroke would be wasteful (and, for the icon,
        // fire a network request per letter typed) - so instead this
        // captures the name as it was when typing started, and migrates
        // once when you click/tab away, comparing against whatever it ended
        // up as. Pairings migrate in memory immediately (cheap, and undone
        // by Cancel via pairingsBackup); the icon copy is only queued here -
        // see pendingImageRenames - since it's a real network/filesystem
        // round trip that needs to stay in step with Save/Cancel too.
        let renameStartedAs = name;
        nameInput.addEventListener('focus', function() {
            renameStartedAs = ingredientsData[sectionIndex].items[itemIndex];
        });
        nameInput.addEventListener('blur', function() {
            const finalName = ingredientsData[sectionIndex].items[itemIndex];
            if (renameStartedAs === finalName) return;
            migratePairingsKey(renameStartedAs, finalName);
            migrateIngredientColorKey(renameStartedAs, finalName);
            migrateComboIngredientNames(renameStartedAs, finalName);
            pendingImageRenames.push({ oldName: renameStartedAs, newName: finalName });
        });
        li.appendChild(nameInput);
    } else if (displayMode === 'icon') {
        // Same shape + label structure whether or not an image exists yet,
        // so chips stay a consistent size instead of falling back to a
        // differently-shaped text pill when a picture is missing.
        li.classList.add('icon-mode-chip');

        const shape = document.createElement('div');
        shape.className = 'icon-shape';

        const img = document.createElement('img');
        img.className = 'ingredient-icon';
        img.src = imagePathFor(name) + '?v=' + iconCacheBust;
        img.alt = '';
        img.draggable = false; // otherwise the browser's own "drag this image" kicks in instead of ours
        usePlaceholderOnError(img);
        shape.appendChild(img);

        li.appendChild(shape);

        const label = document.createElement('span');
        label.className = 'icon-label';
        label.textContent = name;
        li.appendChild(label);
    } else {
        li.appendChild(document.createTextNode(name));
    }

    // Tried vs untried is shown as a background tint instead of an icon -
    // in icon mode a flower emoji sitting inside the flex-centered image
    // box was crowding/shifting the picture itself.
    const tried = isIngredientTried(name);
    li.classList.add(tried ? 'tried-chip' : 'untried-chip');
    li.title = tried ? 'Tried' : 'Not yet tried';

    li.addEventListener('dragstart', function(e) {
        // dragstart bubbles by default - without this, dragging an
        // ingredient also fires the enclosing section's own dragstart
        // (it's draggable too, for section reordering), setting
        // draggedSectionIndex as a side effect. Then dropping anywhere
        // that isn't directly on another ingredient (e.g. a section's
        // empty space) would run BOTH the section-reorder drop handler
        // and the ingredient drop handler for the same event - the first
        // one shuffling ingredientsData's array positions out from under
        // the second, which is what was producing the duplicated/
        // misplaced ingredients.
        e.stopPropagation();
        e.dataTransfer.setData('text', name);
        draggedItem = { name: name, sectionIndex: sectionIndex };
    });

    if (panelMode === 'view') {
        // Click-to-toggle: an alternative to dragging for adding/removing
        // this ingredient from the cauldron.
        li.addEventListener('click', function() {
            if (cauldronItems.includes(name)) {
                removeFromCauldron(name);
            } else {
                addToCauldron(name);
            }
        });
    }

    // Reordering (drag or arrows) works both while browsing and during an
    // edit session, same as sections above.
    if (reorderActive()) {
        // Dropping one ingredient directly on another reorders it to sit
        // just before the one it was dropped on (within this section, or
        // moved in from a different one).
        li.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation(); // don't also trigger the section's own dragover indicator
            if (!draggedItem) return;
            if (draggedItem.name === name && draggedItem.sectionIndex === sectionIndex) return;
            clearDragIndicators();
            // Same top-edge bar style as sections use - matches the actual
            // drop logic below, which always inserts before this chip.
            li.classList.add('drag-target-ingredient');
        });
        li.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation(); // don't also trigger the section's own drop handler
            if (!draggedItem) return;
            if (draggedItem.name === name && draggedItem.sectionIndex === sectionIndex) return;

            const fromItems = ingredientsData[draggedItem.sectionIndex].items;
            const fromIdx = fromItems.indexOf(draggedItem.name);
            if (fromIdx !== -1) fromItems.splice(fromIdx, 1);

            const targetItems = ingredientsData[sectionIndex].items;
            let insertAt = targetItems.indexOf(name);
            if (insertAt === -1) insertAt = targetItems.length;
            targetItems.splice(insertAt, 0, draggedItem.name);

            draggedItem = null;
            saveIngredientsIfViewing();
            buildIngredientsPanel();
        });
    }

    // Deleting still goes through Save/Cancel. Uses itemIndex rather than
    // looking "name" back up in the array, since the rename box above may
    // have already changed what's stored there.
    if (panelMode === 'editing') {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-ingredient';
        removeBtn.textContent = ' x';
        removeBtn.addEventListener('click', function() {
            ingredientsData[sectionIndex].items.splice(itemIndex, 1);
            buildIngredientsPanel();
        });
        li.appendChild(removeBtn);
    }

    if (cauldronItems.includes(name)) {
        li.classList.add('selected');
        const badge = document.createElement('span');
        badge.className = 'selected-badge';
        badge.textContent = '✓';
        li.appendChild(badge);
    }

    return li;
}

// Persists the whole ingredients list to ingredients.json via the server.
// Only called from the "Save" button - every add/delete/move before that
// only touches the in-memory ingredientsData, so "Cancel" can throw it away
// by restoring ingredientsBackup without ever having written to disk.
function saveIngredients() {
    fetch('/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ingredientsData)
    });
}

// Reordering persists immediately only while just browsing. During an
// active edit session it's just another in-memory change like every
// add/delete/rename in that mode - deferred until Save (or thrown away by
// Cancel) rather than jumping ahead and persisting before you've confirmed
// the rest of what you're editing.
function saveIngredientsIfViewing() {
    if (panelMode === 'view') saveIngredients();
}

// ===== Cauldron =====
// renderCauldron() just draws whatever is in cauldronItems - it never
// decides what's in the cauldron itself. All the add/remove/clear helpers
// below change cauldronItems first, then call this (and buildIngredientsPanel,
// to keep the checkmark badges in sync) to redraw.

const cauldron = document.getElementById('cauldron');

// Whether the pot is pinned open (see the click handler below) - a manual
// override on top of hovering/having ingredients already in it, for anyone
// who wants to leave it showing pot-in.png without having to keep the
// cursor parked over it.
let potPinnedOpen = false;

function renderCauldron() {
    cauldron.innerHTML = '';
    // pot-in.png (open, showing the liquid) vs pot-out.png (closed) - the
    // actual image swap is CSS's job (background-image on #cauldron vs
    // #cauldron.cauldron-open/#cauldron:hover), this just decides whether
    // "open" applies even without the cursor there: pinned, or there's
    // already something in the pot (it'd look broken to show the closed
    // sprite with ingredient chips floating on top of it).
    cauldron.classList.toggle('cauldron-open', potPinnedOpen || cauldronItems.length > 0);
    cauldronItems.forEach(function(name) {
        const item = document.createElement('li');
        item.dataset.name = name;
        item.title = name; // the only place the name still shows, since the label itself is gone

        if (displayMode === 'icon') {
            item.classList.add('icon-mode-chip', 'cauldron-icon-chip');

            const shape = document.createElement('div');
            shape.className = 'icon-shape';

            const img = document.createElement('img');
            img.className = 'ingredient-icon';
            img.src = imagePathFor(name) + '?v=' + iconCacheBust;
            img.alt = '';
            img.draggable = false;
            usePlaceholderOnError(img);
            shape.appendChild(img);
            item.appendChild(shape);
        } else {
            item.textContent = name;
        }

        // Small circular badge in the top-right corner, matching the
        // .selected-badge checkmark style used on ingredient chips.
        const removeBtn = document.createElement('span');
        removeBtn.className = 'cauldron-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from cauldron';
        removeBtn.addEventListener('click', function() {
            removeFromCauldron(name);
        });
        item.appendChild(removeBtn);

        cauldron.appendChild(item);
    });
}

// Clicking the pot's own background (not an ingredient chip or its remove
// button - e.target check keeps those from also toggling this) pins it
// open/closed regardless of hover.
cauldron.addEventListener('click', function(e) {
    if (e.target !== cauldron) return;
    potPinnedOpen = !potPinnedOpen;
    renderCauldron();
});

renderCauldron(); // sets the initial pot-out/closed state before anything's added

// Arriving here from a brew-log matrix cell (see log.js's cauldronUrl) means
// that pairing should already be sitting in the cauldron, ready to brew,
// rather than landing on an empty pot you'd have to re-add both ingredients
// to by hand. The URL is cleaned up right after so a refresh/bookmark of
// this page doesn't keep re-adding them.
const preloadedIngredients = new URLSearchParams(window.location.search).getAll('ingredient');
if (preloadedIngredients.length > 0) {
    preloadedIngredients.forEach(function(name) {
        if (!cauldronItems.includes(name)) cauldronItems.push(name);
    });
    window.history.replaceState({}, '', window.location.pathname);
    renderCauldron();
}

// Purely a visual flourish, played whenever Brew is clicked - a handful of
// randomized bubbles rise and fade over the cauldron artwork, then get
// cleared out so they don't just pile up in the DOM every time this fires.
function showCauldronBubbles() {
    const container = document.getElementById('cauldron-bubbles');
    if (!container) return;
    container.innerHTML = '';
    // Color-codes by whichever method is currently selected (see the
    // .cauldron-bubbles-hot/-cold/-stovetop rules in styles.css).
    container.className = 'cauldron-bubbles cauldron-bubbles-' + outputTemp;

    const count = 14;
    for (let i = 0; i < count; i++) {
        const bubble = document.createElement('span');
        bubble.className = 'bubble';
        const size = 8 + Math.random() * 14;
        bubble.style.width = size + 'px';
        bubble.style.height = size + 'px';
        bubble.style.left = (10 + Math.random() * 80) + '%';
        bubble.style.animationDuration = (1.2 + Math.random() * 0.8) + 's';
        bubble.style.animationDelay = (Math.random() * 0.5) + 's';
        container.appendChild(bubble);
    }

    setTimeout(function() { container.innerHTML = ''; }, 2200);
}

// A pairing stops being worth suggesting once reality disagrees with the
// idea: if it's actually been brewed as its own 2-ingredient combo and
// scored below 7, it's a known miss, not a "potential" pairing anymore.
// Never brewed (still just an idea), or brewed but never rated, both still
// count as open - only an actual low score hides it.
function pairingSuggestionAllowed(a, b) {
    const tried = combinations.filter(function(combo) {
        return combo.ingredients.length === 2 &&
            combo.ingredients.includes(a) &&
            combo.ingredients.includes(b) &&
            comboIsTried(combo);
    });
    if (tried.length === 0) return true;
    const rated = tried.filter(function(combo) { return combo.rating; });
    if (rated.length === 0) return true;
    const avg = rated.reduce(function(sum, combo) { return sum + combo.rating; }, 0) / rated.length;
    return avg >= 7;
}

// Shows what's known to pair well with whatever's currently in the
// cauldron - the union of pairings[item] for every item already in, minus
// anything already in the cauldron or already brewed-and-scored-low (see
// pairingSuggestionAllowed). Clicking a chip's name adds it to the
// cauldron; its "x" removes the suggestion; the dropdown at the end adds a
// new one. Edits apply immediately and save straight to pairings.json -
// this is just a set of tags, not worth a separate edit/save/cancel mode.
function renderPotentialPairings() {
    const container = document.getElementById('potential-pairings');
    container.innerHTML = '';

    if (cauldronItems.length === 0) return;

    const suggestions = new Set();
    cauldronItems.forEach(function(name) {
        (pairings[name] || []).forEach(function(other) {
            if (!cauldronItems.includes(other) && pairingSuggestionAllowed(name, other)) {
                suggestions.add(other);
            }
        });
    });

    const heading = document.createElement('h3');
    heading.textContent = '🌿 Potential pairings';
    container.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'pairing-suggestions';

    // Suggestions come out of a Set in whatever order they were encountered
    // while scanning the cauldron's items - alphabetical is a more useful,
    // predictable order to actually read them in.
    const sortedSuggestions = Array.from(suggestions).sort(alphabeticalCompare);

    sortedSuggestions.forEach(function(name) {
        const chip = document.createElement('span');
        chip.className = 'pairing-chip';
        const chipColor = categoryColorHex(categoryOfIngredient(name));
        chip.style.setProperty('--chip-color', chipColor);
        chip.style.setProperty('--chip-text-color', categoryPillTextColor(chipColor));

        const label = document.createElement('span');
        label.textContent = name;
        label.title = 'Add to cauldron';
        label.addEventListener('click', function() {
            addToCauldron(name);
        });
        chip.appendChild(label);

        const removeBtn = document.createElement('span');
        removeBtn.className = 'pairing-remove';
        removeBtn.textContent = ' x';
        removeBtn.title = 'Remove this suggestion';
        removeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            removePairingSuggestion(name);
        });
        chip.appendChild(removeBtn);

        list.appendChild(chip);
    });

    // Only offer ingredients that aren't already in the cauldron or already
    // suggested - a suggestion only means something if it's a real,
    // addable ingredient not already accounted for.
    const addableNames = getAllIngredientNames().filter(function(name) {
        return !cauldronItems.includes(name) && !suggestions.has(name);
    });

    // Always shown, even once every existing ingredient is already in the
    // cauldron/suggested - typing a name that doesn't exist yet is how you
    // add a brand new ingredient on the fly (see addNewIngredientToUncategorized).
    const addForm = document.createElement('div');
    addForm.className = 'pairing-add-form';

    // A searchable text input (via <datalist>) rather than a plain
    // <select> - typing filters the suggestion list natively, which
    // matters once there are a lot of ingredients to scroll through. Typing
    // something not in this list is still accepted (see addBtn below), so
    // this is just a convenience, not a restriction.
    const datalistId = 'pairing-options-datalist';
    let datalist = document.getElementById(datalistId);
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = datalistId;
        document.body.appendChild(datalist);
    }
    datalist.innerHTML = '';
    addableNames.forEach(function(name) {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('list', datalistId);
    input.placeholder = 'Search or add new ingredient...';

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', function() {
        const value = input.value.trim();
        if (!value) return;
        // A name that isn't a known ingredient yet gets created on the fly,
        // filed under "Uncategorized" (auto-created if needed) - lets a
        // pairing be jotted down without a detour through the Ingredients
        // panel first. It'll show the placeholder icon in Icon mode until a
        // real picture is uploaded for it, same as any other ingredient
        // with no image yet.
        if (!getAllIngredientNames().includes(value)) {
            addNewIngredientToUncategorized(value);
        }
        addPairingSuggestion(value);
        input.value = '';
    });
    submitOnEnter(input, addBtn);

    addForm.appendChild(input);
    addForm.appendChild(addBtn);
    list.appendChild(addForm);

    container.appendChild(list);
}

// Creates a brand new ingredient on the fly (see the pairing add-form above)
// filed under a catch-all "Uncategorized" section, auto-created the first
// time this is needed. Only persists immediately while just browsing - same
// rule as every other ingredientsData change (see saveIngredientsIfViewing).
function addNewIngredientToUncategorized(name) {
    let section = ingredientsData.find(function(s) { return s.section === 'Uncategorized'; });
    if (!section) {
        section = { section: 'Uncategorized', items: [] };
        ingredientsData.push(section);
    }
    if (!section.items.includes(name)) section.items.unshift(name);
    saveIngredientsIfViewing();
    buildIngredientsPanel();
}

// Flattens ingredientsData's sections into one list of names - same idea as
// log.js's getAllIngredientNames(), just needed here too for the "add a
// pairing" dropdown.
function getAllIngredientNames() {
    const names = [];
    ingredientsData.forEach(function(section) {
        section.items.forEach(function(name) { names.push(name); });
    });
    return names;
}

// A pairing is symmetric: adding/removing "Honey" as a suggestion while
// Rooibos + Ginger are in the cauldron links/unlinks Honey with both of
// them, both directions.
function addPairingSuggestion(name) {
    cauldronItems.forEach(function(item) {
        if (!pairings[item]) pairings[item] = [];
        if (!pairings[item].includes(name)) pairings[item].push(name);

        if (!pairings[name]) pairings[name] = [];
        if (!pairings[name].includes(item)) pairings[name].push(item);
    });
    savePairings();
    renderPotentialPairings();
}

function removePairingSuggestion(name) {
    cauldronItems.forEach(function(item) {
        if (pairings[item]) {
            const idx = pairings[item].indexOf(name);
            if (idx !== -1) pairings[item].splice(idx, 1);
        }
        if (pairings[name]) {
            const idx = pairings[name].indexOf(item);
            if (idx !== -1) pairings[name].splice(idx, 1);
        }
    });
    savePairings();
    renderPotentialPairings();
}

function savePairings() {
    fetch('/pairings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pairings)
    });
}

function saveIngredientColors() {
    fetch('/ingredient-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ingredientColors)
    });
}

function saveCategoryColors() {
    fetch('/category-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryColors)
    });
}

// Hidden native color input, reused for both ingredients and categories
// (same pattern as iconUploadInput) - a real <input type="color"> gives a
// full picker for free instead of building one. colorPickerTarget records
// which of the two kinds (and which specific one) the next change applies
// to, since both share this one input.
let colorPickerTarget = null; // { kind: 'ingredient' | 'category', name }
const colorPickerInput = document.createElement('input');
colorPickerInput.type = 'color';
colorPickerInput.style.display = 'none';
document.body.appendChild(colorPickerInput);

function openColorPicker(name) {
    colorPickerTarget = { kind: 'ingredient', name: name };
    colorPickerInput.value = ingredientColors[name] || DEFAULT_INGREDIENT_COLOR;
    colorPickerInput.click();
}

function openCategoryColorPicker(category) {
    colorPickerTarget = { kind: 'category', name: category };
    colorPickerInput.value = categoryColorHex(category);
    colorPickerInput.click();
}

colorPickerInput.addEventListener('input', function() {
    if (!colorPickerTarget) return;
    if (colorPickerTarget.kind === 'category') {
        categoryColors[colorPickerTarget.name] = colorPickerInput.value;
        saveCategoryColors();
        buildIngredientsPanel();
        renderPotentialPairings();
    } else {
        ingredientColors[colorPickerTarget.name] = colorPickerInput.value;
        saveIngredientColors();
    }
});

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
        r: parseInt(clean.substring(0, 2), 16),
        g: parseInt(clean.substring(2, 4), 16),
        b: parseInt(clean.substring(4, 6), 16)
    };
}

// The average color of whatever's actually drawn on a canvas, skipping
// fully-transparent pixels (the empty margin around a centered icon
// shouldn't drag the average toward white/black) - used to derive an
// ingredient's mixing color straight from its uploaded photo (see the
// icon-upload handler above) rather than requiring a separate manual pick.
function averageCanvasColor(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // fully transparent - not part of the actual picture
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
    }
    if (count === 0) return null;
    function toHex(sum) {
        return Math.round(sum / count).toString(16).padStart(2, '0');
    }
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Only tried here, not in the render path (usePlaceholderOnError) - this
// only ever runs once per ingredient per click of "Refresh icon colors",
// not on every single re-render, so trying a few extra extensions doesn't
// carry the same repeated-request cost that made trying them on every
// render a real slowdown.
const ICON_REFRESH_FALLBACK_EXTENSIONS = ['.jpg', '.jpeg', '.webp'];

// Loads whichever file imagePathFor(name) (or one of the fallback
// extensions above) actually resolves to, resolving null instead of the
// placeholder if none of them exist - color-sampling the generic
// placeholder image itself would just overwrite every icon-less ingredient
// with the same meaningless grey-ish average.
function loadRealIconImage(name) {
    return new Promise(function(resolve) {
        const basePath = imagePathFor(name);
        const attempts = [basePath].concat(ICON_REFRESH_FALLBACK_EXTENSIONS.map(function(ext) {
            return basePath.replace(/\.png$/, ext);
        }));
        let i = 0;
        const img = new Image();
        img.onload = function() { resolve(img); };
        img.onerror = function() {
            i++;
            if (i >= attempts.length) { resolve(null); return; }
            img.src = attempts[i] + '?v=' + iconCacheBust;
        };
        img.src = attempts[i] + '?v=' + iconCacheBust;
    });
}

// Re-derives *every* ingredient's mixing color from its actual uploaded
// icon, one at a time - for catching up anything that was uploaded before
// applyBrewColor's auto-derive existed, or anything that got "stuck" on an
// old color from before that (see the icon-upload handler). Ingredients
// with no real icon (just falling through to the placeholder) are left
// alone entirely - nothing to sample there.
function refreshAllIngredientColorsFromIcons() {
    const names = getAllIngredientNames();
    let updated = 0;

    function processNext(index) {
        if (index >= names.length) {
            if (updated > 0) saveIngredientColors();
            buildIngredientsPanel();
            renderCauldron();
            showToast('✓ Refreshed ' + updated + ' icon color' + (updated === 1 ? '' : 's'));
            return;
        }

        loadRealIconImage(names[index]).then(function(img) {
            if (img) {
                const size = 64; // just for averaging - no need for the full 256px upload size
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
                const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                const derived = averageCanvasColor(ctx, size, size);
                if (derived) {
                    ingredientColors[names[index]] = derived;
                    updated++;
                }
            }
            processNext(index + 1);
        });
    }

    processNext(0);
}

// Plain per-channel RGB averaging - for the classic "red + yellow = orange"
// case this already lands exactly where you'd expect (255,0,0 averaged with
// 255,255,0 is 255,127,0), without needing a fancier subtractive-mixing model.
function mixCauldronColor() {
    if (cauldronItems.length === 0) return null;
    const rgbs = cauldronItems.map(function(name) {
        return hexToRgb(ingredientColors[name] || DEFAULT_INGREDIENT_COLOR);
    });
    const sum = rgbs.reduce(function(acc, rgb) {
        return { r: acc.r + rgb.r, g: acc.g + rgb.g, b: acc.b + rgb.b };
    }, { r: 0, g: 0, b: 0 });
    return {
        r: Math.round(sum.r / rgbs.length),
        g: Math.round(sum.g / rgbs.length),
        b: Math.round(sum.b / rgbs.length)
    };
}

// pot-in.png's own water color - an approximate eyeball read off the
// artwork (a light sky blue), not pixel-sampled. applyBrewColor hue-rotates
// the pot *from* this color; nudge it if the result looks off.
const POT_WATER_RGB = { r: 195, g: 225, b: 245 };

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const delta = max - min;
    let h = 0, s = 0;
    if (delta !== 0) {
        s = delta / (1 - Math.abs(2 * l - 1));
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
        if (h < 0) h += 360;
    }
    return { h: h, s: s, l: l };
}

function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255)
    };
}

// Tints the Drink card's illustration area, and the pot's own liquid, with
// whatever the cauldron's ingredients mix to - the exact same resulting
// color for both, not just the same starting ingredients. The pot can only
// be *filtered* toward the target (hue-rotate/saturate/brightness on
// #cauldron::before - see styles.css - chosen so only the already-colored
// water shifts, never the ingredient <li> chips sitting in front of it),
// so this works out what that filter combination actually produces and
// uses the same result for the Drink picture, rather than the picture
// showing the raw mixed color while the pot showed a rough approximation
// of it.
//
// hue-rotate alone isn't enough: it preserves the water's own saturation
// exactly, so a near-colorless ingredient (rice, coconut...) still came out
// exactly as vividly colored as plain water, just hued toward whatever
// direction its (essentially meaningless, for a near-grey color) hue
// happened to compute to - saturate()/brightness() are what actually let
// the result go pale for a pale ingredient instead of stubbornly staying
// exactly as saturated as the water always was.
function applyBrewColor() {
    const mixed = mixCauldronColor();
    const picture = document.querySelector('.output-picture');

    if (mixed) {
        const waterHsl = rgbToHsl(POT_WATER_RGB.r, POT_WATER_RGB.g, POT_WATER_RGB.b);
        const targetHsl = rgbToHsl(mixed.r, mixed.g, mixed.b);

        const rotation = ((targetHsl.h - waterHsl.h) + 360) % 360;
        const saturateFactor = waterHsl.s > 0.02 ? Math.min(3, targetHsl.s / waterHsl.s) : 1;
        const brightnessFactor = waterHsl.l > 0.02 ? Math.min(2, Math.max(0.3, targetHsl.l / waterHsl.l)) : 1;
        const resultRgb = hslToRgb((waterHsl.h + rotation) % 360, targetHsl.s, targetHsl.l);

        cauldron.style.setProperty('--pot-hue', rotation + 'deg');
        cauldron.style.setProperty('--pot-saturate', saturateFactor);
        cauldron.style.setProperty('--pot-brightness', brightnessFactor);
        picture.style.background = 'rgba(' + resultRgb.r + ', ' + resultRgb.g + ', ' + resultRgb.b + ', 0.45)';
    } else {
        cauldron.style.removeProperty('--pot-hue');
        cauldron.style.removeProperty('--pot-saturate');
        cauldron.style.removeProperty('--pot-brightness');
        picture.style.background = '';
    }
}

// Deleting an ingredient (or a whole section) only removes it from
// ingredientsData - nothing else was pointing back at pairings.json to keep
// it in sync, so a deleted name would otherwise linger there forever as an
// orphaned entry, both as its own key and inside every other ingredient's
// list. Called right after ingredients.json is actually saved (the only
// point deletions become real - editing mode defers everything else to
// Save/Cancel), so it always compares against the just-persisted list.
function pruneOrphanedPairings() {
    const validNames = new Set(getAllIngredientNames());
    let changed = false;

    Object.keys(pairings).forEach(function(name) {
        if (!validNames.has(name)) {
            delete pairings[name];
            changed = true;
            return;
        }
        const filtered = pairings[name].filter(function(other) { return validNames.has(other); });
        if (filtered.length !== pairings[name].length) {
            pairings[name] = filtered;
            changed = true;
        }
    });

    if (changed) {
        savePairings();
        renderPotentialPairings();
    }
}

// Same idea as pruneOrphanedPairings, for ingredient-colors.json - a flat
// name->hex map, so there's no nested list to clean up, just top-level keys.
function pruneOrphanedIngredientColors() {
    const validNames = new Set(getAllIngredientNames());
    let changed = false;
    Object.keys(ingredientColors).forEach(function(name) {
        if (!validNames.has(name)) {
            delete ingredientColors[name];
            changed = true;
        }
    });
    if (changed) saveIngredientColors();
}

// Renaming an ingredient (see createIngredientEl's nameInput) used to just
// orphan its pairings.json entries - the old key would get silently pruned
// away next Save (see pruneOrphanedPairings) instead of following the
// rename. This carries them over instead: the pairing itself moves from the
// old name to the new one, both as its own key and everywhere else it's
// listed as someone else's pair. In-memory only, like every other edit in
// this mode - actually persisted by savePairings() at Save.
function migratePairingsKey(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;

    if (pairings[oldName]) {
        if (!pairings[newName]) {
            pairings[newName] = pairings[oldName];
        } else {
            pairings[oldName].forEach(function(other) {
                if (!pairings[newName].includes(other)) pairings[newName].push(other);
            });
        }
        delete pairings[oldName];
    }

    Object.keys(pairings).forEach(function(key) {
        const idx = pairings[key].indexOf(oldName);
        if (idx === -1) return;
        if (pairings[key].includes(newName)) {
            pairings[key].splice(idx, 1); // already paired with the new name too - drop the now-duplicate old one
        } else {
            pairings[key][idx] = newName;
        }
    });
}

// Same idea, for ingredientColors - just moves the one map entry over to
// the new key (newName wins if it already had its own color set).
function migrateIngredientColorKey(oldName, newName) {
    if (!oldName || !newName || oldName === newName || !ingredientColors[oldName]) return;
    if (!ingredientColors[newName]) ingredientColors[newName] = ingredientColors[oldName];
    delete ingredientColors[oldName];
}

// Same idea, for already-logged combos (data.json) - without this, a rename
// leaves every combo that used to include this ingredient still pointing at
// the old name, so isIngredientTried() (and the brew-log matrix) can no
// longer find it under the new one and it wrongly reads as untried. Mutates
// the ingredients arrays in place, which every existing reference into
// combinations (including currentMatches) automatically sees too.
function migrateComboIngredientNames(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    combinations.forEach(function(combo) {
        const idx = combo.ingredients.indexOf(oldName);
        if (idx !== -1) combo.ingredients[idx] = newName;
    });
}

function saveCombinations() {
    fetch('/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(combinations)
    });
}

// Same problem, for the ingredient's picture: imagePathFor(name) depends on
// the name itself, so a rename would otherwise leave a perfectly good
// uploaded icon behind under the old filename while the app looks for a
// new one that doesn't exist. Copies (server never deletes the original -
// see /copy-image) so a shared IMAGE_OVERRIDES file used by more than one
// name doesn't get pulled out from under whichever other name still needs
// it. Returns the fetch promise rather than re-rendering itself - queued in
// pendingImageRenames and only actually fired (and waited on) by Save, so
// the panel never re-renders showing the new name before the file backing
// its icon has actually finished copying (that race was the cause of the
// icon briefly - or on a slow disk, not so briefly - reverting to the
// placeholder right after a rename).
function migrateIngredientImage(oldName, newName) {
    const oldFilename = imagePathFor(oldName).replace(/^Images\//, '');
    const newFilename = imagePathFor(newName).replace(/^Images\//, '');
    if (oldFilename === newFilename) return Promise.resolve();

    return fetch('/copy-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldFilename: oldFilename, newFilename: newFilename })
    });
}

// The Drink output belongs to whatever was last brewed/loaded - if the
// cauldron's contents change without re-brewing, that's now stale and
// risks getting saved under the wrong ingredients' name/notes. Wipes it
// back to blank whenever that happens (see addToCauldron/removeFromCauldron
// below). Doesn't touch outputTemp (see selectTemp) - changing the recipe
// shouldn't undo an already-made Hot/Cold/Stove choice.
function resetDrinkOutput() {
    document.getElementById('drink-name').value = '';
    document.getElementById('drink-description').value = '';
    document.getElementById('drink-notes').value = '';
    document.getElementById('drink-rating').value = 0; // 0 = N/A, see updateRatingIndicator
    updateRatingIndicator();
    currentStarred = false;
    updateStarButton();
    currentMatches = { hot: null, cold: null, stovetop: null };
    hasBrewed = false;
    document.getElementById('delete-entry-btn').style.display = 'none';
    updateDrinkImage();
}

function addToCauldron(name) {
    if (cauldronItems.includes(name)) return; // no duplicates
    cauldronItems.push(name);
    renderCauldron();
    buildIngredientsPanel();
    renderPotentialPairings();
    resetDrinkOutput();
}

function removeFromCauldron(name) {
    const idx = cauldronItems.indexOf(name);
    if (idx === -1) return;
    cauldronItems.splice(idx, 1);
    renderCauldron();
    buildIngredientsPanel();
    renderPotentialPairings();
    resetDrinkOutput();
}

function clearCauldron() {
    cauldronItems = [];
    renderCauldron();
    buildIngredientsPanel();
    renderPotentialPairings();
    resetDrinkOutput();

    outputTemp = 'hot';
    updateTempTabs();
    applyBrewColor(); // empty cauldron -> mixed color resets to none
}

cauldron.addEventListener('dragover', function(e) {
    e.preventDefault();
});

cauldron.addEventListener('drop', function(e) {
    e.preventDefault();
    const name = e.dataTransfer.getData('text');
    addToCauldron(name);
});

// ===== Clear =====

const clearBtn = document.getElementById('clear-btn');

clearBtn.addEventListener('click', function() {
    clearCauldron();
});

// Clears whichever drag insertion-indicator is currently showing. Called
// right before a dragover handler adds its own, so only ever one shows at a
// time, and on dragend as a catch-all for drags that end without a valid
// drop (a normal drop already clears these by fully re-rendering the panel).
function clearDragIndicators() {
    document.querySelectorAll('.drag-target-section, .drag-target-ingredient, .drag-target-ingredient-end')
        .forEach(function(el) {
            el.classList.remove('drag-target-section', 'drag-target-ingredient', 'drag-target-ingredient-end');
        });
}

document.addEventListener('dragend', clearDragIndicators);

// ===== Hot / Cold / Stovetop output tabs =====
// Styled as notebook-style tabs at the top of the Drink card (see
// index.html). All three methods share one drink name but have their own
// description/notes/rating/star (see currentMatches, set on Brew). Clicking
// a tab just flips to whichever saved entry - if any - exists for that
// method; Brew itself matches the cauldron across all three regardless of
// which tab is currently selected.

const hotTab = document.getElementById('hot-tab');
const coldTab = document.getElementById('cold-tab');
const stovetopTab = document.getElementById('stovetop-tab');
// Same choice, duplicated as plain pill buttons under the cauldron so it's
// tactile *before* brewing too, not just for flipping between saved entries
// afterward - see selectTemp() below, which both sets of buttons share.
const cauldronHotBtn = document.getElementById('cauldron-hot-btn');
const cauldronColdBtn = document.getElementById('cauldron-cold-btn');
const cauldronStoveBtn = document.getElementById('cauldron-stove-btn');
const saveBtn = document.getElementById('save-btn');
const deleteEntryBtn = document.getElementById('delete-entry-btn');

// One place to look up each method's emoji/label/image/buttons, instead of
// a chain of ternaries every time one of these is needed.
const TEMP_META = {
    hot: { tabs: [hotTab, cauldronHotBtn], emoji: '🔥', image: 'drink-hot.svg' },
    cold: { tabs: [coldTab, cauldronColdBtn], emoji: '❄️', image: 'drink-cold.svg' },
    stovetop: { tabs: [stovetopTab, cauldronStoveBtn], emoji: '🍳', image: 'drink-stovetop.svg' }
};

function updateTempTabs() {
    Object.keys(TEMP_META).forEach(function(temp) {
        TEMP_META[temp].tabs.forEach(function(btn) {
            btn.classList.toggle('active', outputTemp === temp);
        });
    });
    saveBtn.textContent = 'Save ' + TEMP_META[outputTemp].emoji;
    updateDrinkImage();
}

// Shared by both the notebook tabs and the cauldron-side buttons - picking
// either one selects the same method and keeps the other set of buttons in
// sync (see updateTempTabs' tabs.forEach above).
function selectTemp(temp) {
    outputTemp = temp;
    updateTempTabs();
    showOutputForCurrentTab();
}

// Turns the exact cauldron contents + method into a stable filename for a
// custom-uploaded drink picture - same "derive it from identity" idea as
// imagePathFor(), just keyed on ingredients+temperature (a combo's real
// identity) instead of a name, since names can be renamed/aren't unique.
function drinkImageFilename(ingredients, temperature) {
    const slug = ingredients.slice().sort().join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return 'drink-' + slug + '-' + temperature + '.png';
}

// Tries the custom picture for the current cauldron contents + method
// first, falling back to the plain placeholder illustration if none's been
// uploaded for this exact combo yet (or the cauldron's empty).
function updateDrinkImage() {
    const img = document.getElementById('drink-image');
    const removeBtn = document.getElementById('drink-image-remove-btn');
    const fallback = TEMP_META[outputTemp].image;
    img.onerror = null;
    img.onload = null;
    if (cauldronItems.length === 0) {
        img.src = fallback;
        removeBtn.style.display = 'none';
        return;
    }
    img.onerror = function() {
        img.onerror = null;
        img.src = fallback;
        removeBtn.style.display = 'none';
    };
    // Only a real uploaded picture (not the fallback SVG) should offer to be
    // removed - shown once it's actually finished loading rather than
    // eagerly, so a 404 (handled by onerror above) doesn't briefly flash it.
    img.onload = function() {
        removeBtn.style.display = '';
    };
    img.src = 'Images/' + drinkImageFilename(cauldronItems, outputTemp) + '?v=' + iconCacheBust;
}

// Same hidden-input-plus-canvas-normalize pattern as the ingredient icon
// upload (openIconUpload) - just targets drinkImageFilename() instead of
// imagePathFor(name), since a drink doesn't have a name stable enough to
// key an uploaded file on (see drinkImageFilename's own comment).
const drinkImageUploadInput = document.createElement('input');
drinkImageUploadInput.type = 'file';
drinkImageUploadInput.accept = 'image/*';
drinkImageUploadInput.style.display = 'none';
document.body.appendChild(drinkImageUploadInput);

document.getElementById('drink-image-upload-btn').addEventListener('click', function() {
    if (cauldronItems.length === 0) {
        // Previously a silent no-op - indistinguishable from the button
        // being broken if you happened to click it on an empty cauldron.
        showToast('⚠️ Add ingredients to the cauldron first');
        return;
    }
    drinkImageUploadInput.click();
});

drinkImageUploadInput.addEventListener('change', function() {
    const file = drinkImageUploadInput.files[0];
    drinkImageUploadInput.value = ''; // so picking the same file again still fires "change"
    if (!file || cauldronItems.length === 0) return;

    const reader = new FileReader();
    reader.onload = function() {
        const img = new Image();
        img.onload = function() {
            // Same normalize-onto-a-square-canvas approach as the
            // ingredient icon upload - consistent size/format regardless
            // of what was actually picked.
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.min(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

            const filename = drinkImageFilename(cauldronItems, outputTemp);

            uploadImage(filename, canvas.toDataURL('image/png')).then(function(ok) {
                if (!ok) return;
                iconCacheBust = Date.now();
                updateDrinkImage();
                showToast('✓ Picture uploaded');
            });
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
});

// Also doubles as the fix for "I didn't save the entry but the image is
// there" - the picture uploads straight to disk on file selection,
// independent of Save (see the upload flow above), so this is the way to
// undo an upload made before deciding not to save that entry after all.
document.getElementById('drink-image-remove-btn').addEventListener('click', function() {
    if (cauldronItems.length === 0) return;
    const filename = drinkImageFilename(cauldronItems, outputTemp);
    deleteImage(filename).then(function(result) {
        if (!result) return;
        iconCacheBust = Date.now();
        updateDrinkImage();
        showToast(result.deleted ? '✓ Picture removed' : 'No custom picture to remove');
    });
});

// Must match .rating-thumb's own half-width in styles.css - both the
// decorative thumb and every tick dot use this same radius in their
// position math, which is what guarantees they land in the same place for
// the same value (rather than approximating a *native* thumb's geometry,
// which is what kept coming out slightly wrong).
const RATING_THUMB_RADIUS = 9;

// Positions the decorative thumb (at the slider's current value) and every
// tick dot (at each value 0-10, where 0 is the "N/A" tick) using one shared
// formula, so they're guaranteed to coincide instead of being
// separately-approximated. Vertical now (see .rating-slider-wrap) - value
// increases going *up*, so the fraction is inverted when turned into a
// top offset (a higher value needs a *smaller* distance from the top).
function layoutRatingSlider() {
    const wrap = document.querySelector('.rating-slider-wrap');
    const input = document.getElementById('drink-rating');
    const thumb = document.getElementById('rating-thumb');
    if (!wrap || !input || !thumb) return;

    const trackHeight = wrap.clientHeight;
    const min = Number(input.min);
    const max = Number(input.max);

    function positionFor(value) {
        const fraction = (value - min) / (max - min);
        return RATING_THUMB_RADIUS + (1 - fraction) * (trackHeight - 2 * RATING_THUMB_RADIUS);
    }

    thumb.style.top = positionFor(Number(input.value)) + 'px';

    document.querySelectorAll('.rating-ticks-overlay span').forEach(function(tick, i) {
        tick.style.top = positionFor(min + i) + 'px';
    });
}

window.addEventListener('resize', layoutRatingSlider);
layoutRatingSlider(); // initial position, before anything else touches the value

// Updates the corner badge on the drink picture, and repositions the
// decorative thumb, based on whatever the slider's currently set to -
// called on every drag, not just after loading a saved combo, so it
// reflects the value you're about to save too. 0 is the explicit "N/A"
// position (for a potential-pairing idea you haven't actually brewed/rated
// yet) - see the Save handler below, where it's what actually gets
// persisted as no rating.
function updateRatingIndicator() {
    const value = Number(document.getElementById('drink-rating').value);
    document.getElementById('drink-rating-badge').textContent = value === 0 ? 'N/A' : value;
    layoutRatingSlider();
}

// Manual on/off toggle (see the star button's click listener below) -
// no longer derived from the rating automatically.
let currentStarred = false;

function updateStarButton() {
    const btn = document.getElementById('drink-star-btn');
    btn.textContent = currentStarred ? '★' : '☆';
    btn.classList.toggle('active', currentStarred);
}

document.getElementById('drink-star-btn').addEventListener('click', function() {
    currentStarred = !currentStarred;
    updateStarButton();
});

function showOutputForCurrentTab() {
    const match = currentMatches[outputTemp];
    // Any *other* method that already has a saved entry - used to reuse its
    // name below, since all three are meant to share one drink identity.
    const otherMatch = Object.keys(TEMP_META)
        .filter(function(temp) { return temp !== outputTemp; })
        .map(function(temp) { return currentMatches[temp]; })
        .find(function(m) { return m; }) || null;

    if (match) {
        document.getElementById('drink-name').value = match.name;
        document.getElementById('drink-description').value = match.description || '';
        document.getElementById('drink-notes').value = match.notes || '';
        document.getElementById('drink-rating').value = match.rating || 0;
        currentStarred = !!match.starred;
    } else if (otherMatch) {
        // This temperature hasn't been logged yet, but the other one has -
        // reuse its name (they're meant to share one identity) and leave the
        // rest blank, ready to fill in.
        document.getElementById('drink-name').value = otherMatch.name;
        document.getElementById('drink-description').value = '';
        document.getElementById('drink-notes').value = '';
        document.getElementById('drink-rating').value = 0;
        currentStarred = false;
    } else {
        document.getElementById('drink-name').value = 'Unknown brew';
        document.getElementById('drink-description').value = 'Unlogged — try it and report back';
        document.getElementById('drink-notes').value = '';
        document.getElementById('drink-rating').value = 0;
        currentStarred = false;
    }
    updateRatingIndicator();
    updateStarButton();
    // Only offer to delete when there's actually a saved entry for this tab.
    document.getElementById('delete-entry-btn').style.display = match ? 'inline-block' : 'none';
}

document.getElementById('drink-rating').addEventListener('input', updateRatingIndicator);

hotTab.addEventListener('click', function() { selectTemp('hot'); });
coldTab.addEventListener('click', function() { selectTemp('cold'); });
stovetopTab.addEventListener('click', function() { selectTemp('stovetop'); });

cauldronHotBtn.addEventListener('click', function() { selectTemp('hot'); });
cauldronColdBtn.addEventListener('click', function() { selectTemp('cold'); });
cauldronStoveBtn.addEventListener('click', function() { selectTemp('stovetop'); });

// ===== Brew =====

const brewBtn = document.getElementById('brew-btn');

// A combo "matches" the cauldron if it has exactly the same ingredients,
// regardless of order - hence checking .length first, then .every/.includes
// instead of comparing the arrays directly.
function findMatches(selected) {
    return combinations.filter(function(combo) {
        if (combo.ingredients.length !== selected.length) return false;
        return combo.ingredients.every(function(ing) {
            return selected.includes(ing);
        });
    });
}

brewBtn.addEventListener('click', function() {
    const matches = findMatches(cauldronItems);

    // Split whatever matched into a Hot/Cold/Stovetop slot. Combos saved
    // before the Hot/Cold feature existed have no temperature field at all -
    // treat those as "hot" so they still show up somewhere instead of
    // vanishing from view.
    currentMatches = {
        hot: matches.find(function(c) { return c.temperature === 'hot' || !c.temperature; }) || null,
        cold: matches.find(function(c) { return c.temperature === 'cold'; }) || null,
        stovetop: matches.find(function(c) { return c.temperature === 'stovetop'; }) || null
    };

    // outputTemp is *not* reset to 'hot' here - whichever method you picked
    // under the cauldron beforehand (see selectTemp) stays selected, so the
    // Drink card lands straight on that entry instead of always Hot.
    updateTempTabs();
    showOutputForCurrentTab();
    showCauldronBubbles();
    applyBrewColor();
    hasBrewed = true;
});

// ===== Random brew =====

const randomBrewBtn = document.getElementById('random-brew-btn');
const randomCountInput = document.getElementById('random-count');

randomBrewBtn.addEventListener('click', function() {
    const allNames = getAllIngredientNames();
    if (allNames.length === 0) return;
    const count = Math.min(Math.max(1, Number(randomCountInput.value) || 1), allNames.length);

    // Fisher-Yates shuffle, then take the first `count` - a random sample
    // without repeats, regardless of how many ingredients exist in total.
    const shuffled = allNames.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = temp;
    }

    cauldronItems = shuffled.slice(0, count);
    renderCauldron();
    buildIngredientsPanel();
    renderPotentialPairings();
    resetDrinkOutput();

    // Reuses the exact same brew flow (matching, bubbles, color, hasBrewed)
    // as clicking Brew yourself - this button just fills the pot for you first.
    brewBtn.click();
});

// ===== Save =====

saveBtn.addEventListener('click', function() {
    if (!hasBrewed) {
        showToast('Nothing brewed!');
        return;
    }

    const name = document.getElementById('drink-name').value;
    const description = document.getElementById('drink-description').value;
    const notes = document.getElementById('drink-notes').value;

    // The slider's own 0 ("N/A") position *is* "not rated" now, so whatever
    // it's currently sitting at is exactly what should be saved - no need to
    // separately track whether it was touched this session.
    const ratingValue = Number(document.getElementById('drink-rating').value);
    const rating = ratingValue === 0 ? null : ratingValue;

    const newCombo = {
        ingredients: cauldronItems.slice(), // copy, so later cauldron changes can't mutate a saved combo
        name: name,
        description: description,
        notes: notes,
        temperature: outputTemp,
        rating: rating,
        starred: currentStarred
    };

    // Same ingredients + same temperature as something already saved =
    // an edit, not a new entry. (Legacy combos with no temperature field
    // count as "hot", same rule as everywhere else above.)
    function isSameIngredients(combo) {
        return combo.ingredients.length === cauldronItems.length &&
            combo.ingredients.every(function(ing) { return cauldronItems.includes(ing); });
    }

    const existingIndex = combinations.findIndex(function(combo) {
        const sameTemp = combo.temperature === outputTemp || (!combo.temperature && outputTemp === 'hot');
        return sameTemp && isSameIngredients(combo);
    });

    if (existingIndex !== -1) {
        combinations[existingIndex] = newCombo;
    } else {
        combinations.push(newCombo);
    }

    // Hot/Cold/Stovetop each keep whatever name was typed for them - no
    // longer forced to match each other. The shared-by-default part happens
    // earlier instead: switching to a method with no entry of its own yet
    // pre-fills the name from whichever other method already has one (see
    // showOutputForCurrentTab's otherMatch branch), so it only takes typing
    // something different here to give a method its own distinct name.

    fetch('/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(combinations)
    }).then(function(response) {
        return response.json();
    }).then(function(data) {
        if (data.success) {
            currentMatches[outputTemp] = newCombo;
            document.getElementById('delete-entry-btn').style.display = 'inline-block';
            buildIngredientsPanel(); // tried/untried tint depends on combinations
            showToast('✓ Saved');
        }
    });
});

deleteEntryBtn.addEventListener('click', function() {
    const existingMatch = currentMatches[outputTemp];
    if (!existingMatch) return;
    if (!confirm('Delete "' + existingMatch.name + '"? This can\'t be undone.')) return;

    combinations = combinations.filter(function(combo) { return combo !== existingMatch; });
    currentMatches[outputTemp] = null;

    fetch('/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(combinations)
    }).then(function() {
        showOutputForCurrentTab(); // falls back to "Unknown brew" / another temp's entry, and hides this button
        buildIngredientsPanel(); // tried/untried tint depends on combinations
        showToast('✓ Entry deleted');
    });
});
