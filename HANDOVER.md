# Steep It Together - handover

A personal tea/coffee brewing log. Plain HTML/CSS/JS (no build step, no framework),
hosted free on GitHub Pages, with **GitHub itself as the database**.

- Live site: https://thicccoffeeloli.github.io/steep-it-together/
- Repo: https://github.com/thicccoffeeloli/steep-it-together (branch `main`)
- Chrome/Edge only (uses CSS container queries and other modern CSS; no fallbacks).

If you open this in VS Code with Claude Code, tell it: *"Read HANDOVER.md first."*

---

## 1. How it works in one minute

There is no server. The pages call `fetch('/combos')`, `fetch('/ingredients')` etc.
exactly like the old local Node app did. `github-storage.js` is loaded **first** on every
page and replaces `window.fetch`: those calls are redirected to the GitHub Contents API,
which reads/writes the JSON files in this same repo. So **every save is a git commit made
by the live site** (`update data.json`, `upload Images/x.png`, ...).

```
page (script.js / log.js / ...)  --fetch('/combos')-->  github-storage.js  --PUT-->  api.github.com
                                                          (read-modify-write with sha)   -> commit in this repo
```

Consequence you must remember: **the repo gets commits you didn't make.** Always
`git fetch` + merge before you push (see section 5).

## 2. Files

| Page | Scripts | What it is |
|---|---|---|
| `index.html` | `script.js` | Main page: ingredients panel, cauldron, brew + Drink card (rating, notes, photo). On narrow screens it becomes 3 swipeable "rooms". |
| `log.html` | `log.js` | Combo summary + Graphs tabs, Rating table + Book tabs. Includes the pairing matrix (category -> detail -> **full matrix** with focus columns / row filter). |
| `reference.html` | `notes.js`, `reference-list.js` | Notepad (+ your own custom tabs), Hard to get, Avoid with flask. Old `notes.html#...` links were removed; use `reference.html#notes`. |
| `settings.html` | `settings.js`, `app-settings.js` | Settings: default Icon/Word mode (applies to ingredients, cauldron and graphs), data export/import, GitHub disconnect. Old `reference.html#data` links forward here. |
| `combo-detail.html` | `combo-detail.js` | Notes for one specific combo, linked from the matrix/rating table. |
| `github-storage.js` | - | The storage layer (below). **Must stay the first script.** |
| `app-settings.js` | - | `AppSettings.get()/load()/save()` - settings synced via `settings.json`, with a localStorage copy so pages start in the right mode without a flash. Loaded on index, log and settings. |
| `ui.js` | - | `makeModeSwitch()` (the sliding toggle used for every two-option choice), `makeColorKey()` (the colour keys under charts/tables), and keeps `--sticky-top` = header height. Loaded on every page. |
| `tooltip.js` | - | Sticky-note tooltips. |
| `styles.css` | - | All styling (one file). |

Data (all JSON in the repo root, edited through the app, not by hand):
`data.json` (logged combos - each can carry `starred` and `tryAgain` flags), `ingredients.json` (sections + ingredients),
`pairings.json`, `ingredient-colors.json`, `category-colors.json`, `notes.json`,
`hard-to-get.json`, `avoid-flask.json`, `custom-lists.json`, `settings.json` (created on first save),
`blocked.json` (pairs marked "don't mix", as `"A|B"` keys with the two names sorted).

`Images/` - ingredient icons (128px PNG, named after the ingredient: "Dried Rose Buds" ->
`dried-rose-buds.png`; exceptions are listed in `IMAGE_OVERRIDES` at the top of `script.js`),
`placeholder.png` (the "?"), `pot-in.png` / `pot-out.png` (cauldron art, 640px),
`pot-water-mask.png` (the exact shape of the water in `pot-in.png`, used to tint it).

`dev/` - browser regression tests (section 6). Not part of the site.

## 3. The storage layer (`github-storage.js`) - the tricky part

