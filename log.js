// This page shows how much has been tried, three ways:
//   1. Category x category overview (default) - one cell per pair of
//      ingredient sections, colored by % of that pair's possible combos
//      tried, showing the average rating among the tried ones.
//   2. Detail matrix - click a category-pair cell to drill into the actual
//      ingredient x ingredient grid for just those two categories.
//   3. Full matrix - every ingredient at once, orderable and with columns
//      you can hide, reached via a button from the category view.
// Read-only - built from the same data files the main page uses, doesn't
// add or change anything itself (aside from letting you jump elsewhere to).

let ingredientsData = [];
let combinations = [];
let pairings = {};
let categoryColors = {}; // category name -> hex color *override*, loaded from category-colors.json - see categoryColorHex

// Which of the three matrix views is currently showing, and any state that
// view needs - see renderMatrixArea().
let matrixView = 'category'; // 'category' | 'detail' | 'full'
let detailCategories = null; // { a, b } - which two categories, while 'detail'
let fullMatrixOrder = 'category'; // 'category' | 'alphabetical' | 'rating'
let hiddenColumns = new Set(); // ingredient names hidden as *columns* only in the full matrix
let columnFilterOpen = false; // whether the <details> filter panel was left open
let columnFilterOrder = 'category'; // 'category' | 'alphabetical' - how the filter checklist itself is grouped

// 'name' | 'rating' - controls the multi-ingredient combo list's order.
let sortMode = 'name';

// Which of the two Graphs tab views is showing - see renderGraphsArea().
let graphsView = 'preference'; // 'preference' | 'pairings'

// Shared by both graph views - 'all' or a category name. Narrows the
// preference scatter to just that category's ingredients, and the pairing
// network to that category's own sub-graph (a node stays only if its own
// category matches; an edge/combo shape stays only if *every* ingredient
// it touches does too, since drawing a line to an ingredient that's no
// longer shown as a node wouldn't make sense).
let graphsFilterCategory = 'all';

// 'word' (colored circle + name) or 'icon' (the ingredient's own picture,
// no text) - shared by both network graphs (3+ combo network, Pairing
// outcomes), see buildGraphNodeSvg.
let graphNodeMode = 'word';

// Chinese-character entries sort after everything else, then alphabetically
// among themselves - kept in sync with the same helper in script.js.
function isChineseText(str) {
    return /[一-鿿]/.test(str);
}

function alphabeticalCompare(a, b) {
    const aChinese = isChineseText(a);
    const bChinese = isChineseText(b);
    if (aChinese !== bChinese) return aChinese ? 1 : -1;
    return a.localeCompare(b, aChinese ? 'zh' : undefined);
}

// All three fetches can run at the same time since none depends on another;
// Promise.all waits for all before rendering anything.
Promise.all([
    fetch('/ingredients').then(function(r) { return r.json(); }),
    fetch('/combos').then(function(r) { return r.json(); }),
    fetch('/pairings').then(function(r) { return r.json(); }),
    fetch('/category-colors').then(function(r) { return r.json(); })
]).then(function(results) {
    ingredientsData = results[0];
    combinations = results[1];
    pairings = results[2];
    categoryColors = results[3];
    renderMatrixArea();
    renderComboViz();
    renderCombosByRating();
    renderGraphsArea();
    renderBookArea();
});

document.getElementById('sort-name-btn').addEventListener('click', function() {
    sortMode = 'name';
    updateSortButtons();
    renderComboViz();
});

document.getElementById('sort-rating-btn').addEventListener('click', function() {
    sortMode = 'rating';
    updateSortButtons();
    renderComboViz();
});

function updateSortButtons() {
    document.getElementById('sort-name-btn').classList.toggle('active', sortMode === 'name');
    document.getElementById('sort-rating-btn').classList.toggle('active', sortMode === 'rating');
}
updateSortButtons();

// The multi-ingredient list doesn't care which section an ingredient
// belongs to, so this flattens every section's items into one flat list.
function getAllIngredientNames() {
    const names = [];
    ingredientsData.forEach(function(section) {
        section.items.forEach(function(name) {
            names.push(name);
        });
    });
    return names;
}

function getCategories() {
    return ingredientsData.map(function(section) { return section.section; });
}

function getCategoryItems(category) {
    const section = ingredientsData.find(function(s) { return s.section === category; });
    return section ? section.items : [];
}

function categoryOfIngredient(name) {
    const section = ingredientsData.find(function(s) { return s.items.includes(name); });
    return section ? section.section : null;
}

// A palette used by the 3+ combo views (cards + network) to color things by
// *what kind* of ingredient they are, separately from the red/green rating
// scale. Kept in sync with the identical copy in script.js/notes.js/
// combo-detail.js.
const CATEGORY_PALETTE = [
    '#6b4226', '#4c7a3f', '#b5541d', '#d9a441', '#a68a5b',
    '#5b2a86', '#c0392b', '#2f8f9d', '#7a1f3d', '#6b6155'
];

// A stable hash of the category's own *name* (never its position in
// ingredients.json) picks its default palette color - using indexOf into
// the live section order meant dragging a section to a new spot reassigned
// its color to whatever used to sit there (e.g. moving Herbal to the top
// made it turn Coffee's brown). Hashing the name means a section keeps its
// own color no matter where it's dragged. categoryColors (from
// category-colors.json) holds explicit user overrides, set via the section
// right-click menu on the main page - anything not in there uses this
// hashed default.
function defaultCategoryColorHex(category) {
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
        hash = (hash * 31 + category.charCodeAt(i)) | 0;
    }
    return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

function categoryColorHex(category) {
    return categoryColors[category] || defaultCategoryColorHex(category);
}

function ingredientColorHex(name) {
    return categoryColorHex(categoryOfIngredient(name));
}

// Same idea as script.js's IMAGE_OVERRIDES/imagePathFor (kept in sync -
// there's no shared module setup on this site) - used by the network
// graphs' icon mode to find each ingredient's uploaded picture.
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
    const slug = name.toLowerCase()
        .trim()
        .replace(/[^a-z0-9一-鿿]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return 'Images/' + slug + '.png';
}

// The highest rating among any combo this ingredient appears in, or null if
// none of them have one - used to order the full matrix by rating.
function bestRatingFor(name) {
    let best = null;
    combinations.forEach(function(combo) {
        if (combo.ingredients.includes(name) && combo.rating) {
            if (best === null || combo.rating > best) best = combo.rating;
        }
    });
    return best;
}

// Same idea for a list of combos (used by the multi-ingredient list) -
// unrated combos sort last in 'rating' mode.
function getOrderedCombos(combos) {
    const list = combos.slice();
    if (sortMode === 'name') {
        list.sort(function(a, b) { return alphabeticalCompare(a.name, b.name); });
        return list;
    }
    list.sort(function(a, b) {
        const ratingA = a.rating || null;
        const ratingB = b.rating || null;
        if (ratingA === null && ratingB === null) return alphabeticalCompare(a.name, b.name);
        if (ratingA === null) return 1;
        if (ratingB === null) return -1;
        if (ratingA !== ratingB) return ratingB - ratingA;
        return alphabeticalCompare(a.name, b.name);
    });
    return list;
}

// Finds every saved combo that is exactly this pair of ingredients (order
// doesn't matter). Can return 0, 1, or 2 matches (one per temperature).
function findPairMatches(nameA, nameB) {
    return combinations.filter(function(combo) {
        return combo.ingredients.length === 2 &&
            combo.ingredients.includes(nameA) &&
            combo.ingredients.includes(nameB);
    });
}

// Finds every saved combo that's just this one ingredient by itself - the
// diagonal cell's equivalent of findPairMatches.
function findSoloMatches(name) {
    return combinations.filter(function(combo) {
        return combo.ingredients.length === 1 && combo.ingredients[0] === name;
    });
}

// A combo with no description is just a potential-pairing idea jotted down
// for later, not something actually brewed and evaluated - kept in sync
// with the same rule in script.js's isIngredientTried.
function comboIsTried(combo) {
    return !!(combo.description && combo.description.trim());
}

// Builds a link to combo-detail.html for a given set of ingredients -
// repeated ?ingredient= params rather than one joined string, so names with
// odd characters don't need a custom delimiter.
function comboDetailUrl(names) {
    const params = new URLSearchParams();
    names.forEach(function(name) { params.append('ingredient', name); });
    return 'combo-detail.html?' + params.toString();
}

// Same idea as comboDetailUrl, but links to the main page instead - with
// script.js reading these same repeated ?ingredient= params on load to
// preload them straight into the cauldron (see the untried-cell case below).
function cauldronUrl(names) {
    const params = new URLSearchParams();
    names.forEach(function(name) { params.append('ingredient', name); });
    return 'index.html?' + params.toString();
}

// ===== Color scales =====
// Both matrices color cells on a gradient instead of showing raw numbers -
// blue->orange for "how much of this category-pair has been tried", and
// red->green for "how good was it" once something has.

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return [
        parseInt(clean.substring(0, 2), 16),
        parseInt(clean.substring(2, 4), 16),
        parseInt(clean.substring(4, 6), 16)
    ];
}

// Returns the mixed color as an [r,g,b] array (not yet a CSS string) so
// callers can also use it to pick a readable text color - see
// readableTextStyle below.
function interpolateRgb(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const clamped = Math.max(0, Math.min(1, t));
    return [0, 1, 2].map(function(i) { return Math.round(a[i] + (b[i] - a[i]) * clamped); });
}

function rgbToCss(rgb) {
    return 'rgb(' + rgb.join(',') + ')';
}

// White text with a dark shadow only reads well on darker backgrounds -
// this picks dark ink (no shadow needed) on light backgrounds and white
// (with a shadow, for contrast against mid-tones) on dark ones, using
// standard perceived-brightness weighting per channel.
function readableTextStyle(rgb) {
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    return brightness > 150
        ? { color: '#2e2a24', textShadow: 'none' }
        : { color: '#ffffff', textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)' };
}

// Blue -> orange is close to a complementary pair, so mixing them directly
// collapses toward a muddy grey/purple in the middle instead of a clean
// transition - going via a light neutral midpoint (matching the page's own
// cream background) avoids that and stays legible either side of it.
const PERCENT_TRIED_LOW = '#3b82f6';  // blue - 0% of this category-pair tried
const PERCENT_TRIED_MID = '#f6f1e6';  // cream (same as --bg) - 50%
const PERCENT_TRIED_HIGH = '#e67a2e'; // orange - 100% tried
function percentTriedRgb(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    return clamped <= 0.5
        ? interpolateRgb(PERCENT_TRIED_LOW, PERCENT_TRIED_MID, clamped / 0.5)
        : interpolateRgb(PERCENT_TRIED_MID, PERCENT_TRIED_HIGH, (clamped - 0.5) / 0.5);
}

