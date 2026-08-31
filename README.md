# QCU Academic OS — Study Guide Portal (v2)

**Live demo:** https://kianoroku18ino.github.io/qcu-academic-os-portal/

A library + in-page reader + AI assistant for the QCU Academic OS study guide collection, organized by **Year (1–4) → Semester (1–2) → Subject → Item** (a numbered week, or a freeform "special" entry like a Midterm Reviewer), with a built-in admin page for publishing new guides straight from the deployed site — no local git push required. No build step, no backend — everything runs as static files, works on both desktop and mobile.

**Built with:** HTML, CSS, JavaScript — no frameworks. The only external calls are to the AI provider and YouTube you configure yourself (library) and the GitHub API (admin).

---

## What's different from v1

- **Content structure:** `guides.json` (flat, one category field) → `manifest.json` (nested: years → semesters → subjects). `assets/guides/` starts empty — this repo ships with zero guides; everything gets added through `/admin.html` or manually.
- **Admin page (`/admin.html`):** paste a GitHub personal access token, pick Year + Semester + Subject, paste or upload the guide's HTML (+ optional PDF), publish. It uploads the file(s) and updates `manifest.json` for you via the GitHub Contents API — the portal picks up the change on next load, no code edits.
- **Isolated guide URLs:** every guide is still just a standalone static file at its own path (`assets/guides/year-1/sem-1/rizal/RIZAL_Complete_Study_Guide.html`), same as v1 — the portal's sidebar/viewer is a separate shell that loads guides into an iframe, it never wraps around them. That's what makes each guide's direct URL safe to feed into a tool like **Gizmo's Website Link import**: it reads exactly that file, not the portal chrome around it. The admin page surfaces this URL after every publish with a one-tap Copy button.

Everything else — the Library, Viewer (HTML/PDF toggle), Ask AI (BYOK, OpenRouter/Gemini) — works exactly like v1.

## What's new in this update

- **Subjects are folders of items, not single guides.** A subject can now hold multiple pieces: numbered weeks (`Week 1`, `Week 2`, …) and/or freeform "special" entries (`Midterm Reviewer`, `Course Overview`, whatever fits). Each item is its own independent html/pdf pair with its own path — publishing or deleting one item never touches its subject's other items. The sidebar reflects this as a third level: **Year·Semester → Subject (tap to expand) → Item**.
- **Media Search → Videos.** Unsplash (generic stock photography) is gone — it was a poor fit for a CS/IT study tool. In its place: YouTube Data API search with results playable *inline* (tap a thumbnail, it plays right there in the panel, no tab switch). Same BYOK pattern as before — paste an API key, nothing routes through a server of ours.
- **Reference Library.** A second content tree, independent of Year/Semester/Subject entirely — for material that's relevant across the whole curriculum (a full HTML/CSS reference, a GitHub mastery guide). Grouped by a freeform category instead of the curriculum tree; shows up in the sidebar above the year-by-year guides. Its own Publish/Library cards on the admin page. Starts empty — nothing shows in the sidebar for it until something's actually published there.

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

**3. Publish.** Pick Year + Semester, give the subject a code and title, choose **Numbered week** (enter a week number, optional subtitle) or **Special item** (enter a freeform label like "Midterm Reviewer"), then paste or upload the HTML (and optionally a paired PDF), hit Publish. It:
   - Uploads the file(s) to `assets/guides/year-{n}/sem-{n}/{subject-slug}/{item-slug}.*` — filenames always come from the item (`week-1.html`, `midterm-reviewer.pdf`, …), not whatever the source file was called, so items never collide.
   - Read-modifies-writes `manifest.json`, finding-or-creating the subject and then finding-or-creating just that one item inside it — every other item already in the subject is left untouched.
   - Shows the resulting direct URL — that's the one to paste into Gizmo (or anywhere else that should see just the item, not the portal).
   - Publishing the same Year/Semester/Code/item again updates it in place (e.g. attach a PDF to a week that only had HTML before) instead of creating a duplicate.

