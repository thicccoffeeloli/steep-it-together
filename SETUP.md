# Getting your synced version online

This version stores your tea data in a private GitHub repo instead of
OneDrive - no card, no Microsoft sign-up, all free. Three things to do,
all on GitHub (you already have an account).

---

## Part 1 — Make a private repo to hold your data

1. Go to **https://github.com/new**.
2. Repository name: anything, e.g. `steep-data`.
3. Set it to **Private** (this one matters - your tea data shouldn't be
   public, unlike the app's own code repo from before).
4. Leave everything else as default, click **Create repository**.

---

## Part 2 — Make a personal access token

This is what lets the app read/write files in that repo on your behalf,
without ever knowing your GitHub password.

1. Go to **https://github.com/settings/personal-access-tokens/new**.
2. **Token name**: anything, e.g. `Steep It Together`.
3. **Expiration**: pick something long, e.g. 1 year (you'll just need to
   make a new one and reconnect when it expires).
4. **Repository access**: choose **Only select repositories**, then pick
   the `steep-data` repo from Part 1. This means the token can *only*
   touch that one repo, nothing else in your GitHub account.
5. Scroll to **Permissions** → **Repository permissions** → find
   **Contents** → set it to **Read and write**.
6. Click **Generate token**.
7. **Copy the token now** - GitHub only shows it once. Paste it somewhere
   safe temporarily (a notes app) until you use it in Part 3.

---

## Part 3 — Put the app online (free, via GitHub Pages)

1. Go to **https://github.com/new** again - this is for the app's *code*,
   separate from the private data repo in Part 1.
2. Repository name: anything, e.g. `steep-it-together`. Leave it
   **Public** (GitHub Pages' free tier requires this - it's just the
   code, same as any open-source project; your actual tea data lives in
   the *other*, private repo from Part 1, so nothing personal is exposed).
3. Click **Create repository**.
4. Tell me you've done this, and I'll push everything in this
   `cloud-sync-version` folder up to it and turn on GitHub Pages for you.
5. Once that's done, GitHub will give you a web address that looks like
   `https://<your-username>.github.io/steep-it-together/` - that's the
   link you'll open on your phone and laptop from now on. Bookmark it on
   both.

---

## Part 4 — Connect each device

Open that link (from Part 3) on your phone or laptop. The first time, it
asks for three things:

- **GitHub username**: your GitHub username.
- **Repo name**: `steep-data` (the private one from Part 1, not the app's
  own code repo).
- **Personal access token**: the one you copied in Part 2.

Do this once per device (phone, laptop) - each remembers it after that.
Both devices now read/write the exact same files in your `steep-data`
repo, so they stay in sync automatically.

---

## What to expect

- Everything you can see and do stays exactly the same as the version
  you're used to.
- All your existing ingredient icons and pictures show up immediately -
  they're built into this version already.
- A **picture you upload from now on** gets saved properly, but might
  show a plain placeholder icon instead of your actual photo in a couple
  of spots (the pairing graph, the drink photo) until a future update
  finishes that part. Nothing is lost either way - just a cosmetic gap for
  brand new uploads specifically.
- A small "Saving.../Saved" indicator appears bottom-right whenever
  something's being written to your repo.
- If you ever edit the exact same thing on two devices at almost the same
  moment, you'll see a banner saying the data changed elsewhere with a
  Reload button - click it, then redo whatever you were doing. This is
  rare in normal use.
- To bring over your *existing* ingredients/brew log from the version
  you've been using locally: on that local version, go to **Notepad → Data
  tab → Export**, then on this new synced version go to the same **Data
  tab → Import** and pick the file you just downloaded.
- Your token can be swapped out anytime from the same **Data tab →
  Disconnect / change repo** button, if it expires or you want to switch
  repos.