// Red -> green passes through a believable amber/olive in the middle (the
// classic "traffic light" progression), so a straight two-stop mix already
// looks right - no midpoint needed here the way the blue/orange scale did.
const RATING_COLOR_LOW = '#c0392b';  // red - rating 0
const RATING_COLOR_HIGH = '#4CAF50'; // green - rating 10
function ratingRgb(rating) {
    return interpolateRgb(RATING_COLOR_LOW, RATING_COLOR_HIGH, rating / 10);
}

// ===== Category x category overview =====

// Every distinct, unordered ingredient pair between category A and B - if
// they're the same category, pairs are within that one category (each
// combination counted once, no ingredient paired with itself).
function categoryPairsList(catA, catB) {
    const itemsA = getCategoryItems(catA);
    const itemsB = getCategoryItems(catB);
    const pairs = [];
    if (catA === catB) {
        for (let i = 0; i < itemsA.length; i++) {
            for (let j = i + 1; j < itemsA.length; j++) {
                pairs.push([itemsA[i], itemsA[j]]);
            }
        }
    } else {
        itemsA.forEach(function(a) {
            itemsB.forEach(function(b) { pairs.push([a, b]); });
        });
    }
    return pairs;
}

function averageRatingOf(matches) {
    const rated = matches.filter(function(m) { return m.rating; });
    if (rated.length === 0) return null;
    return rated.reduce(function(sum, m) { return sum + m.rating; }, 0) / rated.length;
}

// How much of a category-pair's possible combos have been tried, and the
// average rating among the tried ones (each tried pair/solo contributes its
// own average rating first, so something logged both hot and cold doesn't
// count twice as heavily as one logged only once).
function categoryPairStats(catA, catB) {
    // A single-ingredient category has nothing to pair with *itself* - only
    // one item means zero possible internal pairs. Rather than reading as
    // "nothing here" (the grey empty state), that defaults to fully tried/
    // orange instead, on the idea that there's nothing left untried within
    // a category of one. Still picks up that ingredient's own solo-brew
    // rating if it has one.
    if (catA === catB && getCategoryItems(catA).length === 1) {
        const avgRating = averageRatingOf(findSoloMatches(getCategoryItems(catA)[0]));
        return { total: 1, triedCount: 1, percentTried: 1, avgRating: avgRating, singleIngredient: true };
    }

    const pairs = categoryPairsList(catA, catB);
    let triedCount = 0;
    const averages = [];

    pairs.forEach(function(pair) {
        const matches = findPairMatches(pair[0], pair[1]);
        if (!matches.some(comboIsTried)) return;
        triedCount++;
        const avg = averageRatingOf(matches);
        if (avg !== null) averages.push(avg);
    });

    // Same-category cells also count each ingredient's own solo-brew entry
    // as one of the possible "entries" - matching exactly what the detail
    // matrix shows when you click in (n solo cells on the diagonal, plus
    // the n*(n-1)/2 pairs - see blankMatrixCell), rather than silently
    // leaving the diagonal out of the percentage here.
    let total = pairs.length;
    if (catA === catB) {
        const items = getCategoryItems(catA);
        total += items.length;
        items.forEach(function(name) {
            const matches = findSoloMatches(name);
            if (!matches.some(comboIsTried)) return;
            triedCount++;
            const avg = averageRatingOf(matches);
            if (avg !== null) averages.push(avg);
        });
    }

    const avgRating = averages.length > 0
        ? averages.reduce(function(a, b) { return a + b; }, 0) / averages.length
        : null;

    return {
        total: total,
        triedCount: triedCount,
        percentTried: total > 0 ? triedCount / total : 0,
        avgRating: avgRating
    };
}

// Below the diagonal is always a mirror of above it in a symmetric matrix
// (row x col is the exact same pairing/stats as col x row) - left blank
// (but still present, so columns stay aligned under their headers) rather
// than repeating every combination twice. The diagonal itself is always
// kept, since row === col there is a real, distinct thing (a category
// against itself, or an ingredient brewed solo) rather than a repeat.
function blankMatrixCell() {
    const td = document.createElement('td');
    td.className = 'matrix-cell-skip';
    return td;
}

