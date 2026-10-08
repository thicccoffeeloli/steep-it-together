// Real-browser test: the 'Try again' flag (Drink card, combo notes, Book, rating table, matrix).
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node ux2-test.js
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
const tabs = (page, a, b) => page.evaluate((a, b) => { document.getElementById(a).click(); if (b) document.getElementById(b).click(); }, a, b);
const comboUrl = page => page.url().split('/log.html')[0] + '/combo-detail.html?ingredient=Dark%20Roast%20Coffee&ingredient=Hazelnut%20Coffee';

(async () => {
    // ---- 1. pages vs entries ----
    await run('1. page counts', Object.assign(async ({ page }) => {
        await tabs(page, 'log-tab-ratings', 'ratings-subtab-book');
        await sleep(300);
        console.log('  Book heading:', await page.evaluate(() => document.querySelector('.book-toc h2').textContent));
        console.log('  a section line:', await page.evaluate(() => document.querySelector('.book-toc li a').textContent));
        await page.goto(comboUrl(page), { waitUntil: 'networkidle0' });
        console.log('  combo page says:', await page.evaluate(() => document.querySelector('.combo-nav-position').textContent));
    }, { page: 'log.html' }));

    // ---- 2. locked matrix headers ----
    await run('2. matrix header row + first column stay pinned', Object.assign(async ({ page }) => {
        await page.setViewport({ width: 1100, height: 700 });
        await page.evaluate(() => document.getElementById('show-full-matrix-btn').click());
        await sleep(300);
        const geo = () => page.evaluate(() => {
            const w = document.getElementById('matrix-wrapper'), wr = w.getBoundingClientRect();
            const t = document.querySelector('.brew-matrix');
            const topTh = t.rows[0].cells[3].getBoundingClientRect(), leftTh = t.rows[6].cells[0].getBoundingClientRect(), corner = t.rows[0].cells[0].getBoundingClientRect();
            return { scrollTop: Math.round(w.scrollTop), scrollLeft: Math.round(w.scrollLeft), wrapperH: Math.round(wr.height),
                     headerRowTop: Math.round(topTh.top - wr.top), firstColLeft: Math.round(leftTh.left - wr.left), cornerTop: Math.round(corner.top - wr.top), cornerLeft: Math.round(corner.left - wr.left) };
        });
        console.log('  at rest:', JSON.stringify(await geo()));
        await page.evaluate(() => { const w = document.getElementById('matrix-wrapper'); w.scrollTop = 600; w.scrollLeft = 700; });
        await sleep(200);
        console.log('  scrolled 600 down / 700 across:', JSON.stringify(await geo()), '(offsets should be ~0-1)');
        await page.screenshot({ path: 'matrix-locked.png' });
        await page.evaluate(() => { document.getElementById('matrix-wrapper').scrollTop = 0; });
        await page.evaluate(() => document.querySelector('#matrix-area button').click());
        await sleep(200);
        console.log('  category matrix fits its box (no cramped scrolling):', await page.evaluate(() => { const w = document.getElementById('matrix-wrapper'); return w.scrollHeight <= w.clientHeight + 1; }));
    }, { page: 'log.html' }));

    // ---- 3. remembered view ----
    await run('3. back button / back link keeps search, filters, tab, scroll', Object.assign(async ({ page }) => {
        await page.setViewport({ width: 1100, height: 700 });
        await tabs(page, 'log-tab-ratings', 'ratings-subtab-table');
        await sleep(200);
        await page.evaluate(() => { const i = document.querySelector('#ratings-subpanel-table .rating-table-search-input'); i.value = 'coffee'; i.dispatchEvent(new Event('input', { bubbles: true })); });
        await sleep(400);
        await page.evaluate(() => window.scrollTo(0, 260));
        await sleep(400);
        const state = () => page.evaluate(() => ({ page: location.pathname.split('/').pop() + location.hash, search: (document.querySelector('#ratings-subpanel-table .rating-table-search-input') || {}).value, ratingsTab: document.getElementById('log-tab-ratings').classList.contains('active'), tableSubtab: document.getElementById('ratings-subtab-table').classList.contains('active'), scrollY: Math.round(window.scrollY), rows: document.querySelectorAll('.rating-table tr').length - 1 }));
        console.log('  before opening a combo:   ', JSON.stringify(await state()));
        await page.evaluate(() => document.querySelector('.rating-table tr:nth-child(3)').click());
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        console.log('  now on:', page.url().split('/').pop().slice(0, 40));
        await page.goBack({ waitUntil: 'networkidle0' });
        await sleep(900);
        console.log('  after browser Back:       ', JSON.stringify(await state()));

        await page.evaluate(() => document.querySelector('.rating-table tr:nth-child(3)').click());
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        await page.evaluate(() => document.querySelector('a[href^="log.html"]').click());
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        await sleep(900);
        console.log('  after "Back to brew log": ', JSON.stringify(await state()));

        await page.goto(page.url().split('/log.html')[0] + '/settings.html', { waitUntil: 'networkidle0' });
        await page.evaluate(() => document.querySelector('.nav-tag[href="log.html"]').click());
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        await sleep(500);
        console.log('  Log opened from header:   ', JSON.stringify(await state()), '(should be a clean start)');
    }, { page: 'log.html' }));

    // ---- 4. quick toggles ----
    await run('4. star / try again straight from the table, Book and combo page', Object.assign(async ({ page, world }) => {
        const all = () => JSON.parse(world.repo['data.json'].toString());
        const flags = name => all().filter(c => c.name === name).map(c => ({ starred: !!c.starred, tryAgain: !!c.tryAgain }));
        await tabs(page, 'log-tab-ratings', 'ratings-subtab-table');
        await sleep(300);
        const first = await page.evaluate(() => { const tr = document.querySelector('.rating-table tr:nth-child(2)'); return { name: tr.cells[2].textContent, onStar: tr.querySelector('.flag-star').classList.contains('is-on') }; });
        console.log('  first row:', JSON.stringify(first), '| repo before:', JSON.stringify(flags(first.name)));
        await page.evaluate(() => document.querySelector('.rating-table tr:nth-child(2) .flag-star').click());
        await sleep(1500);
        console.log('  clicked star -> still on log page:', page.url().includes('log.html'), '| button on:', await page.evaluate(() => document.querySelector('.rating-table tr:nth-child(2) .flag-star').classList.contains('is-on')), '| repo:', JSON.stringify(flags(first.name)));
        await page.evaluate(() => document.querySelector('.rating-table tr:nth-child(2) .flag-again').click());
        await sleep(1500);
        console.log('  clicked try-again too | repo:', JSON.stringify(flags(first.name)));

        await page.evaluate(() => [...document.querySelectorAll('.sort-toggle-btn')].find(b => b.textContent.includes('Starred only')).click());
        const starredRows = await page.evaluate(() => document.querySelectorAll('.rating-table tr').length - 1);
        await page.evaluate(() => document.querySelector('.rating-table tr:nth-child(2) .flag-star').click());
        await sleep(1500);
        console.log('  with "Starred only": rows', starredRows, '-> after unstarring one:', await page.evaluate(() => document.querySelectorAll('.rating-table tr').length - 1));

        await page.evaluate(() => document.getElementById('ratings-subtab-book').click());
        await sleep(300);
        const tryBefore = all().filter(c => c.tryAgain).length;
        const book = await page.evaluate(() => { const e = document.querySelector('.book-entry'); return { title: e.querySelector('h3').textContent.trim().slice(0, 40), buttons: e.querySelectorAll('.flag-btn').length }; });
        await page.evaluate(() => document.querySelector('.book-entry .flag-again').click());
        await sleep(1500);
        console.log('  Book entry', JSON.stringify(book), '| still on log page:', page.url().includes('log.html'), '| try-again entries in repo:', tryBefore, '->', all().filter(c => c.tryAgain).length);

        await page.goto(comboUrl(page), { waitUntil: 'networkidle0' });
        const pair = () => all().filter(c => c.ingredients.length === 2 && c.ingredients.includes('Dark Roast Coffee') && c.ingredients.includes('Hazelnut Coffee')).map(c => !!c.starred);
        const b = pair();
        await page.evaluate(() => document.querySelector('.note-item .flag-star').click());
        await sleep(1500);
        console.log('  combo page star without opening the editor | before:', JSON.stringify(b), 'after:', JSON.stringify(pair()));
    }, { page: 'log.html' }));
})();
