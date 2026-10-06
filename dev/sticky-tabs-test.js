// Real-browser test: Save/Cancel bars stay pinned while scrolling, and Notepad tabs can be reordered.
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node sticky-tabs-test.js
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const SRC = path.join(__dirname, '..');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const sha = b => crypto.createHash('sha1').update(b).digest('hex');
const API_DELAY = +process.env.API_DELAY || 0;

// Static "GitHub Pages" snapshot (never changes after deploy) + live "repo" (API) overlay.
function makeWorld() {
    const staticFiles = {}, repo = {};
    (function walk(dir, rel) {
        for (const f of fs.readdirSync(dir)) {
            if (f === '.git' || f === 'node_modules') continue;
            const p = path.join(dir, f), r = rel ? rel + '/' + f : f;
            if (fs.statSync(p).isDirectory()) walk(p, r); else staticFiles[r] = fs.readFileSync(p);
        }
    })(SRC, '');
    // Base state: ingredient "Dried Apple" (not "...Slices") with its icon, no slices icon yet.
    let ing = staticFiles['ingredients.json'].toString().replace('"Dried Apple Slices"', '"Dried Apple"');
    staticFiles['ingredients.json'] = Buffer.from(ing);
    delete staticFiles['Images/dried-apple-slices.png'];
    for (const k of Object.keys(staticFiles)) repo[k] = staticFiles[k]; // repo == same files at deploy time
    return { staticFiles, repo, log: [] };
}

async function run(name, scenario) {
    const world = makeWorld();
    const server = http.createServer((req, res) => {
        const u = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
        if (world.staticFiles[u]) { res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(world.staticFiles[u]); }
        else { res.writeHead(404); res.end(); }
    }).listen(0);
    const port = server.address().port;
    const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', async req => {
        const url = new URL(req.url());
        if (url.host !== 'api.github.com') return req.continue();
        const m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.*))?$/);
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
        if (API_DELAY) await new Promise(r => setTimeout(r, API_DELAY));
        if (!m) return req.respond({ status: 404, headers: cors });
        if (!m[1]) return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        const p = decodeURIComponent(m[1]);
        const raw = (req.headers()['accept'] || '').includes('raw');
        world.log.push(req.method() + ' ' + p);
        if (req.method() === 'GET') {
            if (!world.repo[p]) return req.respond({ status: 404, headers: cors, body: '{}' });
            const buf = world.repo[p];
            if (raw) return req.respond({ status: 200, headers: cors, contentType: 'image/png', body: buf });
            return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sha: sha(buf), content: buf.toString('base64'), encoding: 'base64' }) });
        }
        const body = JSON.parse(req.postData() || '{}');
        if (req.method() === 'PUT') {
            if (world.repo[p] && body.sha !== sha(world.repo[p])) return req.respond({ status: 422, headers: cors, body: '{"message":"sha wasnt supplied"}' });
            world.repo[p] = Buffer.from(body.content, 'base64');
            return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ content: { sha: sha(world.repo[p]) } }) });
        }
        if (req.method() === 'DELETE') {
            if (!world.repo[p]) return req.respond({ status: 404, headers: cors, body: '{}' });
            delete world.repo[p];
            return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        }
        req.respond({ status: 405, headers: cors });
    });
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    const url = `http://localhost:${port}/index.html?owner=o&repo=r&token=t`;
    const pg = scenario.page || 'index.html';
    await page.goto(url.split('/index.html')[0] + '/' + pg + (pg.includes('?') ? '&' : '?') + 'owner=o&repo=r&token=t', { waitUntil: 'networkidle0' });
    const ctx = { page, world, url, port };
    console.log('\n=== ' + name + ' ===');
    try { await scenario(ctx); } catch (e) { console.log('  SCENARIO ERROR', e.message); }
    await browser.close(); server.close();
}


const sleep = ms => new Promise(r => setTimeout(r, ms));
const barTop = (page, sel) => page.evaluate(sel => { const b = document.querySelector(sel); if (!b) return 'NO BAR'; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; }, sel);