function renderCategoryMatrix() {
    const container = document.getElementById('matrix-area');
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = '🗂️ By category';
    container.appendChild(heading);

    const categories = getCategories();

    const wrapper = document.createElement('div');
    wrapper.id = 'matrix-wrapper';
    const table = document.createElement('table');
    table.className = 'brew-matrix';

    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    categories.forEach(function(cat) {
        const th = document.createElement('th');
        th.textContent = cat;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    categories.forEach(function(rowCat, rowIndex) {
        const tr = document.createElement('tr');
        const rowHeader = document.createElement('th');
        rowHeader.textContent = rowCat;
        tr.appendChild(rowHeader);

        categories.forEach(function(colCat, colIndex) {
            if (colIndex < rowIndex) {
                tr.appendChild(blankMatrixCell());
                return;
            }

            const td = document.createElement('td');
            const stats = categoryPairStats(rowCat, colCat);

            if (stats.total === 0) {
                // An empty category (0 items) against itself - genuinely
                // nothing there. A *single*-item category against itself is
                // handled separately (see categoryPairStats) and doesn't
                // hit this branch.
                td.className = 'category-cell-empty';
                td.textContent = '—';
            } else {
                td.className = 'category-cell';
                const rgb = percentTriedRgb(stats.percentTried);
                const textStyle = readableTextStyle(rgb);
                td.style.background = rgbToCss(rgb);
                td.style.color = textStyle.color;
                td.style.textShadow = textStyle.textShadow;
                td.textContent = stats.avgRating !== null
                    ? (Math.round(stats.avgRating * 10) / 10) + '/10'
                    : '';
                td.title = stats.singleIngredient
                    ? 'Only one ingredient in this category - nothing to pair internally'
                    : stats.triedCount + ' / ' + stats.total + ' tried';
                td.addEventListener('click', function() {
                    matrixView = 'detail';
                    detailCategories = { a: rowCat, b: colCat };
                    renderMatrixArea();
                });
            }

            tr.appendChild(td);
        });

        table.appendChild(tr);
    });

    wrapper.appendChild(table);
    container.appendChild(wrapper);

    const fullBtn = document.createElement('button');
    fullBtn.id = 'show-full-matrix-btn';
    fullBtn.textContent = '🔎 Show full matrix';
    fullBtn.addEventListener('click', function() {
        matrixView = 'full';
        renderMatrixArea();
    });
    container.appendChild(fullBtn);
}

// ===== Shared pair-cell rendering (detail matrix + full matrix) =====

// Tick + rating-colored if tried, cross + grey if not - used by both the
// detail matrix and the full matrix so they read the same way. Clicking a
// tried cell opens its notes; clicking an untried one jumps to the main
// page with the pairing preloaded, ready to brew.
function decoratePairCell(td, matches, linkIngredients) {
    const tried = matches.some(comboIsTried);

    if (!tried) {
        td.className = 'pair-cell pair-cell-untried';
        td.textContent = '✗';
        td.title = 'Brew this pairing';
        td.addEventListener('click', function() {
            window.location.href = cauldronUrl(linkIngredients);
        });
        return;
    }

    const rated = matches.filter(function(m) { return m.rating; });
    const avgRating = rated.length > 0
        ? rated.reduce(function(sum, m) { return sum + m.rating; }, 0) / rated.length
        : null;
    const isStarred = matches.some(function(m) { return m.starred; });

    const rgb = avgRating !== null ? ratingRgb(avgRating) : [176, 176, 176];
    const textStyle = readableTextStyle(rgb);
    td.className = 'pair-cell pair-cell-tried';
    td.style.background = rgbToCss(rgb);
    td.style.color = textStyle.color;
    td.style.textShadow = textStyle.textShadow;
    td.textContent = '✓' + (isStarred ? ' ⭐' : '');
    td.title = 'View notes' + (avgRating !== null ? ' (avg rating ' + (Math.round(avgRating * 10) / 10) + '/10)' : '');
    td.addEventListener('click', function() {
        window.location.href = comboDetailUrl(linkIngredients);
    });
}

// ===== Detail matrix (one category pair) =====

function renderDetailMatrix(catA, catB) {
    const container = document.getElementById('matrix-area');
    container.innerHTML = '';

    const backBtn = document.createElement('button');
    backBtn.textContent = '← Back to categories';
    backBtn.addEventListener('click', function() {
        matrixView = 'category';
        detailCategories = null;
        renderMatrixArea();
    });
    container.appendChild(backBtn);

    const heading = document.createElement('h2');
    heading.textContent = catA === catB ? catA : catA + ' × ' + catB;
    container.appendChild(heading);

    const itemsA = getCategoryItems(catA);
    const itemsB = getCategoryItems(catB);

    const wrapper = document.createElement('div');
    wrapper.id = 'matrix-wrapper';
    const table = document.createElement('table');
    table.className = 'brew-matrix';

    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    itemsB.forEach(function(name) {
        const th = document.createElement('th');
        th.textContent = name;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Only when catA === catB are the rows and columns the exact same list
    // (so row x col duplicates col x row somewhere else in the grid) -
    // cross-category (catA !== catB) has no such overlap, so it stays a
    // full rectangle.
    const sameCategory = catA === catB;

    itemsA.forEach(function(rowName, rowIndex) {
        const tr = document.createElement('tr');
        const rowHeader = document.createElement('th');
        rowHeader.textContent = rowName;
        tr.appendChild(rowHeader);

        itemsB.forEach(function(colName, colIndex) {
            if (sameCategory && colIndex < rowIndex) {
                tr.appendChild(blankMatrixCell());
                return;
            }

            const td = document.createElement('td');
            if (rowName === colName) {
                // Only possible when catA === catB - same ingredient on
                // both axes. Not a pair, but still worth showing whether
                // it's been brewed solo (same convention as the full matrix).
                decoratePairCell(td, findSoloMatches(rowName), [rowName]);
            } else {
                decoratePairCell(td, findPairMatches(rowName, colName), [rowName, colName]);
            }
            tr.appendChild(td);
        });

        table.appendChild(tr);
    });

    wrapper.appendChild(table);
    container.appendChild(wrapper);
}

// ===== Full matrix (every ingredient) =====

function getFullMatrixOrderedNames() {
    const names = getAllIngredientNames();

    if (fullMatrixOrder === 'alphabetical') {
        return names.slice().sort(alphabeticalCompare);
    }

    if (fullMatrixOrder === 'rating') {
        return names.slice().sort(function(a, b) {
            const ratingA = bestRatingFor(a);
            const ratingB = bestRatingFor(b);
            if (ratingA === null && ratingB === null) return alphabeticalCompare(a, b);
            if (ratingA === null) return 1;
            if (ratingB === null) return -1;
            if (ratingA !== ratingB) return ratingB - ratingA;
            return alphabeticalCompare(a, b);
        });
    }

    // 'category' - grouped by section in ingredients.json's own order,
    // alphabetical within each section.
    const result = [];
    ingredientsData.forEach(function(section) {
        section.items.slice().sort(alphabeticalCompare).forEach(function(name) {
            result.push(name);
        });
    });
    return result;
}

// A checkbox per ingredient, unchecking hides it as a *column* only - its
// own row stays, so nothing's actually lost (row i x column j is the same
// pairing as row j x column i), it just narrows how wide the table is.
function buildColumnFilterCheckbox(name) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hiddenColumns.has(name);
    checkbox.addEventListener('change', function() {
        if (checkbox.checked) hiddenColumns.delete(name);
        else hiddenColumns.add(name);
        renderFullMatrix();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' ' + name));
    return label;
}

// One category's worth of checkboxes, with its own heading checkbox that
// selects/deselects every ingredient in that category at once - shows as
// indeterminate (a dash) when only some of them are currently visible.
function buildColumnFilterGroup(category, items) {
    const group = document.createElement('div');
    group.className = 'column-filter-group';

    const headingLabel = document.createElement('label');
    headingLabel.className = 'column-filter-group-heading';
    const headingCheckbox = document.createElement('input');
    headingCheckbox.type = 'checkbox';
    const visibleCount = items.filter(function(name) { return !hiddenColumns.has(name); }).length;
    headingCheckbox.checked = visibleCount === items.length;
    headingCheckbox.indeterminate = visibleCount > 0 && visibleCount < items.length;
    headingCheckbox.addEventListener('change', function() {
        items.forEach(function(name) {
            if (headingCheckbox.checked) hiddenColumns.delete(name);
            else hiddenColumns.add(name);
        });
        renderFullMatrix();
    });
    headingLabel.appendChild(headingCheckbox);
    headingLabel.appendChild(document.createTextNode(' ' + category));
    group.appendChild(headingLabel);

    const itemsWrapper = document.createElement('div');
    itemsWrapper.className = 'column-filter-group-items';
    items.slice().sort(alphabeticalCompare).forEach(function(name) {
        itemsWrapper.appendChild(buildColumnFilterCheckbox(name));
    });
    group.appendChild(itemsWrapper);

    return group;
}

function buildColumnFilter() {
    const wrapper = document.createElement('details');
    wrapper.className = 'column-filter';
    wrapper.open = columnFilterOpen;
    wrapper.addEventListener('toggle', function() { columnFilterOpen = wrapper.open; });

    const summary = document.createElement('summary');
    summary.textContent = '🧮 Filter columns' + (hiddenColumns.size > 0 ? ' (' + hiddenColumns.size + ' hidden)' : '');
    wrapper.appendChild(summary);

    // How the checklist itself is grouped - independent of the matrix's own
    // Order by (Category/Alphabetical/Rating) buttons above, since you might
    // want to browse the filter list differently than the matrix is sorted.
    const orderToggle = document.createElement('div');
    orderToggle.className = 'column-filter-order';
    [['category', 'By category'], ['alphabetical', 'Alphabetical']].forEach(function(pair) {
        const btn = document.createElement('button');
        btn.className = 'sort-toggle-btn';
        btn.textContent = pair[1];
        btn.classList.toggle('active', columnFilterOrder === pair[0]);
        btn.addEventListener('click', function() {
            columnFilterOrder = pair[0];
            renderFullMatrix();
        });
        orderToggle.appendChild(btn);
    });
    wrapper.appendChild(orderToggle);

    const list = document.createElement('div');

    if (columnFilterOrder === 'alphabetical') {
        list.className = 'column-filter-list column-filter-list-flat';
        getAllIngredientNames().slice().sort(alphabeticalCompare).forEach(function(name) {
            list.appendChild(buildColumnFilterCheckbox(name));
        });
    } else {
        list.className = 'column-filter-list column-filter-list-grouped';
        ingredientsData.forEach(function(section) {
            if (section.items.length === 0) return;
            list.appendChild(buildColumnFilterGroup(section.section, section.items));
        });
    }

    wrapper.appendChild(list);

    return wrapper;
}

function renderFullMatrix() {
    const container = document.getElementById('matrix-area');
    container.innerHTML = '';

    const backBtn = document.createElement('button');
    backBtn.textContent = '← Back to categories';
    backBtn.addEventListener('click', function() {
        matrixView = 'category';
        renderMatrixArea();
    });
    container.appendChild(backBtn);

    const heading = document.createElement('h2');
    heading.textContent = '🔎 Full matrix';
    container.appendChild(heading);

    const orderControls = document.createElement('div');
    orderControls.className = 'sort-controls';
    const orderLabel = document.createElement('span');
    orderLabel.textContent = 'Order by:';
    orderControls.appendChild(orderLabel);
    [['category', 'Category'], ['alphabetical', 'Alphabetical'], ['rating', 'Rating']].forEach(function(pair) {
        const btn = document.createElement('button');
        btn.className = 'sort-toggle-btn';
        btn.textContent = pair[1];
        btn.classList.toggle('active', fullMatrixOrder === pair[0]);
        btn.addEventListener('click', function() {
            fullMatrixOrder = pair[0];
            renderFullMatrix();
        });
        orderControls.appendChild(btn);
    });
    container.appendChild(orderControls);

    const rowNames = getFullMatrixOrderedNames();
    container.appendChild(buildColumnFilter());

    const colNames = rowNames.filter(function(name) { return !hiddenColumns.has(name); });

    const wrapper = document.createElement('div');
    wrapper.id = 'matrix-wrapper';
    const table = document.createElement('table');
    table.className = 'brew-matrix';

    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    colNames.forEach(function(name) {
        const th = document.createElement('th');
        th.textContent = name;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Rows always use the full list but columns can have some filtered out
    // (see buildColumnFilter), so a column's *position in rowNames* - not
    // its index within the already-filtered colNames - is what actually
    // determines whether it's below the diagonal.
    const positionInOrder = {};
    rowNames.forEach(function(name, i) { positionInOrder[name] = i; });

    rowNames.forEach(function(rowName, rowIndex) {
        const tr = document.createElement('tr');
        const rowHeader = document.createElement('th');
        rowHeader.textContent = rowName;
        tr.appendChild(rowHeader);

        colNames.forEach(function(colName) {
            if (positionInOrder[colName] < rowIndex) {
                tr.appendChild(blankMatrixCell());
                return;
            }

            const td = document.createElement('td');
            if (rowName === colName) {
                decoratePairCell(td, findSoloMatches(rowName), [rowName]);
            } else {
                decoratePairCell(td, findPairMatches(rowName, colName), [rowName, colName]);
            }
            tr.appendChild(td);
        });

        table.appendChild(tr);
    });

    wrapper.appendChild(table);
    container.appendChild(wrapper);
}

// ===== Dispatcher =====

function renderMatrixArea() {
    if (matrixView === 'detail') {
        renderDetailMatrix(detailCategories.a, detailCategories.b);
    } else if (matrixView === 'full') {
        renderFullMatrix();
    } else {
        renderCategoryMatrix();
    }
}

// ===== Combos with 3+ ingredients - cards (default) or network graph =====
// The grid above only works for 2-ingredient combos. Anything bigger shows
// up here instead of silently vanishing from the log.


function buildIngredientChip(name) {
    const chip = document.createElement('span');
    chip.className = 'ingredient-chip';
    const rgb = hexToRgb(ingredientColorHex(name));
    const textStyle = readableTextStyle(rgb);
    chip.style.background = rgbToCss(rgb);
    chip.style.color = textStyle.color;
    chip.style.textShadow = textStyle.textShadow;
    chip.textContent = name;
    return chip;
}

function buildComboCard(combo) {
    const card = document.createElement('div');
    card.className = 'combo-card';
    const tried = comboIsTried(combo);
    const rgb = combo.rating ? ratingRgb(combo.rating) : [176, 176, 176];
    card.style.borderLeftColor = rgbToCss(rgb);
    card.title = 'View notes';
    card.addEventListener('click', function() {
        window.location.href = comboDetailUrl(combo.ingredients);
    });

    const head = document.createElement('div');
    head.className = 'combo-card-head';

    const title = document.createElement('h3');
    const methodEmoji = combo.temperature === 'cold' ? '❄️' : combo.temperature === 'stovetop' ? '🍳' : '🔥';
    title.textContent = methodEmoji + ' ' + combo.name + (!tried ? ' 💡' : '');
    head.appendChild(title);

    const badge = document.createElement('span');
    if (combo.rating) {
        badge.className = 'combo-card-rating';
        badge.style.background = rgbToCss(rgb);
        const textStyle = readableTextStyle(rgb);
        badge.style.color = textStyle.color;
        badge.style.textShadow = textStyle.textShadow;
        badge.textContent = combo.rating + '/10' + (combo.starred ? ' ⭐' : '');
    } else {
        badge.className = 'combo-card-rating combo-card-rating-idea';
        badge.textContent = 'N/A';
    }
    head.appendChild(badge);
    card.appendChild(head);

    const chips = document.createElement('div');
    chips.className = 'combo-card-chips';
    combo.ingredients.forEach(function(name) {
        chips.appendChild(buildIngredientChip(name));
    });
    card.appendChild(chips);

    return card;
}

function renderComboCards(combos) {
    const container = document.getElementById('multi-ingredient-list');
    const grid = document.createElement('div');
    grid.className = 'combo-card-grid';
    getOrderedCombos(combos).forEach(function(combo) {
        grid.appendChild(buildComboCard(combo));
    });
    container.appendChild(grid);
}

// Every distinct ingredient pair that co-occurs in any of the given combos
// (each combo contributes a clique among its own ingredients) - used to lay
// out and draw the 3+ combo network.
function buildComboEdges(combos) {
    const edges = [];
    const seenEdges = new Set();
    combos.forEach(function(combo) {
        const ing = combo.ingredients;
        for (let i = 0; i < ing.length; i++) {
            for (let j = i + 1; j < ing.length; j++) {
                const key = [ing[i], ing[j]].sort().join('|');
                if (!seenEdges.has(key)) {
                    seenEdges.add(key);
                    edges.push([ing[i], ing[j]]);
                }
            }
        }
    });
    return edges;
}

// A small, static Fruchterman-Reingold-style force layout, run once at
// render time (no animation, no library) - connected nodes attract each
// other like a spring, every pair repels regardless, and the whole thing
// cools down over the iterations so it settles instead of oscillating
// forever. Fine for the dozen-or-so nodes any graph on this page will
// realistically have. Shared by the 3+ combo network and the potential-
// pairings network - both just hand it their own edge list.
//
// The *initial* placement (an evenly-spaced circle, purely a function of
// each name's position in the names array) is deliberately deterministic -
// re-running this for the exact same graph always converges to
// essentially the same layout, which is what stops the graph from visibly
// "jumping" every time something unrelated (switching Word/Icon mode,
// e.g.) forces a re-render. randomizeStart scatters that starting circle
// instead, for the one case where a different layout is actually wanted -
// the Shuffle button (see renderPairingNetwork).
function layoutForceGraph(edges, names, width, height, randomizeStart) {
    const positions = {};
    names.forEach(function(name, i) {
        const angle = randomizeStart ? Math.random() * Math.PI * 2 : (i / names.length) * Math.PI * 2;
        const radius = Math.min(width, height) * (randomizeStart ? (0.1 + Math.random() * 0.3) : 0.3);
        positions[name] = {
            x: width / 2 + Math.cos(angle) * radius,
            y: height / 2 + Math.sin(angle) * radius
        };
    });

    const k = Math.sqrt((width * height) / names.length);
    const iterations = 300;
    const centerX = width / 2, centerY = height / 2;
    // Gentle pull toward center - without it, ingredients that share no
    // combo with anything else have nothing but repulsion acting on them,
    // so they just get pushed outward until they're clamped against the
    // canvas edges, where multiple unrelated nodes can pile up together in
    // the same corner instead of spreading into their own cluster.
    const gravityStrength = 0.02;

    for (let iter = 0; iter < iterations; iter++) {
        const disp = {};
        names.forEach(function(name) { disp[name] = { x: 0, y: 0 }; });

        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const a = names[i], b = names[j];
                let dx = positions[a].x - positions[b].x;
                let dy = positions[a].y - positions[b].y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 0.01) {
                    // Coincident points have no direction to push apart
                    // along - a random nudge here so they don't stay stuck
                    // on top of each other forever.
                    dx = (Math.random() - 0.5) * 0.1;
                    dy = (Math.random() - 0.5) * 0.1;
                    dist = Math.sqrt(dx * dx + dy * dy);
                }
                const force = (k * k) / dist;
                dx = (dx / dist) * force;
                dy = (dy / dist) * force;
                disp[a].x += dx; disp[a].y += dy;
                disp[b].x -= dx; disp[b].y -= dy;
            }
        }

        edges.forEach(function(edge) {
            const a = edge[0], b = edge[1];
            let dx = positions[a].x - positions[b].x;
            let dy = positions[a].y - positions[b].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const force = (dist * dist) / k;
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            disp[a].x -= dx; disp[a].y -= dy;
            disp[b].x += dx; disp[b].y += dy;
        });

        names.forEach(function(name) {
            disp[name].x += (centerX - positions[name].x) * gravityStrength;
            disp[name].y += (centerY - positions[name].y) * gravityStrength;
        });

        const temperature = k * (1 - iter / iterations);
        names.forEach(function(name) {
            const d = disp[name];
            const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
            const limited = Math.min(dist, Math.max(temperature, 1));
            positions[name].x = Math.max(50, Math.min(width - 50, positions[name].x + (d.x / dist) * limited));
            positions[name].y = Math.max(30, Math.min(height - 30, positions[name].y + (d.y / dist) * limited));
        });
    }

    return positions;
}

// Only the categories actually present among the given ingredient names,
// alphabetical, so the graph's color key doesn't list ten categories when
// only three are on screen.
function buildCategoryLegend(names) {
    const present = [];
    const seen = new Set();
    names.forEach(function(name) {
        const cat = categoryOfIngredient(name);
        if (cat && !seen.has(cat)) {
            seen.add(cat);
            present.push(cat);
        }
    });
    present.sort(alphabeticalCompare);

    const legend = document.createElement('div');
    legend.className = 'category-legend';
    present.forEach(function(cat) {
        const item = document.createElement('span');
        item.className = 'category-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'category-legend-swatch';
        swatch.style.background = categoryColorHex(cat);
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(cat));
        legend.appendChild(item);
    });
    return legend;
}

// One ingredient node - a circle colored by category (see categoryColorHex)
// plus its label - shared by the 3+ combo network and the potential-
// pairings network.
// A square clip so each icon-mode picture crops to a square regardless of
// its own aspect ratio - objectBoundingBox means one shared clipPath works
// for every image that references it, no matter where each one sits, so it
// only needs to exist once per <svg>. clipId is generated per render (see
// callers) so two network graphs in the same page (only one visible at a
// time, but both stay in the DOM - see the tab bar) never collide on id.
function addGraphIconClipDef(svg, clipId) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', clipId);
    clipPath.setAttribute('clipPathUnits', 'objectBoundingBox');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 0);
    rect.setAttribute('y', 0);
    rect.setAttribute('width', 1);
    rect.setAttribute('height', 1);
    clipPath.appendChild(rect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);
}