- **JSON routes**: `/combos`, `/ingredients`, ... map to files (see `JSON_ROUTES`). Reads are
  `GET` with `cache: 'no-store'`; writes are `PUT` with the file's last-seen `sha`.
- **Conflicts**: a 409/422 means another device saved first -> a red "reload" banner. No merge.
- **Write queue**: all writes (JSON + images) run one at a time.
- **Auth**: a GitHub *fine-grained* token (Contents: read & write, only this repo) is typed
  once per device and kept in `localStorage`. The saved token is used immediately and
  re-checked in the background once per browser session; only a 401/404 discards it.
  **One-click login for your own devices**: open the site with `?owner=thicccoffeeloli&repo=steep-it-together&token=...`
  (the params are stripped from the address bar straight away).
- **Friends = guest (view-only) mode**: `?guest` (Settings > Share with a friend copies the link) or
  "Just look around" on the connect screen. Guests read the data files straight from the site (the
  repo is public anyway), make **no** GitHub API calls, see a banner, and every save is refused.
  Remembered per device in `localStorage` (`steepItTogetherGuest`); Settings has the way out.
- **Writes to the same file coalesce**: if a save to a file is already queued, it just takes the
  newer value. The page also warns before closing while saves are still in flight.
- **Images have two sources.** The original icons are plain static files (instant, same-origin).
  Anything uploaded/renamed/removed after that lives in the repo and must win over a
  same-named static file. That is what the "force override" does: filenames edited through
  the app are remembered in `localStorage` (`steepItTogetherForcedImageOverrides`) and
  displayed via a path that deliberately 404s (`Images/__force-live__/<file>`), which makes
  the error handler look the file up live through the API (`getImageBlobUrl`).
  - `imagePathFor(name)` = the **real filename** (use for upload / delete / rename).
  - `displayIconSrc(name)` = what an `<img>` should point at (this is the one that gets patched).
    Mixing these up caused the old "Invalid filename" bug. Don't patch `imagePathFor`.
  - The patches run on `DOMContentLoaded` (not `setTimeout`): they must apply after `script.js`
    has been parsed, and a timer can fire before it has even downloaded.
- Renaming an ingredient **copies** its icon to the new filename (never moves/deletes the old
  one); the copy overwrites whatever is at the destination.
- Replacing an existing icon needs that file's current `sha` (GitHub returns 422 otherwise) -
  `uploadImageDataUrl` fetches it first.

## 4. Things that bit us (read before changing these areas)

- **Cauldron layout** (`#cauldron` in `styles.css`): percentage padding is measured against the
  *parent's* width, but the pot is capped at 420px. Padding is therefore derived from
  `--pot-w: min(100cqw, 420px)` (the wrapper is a container). The 38% / 22% / 30% values come
  from pixel-measuring the water in `pot-in.png`, not eyeballing. Icon size uses `cqw` of the
  pot's *content box* (it is ~56% of the pot width), hence `24cqw`.
- **Water colour**: `#cauldron::after` is a plain colour layer masked to the water shape
  (`Images/pot-water-mask.png`), set from `applyBrewColor()` via `--brew-rgb`; the Drink card uses
  the identical value. (It used to hue-rotate the pale-blue artwork, which could never reach strong
  reds.) If the pot artwork changes, the mask has to be regenerated from it.
- **Ingredient colours** are auto-derived from the icon by `averageCanvasColor()`, weighted by how
  colourful each pixel is - a plain average let white paper / glass / outlines drown out small red
  accents. Hand-picked colours ("Set colour") are never overwritten except by "Refresh icon colors".
- **Colour picker** previews on `input` and saves once on `change`; section colours are keyed by
  section name, so a section rename carries its colour over (and Cancel puts it back).
- **Save/Cancel bars** (`.edit-actions`) are `position: sticky` at `top: var(--sticky-top)` - just under
  the sticky site header (ui.js measures it). Bars inside the ingredients card pin to that card instead
  (`top: -24px`, its padding). Don't pin anything to the *bottom*: with the header present Chrome stopped
  honouring `bottom: 0` sticky, which is why the combo editor's bar lives at the top of its form.
