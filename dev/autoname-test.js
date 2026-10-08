// Real-browser test: the 'Try again' flag (Drink card, combo notes, Book, rating table, matrix).
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node autoname-test.js
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
    await run('automatic drink names', Object.assign(async ({ page, world }) => {
        const name = () => page.evaluate(() => document.getElementById('drink-name').value);
        const brew = (items, temp) => page.evaluate((items, temp) => { clearCauldron(); items.forEach(addToCauldron); selectTemp(temp); document.getElementById('brew-btn').click(); }, items, temp);
        const type = text => page.evaluate(t => { const i = document.getElementById('drink-name'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, text);
        const tab = temp => page.evaluate(t => selectTemp(t), temp);
        const saved = () => JSON.parse(world.repo['data.json'].toString());

        await brew(['Green Rooibos Teabag', 'Ginger'], 'hot');
        console.log('  hot 2 ingredients:   ', await name());
        await tab('cold');  console.log('  switch to cold:      ', await name());
        await tab('stovetop'); console.log('  switch to stovetop:  ', await name());
        await brew(['Rooibos Teabag', 'Cardamom Pods', 'Barley tea'], 'cold');
        console.log('  cold 3 ingredients:  ', await name());
        await brew(['Star Anise'], 'stovetop');
        console.log('  stovetop 1 ingredient:', await name());

        // custom name stays when switching method (nothing saved yet)
        await brew(['Green Rooibos Teabag', 'Ginger'], 'hot');
        await type('My ginger snap');
        await tab('cold');
        console.log('  typed a name, then switched method:', await name(), '(should keep it)');
        // clearing it brings the generated one back
        await type('');
        await tab('hot');
        console.log('  cleared it, switched back:         ', await name());

        // saving with the generated name, then the other method's tab
        await brew(['Green Rooibos Teabag', 'Ginger'], 'hot');
        await page.evaluate(() => document.getElementById('save-btn').click());
        await sleep(1800);
        const savedHot = saved().find(c => c.ingredients.length === 2 && c.ingredients.includes('Green Rooibos Teabag') && c.ingredients.includes('Ginger') && (c.temperature || 'hot') === 'hot');
        console.log('  saved entry name:', savedHot && savedHot.name);
        await brew(['Green Rooibos Teabag', 'Ginger'], 'hot');
        await tab('cold');
        console.log('  other method of a generated-name entry:', await name(), '(should be Cold Brew ..., not Hot Steep ...)');

        // saving a custom name, then the other method shares it
        await brew(['Green Rooibos Teabag', 'Lemongrass'], 'hot');
        await type('Winter warmer');
        await page.evaluate(() => document.getElementById('save-btn').click());
        await sleep(1800);
        await tab('cold');
        console.log('  other method of a custom-named entry:  ', await name(), '(shares the custom name)');

        // blank name at save time
        await brew(['Fresh Mint Leaves', 'Lemon Slice'], 'cold');
        await type('   ');
        await page.evaluate(() => document.getElementById('save-btn').click());
        await sleep(1800);
        const blank = saved().find(c => c.ingredients.includes('Fresh Mint Leaves') && c.ingredients.includes('Lemon Slice') && c.temperature === 'cold' && c.ingredients.length === 2);
        console.log('  saved with a blank field ->', blank && blank.name);
    }, { page: 'index.html' }));
})();
