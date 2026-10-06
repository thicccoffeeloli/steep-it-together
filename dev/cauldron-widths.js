// Renders the cauldron with 6 ingredients at several window widths and prints where the
// chips land (as % of the pot). Screenshots c_<width>.png are written next to this file.
// Usage:  cd dev && npm install && node cauldron-widths.js
const puppeteer = require('puppeteer-core'), http = require('http'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
(async () => {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html', p = path.join(SRC, u);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); } else { res.writeHead(404); res.end(); }
  }).listen(0);
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { const u = new URL(r.url()); if (u.host !== 'api.github.com') return r.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    const m = u.pathname.match(/contents\/(.*)$/); if (!m) return r.respond({ status: 200, headers: cors, body: '{}' });
    const f = path.join(SRC, decodeURIComponent(m[1]));
    if (!fs.existsSync(f)) return r.respond({ status: 404, headers: cors, body: '{}' });
    const b = fs.readFileSync(f); r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sha: 'x', content: b.toString('base64') }) }); });
  for (const w of [1300, 1000, 800, 700, 500, 400, 330]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`http://localhost:${server.address().port}/index.html?owner=o&repo=r&token=t`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { const t = document.getElementById('room-tab-cauldron'); if (t && getComputedStyle(t).display !== 'none') t.click();
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('Icon mode'))?.click();
      document.getElementById('random-count').value = 6; document.getElementById('random-brew-btn').click(); });
    await new Promise(r => setTimeout(r, 2500)); await page.evaluate(() => document.getElementById('cauldron').scrollIntoView({inline:'center'})); await new Promise(r => setTimeout(r, 800));
    const el = await page.$('.cauldron-wrapper'); console.log(JSON.stringify(await page.evaluate(() => { const c = document.getElementById('cauldron'), s = getComputedStyle(c); return { pad: s.padding, scrollTop: c.scrollTop, scrollH: c.scrollHeight, clientH: c.clientHeight, h: c.getBoundingClientRect().height }; })));
    const bb = await page.evaluate(() => { const r = document.getElementById('cauldron').getBoundingClientRect(); return {x: Math.max(0,r.x-10), y: Math.max(0,r.y-10), width: r.width+20, height: r.height+20}; }); await page.screenshot({ path: `c_${w}.png`, clip: bb });
    console.log(w, JSON.stringify(await page.evaluate(() => { const c = document.getElementById('cauldron').getBoundingClientRect(); return { cauldronW: Math.round(c.width), chips: [...document.querySelectorAll('#cauldron li')].map(l => { const r = l.getBoundingClientRect(); return [Math.round((r.left - c.left) / c.width * 100), Math.round((r.top - c.top) / c.width * 100), Math.round((r.right - c.left) / c.width * 100), Math.round((r.bottom - c.top) / c.width * 100)].join(',') }) }; })));
  }
  await browser.close(); server.close();
})();
