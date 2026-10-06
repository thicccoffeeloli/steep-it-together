// Real-browser regression test for the ingredient-icon flows (rename / remove / replace).
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node icons.js [rename|del|update]
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
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('Icon mode'))?.click(); });
    const ctx = { page, world, url, port };
    console.log('\n=== ' + name + ' ===');
    try { await scenario(ctx); } catch (e) { console.log('  SCENARIO ERROR', e.message); }
    await browser.close(); server.close();
}

// ----- helpers -----
const iconState = (page, name) => page.evaluate(n => {
    const li = document.querySelector('.ingredient[data-name="' + CSS.escape(n) + '"]');
    if (!li) return 'NO-LI';
    document.querySelectorAll('.collapsed');
    const img = li.querySelector('img');
    if (!img) return 'NO-IMG';
    return (img.complete && img.naturalWidth ? 'LOADED ' : 'BROKEN ') + img.src.slice(0, 20) + '…' + img.src.split('/').pop().slice(0, 60) + ' w=' + img.naturalWidth;
}, name);
const expandAll = page => page.evaluate(() => document.getElementById('toggle-all-btn')?.textContent.includes('Expand') && document.getElementById('toggle-all-btn').click());
const rightClick = async (page, name) => {
    await expandAll(page);
    await page.evaluate(n => { document.querySelector('.ingredient[data-name="' + CSS.escape(n) + '"]').scrollIntoView(); }, name);
    const box = await (await page.$('.ingredient[data-name="' + name + '"]')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
};
const menuClick = (page, text) => page.evaluate(t => [...document.querySelectorAll('#context-menu button')].find(b => b.textContent.includes(t)).click(), text);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toasts = page => page.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join(' | '));

(async () => {
    const only = process.argv[2];
    const scenarios = {
        async dbg({ page }) {
            await expandAll(page);
            console.log(await page.evaluate(() => ({ patched: displayIconSrc.toString().slice(0,80), fo: Object.keys(localStorage).filter(k=>/force/i.test(k)).map(k=>k+'='+localStorage[k]) })));
        },
        async base({ page }) {
            await expandAll(page);
            console.log('  Dried Apple icon:', await iconState(page, 'Dried Apple'));
        },
        async rename({ page, world }) {
            await expandAll(page);
            console.log('  before:', await iconState(page, 'Dried Apple'));
            await rightClick(page, 'Dried Apple'); await menuClick(page, 'Rename');
            await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
            await page.keyboard.type('Dried Apple Slices'); await page.keyboard.press('Enter');
            await page.click('#save-edits-btn');
            for (const t of [300, 1500, 4000]) { await sleep(t); console.log(`  +${t}ms:`, await iconState(page, 'Dried Apple Slices'), '| toast:', await toasts(page)); }
            console.log('  api log:', world.log.join(', '));
            console.log('  repo has dried-apple-slices.png:', !!world.repo['Images/dried-apple-slices.png']);
        },
        async del({ page, world }) {
            await expandAll(page);
            console.log('  before:', await iconState(page, 'Dried Apple'));
            const t0 = Date.now();
            await rightClick(page, 'Dried Apple'); await menuClick(page, 'Remove icon');
            let last = '';
            while (Date.now() - t0 < 15000) {
                const s = await iconState(page, 'Dried Apple');
                if (s !== last) { console.log(`  +${Date.now() - t0}ms:`, s); last = s; }
                if (s.includes('placeholder')) break;
                await sleep(100);
            }
            console.log('  toast:', await toasts(page)); console.log('  api log:', world.log.join(', '));
        },
        async update({ page, world }) {
            await expandAll(page);
            console.log('  before:', await iconState(page, 'Dried Apple'));
            await rightClick(page, 'Dried Apple');
            const [chooser] = await Promise.all([page.waitForFileChooser(), menuClick(page, 'Upload icon')]);
            await chooser.accept([path.join(SRC, 'Images', 'cinnamon.png')]);
            for (const t of [300, 1500, 4000]) { await sleep(t); console.log(`  +${t}ms:`, await iconState(page, 'Dried Apple'), '| toast:', await toasts(page)); }
            console.log('  api log:', world.log.join(', '));
        }
    };
    for (const k of Object.keys(scenarios)) if (!only || only === k) await run(k, scenarios[k]);
})();
