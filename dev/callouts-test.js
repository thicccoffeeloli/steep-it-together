// Real-browser test: the 'Try again' flag (Drink card, combo notes, Book, rating table, matrix).
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node callouts-test.js
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
    await run('Notepad: edit, reload, bold, reset', Object.assign(async ({ page, world }) => {
        const box = () => page.evaluate(() => { const b = document.querySelector('[data-callout-id="notepad-citrus"]'); return { text: b.querySelector('.callout-body').textContent.trim().slice(0, 70), bold: [...b.querySelectorAll('.callout-body strong')].map(s => s.textContent), pencil: !!b.querySelector('.callout-edit-btn') && !b.querySelector('.callout-edit-btn').hidden }; });
        console.log('  original:', JSON.stringify(await box()));
        await page.evaluate(() => document.querySelector('[data-callout-id="notepad-citrus"] .callout-edit-btn').click());
        const editor = await page.evaluate(() => document.querySelector('[data-callout-id="notepad-citrus"] textarea').value);
        console.log('  editor opens with the current text, bold as **:', JSON.stringify(editor.slice(0, 60)));
        await page.evaluate(() => { const t = document.querySelector('[data-callout-id="notepad-citrus"] textarea'); t.value = '🍊 **Zest only!**\nSecond line <img src=x onerror="window.__pwned=1"> and **more bold**.'; });
        await page.evaluate(() => document.querySelector('[data-callout-id="notepad-citrus"] .callout-save').click());
        await sleep(1800);
        const after = await page.evaluate(() => { const b = document.querySelector('[data-callout-id="notepad-citrus"]'); return { html: b.querySelector('.callout-body').innerHTML, imgs: b.querySelectorAll('img').length, pwned: !!window.__pwned }; });
        console.log('  after Save:', JSON.stringify(after));
        console.log('  saved in repo:', JSON.stringify(JSON.parse(world.repo['settings.json'].toString()).callouts));
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(600);
        console.log('  after reload:', JSON.stringify(await box()));
        await page.evaluate(() => document.querySelector('[data-callout-id="notepad-citrus"] .callout-edit-btn').click());
        await page.evaluate(() => [...document.querySelectorAll('[data-callout-id="notepad-citrus"] .callout-actions button')].find(b => b.textContent.includes('Reset')).click());
        await sleep(1800);
        console.log('  after Reset to original:', JSON.stringify(await box()), '| repo callouts:', JSON.stringify(JSON.parse(world.repo['settings.json'].toString()).callouts));
        await page.evaluate(() => document.querySelector('[data-callout-id="hard-to-get-intro"] .callout-edit-btn') && 0);
        console.log('  other notes on this page have a pencil too:', await page.evaluate(() => [...document.querySelectorAll('.note-callout[data-callout-id]')].map(b => b.dataset.calloutId + ':' + !!b.querySelector('.callout-edit-btn')).join(', ')));
    }, { page: 'reference.html' }));

    await run('Settings: edit + cancel', Object.assign(async ({ page, world }) => {
        console.log('  boxes:', await page.evaluate(() => [...document.querySelectorAll('.note-callout[data-callout-id]')].map(b => b.dataset.calloutId).join(', ')));
        await page.evaluate(() => document.querySelector('[data-callout-id="settings-share"] .callout-edit-btn').click());
        await page.evaluate(() => { document.querySelector('[data-callout-id="settings-share"] textarea').value = 'Anything I like.'; });
        await page.evaluate(() => [...document.querySelectorAll('[data-callout-id="settings-share"] .callout-actions button')].find(b => b.textContent === 'Cancel').click());
        console.log('  after Cancel text is the original again:', await page.evaluate(() => document.querySelector('[data-callout-id="settings-share"] .callout-body').textContent.trim().slice(0, 50)));
        await page.evaluate(() => document.querySelector('[data-callout-id="settings-share"] .callout-edit-btn').click());
        await page.evaluate(() => { document.querySelector('[data-callout-id="settings-share"] textarea').value = 'Send this link to a friend.'; });
        await page.evaluate(() => document.querySelector('[data-callout-id="settings-share"] .callout-save').click());
        await sleep(1800);
        console.log('  after Save:', await page.evaluate(() => document.querySelector('[data-callout-id="settings-share"] .callout-body').textContent.trim()), '| display mode setting untouched:', JSON.parse(world.repo['settings.json'].toString()).displayMode);
        const shot = await page.$('[data-callout-id="settings-share"]'); await shot.screenshot({ path: 'callout-edited.png' });
        await page.evaluate(() => document.querySelector('[data-callout-id="settings-data"] .callout-edit-btn').click());
        const sh = await page.$('[data-callout-id="settings-data"]'); await sh.screenshot({ path: 'callout-editing.png' });
    }, { page: 'settings.html' }));
})();
