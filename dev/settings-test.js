// Real-browser regression test for the Settings page + default Word/Icon mode.
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node settings-test.js
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
    await page.goto(url.replace('/index.html', '/' + (scenario.page || 'index.html')), { waitUntil: 'networkidle0' });
    const ctx = { page, world, url, port };
    console.log('\n=== ' + name + ' ===');
    try { await scenario(ctx); } catch (e) { console.log('  SCENARIO ERROR', e.message); }
    await browser.close(); server.close();
}


const sleep = ms => new Promise(r => setTimeout(r, ms));
const modeOnMain = page => page.evaluate(() => ({
    iconChips: document.querySelectorAll('.ingredient.icon-mode-chip').length,
    toggleLabel: document.getElementById('display-mode-btn')?.textContent
}));

(async () => {
    // 1. Settings page: pick Word mode, check it was saved to settings.json in the repo.
    const s1 = async ({ page, world }) => {
        console.log('  buttons:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-display-mode]')].map(b => b.dataset.displayMode + (b.classList.contains('active') ? '*' : '')))));
        await page.evaluate(() => document.querySelector('[data-display-mode="word"]').click());
        await sleep(800);
        console.log('  status:', await page.evaluate(() => document.getElementById('settings-status').textContent));
        console.log('  settings.json in repo:', world.repo['settings.json'] ? world.repo['settings.json'].toString().replace(/\s+/g, '') : 'MISSING');
        // export contains settings
        const exp = await page.evaluate(() => fetch('/export').then(r => r.json()).then(j => JSON.stringify(j.settings)));
        console.log('  export.settings:', exp);
        // keep this world for the next page load via localStorage (same page object)
        await page.goto(page.url().replace('settings.html', 'index.html'), { waitUntil: 'networkidle0' });
        await page.evaluate(() => { const b = document.getElementById('toggle-all-btn'); if (b && b.textContent.includes('Expand')) b.click(); });
        console.log('  main page after saving Word:', JSON.stringify(await modeOnMain(page)));
        await page.goto(page.url().replace('index.html', 'log.html') + '#graphs', { waitUntil: 'networkidle0' });
        await page.evaluate(() => [...document.querySelectorAll('#graphs-area button')].find(b => b.textContent.includes('Pairing outcomes')).click());
        console.log('  graph mode buttons (active one marked):', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.combo-viz-toggle .sort-toggle-btn')].filter(b => /Word|Icon/.test(b.textContent)).map(b => b.textContent + (b.classList.contains('active') ? '*' : '')))));
        // back to icon
        await page.goto(page.url().replace('log.html', 'settings.html').split('#')[0], { waitUntil: 'networkidle0' });
        await page.evaluate(() => document.querySelector('[data-display-mode="icon"]').click());
        await sleep(800);
        await page.goto(page.url().replace('settings.html', 'index.html'), { waitUntil: 'networkidle0' });
        await page.evaluate(() => { const b = document.getElementById('toggle-all-btn'); if (b && b.textContent.includes('Expand')) b.click(); });
        console.log('  main page after saving Icon:', JSON.stringify(await modeOnMain(page)));
    };
    s1.page = 'settings.html';
    await run('settings -> main + graphs follow the setting', s1);

    // 2. Reference page: Data tab gone, #data forwards, custom tabs still work.
    const s2 = async ({ page }) => {
        console.log('  tabs:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()))));
        await page.evaluate(() => { window.prompt = () => 'Ideas list'; document.getElementById('tab-add').click(); });
        await sleep(1500);
        console.log('  after adding a tab:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()))));
        await page.goto(page.url().split('#')[0] + '#data', { waitUntil: 'networkidle0' });
        console.log('  #data lands on:', page.url().split('/').pop());
    };
    s2.page = 'reference.html';
    await run('reference page', s2);
})();
