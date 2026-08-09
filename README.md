# QCU Academic OS — Study Guide Portal

**Live demo:** https://kianoroku18ino.github.io/qcu-academic-os-portal/

A library + in-page reader + AI assistant for the QCU Academic OS study guide collection. Pick a guide from the sidebar, read it in place (HTML or PDF), ask an AI about whatever's currently open, or search Unsplash for images. No build step, no backend — everything runs as static files, works on both desktop and mobile.

**Built with:** HTML, CSS, JavaScript — no frameworks. The only external calls are to the AI provider and Unsplash you configure yourself.

---

## Features

- **Library** — driven entirely by `guides.json`; add a guide with zero code changes.
- **Viewer** — opens each guide's HTML or PDF version in place, toggle between them.
- **Ask AI** — reads whatever guide is open (HTML mode) and answers questions about it. Bring your own key: OpenRouter (free tier) or Google Gemini.
- **Media Search** — Unsplash image search, also bring-your-own-key, results render in-app with full attribution.
- **Responsive** — off-canvas sidebar and tool panel on mobile (portrait and landscape), docked panels on desktop. Hardened against real-device viewport clipping (`100vh` vs. actual visible height) and safe-area insets for notches/gesture bars.

## Running it locally

This is a static site, but it **must be served over http(s)** — opening `index.html` via `file://` will fail, since the sidebar loads `guides.json` with `fetch()`, and browsers block that under `file://`.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying

Push to a GitHub repo, then **Settings → Pages → Deploy from branch → `main` / root**. GitHub Pages serves over https automatically.

## Adding a new guide

1. Drop the `.html` and/or `.pdf` file into `assets/guides/`.
2. Add one entry to `guides.json`:

```json
{
  "id": "unique-id",
  "code": "SUBJ101",
  "title": "Subject Name",
  "category": "Subjects",
  "html": "assets/guides/YourGuide.html",
  "pdf": "assets/guides/YourGuide.pdf"
}
```

3. Done — no changes to `script.js` or `index.html` needed. A new `category` value automatically gets its own sidebar section.

## Ask AI — how it works, and its real limit

Bring-your-own-key: your API key is typed into the settings drawer (gear icon), saved only to this browser's `localStorage`, sent only to the provider you picked — OpenRouter or Google Gemini. Nothing passes through a server in between.

When a guide is open **in HTML mode**, Ask AI reads the guide's visible text out of the iframe and includes it as context. **PDF mode is not readable** — the assistant says so and falls back to a general answer instead of pretending to have read a PDF it can't access. Real fix would be bundling `pdf.js` for client-side text extraction; not implemented.

## Media Search — how it works

Also BYOK: paste an Unsplash Access Key (free, no credit card) into its own settings drawer. Results are pulled live from Unsplash's API and rendered in-app with required attribution (photographer + link, and a link back to Unsplash).

## Known gaps

- **No PDF text extraction for Ask AI.**
- **No search across guide content** — sidebar filter matches titles/codes only, not what's inside each guide.
- **Unsplash free tier caps at 50 requests/hour per key** — BYOK avoids that being shared across everyone.

## License

MIT — see [LICENSE](./LICENSE).

---

*Part of the QCU Academic OS project — compiled by [KianoRoku18Ino](https://github.com/KianoRoku18Ino).*
