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
- **Notes.** A third item type, alongside weeks/specials (and reference docs) — just markdown text, no file, no upload. Publish one from either publish card by switching its type tab to "Note"; it's written straight into `manifest.json` and shows up in the sidebar tagged `note`, rendered with the same Markdown formatter Ask AI's answers already use. Fastest possible way to jot something down without touching a file at all.
- **The sidebar library now bypasses the browser/CDN cache on every load** — a plain `fetch("manifest.json")` could serve a stale copy for a while after a fresh publish (GitHub Pages sits behind a CDN); it's now fetched with a cache-busting timestamp and `cache: "no-store"`, so what you just published always shows up (once GitHub Pages finishes its own ~30–90s rebuild).
- **Ask AI keys are now per-provider.** OpenRouter and Gemini used to share one key/model field — pasting a Gemini key while OpenRouter's was still in the field would silently misroute it. Each provider now keeps its own saved key and model; switching the dropdown just changes which one's showing.
- **PPTX/DOCX/XLSX support.** An item — whether a subject item or a reference — can now carry any combination of HTML/PDF/PPTX/DOCX/XLSX, not just HTML/PDF. Office formats render through Microsoft's free Office Online viewer (just needs the file at a public URL, which GitHub Pages already gives it — no account, no API key). The viewer header's format toggle is now built dynamically per item instead of two fixed buttons, showing one button per format that item actually has. A dedicated Download button (separate from "open in new tab") always points at the raw file, never the Office Online wrapper — works the same for every format, including HTML/PDF.
- **Videos: fullscreen actually works now, and playback opens in a proper lightbox.** The embedded player's `allow` list was missing the `fullscreen` permission (present but non-functional fullscreen button). Playback also no longer happens inline inside a ~180px results-grid card — tapping a thumbnail now opens a full-viewport lightbox, so the player is always a real, controllable size regardless of how the results grid is laid out.
- **"Suggest a guide" for visitors.** A button at the bottom of the sidebar opens a small form (type, subject, description) that submits as a pre-filled GitHub Issue — no backend, no configuration; owner/repo are read straight off the page's own URL. A plain-email fallback (`mailto:`, edit the address at the top of Part 6 in `script.js`) covers anyone without a GitHub account. If you'd rather use a Google Form instead — friendlier for classmates who aren't developers — that's a manual one-time setup on your end (create the form, send me the URL) and I can wire it in alongside this.
- **Large files now publish automatically, no size limit worth thinking about.** `putFile()` checks the size of what it's about to upload and transparently routes anything over ~1 MB through the Git Data API (create a blob, graft it into a new tree, commit, move the branch ref) instead of the simple one-call Contents API PUT that has that ~1 MB ceiling. Every publish flow calls the exact same function either way — which path actually ran under the hood isn't something you ever need to think about. Works up to ~100 MB.
- **External site embeds.** A fourth item type — `kind:"link"` — for embedding an external URL directly in the viewer (freeCodeCamp, W3Schools, whatever). Just a URL, no file. One real caveat that can't be engineered away: whether the target site actually allows being framed is entirely up to that site's own headers, and there's no way for JavaScript to detect a silent embed failure — test a URL yourself before relying on it. "Open in new tab" always works as a fallback regardless.
- **Fixed an orphaned-file bug from the PPTX/DOCX/XLSX update.** Deleting an item only ever removed its `html`/`pdf` files — the new pptx/docx/xlsx fields were never wired into delete. Caught and fixed while building the link feature above; deleting an item now removes every file field it has.
- **Sidebar/admin UI polish.** Group headers (subjects, reference categories) now show an item count. The admin page's "Published guides"/"Published references" trees are collapsible now too, same tap-to-expand pattern as the sidebar, instead of always rendering every item for every subject at once. The publish forms hide the PPTX/DOCX/XLSX file pickers behind a "+ Add PPTX / DOCX / XLSX" toggle by default — most guides are just HTML, maybe +PDF, so the common case isn't buried under three file pickers most publishes won't use. Deliberately did *not* add per-format badges to sidebar rows (HTML/PDF/PPTX/…) — felt like clutter for information the format-toggle already shows the moment you open something; the `note`/`link` kind tags stay, since those behave fundamentally differently (no file at all) rather than just offering another format.

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
- Large files publish automatically through the Git Data API instead of the simple Contents API once they cross ~1 MB — same Publish button either way, it just takes a few extra API round-trips under the hood for anything that size or bigger. Works up to ~100 MB (the Git blob ceiling); genuinely huge files beyond that still need pushing with git normally — the portal doesn't care how a file got into `assets/guides/` or `assets/references/`, only that `manifest.json` points at it.
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
    },
    {
      "id": "profs-note",
      "kind": "note",
      "label": "Prof's note",
      "order": 1001,
      "text": "Midterm covers **chapters 1-3 only**, per the announcement in class."
    }
  ]
}
```

A week/special item needs at least one of `html`/`pdf` (both is fine too). A `kind:"note"` item has neither — it carries `text` (Markdown) directly instead, rendered inline with no file involved at all. `order` controls sort position in the sidebar and the admin's library tree — weeks conventionally use their week number, specials and notes use `1000+` so they sort after every week, interleaved in whatever order they were added.

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

- **No PDF/PPTX/DOCX/XLSX text extraction for Ask AI** — it can only read the page content of an HTML-format item. Viewing/downloading those formats works regardless; Ask AI just can't see inside them yet.
- **No search across guide content** — sidebar filter matches subject codes/titles and item labels only, not what's inside each guide.
- **YouTube free quota caps around 100 searches/day per key** (10,000 units/day, 100 units per search) — BYOK avoids that being shared across everyone.
- **Admin page has no undo** — Delete removes the item's file(s) and manifest entry in the same action.

## License

MIT — see [LICENSE](./LICENSE).

---

*Part of the QCU Academic OS project — compiled by [KianoRoku18Ino](https://github.com/KianoRoku18Ino).*