// One ingredient node - word mode is a category-colored circle plus its
// name; icon mode swaps the name for the ingredient's own picture (falling
// back to the placeholder like everywhere else icons show up) inside a
// category-colored ring, whose border separately reports whether/how well
// this ingredient's been brewed on its own (see soloAvgRating below), so
// there's a color cue either way with no text. Either way it gets a
// data-tooltip with the name, so it's identifiable even in icon mode with
// no text.
//
// Two nested <g>s, not one: the outer carries *position* as a plain SVG
// transform attribute (rewritten directly during a drag - see
// repositionNode/renderPairingNetwork), the inner carries the zoom
// controls' marker-size as a CSS transform (--marker-scale, see .graph-node
// in styles.css). They can't both live on the same element - a CSS
// transform property always wins over the attribute on that same element,
// so combining them there would silently drop whichever one lost.
function buildGraphNodeSvg(name, pos, mode, clipId) {
    const rgb = hexToRgb(categoryColorHex(categoryOfIngredient(name)));

    // Whether this ingredient has been brewed on its own (a logged combo
    // whose *only* ingredient is this one) and, if so, its average rating -
    // same tried/avgRating split used for pairing-edge coloring above, just
    // applied to findSoloMatches instead of findPairMatches. Drives the
    // icon-mode outer ring below, and is folded into the tooltip either way.
    const soloMatches = findSoloMatches(name);
    const soloTried = soloMatches.some(comboIsTried);
    const soloAvgRating = soloTried ? averageRatingOf(soloMatches) : null;

    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    outer.setAttribute('class', 'graph-node-anchor');
    outer.setAttribute('data-tooltip', name + (soloAvgRating !== null
        ? ' — brewed alone, avg ' + (Math.round(soloAvgRating * 10) / 10) + '/10'
        : ''));

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'graph-node');
    outer.appendChild(g);

    if (mode === 'icon') {
        // Outer ring - fill stays category-colored, same as always; its
        // stroke is what reports the solo-brew score, in the same
        // green-to-red rating color the pairing edges use, once this
        // ingredient's been brewed alone and rated. Nothing solo-tried yet
        // keeps the grey dashed outline used for "not brewed" throughout
        // this graph (see the edges above).
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ring.setAttribute('x', -17);
        ring.setAttribute('y', -17);
        ring.setAttribute('width', 34);
        ring.setAttribute('height', 34);
        ring.setAttribute('class', 'graph-node-icon-ring');
        ring.setAttribute('fill', rgbToCss(rgb));
        if (soloAvgRating !== null) {
            ring.setAttribute('stroke', rgbToCss(ratingRgb(soloAvgRating)));
        } else {
            ring.setAttribute('stroke', 'rgb(176,176,176)');
            ring.setAttribute('stroke-dasharray', '4 3');
        }
        g.appendChild(ring);

        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('x', -14);
        image.setAttribute('y', -14);
        image.setAttribute('width', 28);
        image.setAttribute('height', 28);
        image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        image.setAttribute('href', imagePathFor(name));
        image.setAttribute('clip-path', 'url(#' + clipId + ')');
        image.addEventListener('error', function() {
            if (image.dataset.usedPlaceholder) return;
            image.dataset.usedPlaceholder = 'true';
            image.setAttribute('href', 'Images/placeholder.png');
        });
        g.appendChild(image);

        const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        border.setAttribute('x', -14);
        border.setAttribute('y', -14);
        border.setAttribute('width', 28);
        border.setAttribute('height', 28);
        border.setAttribute('class', 'graph-node-icon-border');
        g.appendChild(border);
    } else {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', 0);
        circle.setAttribute('cy', 0);
        circle.setAttribute('r', 8);
        circle.setAttribute('fill', rgbToCss(rgb));
        g.appendChild(circle);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 0);
        text.setAttribute('y', -12);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = name;
        g.appendChild(text);
    }

    repositionNode(outer, pos);
    return outer;
}

function repositionNode(outerG, pos) {
    outerG.setAttribute('transform', 'translate(' + pos.x + ',' + pos.y + ')');
}

// Hovering a node dims everything *except* itself, its directly connected
// nodes, and the shapes (edges or combo polygons) linking them - shared by
// both network graphs. shapesByNode maps each ingredient name to the list
// of {el, relatedNames} shapes it appears in (an edge's two ends, or a
// combo polygon's full ingredient list).
function wireGraphHoverHighlight(nodeElements, shapesByNode) {
    const allShapeEls = new Set();
    Object.keys(shapesByNode).forEach(function(name) {
        shapesByNode[name].forEach(function(shape) { allShapeEls.add(shape.el); });
    });

    function clearHighlight() {
        Object.keys(nodeElements).forEach(function(name) {
            nodeElements[name].classList.remove('graph-dimmed');
        });
        allShapeEls.forEach(function(el) { el.classList.remove('graph-dimmed'); });
    }

    Object.keys(nodeElements).forEach(function(name) {
        const g = nodeElements[name];
        g.addEventListener('mouseenter', function() {
            const relatedNames = new Set([name]);
            const relatedShapeEls = new Set();
            (shapesByNode[name] || []).forEach(function(shape) {
                relatedShapeEls.add(shape.el);
                shape.relatedNames.forEach(function(n) { relatedNames.add(n); });
            });

            Object.keys(nodeElements).forEach(function(otherName) {
                nodeElements[otherName].classList.toggle('graph-dimmed', !relatedNames.has(otherName));
            });
            allShapeEls.forEach(function(el) {
                el.classList.toggle('graph-dimmed', !relatedShapeEls.has(el));
            });
        });
        g.addEventListener('mouseleave', clearHighlight);
    });
}

