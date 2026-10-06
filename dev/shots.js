// Screenshots every page at desktop and phone width (fake repo, nothing saved). Writes shot-<page>-<w>.png.
// Usage: cd dev && npm install && node shots.js [suffix]
const puppeteer = require('puppeteer-core'), http = require('http'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const suffix = process.argv[2] || '';
(async () => {
  const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html', p = path.join(SRC, u);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); } else { res.writeHead(404); res.end(); } }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' });
  const handler = r => { const u = new URL(r.url()); if (u.host !== 'api.github.com') return r.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    if (r.method() !== 'GET') return r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'x' } }) });
    const m = u.pathname.match(/contents\/(.*)$/); if (!m) return r.respond({ status: 200, headers: cors, body: '{}' });
    const f = path.join(SRC, decodeURIComponent(m[1])); if (!fs.existsSync(f)) return r.respond({ status: 404, headers: cors, body: '{}' });
    r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sha: 'x', content: fs.readFileSync(f).toString('base64') }) }); };
  const pages = [['index', '/index.html'], ['log', '/log.html'], ['graphs', '/log.html#graphs'], ['matrix', '/log.html'], ['notes', '/reference.html#notes'], ['settings', '/settings.html'], ['combo', '/combo-detail.html?ingredient=Dark%20Roast%20Coffee&ingredient=Hazelnut%20Coffee']];
  for (const [w, h] of [[1300, 900], [400, 800]]) {
    const ctx = await browser.createBrowserContext();
    let first = true;
    for (const [name, url] of pages) {
      const page = await ctx.newPage(); await page.setViewport({ width: w, height: h }); await page.setRequestInterception(true); page.on('request', handler);
      page.on('pageerror', e => console.log('PAGEERROR', name, e.message));
      await page.goto(base + url + (first ? (url.includes('?') ? '&' : '?') + 'owner=o&repo=r&token=t' : ''), { waitUntil: 'networkidle0' }); first = false;
      if (name === 'index') await page.evaluate(() => { try { ['Cinnamon Stick', 'Ginger', 'Orange Slice'].forEach(addToCauldron); applyBrewColor(); } catch (e) {} });
      if (name === 'graphs') await page.evaluate(() => { const b = [...document.querySelectorAll('#graphs-area button')].find(b => b.textContent.includes('Pairing outcomes')); b && b.click(); });
      if (name === 'matrix') await page.evaluate(() => document.getElementById('show-full-matrix-btn').click());
      await new Promise(r => setTimeout(r, 700));
      await page.screenshot({ path: `shot-${name}-${w}${suffix}.png`, fullPage: false });
      await page.close();
    }
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log('done');
})();
