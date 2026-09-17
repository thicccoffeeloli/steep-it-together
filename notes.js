// The Notepad: one flat list of sections, each holding free-text entries
// (description, pairing ideas, tasting notes). Same edit pattern as the
// Ingredients panel - a "+" enters edit mode, all changes stay in memory
// until Save, Cancel restores a snapshot taken when editing started.

let notesData = [];
let notesBackup = null;
let notesMode = 'view'; // 'view' | 'edit'
let categoryColors = {}; // category name -> hex color *override*, loaded from category-colors.json - see categoryColorHex

const notesContainer = document.getElementById('notes-container');

Promise.all([
    fetch('/notes').then(function(r) { return r.json(); }),
    fetch('/category-colors').then(function(r) { return r.json(); })
]).then(function(results) {
    notesData = results[0];
    categoryColors = results[1];
    buildNotesPanel();
});

// A palette used to color a Notepad section by name - a section named
// after a real ingredient category (e.g. "Coffee") lines up with that
// category's color everywhere else on the site; any other name still gets
// its own consistent color via the same hash. Kept in sync with the
// identical copy in script.js/log.js/combo-detail.js.
const CATEGORY_PALETTE = [
    '#6b4226', '#4c7a3f', '#b5541d', '#d9a441', '#a68a5b',
    '#5b2a86', '#c0392b', '#2f8f9d', '#7a1f3d', '#6b6155'
];

// A stable hash of the name itself (not any array position) so a section's
// color never shifts just because sections got reordered/renamed elsewhere -
// see the identical reasoning in script.js/log.js. categoryColors holds
// explicit overrides (set via the section right-click menu on the main
// page); anything else falls back to this hashed default.
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

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
        r: parseInt(clean.substring(0, 2), 16),
        g: parseInt(clean.substring(2, 4), 16),
        b: parseInt(clean.substring(4, 6), 16)
    };
}

function categoryPillTextColor(hex) {
    const rgb = hexToRgb(hex);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness > 150 ? '#2e2a24' : '#ffffff';
}

function buildNotesPanel() {
    notesContainer.innerHTML = '';

    const controls = document.createElement('div');
    controls.className = 'reference-controls';

    if (notesMode === 'view') {
        const plusBtn = document.createElement('button');
        plusBtn.id = 'edit-btn';
        plusBtn.textContent = 'Edit';
        plusBtn.title = 'Add or edit entries';
        plusBtn.addEventListener('click', function() {
            notesBackup = JSON.parse(JSON.stringify(notesData));
            notesMode = 'edit';
            buildNotesPanel();
        });
        controls.appendChild(plusBtn);
        notesContainer.appendChild(controls);
    } else {
        const actions = document.createElement('div');
        actions.className = 'edit-actions';

        const saveBtn = document.createElement('button');
        saveBtn.id = 'save-edits-btn';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
            fetch('/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(notesData)
            }).then(function() {
                notesBackup = null;
                notesMode = 'view';
                buildNotesPanel();
            });
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-edits-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
            notesData = notesBackup;
            notesBackup = null;
            notesMode = 'view';
            buildNotesPanel();
        });

        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);
        notesContainer.appendChild(actions);
    }

    notesData.forEach(function(section, index) {
        notesContainer.appendChild(buildSection(section, index));
    });

    if (notesMode === 'edit') {
        notesContainer.appendChild(buildAddSectionForm());
    }
}

function buildSection(section, sectionIndex) {
    const div = document.createElement('div');
    div.className = 'ingredient-section';

    const h3 = document.createElement('h3');
    h3.className = 'note-section-title';
    const sectionColor = categoryColorHex(section.section);
    h3.style.background = sectionColor;
    h3.style.borderColor = sectionColor;
    h3.style.color = categoryPillTextColor(sectionColor);
    h3.appendChild(document.createTextNode(section.section));

    if (notesMode === 'edit') {
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'remove-ingredient';
        deleteBtn.textContent = ' x';
        deleteBtn.title = 'Delete section';
        deleteBtn.addEventListener('click', function() {
            notesData.splice(sectionIndex, 1);
            buildNotesPanel();
        });
        h3.appendChild(deleteBtn);
    }
    div.appendChild(h3);

    section.items.forEach(function(item, itemIndex) {
        div.appendChild(notesMode === 'edit' ? buildItemEdit(section, item, itemIndex) : buildItemView(item));
    });

    if (notesMode === 'edit') {
        div.appendChild(buildAddItemForm(section));
    }

    return div;
}

