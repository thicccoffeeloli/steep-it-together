// Generic editable flat list, shared by the Hard to get and Avoid with
// flask tabs on reference.html - they're both "a list of {name,
// description, ...}" with nothing else going on, so one config-driven
// builder covers both instead of writing the same add/edit/delete/
// save/cancel logic twice.
//
// Mirrors the Ingredients panel's edit pattern: a "+" enters edit mode, all
// changes happen in memory, and Save/Cancel either POSTs the whole array or
// throws the in-memory changes away.
function buildReferenceListPage(config) {
    let items = [];
    let backup = null;
    let mode = 'view'; // 'view' | 'edit'

    const container = document.getElementById(config.container);

    // The two built-in lists each have a dedicated endpoint (config.endpoint)
    // and are read/written whole. A user-created tab (see reference.html)
    // has no endpoint of its own - all of those lists live together inside
    // one shared file - so it passes config.load()/config.save(items)
    // instead, and these two just defer to them when present.
    function loadItems() {
        if (config.load) return Promise.resolve(config.load());
        return fetch(config.endpoint).then(function(r) { return r.json(); });
    }

    function saveItems(list) {
        if (config.save) return Promise.resolve(config.save(list));
        return fetch(config.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(list)
        });
    }

    loadItems().then(function(data) {
        items = data;
        render();
    });

    function render() {
        container.innerHTML = '';

        const controls = document.createElement('div');
        controls.className = 'reference-controls';

        if (mode === 'view') {
            const plusBtn = document.createElement('button');
            plusBtn.id = 'edit-btn';
            plusBtn.textContent = 'Edit';
            plusBtn.title = 'Add or edit entries';
            plusBtn.addEventListener('click', function() {
                backup = JSON.parse(JSON.stringify(items));
                mode = 'edit';
                render();
            });
            controls.appendChild(plusBtn);
            container.appendChild(controls);
        } else {
            const actions = document.createElement('div');
            actions.className = 'edit-actions';

            const saveBtn = document.createElement('button');
            saveBtn.id = 'save-edits-btn';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', function() {
                saveItems(items).then(function() {
                    backup = null;
                    mode = 'view';
                    render();
                });
            });

            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancel-edits-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', function() {
                items = backup;
                backup = null;
                mode = 'view';
                render();
            });

            actions.appendChild(saveBtn);
            actions.appendChild(cancelBtn);
            container.appendChild(actions);
        }

        items.forEach(function(item, index) {
            container.appendChild(mode === 'edit' ? buildEditItem(item, index) : buildViewItem(item));
        });

        if (mode === 'edit') {
            container.appendChild(buildAddForm());
        }
    }

    function buildViewItem(item) {
        const article = document.createElement('article');
        article.className = 'note-item';

        config.fields.forEach(function(field, i) {
            const value = item[field.key];
            if (!value) return;

            if (i === 0) {
                const h4 = document.createElement('h4');
                h4.textContent = value;
                article.appendChild(h4);
                return;
            }

            const p = document.createElement('p');
            p.className = 'note-desc';
            if (field.label) {
                const strong = document.createElement('strong');
                strong.textContent = field.label + ': ';
                p.appendChild(strong);
            }
            p.appendChild(document.createTextNode(value));
            article.appendChild(p);
        });

        return article;
    }

    function buildEditItem(item, index) {
        const article = document.createElement('article');
        article.className = 'note-item';

        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-ingredient reference-remove';
        removeBtn.textContent = ' x';
        removeBtn.title = 'Delete entry';
        removeBtn.addEventListener('click', function() {
            items.splice(index, 1);
            render();
        });
        article.appendChild(removeBtn);

        config.fields.forEach(function(field) {
            const wrapper = document.createElement('div');
            wrapper.className = 'reference-edit-field';

            const label = document.createElement('label');
            label.textContent = field.label || 'Name';
            wrapper.appendChild(label);

            const input = field.multiline ? document.createElement('textarea') : document.createElement('input');
            if (!field.multiline) input.type = 'text';
            input.value = item[field.key] || '';
            input.addEventListener('input', function() {
                item[field.key] = input.value;
            });
            wrapper.appendChild(input);

            article.appendChild(wrapper);
        });

        return article;
    }

    function buildAddForm() {
        const form = document.createElement('div');
        form.className = 'reference-add-form';

        const inputs = {};
        config.fields.forEach(function(field) {
            const input = field.multiline ? document.createElement('textarea') : document.createElement('input');
            if (!field.multiline) input.type = 'text';
            input.placeholder = field.label || 'Name';
            inputs[field.key] = input;
            form.appendChild(input);
        });

        const addBtn = document.createElement('button');
        addBtn.textContent = 'Add entry';
        addBtn.addEventListener('click', function() {
            const newItem = {};
            let hasContent = false;
            config.fields.forEach(function(field) {
                const value = inputs[field.key].value.trim();
                newItem[field.key] = value;
                if (value) hasContent = true;
            });
            if (!hasContent) return;
            items.push(newItem);
            render();
        });
        form.appendChild(addBtn);

        return form;
    }
}