**4. Manage what's published.** The bottom of the admin page lists everything currently in `manifest.json`, grouped by subject, with each item's direct URL (Copy button) and a Delete action (removes that item's file(s) and its manifest entry; if that empties a subject, the subject entry is dropped too).

**5. References work the same way, separately.** Further down the admin page, "Publish a reference" takes just a Category and an Item title (no Year/Semester/Subject) — everything else about it (paste-or-upload HTML, optional PDF, carry-forward-on-republish, per-item delete, empty-category cleanup) mirrors guide publishing exactly. Lives at `assets/references/{category-slug}/{item-slug}.*`, separate from `assets/guides/`.

**Known limits:**
- The GitHub Contents API this page uses caps out around 1 MB per file. Guides built as clean HTML are normally well under that; a very large PDF might not be. For anything bigger, push it with git normally instead — the portal doesn't care how a file got into `assets/guides/` or `assets/references/`, only that `manifest.json` points at it.
- No file at `assets/guides/` or `assets/references/` is required for the portal to work with an empty library — see "Adding a guide" below for the empty-state message.

## Adding a guide manually (without the admin page)

1. Drop the `.html` and/or `.pdf` into `assets/guides/year-{n}/sem-{n}/{subject-slug}/`, named however you like (the admin page uses `{item-slug}.html`/`.pdf` by convention, but this file only cares about the path in `manifest.json`, not the filename itself).
2. Add or extend one subject entry in the matching semester's `subjects` array in `manifest.json` — a subject holds a list of `items`, each a numbered week or a freeform "special" entry:

```json
{
  "id": "y1-s1-cc104",
  "code": "CC104",
  "title": "Data Structures and Algorithms",
  "items": [
    {
      "id": "week-1",
      "kind": "week",
      "week": 1,
      "label": "Week 1 — Arrays & Complexity",
      "order": 1,
      "html": "assets/guides/year-1/sem-1/cc104/week-1.html"
    },
    {
      "id": "midterm-reviewer",
      "kind": "special",
      "label": "Midterm Reviewer",
      "order": 1000,
      "pdf": "assets/guides/year-1/sem-1/cc104/midterm-reviewer.pdf"
    }
  ]
}
```

An item needs at least one of `html`/`pdf` (both is fine too). `order` controls sort position in the sidebar and the admin's library tree — weeks conventionally use their week number, specials use `1000+` so they sort after every week.

3. Done — `script.js` and `index.html` need no changes either way.

## Adding a reference manually (without the admin page)

Same idea, one level shallower — no Year/Semester nesting, just a top-level `references` array of categories:

1. Drop the file(s) into `assets/references/{category-slug}/`, named however you like.
2. Add or extend one category entry in the top-level `references` array in `manifest.json`:

```json
{
  "id": "web-development",
  "label": "Web Development",
  "items": [
    {
      "id": "html-complete-reference",
      "title": "HTML Complete Reference",
      "order": 1,
      "html": "assets/references/web-development/html-complete-reference.html"
    }
  ]
}
```

3. Done — shows up in the sidebar under "Reference Library" the next time the page loads.

## Ask AI — how it works, and its real limit

Bring-your-own-key: your API key is typed into the settings drawer (gear icon), saved only to this browser's `localStorage`, sent only to the provider you picked — OpenRouter or Google Gemini. Nothing passes through a server in between.

When a guide is open **in HTML mode**, Ask AI reads the guide's visible text out of the iframe and includes it as context. **PDF mode is not readable** — the assistant says so and falls back to a general answer instead of pretending to have read a PDF it can't access. Real fix would be bundling `pdf.js` for client-side text extraction; not implemented.

## Videos — how it works

Also BYOK: paste a YouTube Data API key (free, from a Google Cloud project with "YouTube Data API v3" enabled) into its own settings drawer. Search runs through YouTube's `search` endpoint — API-key auth only, no OAuth login needed. Tapping a result's thumbnail swaps it for a live embedded player (via `youtube-nocookie.com`) right there in the panel, so a video plays without leaving the app.

## Known gaps

- **No PDF text extraction for Ask AI.**
- **No search across guide content** — sidebar filter matches subject codes/titles and item labels only, not what's inside each guide.
- **YouTube free quota caps around 100 searches/day per key** (10,000 units/day, 100 units per search) — BYOK avoids that being shared across everyone.
- **Admin page has no undo** — Delete removes the item's file(s) and manifest entry in the same action.

## License

MIT — see [LICENSE](./LICENSE).

---

*Part of the QCU Academic OS project — compiled by [KianoRoku18Ino](https://github.com/KianoRoku18Ino).*