(async () => {
    // 1. Ingredients card (scrolls inside itself)
    await run('ingredients edit bar', Object.assign(async ({ page }) => {
        await page.setViewport({ width: 1300, height: 600 });
        await page.evaluate(() => { const t = document.getElementById('toggle-all-btn'); if (t.textContent.includes('Expand')) t.click(); });
        await page.evaluate(() => document.querySelector('.ingredient').scrollIntoView({ block: 'center' }));
        const li = await page.$('.ingredient');
        const box = await li.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.evaluate(() => [...document.querySelectorAll('#context-menu button')].find(b => b.textContent.includes('Rename')).click());
        await sleep(300);
        const sectionTop = await page.evaluate(() => Math.round(document.getElementById('ingredients-panel').getBoundingClientRect().top));
        console.log('  panel top at', sectionTop, '| bar before scrolling:', JSON.stringify(await barTop(page, '#ingredients-panel .edit-actions')));
        await page.evaluate(() => { document.getElementById('ingredients-panel').scrollTop = 2000; });
        await sleep(200);
        console.log('  after scrolling the list to the bottom:', JSON.stringify(await barTop(page, '#ingredients-panel .edit-actions')), '(should sit at the panel top, visible)');
        const clickable = await page.evaluate(() => { const b = document.getElementById('save-edits-btn').getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return el && el.id; });
        console.log('  Save button actually clickable at that spot:', clickable === 'save-edits-btn');
    }, { page: 'index.html' }));

    // 2. Notepad lists (page scrolls)
    await run('notepad edit bar', Object.assign(async ({ page }) => {
        await page.setViewport({ width: 900, height: 400 });
        await page.evaluate(() => { const e = [...document.querySelectorAll('#panel-notes button')].find(b => b.textContent.trim() === 'Edit'); e && e.click(); });
        await sleep(300);
        console.log('  bar before scrolling:', JSON.stringify(await barTop(page, '#panel-notes .edit-actions')));
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(200);
        console.log('  after scrolling to the bottom:', JSON.stringify(await barTop(page, '#panel-notes .edit-actions')), '| header height', await page.evaluate(() => Math.round(document.querySelector('.site-header').getBoundingClientRect().height)), '(bar top should equal it)');
    }, { page: 'reference.html' }));

    // 3. Combo editor (Save/Cancel at the end of a long form)
    await run('combo-detail edit bar', Object.assign(async ({ page }) => {
        await page.setViewport({ width: 700, height: 420 });
        await sleep(800);
        console.log('  page says:', await page.evaluate(() => (document.querySelector('#combo-detail-container, main, body').innerText || '').slice(0, 160).split(String.fromCharCode(10)).join(' / ')));
        await page.evaluate(() => document.querySelector('.reference-remove').click());
        await sleep(300);
        await page.evaluate(() => document.querySelector('.reference-edit-form').scrollIntoView({ block: 'end' }));
        await sleep(200);
        console.log('  bar with the bottom of the form in view (top should equal header height):', JSON.stringify(await barTop(page, '.reference-edit-form .edit-actions')), '| header', await page.evaluate(() => Math.round(document.querySelector('.site-header').getBoundingClientRect().height)));
    }, { page: 'combo-detail.html?ingredient=Dark%20Roast%20Coffee&ingredient=Hazelnut%20Coffee' }));

    // 4. Reordering tabs
    await run('notepad tab reordering', Object.assign(async ({ page, world }) => {
        const order = () => page.evaluate(() => [...document.querySelectorAll('.tab-bar .tab-btn[data-tab]')].map(b => b.dataset.tab));
        console.log('  start:', (await order()).join(' | '));
        await page.evaluate(() => document.getElementById('tab-hard-to-get').click());
        await page.evaluate(() => document.getElementById('tab-move-left').click());
        await sleep(600);
        console.log('  "Hard to get" moved left:', (await order()).join(' | '));
        // drag Notepad onto the right half of the last tab (synthetic HTML5 drag events)
        await page.evaluate(() => {
            const dt = new DataTransfer();
            const from = document.getElementById('tab-notes');
            const keys = [...document.querySelectorAll('.tab-bar .tab-btn[data-tab]')];
            const to = keys[keys.length - 1];
            const r = to.getBoundingClientRect();
            const mk = (type, el, x) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: r.top + 5 }));
            mk('dragstart', from, 0); mk('dragover', to, r.right - 2); mk('drop', to, r.right - 2); mk('dragend', from, 0);
        });
        await sleep(600);
        console.log('  dragged Notepad to the end:', (await order()).join(' | '));
        console.log('  saved in repo:', world.repo['settings.json'] ? world.repo['settings.json'].toString().replace(/\s+/g, '') : 'MISSING');
        await page.goto(page.url(), { waitUntil: 'networkidle0' });
        await sleep(600);
        console.log('  after reload:', (await order()).join(' | '));
        console.log('  buttons disabled state (active tab first/last):', JSON.stringify(await page.evaluate(() => ({ left: document.getElementById('tab-move-left').disabled, right: document.getElementById('tab-move-right').disabled }))));
    }, { page: 'reference.html' }));
})();
