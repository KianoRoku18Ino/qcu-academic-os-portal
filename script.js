/* ============================================================
   QCU ACADEMIC OS — STUDY GUIDE PORTAL
   Three independent systems sharing one screen:
   1) Library — manifest.json drives the sidebar, grouped Year ->
      Semester -> Subject -> Item. A subject is a folder of items
      (numbered weeks and/or freeform "special" entries like a
      Midterm Reviewer), each its own html/pdf pair. Guides are
      normally added through /admin.html (paste a GitHub token,
      publish — it writes the file and updates manifest.json for
      you). Manual editing of manifest.json works too; nothing
      here needs to change either way, this file only ever reads it.
   2) Viewer — opens whichever item was clicked in an iframe,
      toggling between its HTML and PDF version if both exist.
   3) Tool panel — Ask AI (reads the open item, answers via
      OpenRouter or Gemini) and Videos (YouTube search + inline
      embedded playback), both BYOK: keys live only in localStorage
      and are sent only to that provider's own endpoint.
   ============================================================ */

(function () {
  "use strict";

  // Every dynamic string that lands in innerHTML anywhere in this file
  // goes through this first — manifest content (titles/labels) and API
  // responses (video titles, error messages) are not trusted input.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ================================================================
     PART 1 — SHELL: sidebar / tool panel open-close plumbing
     Every element grabbed here is looked up ONCE at the top so a
     typo shows up immediately (as a console error on load) instead
     of silently breaking one button deep into the file.
     ================================================================ */
  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");

  const openAiBtn = document.getElementById("openAiBtn");
  const openMsBtn = document.getElementById("openMsBtn");
  const toolPanel = document.getElementById("toolPanel");
  const panelBackdrop = document.getElementById("panelBackdrop");
  const panelCloseBtn = document.getElementById("panelCloseBtn");
  const gearBtn = document.getElementById("gearBtn");

  const tabAiBtn = document.getElementById("tabAiBtn");
  const tabMsBtn = document.getElementById("tabMsBtn");
  const askAiView = document.getElementById("askAiView");
  const mediaSearchView = document.getElementById("mediaSearchView");
  const aiSettings = document.getElementById("aiSettings");
  const msSettings = document.getElementById("msSettings");

  function openSidebar() {
    sidebar.classList.add("open");
    sidebarBackdrop.classList.add("open");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
  }
  hamburgerBtn.addEventListener("click", openSidebar);
  sidebarCloseBtn.addEventListener("click", closeSidebar);
  sidebarBackdrop.addEventListener("click", closeSidebar);

  // Which tool-panel tab is active ("ai" | "ms") — read by openPanel()
  // and by the gear button to know which settings drawer to toggle.
  let activeTab = "ai";

  function setActiveTab(tab) {
    activeTab = tab;
    tabAiBtn.classList.toggle("act", tab === "ai");
    tabMsBtn.classList.toggle("act", tab === "ms");
    askAiView.hidden = tab !== "ai";
    mediaSearchView.hidden = tab !== "ms";
    // Switching tabs always closes whichever settings drawer was open —
    // keeps the gear icon's open/closed state honest per tab.
    aiSettings.hidden = true;
    msSettings.hidden = true;
    gearBtn.classList.remove("open");
    gearBtn.setAttribute("aria-expanded", "false");
  }

  function openPanel(tab) {
    if (tab) setActiveTab(tab);
    toolPanel.classList.add("open");
    panelBackdrop.classList.add("open");
  }
  // THE close function — bound to the X button, the backdrop, and
  // Escape. Only ever removes the "open" class; never touches
  // display/visibility directly, so there's exactly one source of
  // truth for panel state (the class) and nothing can get out of sync.
  function closePanel() {
    toolPanel.classList.remove("open");
    panelBackdrop.classList.remove("open");
  }

  openAiBtn.addEventListener("click", () => openPanel("ai"));
  openMsBtn.addEventListener("click", () => openPanel("ms"));
  panelCloseBtn.addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", closePanel);
  tabAiBtn.addEventListener("click", () => setActiveTab("ai"));
  tabMsBtn.addEventListener("click", () => setActiveTab("ms"));

  gearBtn.addEventListener("click", () => {
    const drawer = activeTab === "ai" ? aiSettings : msSettings;
    const nowOpen = drawer.hidden; // hidden -> about to open
    drawer.hidden = !nowOpen;
    gearBtn.classList.toggle("open", nowOpen);
    gearBtn.setAttribute("aria-expanded", String(nowOpen));
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!aiSettings.hidden) { aiSettings.hidden = true; gearBtn.classList.remove("open"); return; }
    if (!msSettings.hidden) { msSettings.hidden = true; gearBtn.classList.remove("open"); return; }
    if (toolPanel.classList.contains("open")) { closePanel(); return; }
    if (sidebar.classList.contains("open")) { closeSidebar(); return; }
  });

  /* ================================================================
     PART 2 — LIBRARY: fetch manifest.json, render the sidebar
     manifest.json nests years -> semesters -> subjects -> items.
     A subject is a folder; each item inside it (a numbered week, or
     a freeform "special" entry like a Midterm Reviewer) is its own
     html/pdf pair. It's flattened once into allItems for search —
     each item keeps its subject's id/code/title and a groupLabel
     ("Year 1 · Semester 1") so rendering can re-group by subject
     and by term, same idea as v2's flat "category" grouping just
     one level deeper. Item ids ("week-1") repeat across subjects,
     so every item also gets a uid ("<subjectId>::<itemId>") that's
     the only thing ever used to look one back up or highlight it.
     ================================================================ */
  const guideListEl = document.getElementById("guideList");
  const sidebarSearchEl = document.getElementById("sidebarSearch");
  let allItems = [];
  // Manually expanded/collapsed subjects, keyed by subjectId. A filter
  // in progress force-expands whatever matched (see renderGuideList)
  // without touching this set, so the manual state is exactly what's
  // restored once the search box is cleared.
  const expandedSubjects = new Set();

  function subjectHeaderHTML(subjectId, subj, isOpen) {
    return (
      '<button class="gl-subject-head' + (isOpen ? " open" : "") + '" data-subject-id="' +
      escapeHtml(subjectId) + '" type="button" aria-expanded="' + isOpen + '">' +
      '<span class="gl-subject-chevron">' + (isOpen ? "▾" : "▸") + "</span>" +
      '<span class="gl-item-code">' + escapeHtml(subj.code) + "</span>" +
      '<span class="gl-item-title">' + escapeHtml(subj.title) + "</span>" +
      "</button>"
    );
  }

  function itemRowHTML(it) {
    return (
      '<button class="gl-item sub" data-uid="' + escapeHtml(it.uid) + '" type="button">' +
      '<span class="gl-item-title">' + escapeHtml(it.label) + "</span>" +
      "</button>"
    );
  }

  function renderGuideList(filterText) {
    if (allItems.length === 0) {
      guideListEl.innerHTML =
        '<div class="gl-empty">No guides published yet.<br>Tap the ✎ icon above to publish your first one.</div>';
      return;
    }

    const q = (filterText || "").trim().toLowerCase();
    const filtered = q
      ? allItems.filter((it) =>
          (it.subjectCode + " " + it.subjectTitle + " " + it.label).toLowerCase().includes(q)
        )
      : allItems;

    if (filtered.length === 0) {
      guideListEl.innerHTML = '<div class="gl-empty">No guides match "' + escapeHtml(q) + '".</div>';
      return;
    }

    // Group by groupLabel, then by subject, preserving first-seen order
    // (Object insertion order is guaranteed for string keys in every
    // modern JS engine). allItems was built in year/semester/manifest
    // order in loadLibrary(), so groups and subjects come out in that
    // same order automatically.
    const groups = {};
    filtered.forEach((it) => {
      const gl = it.groupLabel || "Guides";
      if (!groups[gl]) groups[gl] = {};
      if (!groups[gl][it.subjectId]) {
        groups[gl][it.subjectId] = { code: it.subjectCode, title: it.subjectTitle, items: [] };
      }
      groups[gl][it.subjectId].items.push(it);
    });

    let html = "";
    Object.keys(groups).forEach((gl) => {
      html += '<div class="gl-section-title">' + escapeHtml(gl) + "</div>";
      const subjMap = groups[gl];
      Object.keys(subjMap).forEach((subjectId) => {
        const subj = subjMap[subjectId];
        // While filtering, every subject left in `groups` already has
        // at least one matching item — show it open so the match is
        // actually visible instead of hidden behind a collapsed head.
        const isOpen = q ? true : expandedSubjects.has(subjectId);
        html += subjectHeaderHTML(subjectId, subj, isOpen);
        if (isOpen) html += subj.items.map(itemRowHTML).join("");
      });
    });
    guideListEl.innerHTML = html;

    // Re-highlight whichever item is currently open, if it's still
    // in the filtered/expanded list.
    if (currentGuide) {
      const btn = guideListEl.querySelector('[data-uid="' + currentGuide.uid + '"]');
      if (btn) btn.classList.add("act");
    }
  }

  // Delegated click listener — one binding for the whole list instead
  // of one per button, so newly-rendered items (after a search filter
  // or an expand/collapse) work automatically with no re-binding needed.
  guideListEl.addEventListener("click", (e) => {
    const subjBtn = e.target.closest(".gl-subject-head");
    if (subjBtn) {
      const sid = subjBtn.dataset.subjectId;
      if (expandedSubjects.has(sid)) expandedSubjects.delete(sid);
      else expandedSubjects.add(sid);
      renderGuideList(sidebarSearchEl.value);
      return;
    }
    const btn = e.target.closest(".gl-item");
    if (!btn) return;
    const item = allItems.find((it) => it.uid === btn.dataset.uid);
    if (item) openGuide(item);
  });

  sidebarSearchEl.addEventListener("input", () => renderGuideList(sidebarSearchEl.value));

  async function loadLibrary() {
    try {
      const res = await fetch("manifest.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const years = data.years || [];
      allItems = [];
      years.forEach((y) => {
        (y.semesters || []).forEach((s) => {
          (s.subjects || []).forEach((subj) => {
            const groupLabel = (y.label || "Year " + y.year) + " · " + (s.label || "Semester " + s.sem);
            (subj.items || []).forEach((item) => {
              allItems.push(Object.assign({}, item, {
                uid: subj.id + "::" + item.id,
                subjectId: subj.id,
                subjectCode: subj.code,
                subjectTitle: subj.title,
                groupLabel: groupLabel,
              }));
            });
          });
        });
      });
      renderGuideList("");
    } catch (err) {
      // Almost always means the site was opened via file:// instead of
      // being served — fetch() can't read local files under that
      // protocol. Say so directly instead of a bare "failed to fetch".
      guideListEl.innerHTML =
        '<div class="gl-error">Couldn\'t load the library (' + escapeHtml(err.message) + "). " +
        "This page needs to be served over http(s) — file:// won't work. " +
        "Locally: <code>python3 -m http.server</code>. Deployed: GitHub Pages does this automatically.</div>";
    }
  }

  /* ================================================================
     PART 3 — VIEWER: open an item, toggle HTML/PDF
     ================================================================ */
  const viewerEmpty = document.getElementById("viewerEmpty");
  const viewerActive = document.getElementById("viewerActive");
  const viewerFrame = document.getElementById("viewerFrame");
  const vhCode = document.getElementById("vhCode");
  const vhTitle = document.getElementById("vhTitle");
  const formatHtmlBtn = document.getElementById("formatHtmlBtn");
  const formatPdfBtn = document.getElementById("formatPdfBtn");
  const openNewTabBtn = document.getElementById("openNewTabBtn");

  let currentGuide = null;    // the flattened item object (with subjectCode/subjectTitle/label/uid), or null
  let currentFormat = "html"; // "html" | "pdf" — which version is showing

  function renderViewerHeader() {
    vhCode.textContent = currentGuide.subjectCode;
    vhTitle.textContent = currentGuide.subjectTitle + " — " + currentGuide.label;
    formatHtmlBtn.disabled = !currentGuide.html;
    formatPdfBtn.disabled = !currentGuide.pdf;
    formatHtmlBtn.classList.toggle("act", currentFormat === "html");
    formatPdfBtn.classList.toggle("act", currentFormat === "pdf");
    const src = currentFormat === "html" ? currentGuide.html : currentGuide.pdf;
    openNewTabBtn.href = src;
  }

  function openGuide(item, format) {
    currentGuide = item;
    currentFormat = format || (item.html ? "html" : "pdf");
    viewerEmpty.hidden = true;
    viewerActive.hidden = false;
    viewerFrame.src = currentFormat === "html" ? item.html : item.pdf;
    renderViewerHeader();
    updateAiContextBanner();
    aiHistory = []; // new item = new context; old turns would reference the wrong one

    // Re-highlight the active row in the sidebar.
    guideListEl.querySelectorAll(".gl-item").forEach((el) => el.classList.remove("act"));
    const btn = guideListEl.querySelector('[data-uid="' + item.uid + '"]');
    if (btn) btn.classList.add("act");

    closeSidebar(); // mobile: picking a guide should return focus to the reading pane
  }

  formatHtmlBtn.addEventListener("click", () => {
    if (!currentGuide || !currentGuide.html || currentFormat === "html") return;
    openGuide(currentGuide, "html");
  });
  formatPdfBtn.addEventListener("click", () => {
    if (!currentGuide || !currentGuide.pdf || currentFormat === "pdf") return;
    openGuide(currentGuide, "pdf");
  });

  /* ================================================================
     PART 4 — ASK AI
     ================================================================ */
  const aiProviderSelect = document.getElementById("aiProviderSelect");
  const aiModelInput = document.getElementById("aiModelInput");
  const aiKeyInput = document.getElementById("aiKeyInput");
  const aiSaveBtn = document.getElementById("aiSaveBtn");
  const aiHintOpenrouter = document.getElementById("aiHintOpenrouter");
  const aiHintGemini = document.getElementById("aiHintGemini");
  const aiContextBanner = document.getElementById("aiContextBanner");
  const aiFeed = document.getElementById("aiFeed");
  const aiFeedEmpty = document.getElementById("aiFeedEmpty");
  const aiQuestion = document.getElementById("aiQuestion");
  const aiSendBtn = document.getElementById("aiSendBtn");

  const AI_STORAGE_KEY = "qcuAcademicOsAiSettings";
  const AI_MODEL_DEFAULTS = { openrouter: "openrouter/free", gemini: "gemini-3.6-flash" };

  // Conversation memory: without this, every question was sent to the API
  // as a fresh, isolated request — the model had no idea what "them" or
  // "yes" referred to because it never saw the earlier turns, even though
  // they were still visible in the feed. Capped so a long chat plus a big
  // guide-text system prompt doesn't blow past free-tier context limits.
  let aiHistory = [];
  const MAX_HISTORY_MESSAGES = 10; // last ~5 question/answer pairs

  const clearChatBtn = document.getElementById("clearChatBtn");
  clearChatBtn.addEventListener("click", () => {
    aiHistory = [];
    aiFeed.innerHTML = '<div class="feed-empty" id="aiFeedEmpty">Questions and answers will show up here.</div>';
  });

  function syncAiProviderUI() {
    const provider = aiProviderSelect.value;
    aiHintOpenrouter.hidden = provider !== "openrouter";
    aiHintGemini.hidden = provider !== "gemini";
    const current = aiModelInput.value.trim();
    const isDefaultOrEmpty = current === "" || Object.values(AI_MODEL_DEFAULTS).includes(current);
    if (isDefaultOrEmpty) aiModelInput.value = AI_MODEL_DEFAULTS[provider];
  }
  aiProviderSelect.addEventListener("change", syncAiProviderUI);

  function loadAiSettings() {
    try {
      const raw = localStorage.getItem(AI_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.provider) aiProviderSelect.value = saved.provider;
        if (saved.model) aiModelInput.value = saved.model;
        if (saved.key) aiKeyInput.value = saved.key;
      }
    } catch (err) {
      console.warn("Could not load saved Ask AI settings:", err);
    }
    syncAiProviderUI();
  }

  aiSaveBtn.addEventListener("click", () => {
    try {
      localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({
        provider: aiProviderSelect.value,
        model: aiModelInput.value.trim(),
        key: aiKeyInput.value.trim(),
      }));
      aiSaveBtn.textContent = "Saved";
      aiSaveBtn.classList.add("saved");
      setTimeout(() => { aiSaveBtn.textContent = "Save"; aiSaveBtn.classList.remove("saved"); }, 1400);
    } catch (err) {
      console.warn("Could not save Ask AI settings:", err);
    }
  });

  function updateAiContextBanner() {
    if (!currentGuide) {
      aiContextBanner.textContent = "Open a guide first, then ask a question about what's on the page.";
      aiContextBanner.classList.remove("has-guide");
      return;
    }
    const label = currentGuide.subjectCode + " — " + currentGuide.subjectTitle + " (" + currentGuide.label + ")";
    if (currentFormat === "pdf") {
      aiContextBanner.textContent = "Reading: " + label + " (PDF mode — switch to HTML to let Ask AI read the page content).";
    } else {
      aiContextBanner.textContent = "Reading: " + label;
    }
    aiContextBanner.classList.add("has-guide");
  }

  // Pulls plain text out of the currently open item's iframe. Only
  // works in HTML mode and only same-origin (true once this is served
  // from its own domain, e.g. GitHub Pages) — returns null otherwise
  // so the caller can fall back to a plain, guide-less answer instead
  // of throwing. PDF text extraction isn't implemented (would need
  // pdf.js bundled in) — that's a known gap, not a silent failure.
  const MAX_CONTEXT_CHARS = 15000;
  function extractGuideText() {
    if (!currentGuide || currentFormat !== "html") return null;
    try {
      const doc = viewerFrame.contentDocument;
      if (!doc || !doc.body) return null;
      const text = doc.body.innerText || "";
      return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS) + "\n…(truncated)" : text;
    } catch (err) {
      // Cross-origin access throws a SecurityError — expected if this
      // file is ever opened somewhere the guide isn't same-origin.
      return null;
    }
  }

  function addAiMessage(text, cls) {
    if (aiFeedEmpty && aiFeedEmpty.parentElement) aiFeedEmpty.remove();
    const div = document.createElement("div");
    div.className = "msg " + cls;
    div.textContent = text;
    aiFeed.appendChild(div);
    aiFeed.scrollTop = aiFeed.scrollHeight;
    return div;
  }

  // Block-level Markdown-to-HTML: headings, tables, blockquotes, lists,
  // and paragraphs (with real line breaks), plus bold/code/italic inline.
  // Every fragment is HTML-escaped before any tag is added, so no matter
  // what the API returns, the only tags that can ever land on the page
  // are the ones this function creates itself.
  function inlineMd(s) {
    return s
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  }
  function isTableRow(line) { return /^\|.*\|$/.test(line.trim()); }
  function isTableSeparator(line) {
    const t = line.trim();
    return /^\|?[-:\s|]+\|?$/.test(t) && t.includes("-") && t.includes("|");
  }
  function tableCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  }

  function formatAiAnswer(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      // Heading: # / ## / ### / ####
      let m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) {
        const level = Math.min(m[1].length + 2, 6);
        blocks.push(`<h${level} class="msg-h">${inlineMd(escapeHtml(m[2].trim()))}</h${level}>`);
        i++; continue;
      }

      // Table: a row line immediately followed by a |---|---| separator
      if (isTableRow(line) && lines[i + 1] && isTableSeparator(lines[i + 1])) {
        const head = tableCells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) { rows.push(tableCells(lines[i])); i++; }
        let html = '<table class="msg-table"><thead><tr>' +
          head.map((c) => `<th>${inlineMd(escapeHtml(c))}</th>`).join("") + "</tr></thead><tbody>";
        rows.forEach((r) => { html += "<tr>" + r.map((c) => `<td>${inlineMd(escapeHtml(c))}</td>`).join("") + "</tr>"; });
        blocks.push(html + "</tbody></table>");
        continue;
      }

      // Blockquote: consecutive lines starting with ">"
      if (/^>\s?/.test(line)) {
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
        blocks.push(`<blockquote class="msg-quote">${inlineMd(escapeHtml(q.join(" ")))}</blockquote>`);
        continue;
      }

      // Unordered list
      if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i++; }
        blocks.push('<ul class="msg-list">' + items.map((it) => `<li>${inlineMd(escapeHtml(it))}</li>`).join("") + "</ul>");
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
        blocks.push('<ol class="msg-list">' + items.map((it) => `<li>${inlineMd(escapeHtml(it))}</li>`).join("") + "</ol>");
        continue;
      }

      // Paragraph: consecutive plain lines, joined with a space
      const p = [];
      while (
        i < lines.length && lines[i].trim() &&
        !/^(#{1,4})\s+/.test(lines[i]) && !/^>\s?/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) && !isTableRow(lines[i])
      ) { p.push(lines[i]); i++; }
      blocks.push(`<p>${inlineMd(escapeHtml(p.join(" ")))}</p>`);
    }

    return blocks.join("");
  }

  const AI_BASE_PROMPT =
    "You are the Ask AI assistant embedded in the QCU Academic OS study guide portal. " +
    "When study guide content is included below, answer using it and stay accurate to it — " +
    "don't contradict it. If no guide content is included, or the question isn't covered by " +
    "it, say so plainly, then answer generally if you can. Keep answers concise. You may use " +
    "Markdown: **bold**, `inline code`, *italic*, ### headings, - bullet or 1. numbered lists, " +
    "> blockquotes, and | table | syntax where a table genuinely fits. Don't overuse headings " +
    "or tables for short answers — plain paragraphs are fine for anything simple.";

  async function askGemini(history, model, apiKey, systemPrompt) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);
    const contents = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : "Request failed (HTTP " + res.status + ")";
      throw new Error(msg);
    }
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) throw new Error("The API responded but returned no answer text.");
    return text.trim();
  }

  async function askOpenRouter(history, model, apiKey, systemPrompt) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "HTTP-Referer": window.location.href,
        "X-Title": "QCU Academic OS Portal",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Free-tier rate limit hit (20/minute or 50/day). Wait a moment, or keep using openrouter/free so it can fall back to a different free model automatically.");
      }
      const msg = data && data.error && data.error.message ? data.error.message : "Request failed (HTTP " + res.status + ")";
      throw new Error(msg);
    }
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error("The API responded but returned no answer text.");
    return text.trim();
  }

  async function handleAsk() {
    const question = aiQuestion.value.trim();
    if (!question) return;

    const apiKey = aiKeyInput.value.trim();
    if (!apiKey) {
      aiSettings.hidden = false;
      gearBtn.classList.add("open");
      gearBtn.setAttribute("aria-expanded", "true");
      addAiMessage("Add your API key above before asking a question.", "a error");
      return;
    }

    const provider = aiProviderSelect.value;
    const model = aiModelInput.value.trim() || AI_MODEL_DEFAULTS[provider];
    const guideText = extractGuideText();
    const systemPrompt = guideText
      ? AI_BASE_PROMPT + "\n\n--- Currently open guide: " + currentGuide.subjectCode + " — " +
        currentGuide.subjectTitle + " (" + currentGuide.label + ") ---\n" + guideText
      : AI_BASE_PROMPT;

    addAiMessage(question, "q");
    aiQuestion.value = "";
    const pending = addAiMessage("Thinking…", "a pending");
    aiSendBtn.disabled = true;

    aiHistory.push({ role: "user", content: question });
    if (aiHistory.length > MAX_HISTORY_MESSAGES) aiHistory = aiHistory.slice(-MAX_HISTORY_MESSAGES);

    try {
      const answer = provider === "openrouter"
        ? await askOpenRouter(aiHistory, model, apiKey, systemPrompt)
        : await askGemini(aiHistory, model, apiKey, systemPrompt);
      aiHistory.push({ role: "assistant", content: answer });
      pending.innerHTML = formatAiAnswer(answer);
      pending.className = "msg a";
    } catch (err) {
      aiHistory.pop(); // drop the unanswered question — don't leave a dangling turn for next time
      pending.textContent = "Couldn't get an answer: " + err.message;
      pending.className = "msg a error";
    } finally {
      aiSendBtn.disabled = false;
      aiFeed.scrollTop = aiFeed.scrollHeight;
    }
  }

  aiSendBtn.addEventListener("click", handleAsk);
  aiQuestion.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); }
  });
  // Let the textarea grow with content, up to the CSS max-height cap.
  aiQuestion.addEventListener("input", () => {
    aiQuestion.style.height = "auto";
    aiQuestion.style.height = aiQuestion.scrollHeight + "px";
  });

  /* ================================================================
     PART 5 — VIDEOS (YouTube Data API, BYOK)
     Search runs through YouTube's `search` endpoint (API-key auth,
     no OAuth needed — same BYOK shape as everything else in this
     app). Results render as thumbnail cards; tapping one swaps its
     thumbnail for a live embedded player in place, so a video plays
     right there in the panel instead of bouncing out to youtube.com.
     ================================================================ */
  const msKeyInput = document.getElementById("msKeyInput");
  const msSaveBtn = document.getElementById("msSaveBtn");
  const msQuery = document.getElementById("msQuery");
  const msSearchBtn = document.getElementById("msSearchBtn");
  const msResults = document.getElementById("msResults");
  const msResultsEmpty = document.getElementById("msResultsEmpty");

  // Renamed from the old Unsplash-era key (qcuAcademicOsMsSettings) since
  // the stored shape changed meaning (Unsplash Access Key -> YouTube API
  // key). Any old value just sits unused under its old name.
  const YT_STORAGE_KEY = "qcuAcademicOsYtSettings";

  function loadMsSettings() {
    try {
      const raw = localStorage.getItem(YT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.key) msKeyInput.value = saved.key;
      }
    } catch (err) {
      console.warn("Could not load saved Videos settings:", err);
    }
  }

  msSaveBtn.addEventListener("click", () => {
    try {
      localStorage.setItem(YT_STORAGE_KEY, JSON.stringify({ key: msKeyInput.value.trim() }));
      msSaveBtn.textContent = "Saved";
      msSaveBtn.classList.add("saved");
      setTimeout(() => { msSaveBtn.textContent = "Save"; msSaveBtn.classList.remove("saved"); }, 1400);
    } catch (err) {
      console.warn("Could not save Videos settings:", err);
    }
  });

  function ytCardHTML(video) {
    const vid = video.id && video.id.videoId;
    if (!vid) return "";
    const sn = video.snippet || {};
    const thumb = sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default);
    const title = sn.title || "Untitled";
    const channel = sn.channelTitle || "Unknown channel";
    return (
      '<div class="ms-card yt-card">' +
      '<button class="yt-thumb-btn" type="button" data-vid="' + escapeHtml(vid) + '" aria-label="Play ' + escapeHtml(title) + '">' +
      (thumb ? '<img src="' + escapeHtml(thumb.url) + '" alt="" loading="lazy">' : "") +
      '<span class="yt-play-badge" aria-hidden="true">▶</span>' +
      "</button>" +
      '<div class="ms-card-credit">' + escapeHtml(title) + "<br>" +
      '<a href="https://www.youtube.com/watch?v=' + encodeURIComponent(vid) + '" target="_blank" rel="noopener">' +
      escapeHtml(channel) + "</a> on YouTube</div>" +
      "</div>"
    );
  }

  // Delegated: swaps a card's thumbnail button for a live embed on click,
  // instead of every card getting its own listener at render time.
  msResults.addEventListener("click", (e) => {
    const btn = e.target.closest(".yt-thumb-btn");
    if (!btn) return;
    const vid = btn.dataset.vid;
    const wrap = document.createElement("div");
    wrap.className = "yt-embed-wrap";
    wrap.innerHTML =
      '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(vid) + '?autoplay=1" ' +
      'title="YouTube video player" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    btn.replaceWith(wrap);
  });

  async function handleMsSearch() {
    const query = msQuery.value.trim();
    if (!query) return;

    const key = msKeyInput.value.trim();
    if (!key) {
      msSettings.hidden = false;
      gearBtn.classList.add("open");
      gearBtn.setAttribute("aria-expanded", "true");
      msResults.innerHTML = '<div class="gl-error">Add your YouTube API key above before searching.</div>';
      return;
    }

    msSearchBtn.disabled = true;
    msResults.innerHTML = '<div class="feed-empty">Searching…</div>';

    try {
      const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=" +
        encodeURIComponent(query) + "&key=" + encodeURIComponent(key);
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data && data.error && data.error.message ? data.error.message : "Request failed (HTTP " + res.status + ")";
        throw new Error(msg);
      }
      const results = (data && data.items) || [];
      if (results.length === 0) {
        msResults.innerHTML = '<div class="feed-empty">No results for "' + escapeHtml(query) + '".</div>';
        return;
      }
      msResults.innerHTML = results.map(ytCardHTML).join("");
    } catch (err) {
      msResults.innerHTML = '<div class="gl-error">Search failed: ' + escapeHtml(err.message) + "</div>";
    } finally {
      msSearchBtn.disabled = false;
    }
  }

  msSearchBtn.addEventListener("click", handleMsSearch);
  msQuery.addEventListener("keydown", (e) => { if (e.key === "Enter") handleMsSearch(); });

  /* ================================================================
     PART 6 — BOOT
     ================================================================ */
  loadAiSettings();
  loadMsSettings();
  updateAiContextBanner();
  loadLibrary();
})();