function buildItemView(item) {
    const article = document.createElement('article');
    article.className = 'note-item';

    const h4 = document.createElement('h4');
    h4.textContent = item.name;
    article.appendChild(h4);

    if (item.description) {
        const p = document.createElement('p');
        p.className = 'note-desc';
        p.textContent = item.description;
        article.appendChild(p);
    }

    if (item.pairs) {
        const p = document.createElement('p');
        p.className = 'note-pairs';
        const strong = document.createElement('strong');
        strong.textContent = 'Pairs well with: ';
        p.appendChild(strong);
        p.appendChild(document.createTextNode(item.pairs));
        article.appendChild(p);
    }

    if (item.notes && item.notes.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'note-notes';
        item.notes.forEach(function(note) {
            const li = document.createElement('li');
            li.textContent = note;
            ul.appendChild(li);
        });
        article.appendChild(ul);
    }

    return article;
}

function buildItemEdit(section, item, itemIndex) {
    const article = document.createElement('article');
    article.className = 'note-item';

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove-ingredient reference-remove';
    removeBtn.textContent = ' x';
    removeBtn.title = 'Delete entry';
    removeBtn.addEventListener('click', function() {
        section.items.splice(itemIndex, 1);
        buildNotesPanel();
    });
    article.appendChild(removeBtn);

    article.appendChild(editField('Name', item, 'name', false));
    article.appendChild(editField('Description', item, 'description', true));
    article.appendChild(editField('Pairs well with', item, 'pairs', false));

    const notesWrapper = document.createElement('div');
    notesWrapper.className = 'reference-edit-field';
    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Notes (one per line)';
    notesWrapper.appendChild(notesLabel);
    const notesTextarea = document.createElement('textarea');
    notesTextarea.value = (item.notes || []).join('\n');
    notesTextarea.addEventListener('input', function() {
        item.notes = notesTextarea.value.split('\n')
            .map(function(line) { return line.trim(); })
            .filter(function(line) { return line.length > 0; });
    });
    notesWrapper.appendChild(notesTextarea);
    article.appendChild(notesWrapper);

    return article;
}

// Builds one labelled input/textarea pair bound directly to item[key].
function editField(labelText, item, key, multiline) {
    const wrapper = document.createElement('div');
    wrapper.className = 'reference-edit-field';

    const label = document.createElement('label');
    label.textContent = labelText;
    wrapper.appendChild(label);

    const input = multiline ? document.createElement('textarea') : document.createElement('input');
    if (!multiline) input.type = 'text';
    input.value = item[key] || '';
    input.addEventListener('input', function() {
        item[key] = input.value;
    });
    wrapper.appendChild(input);

    return wrapper;
}

function buildAddItemForm(section) {
    const form = document.createElement('div');
    form.className = 'reference-add-form';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'New entry name';
    form.appendChild(nameInput);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add entry';
    addBtn.addEventListener('click', function() {
        const name = nameInput.value.trim();
        if (!name) return;
        section.items.push({ name: name, description: '', pairs: '', notes: [] });
        buildNotesPanel();
    });
    form.appendChild(addBtn);

    return form;
}

function buildAddSectionForm() {
    const form = document.createElement('div');
    form.className = 'add-section-form';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'New section name';
    form.appendChild(nameInput);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add section';
    addBtn.addEventListener('click', function() {
        const name = nameInput.value.trim();
        if (!name) return;
        notesData.push({ section: name, items: [] });
        buildNotesPanel();
    });
    form.appendChild(addBtn);

    return form;
}