// Lets you pick a node up and drop it wherever - mutates positions[name]
// directly (which, since renderPairingNetwork hands this the very object
// it just cached, means a manually-placed node stays put across
// unrelated re-renders too, the same way the cache does). Every shape
// touching the dragged node (an edge's line, or a combo polygon) gets its
// coordinates recomputed live so nothing looks disconnected mid-drag.
// Currently only wired up for the Pairing outcomes graph.
function wireNodeDragging(svg, width, height, positions, nodeElements, shapesByNode) {
    Object.keys(nodeElements).forEach(function(name) {
        const g = nodeElements[name];
        let dragging = false;

        g.addEventListener('pointerdown', function(e) {
            dragging = true;
            g.setPointerCapture(e.pointerId);
            g.classList.add('graph-node-dragging');
        });

        g.addEventListener('pointermove', function(e) {
            if (!dragging) return;
            const rect = svg.getBoundingClientRect();
            const pos = positions[name];
            pos.x = Math.max(10, Math.min(width - 10, (e.clientX - rect.left) / rect.width * width));
            pos.y = Math.max(10, Math.min(height - 10, (e.clientY - rect.top) / rect.height * height));
            repositionNode(g, pos);

            (shapesByNode[name] || []).forEach(function(shape) {
                if (shape.el.tagName === 'line') {
                    const a = shape.relatedNames[0], b = shape.relatedNames[1];
                    shape.el.setAttribute('x1', positions[a].x);
                    shape.el.setAttribute('y1', positions[a].y);
                    shape.el.setAttribute('x2', positions[b].x);
                    shape.el.setAttribute('y2', positions[b].y);
                } else if (shape.el.tagName === 'polygon') {
                    shape.el.setAttribute('points', comboPolygonPoints(shape.relatedNames, positions));
                }
            });
        });

        function endDrag() {
            dragging = false;
            g.classList.remove('graph-node-dragging');
        }
        g.addEventListener('pointerup', endDrag);
        g.addEventListener('pointercancel', endDrag);
    });
}

// Word/Icon toggle, shared by both network graphs - reused as-is in each
// render function since the state (graphNodeMode) is global.
function buildGraphModeToggle(onChange) {
    const toggle = document.createElement('div');
    toggle.className = 'combo-viz-toggle';
    [['word', '🔤 Word mode'], ['icon', '🖼️ Icon mode']].forEach(function(pair) {
        const btn = document.createElement('button');
        btn.className = 'sort-toggle-btn';
        btn.textContent = pair[1];
        btn.classList.toggle('active', graphNodeMode === pair[0]);
        btn.addEventListener('click', function() {
            graphNodeMode = pair[0];
            onChange();
        });
        toggle.appendChild(btn);
    });
    return toggle;
}

// Scroll-to-shrink + explicit +/-/reset buttons that resize the nodes
// (circles/icons) and their labels themselves - via --marker-scale, a CSS
// custom property each .graph-node scales around its own center (see
// styles.css) - rather than the SVG's viewBox. The graph's own layout/
// spatial extent never changes, only how big the markers drawn on top of
// it are, since that's what was actually overlapping. Shared by both
// graphs (preference scatter, Pairing outcomes). Listeners are attached
// directly to wrapper/svg (never window/document), so they're simply
// discarded along with those elements next render - nothing to clean up.
function makeSvgZoomable(wrapper, svg) {
    let scale = 1;
    const minScale = 0.35;
    const maxScale = 1.5;

    function applyScale() {
        svg.style.setProperty('--marker-scale', scale);
    }

    function zoomBy(factor) {
        scale = Math.max(minScale, Math.min(maxScale, scale * factor));
        applyScale();
    }

    wrapper.addEventListener('wheel', function(e) {
        e.preventDefault();
        zoomBy(e.deltaY > 0 ? 1 / 1.1 : 1.1);
    }, { passive: false });

    const controls = document.createElement('div');
    controls.className = 'graph-zoom-controls';
    [['+', 'Bigger markers', 1.2], ['−', 'Smaller markers', 1 / 1.2], ['⤢', 'Reset marker size', null]].forEach(function(item) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'graph-zoom-btn';
        btn.textContent = item[0];
        btn.title = item[1];
        btn.addEventListener('click', function() {
            if (item[2] === null) {
                scale = 1;
                applyScale();
            } else {
                zoomBy(item[2]);
            }
        });
        controls.appendChild(btn);
    });
    wrapper.appendChild(controls);

    // Fullscreen toggle - a separate top-left control so it doesn't get
    // lost among the marker-size buttons. The graph itself already fills
    // its container responsively (viewBox + width:100%), so entering
    // fullscreen is just handing the wrapper to the Fullscreen API and
    // letting CSS (#graphs-svg-wrapper:fullscreen in styles.css) drop its
    // max-width cap so it can actually use the extra space.
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.type = 'button';
    fullscreenBtn.className = 'graph-fullscreen-btn';
    fullscreenBtn.title = 'Toggle fullscreen';
    fullscreenBtn.textContent = '⛶';
    fullscreenBtn.addEventListener('click', function() {
        if (document.fullscreenElement === wrapper) {
            document.exitFullscreen();
        } else {
            wrapper.requestFullscreen();
        }
    });
    wrapper.appendChild(fullscreenBtn);

    applyScale();
}

// The points= string for one combo's polygon, vertices sorted by angle
// around their own centroid first so the shape traces a simple outline
// instead of a self-intersecting star. Pulled out of drawComboShapes so a
// drag (renderPairingNetwork) can recompute just this after moving a node,
// without rebuilding the whole shape.
function comboPolygonPoints(ingredients, positions) {
    const pts = ingredients.map(function(name) { return positions[name]; });
    const cx = pts.reduce(function(sum, p) { return sum + p.x; }, 0) / pts.length;
    const cy = pts.reduce(function(sum, p) { return sum + p.y; }, 0) / pts.length;
    const ordered = ingredients.slice().sort(function(a, b) {
        const pa = positions[a], pb = positions[b];
        return Math.atan2(pa.y - cy, pa.x - cx) - Math.atan2(pb.y - cy, pb.x - cx);
    });
    return ordered.map(function(name) {
        return positions[name].x + ',' + positions[name].y;
    }).join(' ');
}

// Draws one closed shape per 3+ ingredient combo - fill only, colored by
// rating (grey if it's an unrated idea), no border - the shape's own
// pairwise sides are already drawn as real edges (see renderPairingNetwork,
// which layers these underneath), each independently grey-dotted or
// rating-colored depending on whether *that specific pair* has also been
// brewed alone, so a stroke here would just be a second, redundant outline
// on top of them. Appends each polygon to svg and records it into
// shapesByNode for the hover-highlight/drag.
function drawComboShapes(svg, combos, positions, shapesByNode) {
    combos.forEach(function(combo) {
        const rgb = combo.rating ? ratingRgb(combo.rating) : [176, 176, 176];
        const color = rgbToCss(rgb);

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', comboPolygonPoints(combo.ingredients, positions));
        polygon.setAttribute('class', 'combo-shape');
        polygon.setAttribute('fill', color);
        polygon.setAttribute('stroke', 'none');
        // data-tooltip rather than a nested <title> element - SVG's own
        // native tooltip can't be intercepted/restyled by tooltip.js the
        // way a title *attribute* can.
        polygon.setAttribute('data-tooltip', combo.name + (combo.rating ? ' — ' + combo.rating + '/10' : ' — idea, not rated yet'));

        polygon.addEventListener('click', function() {
            window.location.href = comboDetailUrl(combo.ingredients);
        });
        svg.appendChild(polygon);

        combo.ingredients.forEach(function(name) {
            if (!shapesByNode[name]) shapesByNode[name] = [];
            shapesByNode[name].push({ el: polygon, relatedNames: combo.ingredients });
        });
    });
}

function renderComboViz() {
    const container = document.getElementById('multi-ingredient-list');
    container.innerHTML = '';
    const sortControls = document.getElementById('combo-sort-controls');

    const multi = combinations.filter(function(combo) { return combo.ingredients.length > 2; });
    if (multi.length === 0) {
        sortControls.style.display = 'none';
        return;
    }
    sortControls.style.display = 'flex';

    const heading = document.createElement('h2');
    heading.textContent = 'Combos with 3+ ingredients';
    container.appendChild(heading);

    renderComboCards(multi);
}

// Every logged combo, sortable by clicking any column heading - the arrow
// shown in the active heading indicates direction (see setRatingTableSort).
// Unrated combos always sort last regardless of direction when sorting by
// rating, same invariant as getOrderedCombos elsewhere on this page.
const RATING_TABLE_COLUMNS = [
    { key: 'rating', label: 'Rating' },
    { key: 'name', label: 'Name' },
    { key: 'method', label: 'Method' },
    { key: 'ingredients', label: 'Ingredients' }
];
const RATING_TABLE_METHOD_ORDER = { hot: 0, cold: 1, stovetop: 2 };

let ratingTableSortKey = 'rating';
let ratingTableSortDir = 'desc'; // 'asc' | 'desc'

// Live text filter, typed into the search box above the table - matches if
// *any* of the combo's ingredients contains the query (so searching
// "hibiscus" surfaces every combo containing "Hibiscus Teabag", etc.), not
// the combo's own name/description.
let ratingTableSearchQuery = '';

function matchesRatingTableSearch(combo, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return combo.ingredients.some(function(name) { return name.toLowerCase().includes(q); });
}

// Filter row above the table - all four narrow the same list down together
// (AND, not OR), on top of whatever the search box above already matched.
// 'all'/0 are each dimension's "off" state.
let ratingTableFilterMethod = 'all'; // 'all' | 'hot' | 'cold' | 'stovetop'
let ratingTableFilterStarredOnly = false;
let ratingTableFilterMinRating = 0; // 0 = no minimum
let ratingTableFilterCategory = 'all';

function ratingTableFiltersActive() {
    return ratingTableFilterMethod !== 'all' || ratingTableFilterStarredOnly ||
        ratingTableFilterMinRating > 0 || ratingTableFilterCategory !== 'all';
}

function matchesRatingTableFilters(combo) {
    if (ratingTableFilterMethod !== 'all' && (combo.temperature || 'hot') !== ratingTableFilterMethod) return false;
    if (ratingTableFilterStarredOnly && !combo.starred) return false;
    if (ratingTableFilterMinRating > 0 && (!combo.rating || combo.rating < ratingTableFilterMinRating)) return false;
    if (ratingTableFilterCategory !== 'all' && primaryCategoryFor(combo) !== ratingTableFilterCategory) return false;
    return true;
}

function compareByRatingTableKey(a, b, key, dir) {
    const sign = dir === 'desc' ? -1 : 1;

    if (key === 'name') return sign * alphabeticalCompare(a.name, b.name);

    if (key === 'method') {
        const ma = RATING_TABLE_METHOD_ORDER[a.temperature] !== undefined ? RATING_TABLE_METHOD_ORDER[a.temperature] : 0;
        const mb = RATING_TABLE_METHOD_ORDER[b.temperature] !== undefined ? RATING_TABLE_METHOD_ORDER[b.temperature] : 0;
        if (ma !== mb) return sign * (ma - mb);
        return sign * alphabeticalCompare(a.name, b.name);
    }

    if (key === 'ingredients') {
        return sign * alphabeticalCompare(a.ingredients.join(', '), b.ingredients.join(', '));
    }

    // 'rating' - the null-last placement never flips, only the order among
    // rated combos does, so "lowest to highest" doesn't mean unrated jumps
    // to the top.
    const ratingA = a.rating || null;
    const ratingB = b.rating || null;
    if (ratingA === null && ratingB === null) return alphabeticalCompare(a.name, b.name);
    if (ratingA === null) return 1;
    if (ratingB === null) return -1;
    if (ratingA !== ratingB) return sign * (ratingA - ratingB);
    return alphabeticalCompare(a.name, b.name);
}