- **Look & feel** ("candy-maker's travel trunk"): the theme is one block at the end of `styles.css`
  (search `THEME:`) on top of the original rules - tokens on `:root`, Fredoka for the chrome. The site
  header is plain markup repeated in each page (`<header class="site-header">`, the current page's tag
  gets `is-active`).
- **Notepad tab order** is saved in `settings.json` as `referenceTabOrder` (array of tab keys; custom tabs
  are `custom-<id>`). Tabs can be dragged or moved with the Left/Right buttons.
- `container-type: inline-size` elements can't size themselves from their own content.
- The hidden attribute loses to any `display:` rule - the matrix filter list needs
  `.column-filter [hidden] { display:none !important }`.
- Git shows "LF will be replaced by CRLF" warnings on Windows. Harmless.

## 5. Day-to-day workflow

```bash
git clone https://github.com/thicccoffeeloli/steep-it-together.git
cd steep-it-together
# edit files, then open index.html through any static server (e.g. VS Code "Live Server")
# and connect with your token - NOTE: that talks to the REAL repo, so test with dev/ instead.

git add -A && git commit -m "what and why"
git fetch origin && git merge origin/main      # pulls in commits the live site made
git push origin main
```
GitHub Pages redeploys in ~1-2 minutes. Browsers cache files for 10 minutes (Pages sets
`max-age=600`), so **bump the `?v=` on the `<script>`/stylesheet links in the four HTML files**
(e.g. `?v=20261008a`; the current one is `20261008a`) whenever you change a js/css file - that makes every browser fetch the new
version immediately instead of showing an old copy. (Ctrl+Shift+R also works locally.) If a merge conflicts, it will be in a data file or an image written by the live
site: keep the **live site's** version of data files.

## 6. Testing (no real GitHub needed)

`dev/` drives a real Edge/Chrome against a fake in-memory GitHub API:

```bash
cd dev && npm install
node icons.js rename      # also: del, update  (ingredient-icon flows)
node cauldron-widths.js   # cauldron at 7 window widths, writes c_<width>.png
node settings-test.js     # Settings page + default Icon/Word mode on main page and graphs
node colours-test.js      # brew colour incl. reds, colour picker saves once, section rename keeps colour
node blocked-test.js      # blocked pairs: cauldron button/warning, randomizer, matrix right-click
node guest-test.js        # friend/guest mode: no API calls, saves refused, connect-screen route
node sticky-tabs-test.js  # pinned Save bars under the header, Notepad tab reordering
node tryagain-test.js     # 'Try again' flag: Drink card, combo notes, Book, rating table filter, matrix
node shots.js -mine       # screenshots of every page, desktop + phone -> shot-*.png
```
Set `EDGE_PATH` if the browser isn't at the default Edge location. Tests assume the ingredient
"Dried Apple" exists with an icon; adjust the replace in `makeWorld()` if your data changed.

## 7. Backups / restore

- Git tag `backup-before-cleanup-2026-10-06` = the repo exactly before the big cleanup.
  Restore a file: `git checkout backup-before-cleanup-2026-10-06 -- <path>`.
- `Tea Project Website Backup 2026-10-06.zip` (OneDrive, Tea Project folder) = the same
  site files as a zip.

## 8. Security note (please read)

- The repo is **public** (GitHub Pages' free tier needs that), and it holds both code **and your
  data** (ratings, notes). Anyone who finds the repo can read them.
- **Never put the token in a file in this repo**, in `Things to do.txt`, or in a chat. If it has
  been exposed anywhere, revoke it at https://github.com/settings/personal-access-tokens and make a
  new one (fine-grained, this repo only, Contents: read & write).
- On the laptop you only need the token to *use the site*, not to push code (pushing uses
  your normal GitHub login / Git Credential Manager).

