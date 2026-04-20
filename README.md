# ☁ TGCloud — Telegram Personal Cloud Storage

A **100% static web app** — no server, no backend, no hosting costs beyond GitHub Pages.

Your browser connects directly to Telegram via MTProto (WebSocket), stores files in your **Saved Messages**, and everything runs client-side.

---

## Deploy to GitHub Pages

### Step 1 — Get Telegram API credentials
Go to **https://my.telegram.org/apps**, log in, create an app, and copy your:
- **App api_id** (a number, e.g. `12345678`)
- **App api_hash** (a 32-char hex string)

You'll enter these in the app on first visit — they're stored only in your browser's `localStorage` and never leave your device.

### Step 2 — Push to GitHub

```bash
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 3 — Wait ~2 minutes for the Action to run

Go to your repo on GitHub → click the **Actions** tab → watch the "Deploy to GitHub Pages" workflow run. It will build the app and push the built files to a `gh-pages` branch.

### Step 4 — Set Pages source to the gh-pages branch

**This is the critical step.** In your repo on GitHub:

1. Go to **Settings → Pages**
2. Under **Branch**, select `gh-pages` and folder `/ (root)`
3. Click **Save**

### Step 5 — Visit your app

```
https://YOUR_USERNAME.github.io/YOUR_REPO/
```

> **If you see a white page or raw HTML with `/src/main.jsx`**, it means Pages is still set to deploy from the `main` branch instead of `gh-pages`. Go back to Settings → Pages and make sure `gh-pages` is selected.

---

## How it works

```
Browser ──WebSocket──▶ Telegram servers (MTProto)
   │
localStorage: API credentials + StringSession
```

- **No backend** — GramJS runs entirely in your browser via WebSocket
- **No database** — file metadata stored as prefixed messages in your Saved Messages
- **No third-party storage** — all files live in your own Telegram account
- **Persistent login** — session string saved in localStorage

### Manifest format

Each uploaded file creates a message in Saved Messages:
```
ULM1_MANIFEST::<base64 JSON>
```
```json
{
  "v": 1,
  "name": "video.mp4",
  "size": 2500000000,
  "mime": "video/mp4",
  "sha256": "abc123...",
  "chunks": ["111111", "222222"],
  "chunked": true,
  "timestamp": 1700000000000
}
```

### Chunking

All Telegram accounts support files up to **2 GB** in Saved Messages. TGCloud chunks at **1.95 GB** — so any size file works.

---

## Local development

```bash
npm install
npm run dev
# Open http://localhost:5173
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| White page / sees `/src/main.jsx` | Pages source is wrong — set to `gh-pages` branch in Settings → Pages |
| Actions tab shows no workflow | Make sure you pushed the `.github/` folder (check `git status`) |
| Workflow fails | Check the Actions log; usually a missing `package-lock.json` |
| "Not connected" on login | Your API ID/Hash is wrong — double-check at my.telegram.org/apps |
