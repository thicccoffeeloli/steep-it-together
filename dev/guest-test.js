// Real-browser test: friend/guest (view-only) mode - reads the static data files, never calls the
// GitHub API, refuses writes. Usage: cd dev && npm install && node guest-test.js
const puppeteer = require('puppeteer-core'), http = require('http'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html', p = path.join(SRC, u);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); } else { res.writeHead(404); res.end(); } }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' });
  const ctx = await browser.createBrowserContext();
  let apiCalls = [];
  const open = async url => { const p = await ctx.newPage(); await p.setViewport({ width: 1300, height: 900 }); await p.setRequestInterception(true);
    p.on('request', r => { if (new URL(r.url()).host === 'api.github.com') { apiCalls.push(r.method() + ' ' + r.url()); return r.respond({ status: 500, body: '' }); } r.continue(); });
    p.on('pageerror', e => console.log('  PAGEERROR', e.message));
    await p.goto(base + url, { waitUntil: 'networkidle0' }); return p; };

  // 1. shared link
  let page = await open('/index.html?guest');
  await page.evaluate(() => { const t = document.getElementById('toggle-all-btn'); if (t && t.textContent.includes('Expand')) t.click(); });
  console.log('guest link -> url now:', page.url().replace(base, ''), '| banner:', await page.evaluate(() => !!document.getElementById('guest-banner')), '| ingredients shown:', await page.evaluate(() => document.querySelectorAll('.ingredient').length), '| connect screen:', await page.evaluate(() => !!document.getElementById('github-config-overlay')));
  // try to save something
  await page.evaluate(() => { ingredientColors['Ginger'] = '#000000'; saveIngredientColors(); });
  await sleep(500);
  console.log('save attempt -> notice:', await page.evaluate(() => document.getElementById('gh-save-status') && document.getElementById('gh-save-status').textContent));
  // log page in the same (guest) browser
  const log = await open('/log.html');
  await log.evaluate(() => document.getElementById('show-full-matrix-btn').click());
  console.log('log page as guest -> matrix cells:', await log.evaluate(() => document.querySelectorAll('.pair-cell').length));
  const settings = await open('/settings.html');
  console.log('settings as guest -> button:', await settings.evaluate(() => (document.getElementById('gh-leave-guest-btn') || {}).textContent), '| share link:', await settings.evaluate(() => document.getElementById('guest-link').value.replace(location.origin, '')));
  console.log('GitHub API calls made as a guest:', apiCalls.length);

  // 2. connect screen button
  const ctx2 = await browser.createBrowserContext(); const p2 = await ctx2.newPage(); await p2.setRequestInterception(true);
  p2.on('request', r => { if (new URL(r.url()).host === 'api.github.com') return r.respond({ status: 500, body: '' }); r.continue(); });
  await p2.goto(base + '/index.html', { waitUntil: 'networkidle0' });
  const hadOverlay = await p2.evaluate(() => !!document.getElementById('github-config-overlay'));
  await p2.evaluate(() => document.getElementById('gh-guest-btn').click());
  await sleep(1500);
  console.log('connect screen shown:', hadOverlay, '| after "Just look around": overlay gone:', await p2.evaluate(() => !document.getElementById('github-config-overlay')), '| sections loaded:', await p2.evaluate(() => document.querySelectorAll('.ingredient-section').length));
  await p2.screenshot({ path: 'guest.png' });
  await browser.close(); server.close();
})();
