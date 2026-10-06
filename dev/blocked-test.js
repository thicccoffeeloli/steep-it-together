// Real-browser test: blocked pairings (cauldron button + warning, randomizer, matrix).
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node blocked-test.js
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
(async () => {
    let blockedJson = null;
    await run('block from the cauldron + randomizer avoids blocked pairs', Object.assign(async ({ page, world }) => {
        await page.evaluate(() => { clearCauldron(); addToCauldron('Cinnamon Stick'); addToCauldron('Ginger'); });
        await sleep(300);
        const box = () => page.evaluate(() => { const c = document.getElementById('potential-pairings'); const w = c.querySelector('.blocked-warning'); const b = c.querySelector('.block-pair-btn'); return { warning: w ? w.textContent.trim() : null, blockBtn: b ? b.textContent : null, suggestsGinger: [...c.querySelectorAll('.pairing-chip')].some(x => x.textContent.includes('Ginger')) }; });
        console.log('  before:', JSON.stringify(await box()));
        await page.evaluate(() => document.querySelector('.block-pair-btn').click());
        await sleep(1200);
        console.log('  after blocking:', JSON.stringify(await box()));
        console.log('  blocked.json in repo:', world.repo['blocked.json'] && world.repo['blocked.json'].toString());
        // suggestions: with only Cinnamon in the pot, Ginger must not be suggested
        await page.evaluate(() => { clearCauldron(); addToCauldron('Cinnamon Stick'); });
        await sleep(200);
        console.log('  Cinnamon alone - Ginger suggested?', (await box()).suggestsGinger);
        // randomizer: block every pair with Cinnamon, roll 300 times
        const appearances = await page.evaluate(() => {
            getAllIngredientNames().forEach(n => { if (n !== 'Cinnamon Stick') blockedPairs.add(blockedPairKey('Cinnamon Stick', n)); });
            document.getElementById('random-count').value = 2;
            const realBrew = brewBtn.click; brewBtn.click = function() {};
            let hits = 0;
            for (let i = 0; i < 300; i++) { document.getElementById('random-brew-btn').click(); if (cauldronItems.includes('Cinnamon Stick')) hits++; }
            return hits;
        });
        console.log('  300 random 2-ingredient brews with every Cinnamon pair blocked - Cinnamon picked:', appearances, '(expected ~11 if blocking were ignored)');
        // unblock via the warning
        await page.evaluate(() => { blockedPairs = new Set([blockedPairKey('Cinnamon Stick', 'Ginger')]); clearCauldron(); addToCauldron('Cinnamon Stick'); addToCauldron('Ginger'); });
        await sleep(200);
        await page.evaluate(() => [...document.querySelectorAll('.blocked-warning button')][0].click());
        await sleep(1200);
        console.log('  after Unblock:', JSON.stringify(await box()), '| repo:', world.repo['blocked.json'].toString());
    }, { page: 'index.html' }));

    await run('matrix shows and toggles blocked pairs', Object.assign(async ({ page, world }) => {
        await page.evaluate(() => document.getElementById('show-full-matrix-btn').click());
        await sleep(300);
        // right-click the Cinnamon x Ginger cell
        const res = await page.evaluate(() => {
            const table = document.querySelector('.brew-matrix');
            const headers = [...table.rows[0].cells].map(c => c.textContent);
            const row = [...table.rows].find(r => r.cells[0].textContent === 'Cinnamon Stick');
            let col = headers.indexOf('Ginger');
            let cell = row.cells[col];
            if (cell.classList.contains('matrix-cell-skip')) { const r2 = [...table.rows].find(r => r.cells[0].textContent === 'Ginger'); cell = r2.cells[headers.indexOf('Cinnamon Stick')]; }
            cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            return headers.length;
        });
        await sleep(1200);
        const cell = await page.evaluate(() => { const c = document.querySelector('.pair-cell-blocked'); return c ? { text: c.textContent, title: c.title, count: document.querySelectorAll('.pair-cell-blocked').length } : null; });
        console.log('  after right-click:', JSON.stringify(cell), '| repo:', world.repo['blocked.json'] && world.repo['blocked.json'].toString());
        await page.evaluate(() => document.querySelector('.pair-cell-blocked').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
        await sleep(1200);
        console.log('  after right-clicking it again:', await page.evaluate(() => document.querySelectorAll('.pair-cell-blocked').length), 'blocked cells | repo:', world.repo['blocked.json'].toString());
    }, { page: 'log.html' }));
})();
