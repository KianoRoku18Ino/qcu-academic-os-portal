# QCU Academic OS — Study Guide Portal (v2)

**Live demo:** https://kianoroku18ino.github.io/qcu-academic-os-portal/

A library + in-page reader + AI assistant for the QCU Academic OS study guide collection, organized by **Year (1–4) → Semester (1–2) → Subject**, with a built-in admin page for publishing new guides straight from the deployed site — no local git push required. No build step, no backend — everything runs as static files, works on both desktop and mobile.

**Built with:** HTML, CSS, JavaScript — no frameworks. The only external calls are to the AI provider and Unsplash you configure yourself (library) and the GitHub API (admin).

---

## What's different from v1

- **Content structure:** `guides.json` (flat, one category field) → `manifest.json` (nested: years → semesters → subjects). `assets/guides/` starts empty — this repo ships with zero guides; everything gets added through `/admin.html` or manually.
- **Admin page (`/admin.html`):** paste a GitHub personal access token, pick Year + Semester + Subject, paste or upload the guide's HTML (+ optional PDF), publish. It uploads the file(s) and updates `manifest.json` for you via the GitHub Contents API — the portal picks up the change on next load, no code edits.
- **Isolated guide URLs:** every guide is still just a standalone static file at its own path (`assets/guides/year-1/sem-1/rizal/RIZAL_Complete_Study_Guide.html`), same as v1 — the portal's sidebar/viewer is a separate shell that loads guides into an iframe, it never wraps around them. That's what makes each guide's direct URL safe to feed into a tool like **Gizmo's Website Link import**: it reads exactly that file, not the portal chrome around it. The admin page surfaces this URL after every publish with a one-tap Copy button.

Everything else — the Library, Viewer (HTML/PDF toggle), Ask AI (BYOK, OpenRouter/Gemini), Media Search (BYOK, Unsplash) — works exactly like v1.

## Running it locally

Must be served over http(s) — `file://` won't work, since both `script.js` and `admin.js` use `fetch()`.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying

Push to a GitHub repo, then **Settings → Pages → Deploy from branch → `main` / root**. GitHub Pages serves over https automatically and rebuilds ~30–90 seconds after any push (including ones the admin page makes).

## Using the admin page

Go to `/admin.html` (there's also a small ✎ icon in the portal's topbar). It's not linked anywhere else and is marked `noindex`, but it's still a public URL like every other file in this repo — that's fine, since nothing writes to the repo without a valid token. Treat the token itself as the actual secret, not the page's obscurity.

**1. Get a token.** Create a **fine-grained personal access token** at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - Repository access → Only select repositories → this repo.
   - Permissions → Contents → **Read and write**.
   - Set a short expiration (30–90 days) and just regenerate it when it lapses. Don't use a classic PAT with full-account scope for this — fine-grained keeps the blast radius to this one repo.

**2. Connect.** Paste the token (owner/repo/branch are pre-filled). Leave "Remember on this device" unchecked unless this is a device only you use — checked, it persists in `localStorage` across sessions; unchecked, it's cleared the moment the tab closes.

**3. Publish.** Pick Year + Semester, give the subject a code and title, paste or upload the HTML (and optionally a paired PDF), hit Publish. It:
   - Uploads the file(s) to `assets/guides/year-{n}/sem-{n}/{subject-slug}/`.
   - Read-modifies-writes `manifest.json` to add or update that subject's entry.
   - Shows the resulting direct URL — that's the one to paste into Gizmo (or anywhere else that should see just the guide, not the portal).

**4. Manage what's published.** The bottom of the admin page lists everything currently in `manifest.json` with its direct URL (Copy button) and a Delete action (removes the file(s) and the manifest entry together).

**Known limits:**
- The GitHub Contents API this page uses caps out around 1 MB per file. Guides built as clean HTML are normally well under that; a very large PDF might not be. For anything bigger, push it with git normally instead — the portal doesn't care how a file got into `assets/guides/`, only that `manifest.json` points at it.
- No file at `assets/guides/` is required for the portal to work with an empty library — see "Adding a guide" below for the empty-state message.

## Adding a guide manually (without the admin page)

Still works exactly like editing `guides.json` did in v1, just nested now:

1. Drop the `.html` and/or `.pdf` into `assets/guides/year-{n}/sem-{n}/{subject-slug}/`.
2. Add one entry to the matching semester's `subjects` array in `manifest.json`:

```json
{
  "id": "y1-s1-cc104",
  "code": "CC104",
  "title": "Data Structures and Algorithms",
  "html": "assets/guides/year-1/sem-1/cc104/CC104_Complete_Study_Guide.html",
  "pdf": "assets/guides/year-1/sem-1/cc104/CC104_Complete_Study_Guide.pdf"
}
```

3. Done — `script.js` and `index.html` need no changes either way.

## Ask AI — how it works, and its real limit

Bring-your-own-key: your API key is typed into the settings drawer (gear icon), saved only to this browser's `localStorage`, sent only to the provider you picked — OpenRouter or Google Gemini. Nothing passes through a server in between.

When a guide is open **in HTML mode**, Ask AI reads the guide's visible text out of the iframe and includes it as context. **PDF mode is not readable** — the assistant says so and falls back to a general answer instead of pretending to have read a PDF it can't access. Real fix would be bundling `pdf.js` for client-side text extraction; not implemented.

## Media Search — how it works

Also BYOK: paste an Unsplash Access Key (free, no credit card) into its own settings drawer. Results are pulled live from Unsplash's API and rendered in-app with required attribution (photographer + link, and a link back to Unsplash).

## Known gaps

- **No PDF text extraction for Ask AI.**
- **No search across guide content** — sidebar filter matches titles/codes only, not what's inside each guide.
- **Unsplash free tier caps at 50 requests/hour per key** — BYOK avoids that being shared across everyone.
- **Admin page has no undo** — Delete removes the file(s) and manifest entry in the same action.

## License

MIT — see [LICENSE](./LICENSE).

---

*Part of the QCU Academic OS project — compiled by [KianoRoku18Ino](https://github.com/KianoRoku18Ino).*
