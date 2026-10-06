// Real-browser test: brew colour (incl. reds), colour-picker saving, section rename keeps its colour.
// Serves this folder + a fake in-memory GitHub API, so it never touches your real repo.
// Usage:  cd dev && npm install && node colours-test.js
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
const puts = (world, file) => world.log.filter(l => l === 'PUT ' + file).length;

(async () => {
    await run('red brew in the pot and on the Drink card', Object.assign(async ({ page }) => {
        await page.setViewport({ width: 1300, height: 900 });
        for (const combo of [['Dried Apple'], ['Dried Apple', 'Dried Rosehip'], ['Red Wine'], ['Hibiscus Teabag']]) {
            await page.evaluate(c => { clearCauldron(); c.forEach(addToCauldron); applyBrewColor(); }, combo);
            await sleep(500);
            const r = await page.evaluate(() => {
                const cs = getComputedStyle(document.getElementById('cauldron'), '::after');
                return { pot: cs.backgroundColor, potOpacity: cs.opacity, card: document.querySelector('.output-picture').style.background, mask: cs.maskImage || cs.webkitMaskImage };
            });
            console.log('  ' + combo.join(' + ').padEnd(28), JSON.stringify(r));
        }
        await page.evaluate(() => { clearCauldron(); ['Dried Apple', 'Dried Rosehip'].forEach(addToCauldron); applyBrewColor(); });
        await sleep(600);
        const wrap = await page.$('.cauldron-wrapper'); await wrap.screenshot({ path: 'red-pot.png' });
        const card = await page.$('.output-picture'); if (card) await card.screenshot({ path: 'red-card.png' });
    }, { page: 'index.html' }));

    await run('colour picker: drag then close saves once', Object.assign(async ({ page, world }) => {
        const before = puts(world, 'category-colors.json');
        await page.evaluate(async () => {
            colorPickerTarget = { kind: 'category', name: 'Coffee' };
            for (let i = 0; i < 25; i++) { colorPickerInput.value = '#' + (16 + i * 9).toString(16).padStart(2, '0') + '2040'; colorPickerInput.dispatchEvent(new Event('input')); }
            colorPickerInput.value = '#e01070';
            colorPickerInput.dispatchEvent(new Event('change'));
        });
        await sleep(1500);
        console.log('  GitHub writes for 25 drag steps + close:', puts(world, 'category-colors.json') - before);
        console.log('  saved Coffee colour:', JSON.parse(world.repo['category-colors.json'].toString())['Coffee']);
        // rapid ingredient colour saves coalesce too
        const b2 = puts(world, 'ingredient-colors.json');
        await page.evaluate(() => { for (let i = 0; i < 15; i++) saveIngredientColors(); });
        await sleep(2000);
        console.log('  15 back-to-back ingredient-colour saves -> GitHub writes:', puts(world, 'ingredient-colors.json') - b2);
    }, { page: 'index.html' }));

    await run('renaming a coloured section keeps its colour', Object.assign(async ({ page, world }) => {
        const colours = () => JSON.parse(world.repo['category-colors.json'].toString());
        const sec = Object.keys(colours()).find(k => k !== 'Uncategorized');
        console.log('  section:', sec, 'colour:', colours()[sec]);
        await page.evaluate(() => enterEditingMode());
        await page.evaluate(() => buildIngredientsPanel());
        await page.evaluate(sec => {
            const input = [...document.querySelectorAll('.section-name-input')].find(i => i.value === sec);
            input.focus(); input.value = sec + ' (renamed)'; input.dispatchEvent(new Event('input')); input.blur();
        }, sec);
        await page.evaluate(() => document.getElementById('save-edits-btn').click());
        await sleep(2500);
        const c = colours();
        console.log('  after Save: old name present?', sec in c, '| new name colour:', c[sec + ' (renamed)']);
        const shown = await page.evaluate(sec => { const h = [...document.querySelectorAll('.ingredient-section')].find(d => d.dataset.section === sec + ' (renamed)'); return h ? getComputedStyle(h.querySelector('h3') || h).borderColor + ' / ' + (h.getAttribute('style') || '') : 'not found'; }, sec);
        console.log('  section on screen:', shown.slice(0, 120));
    }, { page: 'index.html' }));
})();
