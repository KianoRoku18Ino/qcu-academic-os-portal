/* ============================================================
   QCU ACADEMIC OS — ADMIN
   A browser-only CMS: every write goes straight from this page to
   api.github.com using a personal access token you paste in below.
   There's no server of ours in between and the token is never
   written into any file this page publishes — it only ever lives
   in sessionStorage (default) or localStorage (if you opt in) on
   this device.

   Flow:
   1) Connect — validate the token against the repo, show who/what
      it can write to.
   2) Publish — a subject is a folder; each item inside it (a
      numbered week, or a freeform "special" entry like a Midterm
      Reviewer) is its own upload. Uploads the HTML (+ optional PDF)
      to assets/guides/year-{n}/sem-{n}/{subject-slug}/{item-slug}.*,
      then read-modify-writes manifest.json so the portal picks it
      up — without touching the subject's other items.
   3) Library — re-reads manifest.json and lists what's there,
      grouped by subject, with a delete action per item (removes
      the files + the entry; a subject with no items left is
      dropped from the manifest too).
   ============================================================ */

(function () {
  "use strict";

  const API = "https://api.github.com";

  // Every dynamic string that lands in innerHTML anywhere in this file
  // goes through this — manifest content (codes/titles/labels) and
  // GitHub API error messages are not trusted input.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ================================================================
     STORAGE — token + repo target, session-only unless "remember"
     is checked. Two independent stores so checking/unchecking the
     box later doesn't leave a stale copy sitting in the other one.
     ================================================================ */
  const STORAGE_KEY = "qcuAdminGh";

  function saveConnection(conn, remember) {
    const raw = JSON.stringify(conn);
    if (remember) {
      localStorage.setItem(STORAGE_KEY, raw);
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, raw);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function loadConnection() {
    try {
      const fromSession = sessionStorage.getItem(STORAGE_KEY);
      if (fromSession) return { conn: JSON.parse(fromSession), remembered: false };
      const fromLocal = localStorage.getItem(STORAGE_KEY);
      if (fromLocal) return { conn: JSON.parse(fromLocal), remembered: true };
    } catch (err) {
      console.warn("Could not read saved connection:", err);
    }
    return null;
  }

  /* ================================================================
     GITHUB API HELPERS
     ================================================================ */
  function authHeaders(token) {
    return {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function textToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToText(b64) {
    const binary = atob(b64.replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function ghJson(res) {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.message) || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return data;
  }

  async function getFile(owner, repo, branch, token, path) {
    const res = await fetch(
      API + "/repos/" + owner + "/" + repo + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(branch),
      { headers: authHeaders(token) }
    );
    if (res.status === 404) return null;
    return ghJson(res);
  }

  async function putFile(owner, repo, branch, token, path, base64Content, message, existingSha) {
    const body = { message: message, content: base64Content, branch: branch };
    if (existingSha) body.sha = existingSha;
    const res = await fetch(API + "/repos/" + owner + "/" + repo + "/contents/" + encodePath(path), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify(body),
    });
    return ghJson(res);
  }

  async function deleteFile(owner, repo, branch, token, path, sha, message) {
    const res = await fetch(API + "/repos/" + owner + "/" + repo + "/contents/" + encodePath(path), {
      method: "DELETE",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ message: message, sha: sha, branch: branch }),
    });
    return ghJson(res);
  }

  // Read-modify-write manifest.json. mutatorFn receives the parsed
  // object and mutates it in place; whatever it returns (or nothing —
  // the mutation itself is enough) gets re-serialized and pushed back
  // with the sha we just read, so a concurrent edit from elsewhere
  // would surface as a normal 409/422 rather than silently clobbering.
  async function updateManifest(owner, repo, branch, token, mutatorFn, message) {
    const file = await getFile(owner, repo, branch, token, "manifest.json");
    if (!file) throw new Error("manifest.json not found in this repo/branch.");
    const manifest = JSON.parse(base64ToText(file.content));
    mutatorFn(manifest);
    const newContent = textToBase64(JSON.stringify(manifest, null, 2) + "\n");
    return putFile(owner, repo, branch, token, "manifest.json", newContent, message, file.sha);
  }

  function findSemester(manifest, year, sem) {
    const y = (manifest.years || []).find((yy) => yy.year === year);
    if (!y) throw new Error("Year " + year + " isn't in manifest.json.");
    const s = (y.semesters || []).find((ss) => ss.sem === sem);
    if (!s) throw new Error("Semester " + sem + " isn't in manifest.json for Year " + year + ".");
    return s;
  }

  function slugify(text) {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  }

  /* ================================================================
     PART 1 — CONNECT
     ================================================================ */
  const ghOwnerEl = document.getElementById("ghOwner");
  const ghRepoEl = document.getElementById("ghRepo");
  const ghBranchEl = document.getElementById("ghBranch");
  const ghTokenEl = document.getElementById("ghToken");
  const ghRememberEl = document.getElementById("ghRemember");
  const ghConnectBtn = document.getElementById("ghConnectBtn");
  const connectStatus = document.getElementById("connectStatus");
  const scopeNote = document.getElementById("scopeNote");
  const publishCard = document.getElementById("publishCard");
  const libraryCard = document.getElementById("libraryCard");
  const refPublishCard = document.getElementById("refPublishCard");
  const refLibraryCard = document.getElementById("refLibraryCard");

  let activeConn = null; // { owner, repo, branch, token } once connected

  function statusEl(el, text, kind) {
    el.textContent = text;
    el.className = "admin-status" + (kind ? " " + kind : "");
  }

  async function connect() {
    const owner = ghOwnerEl.value.trim();
    const repo = ghRepoEl.value.trim();
    const branch = ghBranchEl.value.trim() || "main";
    const token = ghTokenEl.value.trim();

    if (!owner || !repo || !token) {
      statusEl(connectStatus, "Fill in owner, repo, and token first.", "error");
      return;
    }

    ghConnectBtn.disabled = true;
    statusEl(connectStatus, "Checking access…", "");

    try {
      const res = await fetch(API + "/repos/" + owner + "/" + repo, { headers: authHeaders(token) });
      const data = await ghJson(res);
      const canPush = data.permissions && data.permissions.push;
      if (!canPush) {
        statusEl(
          connectStatus,
          "Token works but doesn't have write access to " + owner + "/" + repo + ". Check the token's repository access and permissions.",
          "error"
        );
        ghConnectBtn.disabled = false;
        return;
      }

      activeConn = { owner, repo, branch, token };
      saveConnection(activeConn, ghRememberEl.checked);
      scopeNote.textContent = "Connected — " + owner + "/" + repo + " @ " + branch;
      statusEl(connectStatus, "Connected. Write access confirmed.", "success");
      publishCard.hidden = false;
      libraryCard.hidden = false;
      refPublishCard.hidden = false;
      refLibraryCard.hidden = false;
      loadLibraryTree();
      loadReferenceLibraryTree();
    } catch (err) {
      statusEl(connectStatus, "Couldn't connect: " + err.message, "error");
    } finally {
      ghConnectBtn.disabled = false;
    }
  }

  ghConnectBtn.addEventListener("click", connect);

  // Restore a saved connection on load, but still re-validate it —
  // a token can expire or be revoked between sessions.
  (function restoreConnection() {
    const saved = loadConnection();
    if (!saved) return;
    ghOwnerEl.value = saved.conn.owner || ghOwnerEl.value;
    ghRepoEl.value = saved.conn.repo || ghRepoEl.value;
    ghBranchEl.value = saved.conn.branch || ghBranchEl.value;
    ghTokenEl.value = saved.conn.token || "";
    ghRememberEl.checked = saved.remembered;
    if (ghTokenEl.value) connect();
  })();

  /* ================================================================
     PART 2 — PUBLISH
     A subject (Year/Semester/Code/Title) is the folder; what's
     actually being published each time is one ITEM inside it —
     either a numbered week or a freeform "special" entry (Midterm
     Reviewer, Course Overview, etc). Publishing never touches the
     subject's other items: it finds-or-creates the subject, then
     finds-or-creates just that one item inside its `items` array.
     ================================================================ */
  const pubYear = document.getElementById("pubYear");
  const pubSem = document.getElementById("pubSem");
  const pubCode = document.getElementById("pubCode");
  const pubTitle = document.getElementById("pubTitle");

  const itemTypeWeekTab = document.getElementById("itemTypeWeekTab");
  const itemTypeSpecialTab = document.getElementById("itemTypeSpecialTab");
  const pubWeekPanel = document.getElementById("pubWeekPanel");
  const pubSpecialPanel = document.getElementById("pubSpecialPanel");
  const pubWeekNumber = document.getElementById("pubWeekNumber");
  const pubWeekSubtitle = document.getElementById("pubWeekSubtitle");
  const pubSpecialLabel = document.getElementById("pubSpecialLabel");

  const srcPasteTab = document.getElementById("srcPasteTab");
  const srcUploadTab = document.getElementById("srcUploadTab");
  const srcPastePanel = document.getElementById("srcPastePanel");
  const srcUploadPanel = document.getElementById("srcUploadPanel");
  const pubHtmlPaste = document.getElementById("pubHtmlPaste");
  const pubHtmlFile = document.getElementById("pubHtmlFile");
  const pubPdfFile = document.getElementById("pubPdfFile");
  const pubMessage = document.getElementById("pubMessage");
  const pubPublishBtn = document.getElementById("pubPublishBtn");
  const publishStatus = document.getElementById("publishStatus");
  const publishResult = document.getElementById("publishResult");

  let itemType = "week"; // "week" | "special"
  function setItemType(t) {
    itemType = t;
    itemTypeWeekTab.classList.toggle("act", t === "week");
    itemTypeSpecialTab.classList.toggle("act", t === "special");
    pubWeekPanel.hidden = t !== "week";
    pubSpecialPanel.hidden = t !== "special";
  }
  itemTypeWeekTab.addEventListener("click", () => setItemType("week"));
  itemTypeSpecialTab.addEventListener("click", () => setItemType("special"));

  let htmlSource = "paste";
  function setHtmlSource(src) {
    htmlSource = src;
    srcPasteTab.classList.toggle("act", src === "paste");
    srcUploadTab.classList.toggle("act", src === "upload");
    srcPastePanel.hidden = src !== "paste";
    srcUploadPanel.hidden = src !== "upload";
  }
  srcPasteTab.addEventListener("click", () => setHtmlSource("paste"));
  srcUploadTab.addEventListener("click", () => setHtmlSource("upload"));

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Couldn't read the file."));
      reader.readAsArrayBuffer(file);
    });
  }

  // HTML is only required when creating an item for the first time.
  // Updating an existing one can supply just a PDF (or just new HTML) —
  // whichever file isn't resupplied carries forward from the existing
  // manifest entry untouched, so adding a PDF later never clobbers the
  // HTML that's already live, and vice versa. Filenames are always
  // derived from the item id (week-3.html, midterm-reviewer.pdf, …)
  // rather than whatever the source file happened to be called, so
  // multiple weeks uploaded from files that all share some generic
  // local name (guide.html, notes.pdf) never collide with each other.
  async function handlePublish() {
    if (!activeConn) {
      statusEl(publishStatus, "Connect first.", "error");
      return;
    }
    const year = parseInt(pubYear.value, 10);
    const sem = parseInt(pubSem.value, 10);
    const code = pubCode.value.trim();
    const title = pubTitle.value.trim();

    if (!code || !title) {
      statusEl(publishStatus, "Subject code and title are both required.", "error");
      return;
    }

    let itemKind, itemId, itemLabel, weekNum = null;
    if (itemType === "week") {
      weekNum = parseInt(pubWeekNumber.value, 10);
      if (!weekNum || weekNum < 1) {
        statusEl(publishStatus, "Enter a valid week number.", "error");
        return;
      }
      itemKind = "week";
      itemId = "week-" + weekNum;
      const subtitle = pubWeekSubtitle.value.trim();
      itemLabel = subtitle ? ("Week " + weekNum + " — " + subtitle) : ("Week " + weekNum);
    } else {
      const label = pubSpecialLabel.value.trim();
      if (!label) {
        statusEl(publishStatus, "Enter a label for the special item.", "error");
        return;
      }
      itemKind = "special";
      itemLabel = label;
      itemId = slugify(label);
    }

    // Read whatever HTML input was actually given this time — may be
    // nothing at all, if this call is only meant to attach/replace the
    // PDF on an item that's already published.
    let newHtmlBase64 = null;
    if (htmlSource === "paste" && pubHtmlPaste.value.trim()) {
      newHtmlBase64 = textToBase64(pubHtmlPaste.value);
    } else if (htmlSource === "upload" && pubHtmlFile.files[0]) {
      const buf = await readFileAsArrayBuffer(pubHtmlFile.files[0]);
      newHtmlBase64 = arrayBufferToBase64(buf);
    }

    const pdfFile = pubPdfFile.files[0] || null;
    if (!newHtmlBase64 && !pdfFile) {
      statusEl(publishStatus, "Provide new HTML content/file, a PDF, or both.", "error");
      return;
    }

    const subjectSlug = slugify(code);
    const subjectId = "y" + year + "-s" + sem + "-" + subjectSlug;
    const basePath = "assets/guides/year-" + year + "/sem-" + sem + "/" + subjectSlug + "/";
    const message = pubMessage.value.trim() || ("Publish " + code + " " + itemLabel + " (Year " + year + " Sem " + sem + ")");

    pubPublishBtn.disabled = true;
    publishResult.hidden = true;
    const { owner, repo, branch, token } = activeConn;

    try {
      statusEl(publishStatus, "Checking existing entry…", "");
      const manifestFile = await getFile(owner, repo, branch, token, "manifest.json");
      if (!manifestFile) throw new Error("manifest.json not found in this repo/branch.");
      const manifestSnapshot = JSON.parse(base64ToText(manifestFile.content));
      const semSnapshot = findSemester(manifestSnapshot, year, sem);
      const subjectSnapshot = (semSnapshot.subjects || []).find((s) => s.id === subjectId) || null;
      const existingItem = subjectSnapshot ? (subjectSnapshot.items || []).find((it) => it.id === itemId) || null : null;

      if (!existingItem && !newHtmlBase64 && !pdfFile) {
        throw new Error("No existing item at this Year/Semester/Subject/Item — provide at least one file to create it.");
      }

      // HTML: upload a new one if given, otherwise keep whatever path
      // (if any) the existing item already had.
      let htmlPath = existingItem ? existingItem.html || null : null;
      if (newHtmlBase64) {
        htmlPath = basePath + itemId + ".html";
        statusEl(publishStatus, "Uploading " + itemId + ".html…", "");
        const existingHtmlFile = await getFile(owner, repo, branch, token, htmlPath);
        await putFile(owner, repo, branch, token, htmlPath, newHtmlBase64, message, existingHtmlFile ? existingHtmlFile.sha : null);
      }

      // PDF: same carry-forward rule.
      let pdfPath = existingItem ? existingItem.pdf || null : null;
      if (pdfFile) {
        pdfPath = basePath + itemId + ".pdf";
        statusEl(publishStatus, "Uploading " + itemId + ".pdf…", "");
        const pdfBuf = await readFileAsArrayBuffer(pdfFile);
        const pdfBase64 = arrayBufferToBase64(pdfBuf);
        const existingPdfFile = await getFile(owner, repo, branch, token, pdfPath);
        await putFile(owner, repo, branch, token, pdfPath, pdfBase64, message, existingPdfFile ? existingPdfFile.sha : null);
      }

      // Order: weeks sort by week number; specials sort after every
      // week, in the order they were first created. Republishing an
      // item that already exists keeps its original order untouched.
      const itemOrder = existingItem && typeof existingItem.order === "number"
        ? existingItem.order
        : (itemKind === "week"
            ? weekNum
            : 1000 + ((subjectSnapshot && (subjectSnapshot.items || []).filter((it) => it.kind === "special").length) || 0));

      statusEl(publishStatus, "Updating manifest.json…", "");
      await updateManifest(owner, repo, branch, token, (manifest) => {
        const semObj = findSemester(manifest, year, sem);
        let subject = semObj.subjects.find((s) => s.id === subjectId);
        if (!subject) {
          subject = { id: subjectId, code: code, title: title, items: [] };
          semObj.subjects.push(subject);
        } else {
          subject.code = code;
          subject.title = title;
          if (!subject.items) subject.items = [];
        }
        const entry = { id: itemId, kind: itemKind, label: itemLabel, order: itemOrder };
        if (itemKind === "week") entry.week = weekNum;
        if (htmlPath) entry.html = htmlPath;
        if (pdfPath) entry.pdf = pdfPath;
        const idx = subject.items.findIndex((it) => it.id === itemId);
        if (idx >= 0) subject.items[idx] = entry;
        else subject.items.push(entry);
        subject.items.sort((a, b) => (a.order || 0) - (b.order || 0));
      }, message);

      const primaryPath = htmlPath || pdfPath;
      const pagesUrl = "https://" + owner + ".github.io/" + repo + "/" + primaryPath;
      const urlLabel = htmlPath ? "Gizmo-ready URL (this file only, no site chrome):" : "Direct PDF URL:";
      statusEl(publishStatus, "Published.", "success");
      publishResult.hidden = false;
      publishResult.innerHTML =
        '<div class="admin-result-label">' + escapeHtml(urlLabel) + "</div>" +
        '<div class="admin-result-url"><code>' + escapeHtml(pagesUrl) + "</code>" +
        '<button class="copy-btn" type="button" data-copy="' + escapeHtml(pagesUrl) + '">Copy</button></div>' +
        '<p class="hint">GitHub Pages usually takes 30–90 seconds to rebuild after a push before this URL goes live.</p>';

      pubHtmlPaste.value = "";
      pubHtmlFile.value = "";
      pubPdfFile.value = "";
      loadLibraryTree();
    } catch (err) {
      statusEl(publishStatus, "Publish failed: " + err.message, "error");
    } finally {
      pubPublishBtn.disabled = false;
    }
  }

  pubPublishBtn.addEventListener("click", handlePublish);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const text = btn.dataset.copy;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = original; }, 1200);
    }).catch(() => {});
  });

  /* ================================================================
     PART 3 — LIBRARY TREE (read-only list + delete)
     Three levels: Year·Semester -> Subject -> Item. Deleting an item
     removes its file(s) and its entry; if that empties a subject's
     items array, the subject entry itself is dropped from the
     manifest too, so nothing keeps an empty folder around forever.
     ================================================================ */
  const libraryTree = document.getElementById("libraryTree");

  async function loadLibraryTree() {
    if (!activeConn) return;
    const { owner, repo, branch, token } = activeConn;
    libraryTree.innerHTML = '<div class="gl-loading">Loading…</div>';
    try {
      const file = await getFile(owner, repo, branch, token, "manifest.json");
      if (!file) throw new Error("manifest.json not found.");
      const manifest = JSON.parse(base64ToText(file.content));
      const years = manifest.years || [];
      let html = "";
      let any = false;
      years.forEach((y) => {
        (y.semesters || []).forEach((s) => {
          const subjects = (s.subjects || []).filter((subj) => subj.items && subj.items.length > 0);
          if (subjects.length === 0) return;
          any = true;
          html += '<div class="gl-section-title">' + escapeHtml(y.label || "Year " + y.year) + " · " + escapeHtml(s.label || "Semester " + s.sem) + "</div>";
          subjects.forEach((subj) => {
            html +=
              '<div class="admin-tree-subject">' +
              '<span class="gl-item-code">' + escapeHtml(subj.code) + "</span>" +
              '<span class="gl-item-title">' + escapeHtml(subj.title) + "</span>" +
              "</div>";
            const items = (subj.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
            items.forEach((it) => {
              const primaryPath = it.html || it.pdf || "";
              const url = "https://" + owner + ".github.io/" + repo + "/" + primaryPath;
              html +=
                '<div class="admin-tree-item admin-tree-item-sub">' +
                '<div class="admin-tree-item-main"><span class="gl-item-title">' + escapeHtml(it.label) + "</span></div>" +
                '<div class="admin-tree-item-url"><code>' + escapeHtml(url) + "</code>" +
                '<button class="copy-btn" type="button" data-copy="' + escapeHtml(url) + '">Copy</button></div>' +
                '<button class="delete-btn" type="button" data-delete-subject-id="' + escapeHtml(subj.id) +
                '" data-delete-item-id="' + escapeHtml(it.id) + '" data-year="' + y.year + '" data-sem="' + s.sem + '">Delete</button>' +
                "</div>";
            });
          });
        });
      });
      libraryTree.innerHTML = any ? html : '<div class="gl-empty">Nothing published yet.</div>';
    } catch (err) {
      libraryTree.innerHTML = '<div class="gl-error">Couldn\'t load: ' + escapeHtml(err.message) + "</div>";
    }
  }

  libraryTree.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn || !activeConn) return;
    const subjectId = btn.dataset.deleteSubjectId;
    const itemId = btn.dataset.deleteItemId;
    const year = parseInt(btn.dataset.year, 10);
    const sem = parseInt(btn.dataset.sem, 10);
    if (!confirm("Delete this item's files and remove it from the library? This can't be undone from here.")) return;

    btn.disabled = true;
    btn.textContent = "Deleting…";
    const { owner, repo, branch, token } = activeConn;

    try {
      const file = await getFile(owner, repo, branch, token, "manifest.json");
      const manifest = JSON.parse(base64ToText(file.content));
      const semObj = findSemester(manifest, year, sem);
      const subject = (semObj.subjects || []).find((s) => s.id === subjectId);
      if (!subject) throw new Error("Already gone from manifest.json.");
      const item = (subject.items || []).find((it) => it.id === itemId);
      if (!item) throw new Error("Already gone from manifest.json.");

      const message = "Remove " + subject.code + " — " + item.label;
      if (item.html) {
        const htmlFile = await getFile(owner, repo, branch, token, item.html);
        if (htmlFile) await deleteFile(owner, repo, branch, token, item.html, htmlFile.sha, message);
      }
      if (item.pdf) {
        const pdfFile = await getFile(owner, repo, branch, token, item.pdf);
        if (pdfFile) await deleteFile(owner, repo, branch, token, item.pdf, pdfFile.sha, message);
      }

      await updateManifest(owner, repo, branch, token, (m) => {
        const s2 = findSemester(m, year, sem);
        const subj2 = (s2.subjects || []).find((s) => s.id === subjectId);
        if (!subj2) return;
        subj2.items = (subj2.items || []).filter((it) => it.id !== itemId);
        if (subj2.items.length === 0) {
          s2.subjects = s2.subjects.filter((s) => s.id !== subjectId);
        }
      }, message);

      loadLibraryTree();
    } catch (err) {
      alert("Couldn't delete: " + err.message);
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  });

  /* ================================================================
     PART 4 — PUBLISH A REFERENCE
     Same idea as Part 2, minus the Year/Semester/Subject nesting —
     references only have a category (freeform, like "special" items)
     and a title. Lives at manifest.references (sibling to years, not
     inside it), and at assets/references/{category-slug}/{item-slug}.*
     on disk. Independent find-or-create at both the category and the
     item level, exactly like subjects/items: republishing one item
     never touches any other item in its category.
     ================================================================ */
  const refCategory = document.getElementById("refCategory");
  const refTitle = document.getElementById("refTitle");
  const refSrcPasteTab = document.getElementById("refSrcPasteTab");
  const refSrcUploadTab = document.getElementById("refSrcUploadTab");
  const refSrcPastePanel = document.getElementById("refSrcPastePanel");
  const refSrcUploadPanel = document.getElementById("refSrcUploadPanel");
  const refHtmlPaste = document.getElementById("refHtmlPaste");
  const refHtmlFile = document.getElementById("refHtmlFile");
  const refPdfFile = document.getElementById("refPdfFile");
  const refMessage = document.getElementById("refMessage");
  const refPublishBtn = document.getElementById("refPublishBtn");
  const refPublishStatus = document.getElementById("refPublishStatus");
  const refPublishResult = document.getElementById("refPublishResult");

  let refHtmlSource = "paste";
  function setRefHtmlSource(src) {
    refHtmlSource = src;
    refSrcPasteTab.classList.toggle("act", src === "paste");
    refSrcUploadTab.classList.toggle("act", src === "upload");
    refSrcPastePanel.hidden = src !== "paste";
    refSrcUploadPanel.hidden = src !== "upload";
  }
  refSrcPasteTab.addEventListener("click", () => setRefHtmlSource("paste"));
  refSrcUploadTab.addEventListener("click", () => setRefHtmlSource("upload"));

  async function handlePublishReference() {
    if (!activeConn) {
      statusEl(refPublishStatus, "Connect first.", "error");
      return;
    }
    const categoryLabel = refCategory.value.trim();
    const itemTitle = refTitle.value.trim();
    if (!categoryLabel || !itemTitle) {
      statusEl(refPublishStatus, "Category and item title are both required.", "error");
      return;
    }

    let newHtmlBase64 = null;
    if (refHtmlSource === "paste" && refHtmlPaste.value.trim()) {
      newHtmlBase64 = textToBase64(refHtmlPaste.value);
    } else if (refHtmlSource === "upload" && refHtmlFile.files[0]) {
      const buf = await readFileAsArrayBuffer(refHtmlFile.files[0]);
      newHtmlBase64 = arrayBufferToBase64(buf);
    }

    const pdfFile = refPdfFile.files[0] || null;
    if (!newHtmlBase64 && !pdfFile) {
      statusEl(refPublishStatus, "Provide new HTML content/file, a PDF, or both.", "error");
      return;
    }

    const categoryId = slugify(categoryLabel);
    const itemId = slugify(itemTitle);
    const basePath = "assets/references/" + categoryId + "/";
    const message = refMessage.value.trim() || ("Publish reference: " + itemTitle);

    refPublishBtn.disabled = true;
    refPublishResult.hidden = true;
    const { owner, repo, branch, token } = activeConn;

    try {
      statusEl(refPublishStatus, "Checking existing entry…", "");
      const manifestFile = await getFile(owner, repo, branch, token, "manifest.json");
      if (!manifestFile) throw new Error("manifest.json not found in this repo/branch.");
      const manifestSnapshot = JSON.parse(base64ToText(manifestFile.content));
      const categorySnapshot = (manifestSnapshot.references || []).find((c) => c.id === categoryId) || null;
      const existingItem = categorySnapshot ? (categorySnapshot.items || []).find((it) => it.id === itemId) || null : null;

      if (!existingItem && !newHtmlBase64 && !pdfFile) {
        throw new Error("No existing reference at this Category/Title — provide at least one file to create it.");
      }

      let htmlPath = existingItem ? existingItem.html || null : null;
      if (newHtmlBase64) {
        htmlPath = basePath + itemId + ".html";
        statusEl(refPublishStatus, "Uploading " + itemId + ".html…", "");
        const existingHtmlFile = await getFile(owner, repo, branch, token, htmlPath);
        await putFile(owner, repo, branch, token, htmlPath, newHtmlBase64, message, existingHtmlFile ? existingHtmlFile.sha : null);
      }

      let pdfPath = existingItem ? existingItem.pdf || null : null;
      if (pdfFile) {
        pdfPath = basePath + itemId + ".pdf";
        statusEl(refPublishStatus, "Uploading " + itemId + ".pdf…", "");
        const pdfBuf = await readFileAsArrayBuffer(pdfFile);
        const pdfBase64 = arrayBufferToBase64(pdfBuf);
        const existingPdfFile = await getFile(owner, repo, branch, token, pdfPath);
        await putFile(owner, repo, branch, token, pdfPath, pdfBase64, message, existingPdfFile ? existingPdfFile.sha : null);
      }

      // No inherent ordering concept like week numbers — new items just
      // append after whatever's already in the category. Republishing
      // an existing item keeps its original position.
      const itemOrder = existingItem && typeof existingItem.order === "number"
        ? existingItem.order
        : ((categorySnapshot && (categorySnapshot.items || []).length) || 0) + 1;

      statusEl(refPublishStatus, "Updating manifest.json…", "");
      await updateManifest(owner, repo, branch, token, (manifest) => {
        if (!manifest.references) manifest.references = [];
        let category = manifest.references.find((c) => c.id === categoryId);
        if (!category) {
          category = { id: categoryId, label: categoryLabel, items: [] };
          manifest.references.push(category);
        } else {
          category.label = categoryLabel;
          if (!category.items) category.items = [];
        }
        const entry = { id: itemId, title: itemTitle, order: itemOrder };
        if (htmlPath) entry.html = htmlPath;
        if (pdfPath) entry.pdf = pdfPath;
        const idx = category.items.findIndex((it) => it.id === itemId);
        if (idx >= 0) category.items[idx] = entry;
        else category.items.push(entry);
        category.items.sort((a, b) => (a.order || 0) - (b.order || 0));
      }, message);

      const primaryPath = htmlPath || pdfPath;
      const pagesUrl = "https://" + owner + ".github.io/" + repo + "/" + primaryPath;
      const urlLabel = htmlPath ? "Gizmo-ready URL (this file only, no site chrome):" : "Direct PDF URL:";
      statusEl(refPublishStatus, "Published.", "success");
      refPublishResult.hidden = false;
      refPublishResult.innerHTML =
        '<div class="admin-result-label">' + escapeHtml(urlLabel) + "</div>" +
        '<div class="admin-result-url"><code>' + escapeHtml(pagesUrl) + "</code>" +
        '<button class="copy-btn" type="button" data-copy="' + escapeHtml(pagesUrl) + '">Copy</button></div>' +
        '<p class="hint">GitHub Pages usually takes 30–90 seconds to rebuild after a push before this URL goes live.</p>';

      refHtmlPaste.value = "";
      refHtmlFile.value = "";
      refPdfFile.value = "";
      loadReferenceLibraryTree();
    } catch (err) {
      statusEl(refPublishStatus, "Publish failed: " + err.message, "error");
    } finally {
      refPublishBtn.disabled = false;
    }
  }

  refPublishBtn.addEventListener("click", handlePublishReference);

  /* ================================================================
     PART 5 — REFERENCE LIBRARY TREE (read-only list + delete)
     Two levels: category -> item. Mirrors Part 3 exactly, just
     reading manifest.references instead of manifest.years.
     ================================================================ */
  const refLibraryTree = document.getElementById("refLibraryTree");

  async function loadReferenceLibraryTree() {
    if (!activeConn) return;
    const { owner, repo, branch, token } = activeConn;
    refLibraryTree.innerHTML = '<div class="gl-loading">Loading…</div>';
    try {
      const file = await getFile(owner, repo, branch, token, "manifest.json");
      if (!file) throw new Error("manifest.json not found.");
      const manifest = JSON.parse(base64ToText(file.content));
      const categories = (manifest.references || []).filter((cat) => cat.items && cat.items.length > 0);
      let html = "";
      categories.forEach((cat) => {
        html += '<div class="gl-section-title">' + escapeHtml(cat.label) + "</div>";
        const items = (cat.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        items.forEach((it) => {
          const primaryPath = it.html || it.pdf || "";
          const url = "https://" + owner + ".github.io/" + repo + "/" + primaryPath;
          html +=
            '<div class="admin-tree-item">' +
            '<div class="admin-tree-item-main"><span class="gl-item-title">' + escapeHtml(it.title) + "</span></div>" +
            '<div class="admin-tree-item-url"><code>' + escapeHtml(url) + "</code>" +
            '<button class="copy-btn" type="button" data-copy="' + escapeHtml(url) + '">Copy</button></div>' +
            '<button class="delete-btn" type="button" data-delete-category-id="' + escapeHtml(cat.id) +
            '" data-delete-item-id="' + escapeHtml(it.id) + '">Delete</button>' +
            "</div>";
        });
      });
      refLibraryTree.innerHTML = categories.length > 0 ? html : '<div class="gl-empty">Nothing published yet.</div>';
    } catch (err) {
      refLibraryTree.innerHTML = '<div class="gl-error">Couldn\'t load: ' + escapeHtml(err.message) + "</div>";
    }
  }

  refLibraryTree.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn || !activeConn) return;
    const categoryId = btn.dataset.deleteCategoryId;
    const itemId = btn.dataset.deleteItemId;
    if (!confirm("Delete this reference's files and remove it from the library? This can't be undone from here.")) return;

    btn.disabled = true;
    btn.textContent = "Deleting…";
    const { owner, repo, branch, token } = activeConn;

    try {
      const file = await getFile(owner, repo, branch, token, "manifest.json");
      const manifest = JSON.parse(base64ToText(file.content));
      const category = (manifest.references || []).find((c) => c.id === categoryId);
      if (!category) throw new Error("Already gone from manifest.json.");
      const item = (category.items || []).find((it) => it.id === itemId);
      if (!item) throw new Error("Already gone from manifest.json.");

      const message = "Remove reference: " + item.title;
      if (item.html) {
        const htmlFile = await getFile(owner, repo, branch, token, item.html);
        if (htmlFile) await deleteFile(owner, repo, branch, token, item.html, htmlFile.sha, message);
      }
      if (item.pdf) {
        const pdfFile = await getFile(owner, repo, branch, token, item.pdf);
        if (pdfFile) await deleteFile(owner, repo, branch, token, item.pdf, pdfFile.sha, message);
      }

      await updateManifest(owner, repo, branch, token, (m) => {
        const cat2 = (m.references || []).find((c) => c.id === categoryId);
        if (!cat2) return;
        cat2.items = (cat2.items || []).filter((it) => it.id !== itemId);
        if (cat2.items.length === 0) {
          m.references = (m.references || []).filter((c) => c.id !== categoryId);
        }
      }, message);

      loadReferenceLibraryTree();
    } catch (err) {
      alert("Couldn't delete: " + err.message);
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  });
})();