function getSortedRatingTableCombos() {
    const list = combinations.slice();
    list.sort(function(a, b) {
        return compareByRatingTableKey(a, b, ratingTableSortKey, ratingTableSortDir);
    });
    return list;
}

// Clicking the already-active column flips its direction; clicking a
// different column switches to it - rating defaults to highest-first
// (matching this view's original behavior), everything else to A-Z first.
function setRatingTableSort(key) {
    if (ratingTableSortKey === key) {
        ratingTableSortDir = ratingTableSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        ratingTableSortKey = key;
        ratingTableSortDir = key === 'rating' ? 'desc' : 'asc';
    }
    renderCombosByRating();
}

function renderCombosByRating() {
    const container = document.getElementById('rating-list');
    container.innerHTML = '';

    if (combinations.length === 0) return;

    const heading = document.createElement('h2');
    heading.textContent = '⭐ All combos by rating';
    container.appendChild(heading);

    // Full teardown/rebuild on every keystroke (same as everywhere else in
    // this file), so focus/cursor position have to be explicitly restored
    // afterward - otherwise typing a second character would find the input
    // already gone.
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'rating-table-search-input';
    searchInput.placeholder = '🔍 Search ingredients...';
    searchInput.value = ratingTableSearchQuery;
    searchInput.addEventListener('input', function() {
        ratingTableSearchQuery = searchInput.value;
        const cursor = searchInput.selectionStart;
        renderCombosByRating();
        const newInput = document.querySelector('#rating-list .rating-table-search-input');
        if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(cursor, cursor);
        }
    });
    container.appendChild(searchInput);

    // Filter row - method/starred/min-rating/category, all AND'd together
    // on top of the search box above. Buttons/selects don't need the
    // refocus dance the search input does above (each change is a discrete
    // click, not continuous typing), so this just re-renders plainly.
    const filterRow = document.createElement('div');
    filterRow.className = 'rating-table-filter-row';

    const methodFilterGroup = document.createElement('div');
    methodFilterGroup.className = 'rating-table-filter-group';
    [['all', 'All'], ['hot', '🔥'], ['cold', '❄️'], ['stovetop', '🍳']].forEach(function(pair) {
        const btn = document.createElement('button');
        btn.className = 'sort-toggle-btn';
        btn.textContent = pair[1];
        btn.title = pair[0] === 'all' ? 'All methods' : pair[1];
        btn.classList.toggle('active', ratingTableFilterMethod === pair[0]);
        btn.addEventListener('click', function() {
            ratingTableFilterMethod = pair[0];
            renderCombosByRating();
        });
        methodFilterGroup.appendChild(btn);
    });
    filterRow.appendChild(methodFilterGroup);

    const starredBtn = document.createElement('button');
    starredBtn.className = 'sort-toggle-btn';
    starredBtn.textContent = '⭐ Starred only';
    starredBtn.classList.toggle('active', ratingTableFilterStarredOnly);
    starredBtn.addEventListener('click', function() {
        ratingTableFilterStarredOnly = !ratingTableFilterStarredOnly;
        renderCombosByRating();
    });
    filterRow.appendChild(starredBtn);

    const minRatingSelect = document.createElement('select');
    minRatingSelect.className = 'rating-table-filter-select';
    minRatingSelect.title = 'Minimum rating';
    for (let r = 0; r <= 10; r++) {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r === 0 ? 'Any rating' : r + '+/10';
        if (r === ratingTableFilterMinRating) opt.selected = true;
        minRatingSelect.appendChild(opt);
    }
    minRatingSelect.addEventListener('change', function() {
        ratingTableFilterMinRating = Number(minRatingSelect.value);
        renderCombosByRating();
    });
    filterRow.appendChild(minRatingSelect);

    const categorySelect = document.createElement('select');
    categorySelect.className = 'rating-table-filter-select';
    categorySelect.title = 'Category';
    const allCategoriesOpt = document.createElement('option');
    allCategoriesOpt.value = 'all';
    allCategoriesOpt.textContent = 'All categories';
    if (ratingTableFilterCategory === 'all') allCategoriesOpt.selected = true;
    categorySelect.appendChild(allCategoriesOpt);
    getCategories().forEach(function(cat) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === ratingTableFilterCategory) opt.selected = true;
        categorySelect.appendChild(opt);
    });
    categorySelect.addEventListener('change', function() {
        ratingTableFilterCategory = categorySelect.value;
        renderCombosByRating();
    });
    filterRow.appendChild(categorySelect);

    if (ratingTableFiltersActive()) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'sort-toggle-btn';
        clearBtn.textContent = '✕ Clear filters';
        clearBtn.addEventListener('click', function() {
            ratingTableFilterMethod = 'all';
            ratingTableFilterStarredOnly = false;
            ratingTableFilterMinRating = 0;
            ratingTableFilterCategory = 'all';
            renderCombosByRating();
        });
        filterRow.appendChild(clearBtn);
    }

    container.appendChild(filterRow);

    const filtered = getSortedRatingTableCombos().filter(function(combo) {
        return matchesRatingTableSearch(combo, ratingTableSearchQuery) && matchesRatingTableFilters(combo);
    });

    if (filtered.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'graphs-empty';
        empty.textContent = ratingTableSearchQuery
            ? 'No combos match "' + ratingTableSearchQuery + '".'
            : 'No combos match these filters.';
        container.appendChild(empty);
        return;
    }

    const table = document.createElement('table');
    table.className = 'rating-table';

    const headerRow = document.createElement('tr');
    RATING_TABLE_COLUMNS.forEach(function(col) {
        const th = document.createElement('th');
        th.className = 'rating-table-sortable';
        th.title = 'Sort by ' + col.label;
        th.appendChild(document.createTextNode(col.label));
        if (ratingTableSortKey === col.key) {
            const arrow = document.createElement('span');
            arrow.className = 'rating-table-sort-arrow';
            arrow.textContent = ratingTableSortDir === 'asc' ? ' ▲' : ' ▼';
            th.appendChild(arrow);
        }
        th.addEventListener('click', function() { setRatingTableSort(col.key); });
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    filtered.forEach(function(combo) {
        const tr = document.createElement('tr');
        tr.title = 'View notes';
        tr.addEventListener('click', function() {
            window.location.href = comboDetailUrl(combo.ingredients);
        });

        const ratingCell = document.createElement('td');
        ratingCell.textContent = (combo.rating ? combo.rating + '/10' : 'N/A') + (combo.starred ? ' ⭐' : '');
        tr.appendChild(ratingCell);

        const nameCell = document.createElement('td');
        nameCell.textContent = combo.name;
        tr.appendChild(nameCell);

        const methodCell = document.createElement('td');
        // Combos saved before the Hot/Cold feature existed have no
        // temperature field - treat those as "hot", same rule as everywhere
        // else this data gets read.
        methodCell.textContent = combo.temperature === 'cold' ? '❄️' : combo.temperature === 'stovetop' ? '🍳' : '🔥';
        tr.appendChild(methodCell);

        const ingredientsCell = document.createElement('td');
        ingredientsCell.textContent = combo.ingredients.join(', ');
        tr.appendChild(ingredientsCell);

        table.appendChild(tr);
    });

    container.appendChild(table);
}

// ===== Graphs tab =====
// Two views: a preference scatter (which ingredients you actually reach
// for, and how well they rate) and a "Pairing outcomes" network - every
// suggested 2-ingredient pairing as an edge, plus every 3+ ingredient combo
// as a triangle/polygon layered on top (see renderPairingNetwork) - each
// colored by how it actually turned out. A combo's triangle can show even
// when one of its own internal pairs was never separately suggested/tried
// (no line drawn for that pair specifically, but the shape still is).
// Deliberately unfiltered, unlike the cauldron's own Potential pairings
// widget (see pairingSuggestionAllowed in script.js), which hides a
// suggestion once it's been tried and scored below 7 - this view's whole
// point is to show the full picture, misses included.

// How many *tried* combos an ingredient shows up in, and its average
// rating among the ones that got one - the raw material for the
// preference scatter.
function getIngredientStats(name) {
    const tried = combinations.filter(function(combo) {
        return combo.ingredients.includes(name) && comboIsTried(combo);
    });
    const rated = tried.filter(function(combo) { return combo.rating; });
    const avgRating = rated.length > 0
        ? rated.reduce(function(sum, c) { return sum + c.rating; }, 0) / rated.length
        : null;
    return { timesBrewed: tried.length, avgRating: avgRating };
}

// A deterministic small offset from an ingredient's name, so two
// ingredients that land on the exact same (frequency, rating) point don't
// draw as one indistinguishable dot.
function hashJitter(str, magnitude) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    const a = ((Math.abs(hash) % 1000) / 1000) - 0.5;
    const b = ((Math.abs(hash >> 8) % 1000) / 1000) - 0.5;
    return { x: a * magnitude * 2, y: b * magnitude * 2 };
}

function getPreferenceScatterData() {
    return getAllIngredientNames()
        .filter(function(name) {
            return graphsFilterCategory === 'all' || categoryOfIngredient(name) === graphsFilterCategory;
        })
        .map(function(name) {
            const stats = getIngredientStats(name);
            return {
                name: name,
                category: categoryOfIngredient(name),
                timesBrewed: stats.timesBrewed,
                avgRating: stats.avgRating
            };
        })
        .filter(function(d) { return d.timesBrewed > 0 && d.avgRating !== null; });
}

