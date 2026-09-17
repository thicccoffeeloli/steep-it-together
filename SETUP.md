# Getting your synced version online

Everything's built. Two short things are left, and both need *you* signed
into your own accounts - I can't do these parts. Neither costs anything.

Do them in this order: **Part 1 first**, then **Part 2** (Part 2 needs a
piece of information Part 1 gives you).

---

## Part 1 — Get your Client ID (a few minutes)

This is a free "permission slip" that lets the app ask to sign in with your
personal OneDrive. You make it once; it's yours, tied to your account, and
nobody else can use it to access your data.

1. Go to **https://portal.azure.com** and sign in with your **personal**
   Microsoft account (the one you said has OneDrive already - not any work
   account).
2. In the search bar at the top of the page, type **App registrations**
   and click the result.
3. Click **+ New registration**.
4. Fill in:
   - **Name**: anything you like, e.g. `Steep It Together`
   - **Supported account types**: choose the option that says
     **"Personal Microsoft accounts only"** (it's the last of the four
     choices).
   - **Redirect URI**: leave this blank for now - you'll add it in Part 2,
     once you know the exact web address.
5. Click **Register**.
6. You'll land on an "Overview" page. Find **Application (client) ID** -
   it's a code that looks like `a1b2c3d4-...`. Copy it.
7. Open `msal-config.js` (in this same folder) and paste it in, replacing
   `PASTE-YOUR-CLIENT-ID-HERE` - keep the quote marks around it.
8. Still on the Azure page, click **API permissions** in the left-hand
   menu, then **+ Add a permission** → **Microsoft Graph** →
   **Delegated permissions**. Type `Files.ReadWrite.AppFolder` into the
   search box, tick it, then click **Add permissions** at the bottom.
   (`User.Read` is usually already there by default - leave it.)

That's Part 1 done. You now have a Client ID pasted into `msal-config.js`.

---

## Part 2 — Put the app online (free, via GitHub Pages)

1. Go to **https://github.com/new** (sign into the GitHub account you
   already have).
2. Repository name: anything, e.g. `steep-it-together`. Leave it **Public**
   (GitHub Pages' free tier requires this - it just means the *code* is
   visible to anyone who looks, same as any open-source project; your
   actual tea data is never in this code, it lives in your OneDrive, so
   this doesn't expose anything personal).
3. Click **Create repository**.
4. Tell me you've done this, and I'll push everything in this
   `cloud-sync-version` folder up to it and turn on GitHub Pages for you.
5. Once that's done, GitHub will give you a web address that looks like
   `https://<your-username>.github.io/steep-it-together/` - that's the
   link you'll open on your phone and laptop from now on. Bookmark it on
   both.
6. Last step: go back to **https://portal.azure.com** → **App
   registrations** → your app → **Authentication** (left-hand menu) →
   **+ Add a platform** → **Single-page application** → paste in that
   exact web address → **Configure**.

Once that's saved, open the link on your phone or laptop, click
**Sign in with Microsoft**, and you're in. Do it on the other device too -
both will show the exact same data from then on, always.

---

## What to expect the first time

- Everything you can see and do stays exactly the same as the version
  you're used to.
- All your existing ingredient icons and pictures show up immediately -
  they're built into this version already.
- A **picture you upload from now on** gets saved properly, but might
  show a plain placeholder icon instead of your actual photo in a couple
  of spots (the pairing graph, the drink photo) until a future update
  finishes that part. Nothing is lost either way - just a cosmetic gap for
  brand new uploads specifically.
- To bring over your *existing* ingredients/brew log from the version
  you've been using locally: on that local version, go to **Notepad → Data
  tab → Export**, then on this new synced version go to the same **Data
  tab → Import** and pick the file you just downloaded.
