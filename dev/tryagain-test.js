// Real-browser test: the 'Try again' flag (Drink card, combo notes, Book, rating table, matrix).
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node tryagain-test.js
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
const findCombo = (world, a, b, temp) => JSON.parse(world.repo['data.json'].toString()).find(c => c.ingredients.length === 2 && c.ingredients.includes(a) && c.ingredients.includes(b) && (c.temperature || 'hot') === temp);
(async () => {
    await run('Drink card: mark, save, reload', Object.assign(async ({ page, world, url }) => {
        console.log('  before:', JSON.stringify(findCombo(world, 'Dark Roast Coffee', 'Hazelnut Coffee', 'hot').tryAgain));
        await page.evaluate(() => { clearCauldron(); addToCauldron('Dark Roast Coffee'); addToCauldron('Hazelnut Coffee'); selectTemp('hot'); document.getElementById('brew-btn').click(); });
        await sleep(2500);
        const btn = () => page.evaluate(() => { const b = document.getElementById('drink-tryagain-btn'); return { active: b.classList.contains('active'), name: document.getElementById('drink-name').value }; });
        console.log('  after Brew:', JSON.stringify(await btn()));
        await page.evaluate(() => document.getElementById('drink-tryagain-btn').click());
        console.log('  after clicking 🔁:', JSON.stringify(await btn()));
        const pic = await page.$('.output-picture'); if (pic) await pic.screenshot({ path: 'tryagain-card.png' });
        await page.evaluate(() => document.getElementById('save-btn').click());
        await sleep(2000);
        console.log('  saved entry tryAgain:', findCombo(world, 'Dark Roast Coffee', 'Hazelnut Coffee', 'hot').tryAgain, '| starred kept:', findCombo(world, 'Dark Roast Coffee', 'Hazelnut Coffee', 'hot').starred);
        // a different combo resets the button
        await page.evaluate(() => { clearCauldron(); addToCauldron('Cinnamon Stick'); });
        console.log('  after changing the cauldron:', JSON.stringify(await btn()));
    }, { page: 'index.html' }));

    await run('combo notes page: checkbox + tag', Object.assign(async ({ page, world }) => {
        await page.evaluate(() => document.querySelector('.reference-remove').click());   // ✏️ on the first entry
        await sleep(300);
        const hasBox = await page.evaluate(() => !!document.querySelector('.try-again-label input'));
        await page.evaluate(() => { const b = document.querySelector('.try-again-label input'); b.checked = true; b.dispatchEvent(new Event('change')); });
        await page.evaluate(() => [...document.querySelectorAll('.edit-actions button')].find(b => b.textContent === 'Save').click());
        await sleep(1800);
        const combos = JSON.parse(world.repo['data.json'].toString()).filter(c => c.tryAgain);
        console.log('  checkbox present:', hasBox, '| entries now marked in repo:', combos.map(c => c.name + ' (' + (c.temperature || 'hot') + ')').join(', '));
        console.log('  tag shown on page:', await page.evaluate(() => [...document.querySelectorAll('.try-again-tag')].length));
    }, { page: 'combo-detail.html?ingredient=Dark%20Roast%20Coffee&ingredient=Hazelnut%20Coffee' }));

    await run('log page: Book, rating table filter, matrix', Object.assign(async ({ page }) => {
        const r = await page.evaluate(() => {
            const pair = combinations.find(c => c.ingredients.length === 2 && c.rating);
            pair.tryAgain = true;
            renderBookArea(); renderCombosByRating(); matrixView = 'full'; renderMatrixArea();
            const total = document.querySelectorAll('.rating-table tr').length - 1;
            const btn = [...document.querySelectorAll('.sort-toggle-btn')].find(b => b.textContent.includes('Try again only'));
            btn.click();
            const filtered = document.querySelectorAll('.rating-table tr').length - 1;
            return { marked: pair.name, bookTags: document.querySelectorAll('.book-entry .try-again-tag').length, tableRows: total, afterFilter: filtered,
                     matrixCells: [...document.querySelectorAll('.pair-cell')].filter(td => td.textContent.includes('🔁')).length,
                     keyHasIt: [...document.querySelectorAll('.color-key-label')].some(l => l.textContent === 'Try again') };
        });
        console.log('  ' + JSON.stringify(r));
    }, { page: 'log.html' }));
})();