function renderPreferenceScatter() {
    const container = document.getElementById('graphs-area');
    const data = getPreferenceScatterData();

    if (data.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'graphs-empty';
        empty.textContent = graphsFilterCategory !== 'all'
            ? 'Nothing rated yet in this category.'
            : 'Nothing rated yet - brew and rate a few things to see your preferences here.';
        container.appendChild(empty);
        return;
    }

    const width = 640, height = 460;
    const padLeft = 46, padBottom = 40, padTop = 16, padRight = 24;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const maxFreq = Math.max.apply(null, data.map(function(d) { return d.timesBrewed; }));
    const xMax = Math.max(maxFreq, 1);

    // The y axis used to always run 0-10, which crushed every point into the
    // top sliver once nothing's actually rated below ~6 - starting instead
    // at the floor of whatever the lowest real average is (never hardcoded,
    // so a future rock-bottom ingredient just widens the axis back out on
    // its own) spreads the same data across the full plot height.
    const minAvg = Math.min.apply(null, data.map(function(d) { return d.avgRating; }));
    const yMin = Math.min(9, Math.max(0, Math.floor(minAvg)));
    const yRange = 10 - yMin;

    function xPos(freq) { return padLeft + (freq / xMax) * plotW; }
    function yPos(rating) { return padTop + plotH - ((rating - yMin) / yRange) * plotH; }

    const clipId = 'graph-icon-clip-' + Date.now() + '-' + Math.floor(Math.random() * 100000);

    // renderGraphsArea (not this function directly) so the container gets
    // cleared before redrawing - otherwise toggling the mode would just
    // stack a second copy on top of the first.
    const toggle = buildGraphModeToggle(function() { renderGraphsArea(); });
    container.appendChild(toggle);

    const wrapper = document.createElement('div');
    wrapper.id = 'graphs-svg-wrapper';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'graphs-svg');
    addGraphIconClipDef(svg, clipId);

    // Horizontal gridlines + labels, from yMin up to 10 - every point once
    // the (now often narrower) range fits comfortably, every other point
    // otherwise, same spirit as the old fixed 0-10/step-2 version.
    const yTickStep = yRange <= 6 ? 1 : 2;
    for (let r = yMin; r <= 10; r += yTickStep) {
        const y = yPos(r);
        const gridline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        gridline.setAttribute('x1', padLeft);
        gridline.setAttribute('x2', width - padRight);
        gridline.setAttribute('y1', y);
        gridline.setAttribute('y2', y);
        gridline.setAttribute('class', 'graph-gridline');
        svg.appendChild(gridline);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', padLeft - 8);
        label.setAttribute('y', y + 4);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('class', 'graph-axis-label');
        label.textContent = r;
        svg.appendChild(label);
    }

    // X axis ticks - every integer if there aren't many, otherwise spaced
    // out so labels don't collide.
    const xTickStep = xMax <= 10 ? 1 : Math.ceil(xMax / 10);
    for (let f = 0; f <= xMax; f += xTickStep) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', xPos(f));
        label.setAttribute('y', height - padBottom + 18);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'graph-axis-label');
        label.textContent = f;
        svg.appendChild(label);
    }

    // Axis line
    const axisLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    axisLine.setAttribute('d', 'M ' + padLeft + ' ' + padTop + ' L ' + padLeft + ' ' + (height - padBottom) +
        ' L ' + (width - padRight) + ' ' + (height - padBottom));
    axisLine.setAttribute('class', 'graph-axis-line');
    svg.appendChild(axisLine);

    const xTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xTitle.setAttribute('x', padLeft + plotW / 2);
    xTitle.setAttribute('y', height - 4);
    xTitle.setAttribute('text-anchor', 'middle');
    xTitle.setAttribute('class', 'graph-axis-title');
    xTitle.textContent = 'Times brewed →';
    svg.appendChild(xTitle);

    const yTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yTitle.setAttribute('x', -(padTop + plotH / 2));
    yTitle.setAttribute('y', 14);
    yTitle.setAttribute('text-anchor', 'middle');
    yTitle.setAttribute('class', 'graph-axis-title');
    yTitle.setAttribute('transform', 'rotate(-90)');
    yTitle.textContent = 'Average rating →';
    svg.appendChild(yTitle);

    data.forEach(function(d) {
        const jitter = hashJitter(d.name, 5);
        const pos = {
            x: xPos(d.timesBrewed) + jitter.x,
            y: yPos(d.avgRating) + jitter.y
        };

        const node = buildGraphNodeSvg(d.name, pos, graphNodeMode, clipId);
        node.setAttribute('data-tooltip', d.name + ' — brewed ' + d.timesBrewed + '× , avg ' + (Math.round(d.avgRating * 10) / 10) + '/10');
        svg.appendChild(node);
    });

    wrapper.appendChild(svg);
    makeSvgZoomable(wrapper, svg);
    container.appendChild(wrapper);
    container.appendChild(buildCategoryLegend(data.map(function(d) { return d.name; })));
}

// Every distinct ingredient pair mentioned in pairings.json (in either
// direction - it's recorded per-ingredient, not as a symmetric pair),
// limited to names that are still real, current ingredients.
function buildPairingEdges() {
    const validNames = new Set(getAllIngredientNames());
    const edges = [];
    const seenEdges = new Set();
    Object.keys(pairings).forEach(function(a) {
        if (!validNames.has(a)) return;
        (pairings[a] || []).forEach(function(b) {
            if (!validNames.has(b)) return;
            const key = [a, b].sort().join('|');
            if (!seenEdges.has(key)) {
                seenEdges.add(key);
                edges.push([a, b]);
            }
        });
    });
    return edges;
}

// Caches the last computed layout for the Pairing outcomes graph, keyed by
// what's actually IN the graph (see pairingLayoutKey) - re-rendering for an
// unrelated reason (switching Word/Icon mode, resizing the tab) reuses it
// instead of recomputing, which is what stopped the graph from visibly
// "jumping" on every button press: layoutForceGraph's own starting circle
// is deterministic, but re-running the physics from scratch each time
// still doesn't converge to *pixel-identical* positions. Dragging a node
// mutates this cache's positions object directly, so a manually-placed
// node stays put across those same re-renders too - only actual data
// changes (a new pairing, a new combo) or the Shuffle button invalidate it.
let cachedPairingLayout = null; // { key, positions }

function pairingLayoutKey(names, edges, multiCombos) {
    const edgeKey = edges.map(function(e) { return e.slice().sort().join('|'); }).sort().join(',');
    const comboKey = multiCombos.map(function(c) { return c.ingredients.slice().sort().join('+'); }).sort().join(',');
    return names.slice().sort().join(',') + '::' + edgeKey + '::' + comboKey;
}

function renderPairingNetwork() {
    const container = document.getElementById('graphs-area');
    let edges = buildPairingEdges();
    // 3+ combos layer in as triangles (or bigger shapes) alongside the
    // pairwise edges - e.g. ginger+barley+jujube shows as a triangle because
    // all three were brewed together, *and* draws a barley-jujube edge even
    // if that exact pair was never separately suggested (see allPairEdges
    // below) - if the three tasted good together, that pair's a reasonable
    // potential pairing in its own right.
    let multiCombos = combinations.filter(function(combo) { return combo.ingredients.length > 2; });

    let names = [];
    const seenNames = new Set();
    edges.forEach(function(edge) {
        edge.forEach(function(name) {
            if (!seenNames.has(name)) { seenNames.add(name); names.push(name); }
        });
    });
    multiCombos.forEach(function(combo) {
        combo.ingredients.forEach(function(name) {
            if (!seenNames.has(name)) { seenNames.add(name); names.push(name); }
        });
    });

    if (graphsFilterCategory !== 'all') {
        const allowed = new Set(names.filter(function(name) {
            return categoryOfIngredient(name) === graphsFilterCategory;
        }));
        names = names.filter(function(name) { return allowed.has(name); });
        edges = edges.filter(function(e) { return allowed.has(e[0]) && allowed.has(e[1]); });
        multiCombos = multiCombos.filter(function(combo) {
            return combo.ingredients.every(function(n) { return allowed.has(n); });
        });
    }

    if (names.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'graphs-empty';
        empty.textContent = graphsFilterCategory !== 'all'
            ? 'No potential pairings in this category yet.'
            : 'No potential pairings recorded yet - add some from the cauldron\'s suggestions first.';
        container.appendChild(empty);
        return;
    }

    const width = 640, height = 460;
    // Every pair actually drawn as a line: explicitly recorded pairings,
    // plus every pair implied by a 3+ combo's own ingredients (if three
    // things tasted good together, each pair inside that combo is a
    // reasonable potential pairing too - see drawComboShapes, which leaves
    // the combo shape itself unbordered specifically so these carry that
    // information instead). Also drives the layout - a combo's own
    // ingredients would otherwise land nowhere near each other if that
    // exact pair was never separately suggested.
    const comboCoOccurrenceEdges = buildComboEdges(multiCombos);
    const allPairEdgeKeys = new Set();
    const allPairEdges = [];
    edges.concat(comboCoOccurrenceEdges).forEach(function(edge) {
        const key = edge.slice().sort().join('|');
        if (!allPairEdgeKeys.has(key)) {
            allPairEdgeKeys.add(key);
            allPairEdges.push(edge);
        }
    });

    const layoutKey = pairingLayoutKey(names, edges, multiCombos);
    let positions;
    if (cachedPairingLayout && cachedPairingLayout.key === layoutKey) {
        positions = cachedPairingLayout.positions;
    } else {
        positions = layoutForceGraph(allPairEdges, names, width, height, false);
        cachedPairingLayout = { key: layoutKey, positions: positions };
    }
    const clipId = 'graph-icon-clip-' + Date.now() + '-' + Math.floor(Math.random() * 100000);

    // renderGraphsArea (not this function directly) so the container gets
    // cleared before redrawing - otherwise toggling the mode would just
    // stack a second copy on top of the first.
    const toggle = buildGraphModeToggle(function() { renderGraphsArea(); });
    container.appendChild(toggle);

    const shuffleRow = document.createElement('div');
    shuffleRow.className = 'combo-viz-toggle';
    const shuffleBtn = document.createElement('button');
    shuffleBtn.type = 'button';
    shuffleBtn.className = 'sort-toggle-btn';
    shuffleBtn.textContent = '🔀 Shuffle layout';
    shuffleBtn.title = 'Not liking this arrangement? Try another.';
    shuffleBtn.addEventListener('click', function() {
        cachedPairingLayout = { key: layoutKey, positions: layoutForceGraph(allPairEdges, names, width, height, true) };
        renderGraphsArea();
    });
    shuffleRow.appendChild(shuffleBtn);
    container.appendChild(shuffleRow);

    const wrapper = document.createElement('div');
    wrapper.id = 'graphs-svg-wrapper';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'graphs-svg');
    addGraphIconClipDef(svg, clipId);

    // shapesByNode tracks which shape(s) - edges and/or combo polygons -
    // each ingredient touches, for the hover-highlight.
    const shapesByNode = {};
    names.forEach(function(name) { shapesByNode[name] = []; });

    // Combo triangles first, at the bottom - pairwise edges and nodes both
    // draw on top of them.
    drawComboShapes(svg, multiCombos, positions, shapesByNode);

    // Lines next, under the nodes - green-to-red by average rating for
    // pairings that have actually been brewed on their own, grey and dashed
    // for ones that are still just a suggestion (recorded, or implied by a
    // 3+ combo - allPairEdges covers both, see its own comment above).
    allPairEdges.forEach(function(edge) {
        const a = edge[0], b = edge[1];
        const matches = findPairMatches(a, b);
        const tried = matches.some(comboIsTried);
        const avgRating = tried ? averageRatingOf(matches) : null;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', positions[a].x);
        line.setAttribute('y1', positions[a].y);
        line.setAttribute('x2', positions[b].x);
        line.setAttribute('y2', positions[b].y);
        line.setAttribute('class', 'pairing-edge');

        if (avgRating !== null) {
            line.setAttribute('stroke', rgbToCss(ratingRgb(avgRating)));
        } else {
            line.setAttribute('stroke', 'rgb(176,176,176)');
            line.setAttribute('stroke-dasharray', '4 3');
        }

        line.setAttribute('data-tooltip', a + ' + ' + b + (avgRating !== null
            ? ' — avg ' + (Math.round(avgRating * 10) / 10) + '/10'
            : ' — suggested, not brewed yet'));

        line.addEventListener('click', function() {
            window.location.href = tried ? comboDetailUrl([a, b]) : cauldronUrl([a, b]);
        });

        svg.appendChild(line);

        shapesByNode[a].push({ el: line, relatedNames: [a, b] });
        shapesByNode[b].push({ el: line, relatedNames: [a, b] });
    });

    const nodeElements = {};
    names.forEach(function(name) {
        const node = buildGraphNodeSvg(name, positions[name], graphNodeMode, clipId);
        nodeElements[name] = node;
        svg.appendChild(node);
    });
    wireGraphHoverHighlight(nodeElements, shapesByNode);
    wireNodeDragging(svg, width, height, positions, nodeElements, shapesByNode);

    wrapper.appendChild(svg);
    makeSvgZoomable(wrapper, svg);
    container.appendChild(wrapper);
    container.appendChild(buildCategoryLegend(names));
}

