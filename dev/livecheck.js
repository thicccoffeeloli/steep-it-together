// Smoke-tests the LIVE site (the real GitHub Pages files) with the GitHub API faked from local data,
// so nothing is read from or written to your real repo. Usage: cd dev && npm install && node livecheck.js
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..');
const BASE = 'https://thicccoffeeloli.github.io/steep-it-together';
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  const handler = r => { const u = new URL(r.url()); if (u.host !== 'api.github.com') return r.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    if (r.method() !== 'GET') return r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'x' } }) });
    const m = u.pathname.match(/contents\/(.*)$/); if (!m) return r.respond({ status: 200, headers: cors, body: '{}' });
    const f = path.join(SRC, decodeURIComponent(m[1])); if (!fs.existsSync(f)) return r.respond({ status: 404, headers: cors, body: '{}' });
    r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sha: 'x', content: fs.readFileSync(f).toString('base64') }) }); };
  for (const [w, h] of [[1300, 900], [390, 800]]) {
    const ctx = await browser.createBrowserContext(); let first = true;
    for (const p of ['index.html', 'log.html', 'log.html#graphs', 'reference.html#notes', 'settings.html', 'combo-detail.html?ingredient=Dark%20Roast%20Coffee&ingredient=Hazelnut%20Coffee']) {
      const page = await ctx.newPage(); await page.setViewport({ width: w, height: h }); await page.setRequestInterception(true); page.on('request', handler);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/' + p + (first ? (p.includes('?') ? '&' : '?') + 'owner=o&repo=r&token=t' : ''), { waitUntil: 'load', timeout: 60000 }); first = false;
      await new Promise(r => setTimeout(r, 2500));
      if (p.includes('graphs')) await page.evaluate(() => { const b = document.querySelector('#graphs-area .mode-switch'); });
      const info = await page.evaluate(() => ({
        header: !!document.querySelector('.site-header'), active: (document.querySelector('.nav-tag.is-active') || {}).textContent,
        font: document.fonts.check('16px Fredoka'), switches: document.querySelectorAll('.mode-switch').length, keys: document.querySelectorAll('.color-key').length,
        sideScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, connectScreen: !!document.getElementById('github-config-overlay')
      }));
      console.log(String(w).padEnd(5), p.split('?')[0].padEnd(22), JSON.stringify(info), errors.length ? 'ERRORS: ' + errors.join(' | ') : '');
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
})();
