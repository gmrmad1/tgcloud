# ☁ TGCloud — Telegram Personal Cloud Storage

A **100% static web app** — no server, no backend, no hosting costs beyond GitHub Pages.

Your browser connects directly to Telegram via MTProto (WebSocket), stores files in your **Saved Messages**, and everything runs client-side.

---

## How to deploy (5 minutes)

### 1. Get Telegram API credentials
Go to **https://my.telegram.org/apps**, log in, create an app, copy:
- **App api_id** (a number like `12345678`)
- **App api_hash** (a 32-char hex string)

You'll enter these in the app on first run — they're stored only in your browser's `localStorage`.

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 3. Enable GitHub Pages

In your repo on GitHub:
- Go to **Settings → Pages**
- Under **Source**, select **GitHub Actions**
- That's it — the workflow in `.github/workflows/deploy.yml` handles the rest

### 4. Visit your site

After the first push, GitHub Actions will build and deploy automatically (takes ~2 min).

Your app will be live at:
```
https://YOUR_USERNAME.github.io/YOUR_REPO/
```

---

## How it works

```
Browser ──WebSocket──▶ Telegram servers (MTProto)
   │                         │
   │   uploads/downloads     │  Saved Messages
   │◀────────────────────────┘
   │
localStorage: API credentials + session string
```

- **No backend** — GramJS (the Telegram client library) runs entirely in your browser
- **No database** — file metadata is stored as specially prefixed messages in your Saved Messages chat
- **No third-party storage** — all files live in your own Telegram account
- **Session persistence** — your Telegram session string is saved in localStorage so you stay logged in across visits

### Manifest format

For every uploaded file, TGCloud stores a message in Saved Messages like:
```
ULM1_MANIFEST::<base64-encoded JSON>
```

The JSON contains:
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

Chunk message IDs let TGCloud reconstruct and download any file by fetching those messages in order.

### Chunking

All Telegram accounts (free and premium) support files up to **2 GB** in Saved Messages. TGCloud chunks at **1.95 GB** to stay safely below the limit — so files up to any size work.

---

## Local development

```bash
npm install
npm run dev
# Open http://localhost:5173
```

---

## Notes

- Don't manually delete messages that start with `ULM1_MANIFEST::` or the associated file chunks in Saved Messages — TGCloud manages them
- The app uses `HashRouter` (`/#/`) so it works on GitHub Pages without any server-side redirect config
- Downloading large files reassembles chunks in-browser before triggering the browser's native download — this requires enough RAM for the file
- SHA-256 integrity is verified after every download using the Web Crypto API