function renderGraphsArea() {
    const container = document.getElementById('graphs-area');
    container.innerHTML = '';

    // Category filter - shared by both views below, so it stays put and
    // keeps its selection when switching between them.
    const filterRow = document.createElement('div');
    filterRow.className = 'rating-table-filter-row';
    const categorySelect = document.createElement('select');
    categorySelect.className = 'rating-table-filter-select';
    categorySelect.title = 'Category';
    const allCategoriesOpt = document.createElement('option');
    allCategoriesOpt.value = 'all';
    allCategoriesOpt.textContent = 'All categories';
    if (graphsFilterCategory === 'all') allCategoriesOpt.selected = true;
    categorySelect.appendChild(allCategoriesOpt);
    getCategories().forEach(function(cat) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === graphsFilterCategory) opt.selected = true;
        categorySelect.appendChild(opt);
    });
    categorySelect.addEventListener('change', function() {
        graphsFilterCategory = categorySelect.value;
        renderGraphsArea();
    });
    filterRow.appendChild(categorySelect);
    container.appendChild(filterRow);

    const toggle = document.createElement('div');
    toggle.className = 'combo-viz-toggle';
    [['preference', '🌟 My preferences'], ['pairings', '🕸️ Pairing outcomes']].forEach(function(pair) {
        const btn = document.createElement('button');
        btn.className = 'sort-toggle-btn';
        btn.textContent = pair[1];
        btn.classList.toggle('active', graphsView === pair[0]);
        btn.addEventListener('click', function() {
            graphsView = pair[0];
            renderGraphsArea();
        });
        toggle.appendChild(btn);
    });
    container.appendChild(toggle);

    if (graphsView === 'pairings') {
        renderPairingNetwork();
    } else {
        renderPreferenceScatter();
    }
}

// ===== Book tab =====
// Every logged combo (anything with real notes - see comboIsTried), read
// top to bottom like a reference book: grouped under whichever category its
// "primary" ingredient belongs to, alphabetical within each group, with a
// table of contents up top linking straight to each category's section.

// The category a combo is filed under - whichever category its first
// ingredient (in the site's normal category order) belongs to. Same idea as
// combo-detail.js's own divider tab, just picking one category per combo
// instead of per navigation step.
function primaryCategoryFor(combo) {
    const categories = getCategories();
    const sorted = combo.ingredients.slice().sort(function(a, b) {
        const rankA = categories.indexOf(categoryOfIngredient(a));
        const rankB = categories.indexOf(categoryOfIngredient(b));
        return (rankA === -1 ? categories.length : rankA) - (rankB === -1 ? categories.length : rankB);
    });
    return categoryOfIngredient(sorted[0]) || 'Uncategorized';
}

// Live text filter for the Book tab, same idea/pattern as the Rating
// table's own search (matchesRatingTableSearch) - matches if *any* of the
// combo's ingredients contains the query.
let bookSearchQuery = '';

function renderBookArea() {
    const container = document.getElementById('book-area');
    container.innerHTML = '';

    const allEntries = combinations.filter(comboIsTried);
    if (allEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'graphs-empty';
        empty.textContent = 'Nothing logged yet - brew something and add notes to see it here.';
        container.appendChild(empty);
        return;
    }

    // Full teardown/rebuild on every keystroke (same as the Rating table's
    // search box), so focus/cursor position have to be explicitly restored
    // afterward - otherwise typing a second character would find the input
    // already gone.
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'rating-table-search-input';
    searchInput.placeholder = '🔍 Search ingredients...';
    searchInput.value = bookSearchQuery;
    searchInput.addEventListener('input', function() {
        bookSearchQuery = searchInput.value;
        const cursor = searchInput.selectionStart;
        renderBookArea();
        const newInput = document.querySelector('#book-area .rating-table-search-input');
        if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(cursor, cursor);
        }
    });
    container.appendChild(searchInput);

    const entries = allEntries.filter(function(combo) {
        return matchesRatingTableSearch(combo, bookSearchQuery);
    });

    if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'graphs-empty';
        empty.textContent = 'No entries match "' + bookSearchQuery + '".';
        container.appendChild(empty);
        return;
    }

    const categories = getCategories();
    const groups = {};
    categories.forEach(function(cat) { groups[cat] = []; });
    entries.forEach(function(combo) {
        const cat = primaryCategoryFor(combo);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(combo);
    });
    Object.keys(groups).forEach(function(cat) {
        groups[cat].sort(function(a, b) { return alphabeticalCompare(a.name, b.name); });
    });

    // Only categories that actually have an entry get a contents line/
    // section - an empty category is nothing to browse to.
    const populatedCategories = categories.filter(function(cat) { return groups[cat].length > 0; });

    const toc = document.createElement('nav');
    toc.className = 'notes-page book-toc';
    const tocHeading = document.createElement('h2');
    tocHeading.textContent = '📑 Table of Contents';
    toc.appendChild(tocHeading);
    const tocList = document.createElement('ul');
    populatedCategories.forEach(function(cat) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#book-' + encodeURIComponent(cat);
        a.textContent = cat + ' (' + groups[cat].length + ')';
        li.appendChild(a);
        tocList.appendChild(li);
    });
    toc.appendChild(tocList);
    container.appendChild(toc);

    populatedCategories.forEach(function(cat) {
        const section = document.createElement('section');
        section.className = 'notes-page book-section';
        section.id = 'book-' + encodeURIComponent(cat);

        const heading = document.createElement('h2');
        heading.textContent = cat;
        section.appendChild(heading);

        groups[cat].forEach(function(combo) {
            const entry = document.createElement('article');
            entry.className = 'note-item book-entry';
            entry.title = 'View notes';
            entry.addEventListener('click', function() {
                window.location.href = comboDetailUrl(combo.ingredients);
            });

            const h3 = document.createElement('h3');
            const methodEmoji = combo.temperature === 'cold' ? '❄️' : combo.temperature === 'stovetop' ? '🍳' : '🔥';
            h3.textContent = methodEmoji + ' ' + combo.name + (combo.starred ? ' ⭐' : '');
            entry.appendChild(h3);

            const meta = document.createElement('p');
            meta.className = 'note-desc';
            const strong = document.createElement('strong');
            strong.textContent = (combo.rating ? combo.rating + '/10' : 'N/A') + ' — ';
            meta.appendChild(strong);
            meta.appendChild(document.createTextNode(combo.ingredients.join(', ')));
            entry.appendChild(meta);

            if (combo.description) {
                const desc = document.createElement('p');
                desc.className = 'note-desc';
                desc.textContent = combo.description;
                entry.appendChild(desc);
            }

            section.appendChild(entry);
        });

        container.appendChild(section);
    });
}

// ===== Tab bar (Combos [Combo summary/Graphs] / Ratings [Rating table/Book]) =====
// Every panel and sub-panel is rendered up front by the Promise.all above -
// switching tabs only shows/hides them, same pattern as reference.html's
// selectReferenceTab. Combo summary+Graphs and Rating table+Book used to
// be four separate top-level tabs - now each pair shares one tab with its
// own sub-tab bar underneath, mainly so the tab bar itself doesn't wrap
// into a cramped two-line mess on a narrow phone screen.

const LOG_TAB_KEYS = ['summary', 'ratings'];
const SUB_TAB_KEYS = {
    summary: ['summary', 'graphs'],
    ratings: ['table', 'book']
};

// Every hash this page has ever linked to still works, even though
// "graphs" and "book" aren't top-level tabs anymore - each just resolves
// to the right tab+sub-tab combination instead.
const HASH_MAP = {
    summary: { tab: 'summary', subtab: 'summary' },
    graphs: { tab: 'summary', subtab: 'graphs' },
    ratings: { tab: 'ratings', subtab: 'table' },
    book: { tab: 'ratings', subtab: 'book' }
};

function selectLogTab(tab) {
    LOG_TAB_KEYS.forEach(function(key) {
        document.getElementById('log-panel-' + key).hidden = key !== tab;
        document.getElementById('log-tab-' + key).classList.toggle('active', key === tab);
    });
}

function selectSubTab(prefix, subtab) {
    SUB_TAB_KEYS[prefix].forEach(function(key) {
        document.getElementById(prefix + '-subpanel-' + key).hidden = key !== subtab;
        document.getElementById(prefix + '-subtab-' + key).classList.toggle('active', key === subtab);
    });
}

document.querySelectorAll('.tab-btn[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        selectLogTab(btn.dataset.tab);
        history.replaceState(null, '', '#' + btn.dataset.tab);
    });
});

document.querySelectorAll('.tab-btn[data-subtab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        selectSubTab(btn.dataset.prefix, btn.dataset.subtab);
        history.replaceState(null, '', '#' + btn.dataset.subtab);
    });
});

const initialRoute = HASH_MAP[window.location.hash.slice(1)] || HASH_MAP.summary;
selectLogTab(initialRoute.tab);
// Both sub-tab bars get initialized (not just the active tab's) so
// whichever tab you switch to next already shows a sensible default
// instead of whatever state it happened to be left in.
selectSubTab('summary', initialRoute.tab === 'summary' ? initialRoute.subtab : 'summary');
selectSubTab('ratings', initialRoute.tab === 'ratings' ? initialRoute.subtab : 'table');
