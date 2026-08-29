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
   2) Publish — upload the HTML (+ optional PDF) to
      assets/guides/year-{n}/sem-{n}/{subject-slug}/, then read-
      modify-write manifest.json so the portal picks it up.
   3) Library — re-reads manifest.json and lists what's there, with
      a delete action per subject (removes the files + the entry).
   ============================================================ */

(function () {
  "use strict";

  const API = "https://api.github.com";

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

  function slugify(code) {
    return code.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "subject";
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
      loadLibraryTree();
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
     ================================================================ */
  const pubYear = document.getElementById("pubYear");
  const pubSem = document.getElementById("pubSem");
  const pubCode = document.getElementById("pubCode");
  const pubTitle = document.getElementById("pubTitle");
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

  // HTML is only required when creating a subject for the first time.
  // Updating an existing one can supply just a PDF (or just new HTML) —
  // whichever file isn't resupplied carries forward from the existing
  // manifest entry untouched, so adding a PDF later never clobbers the
  // HTML that's already live, and vice versa.
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

    // Read whatever HTML input was actually given this time — may be
    // nothing at all, if this call is only meant to attach/replace the
    // PDF on a subject that's already published.
    let newHtmlBase64 = null;
    let newHtmlFilename = null;
    if (htmlSource === "paste" && pubHtmlPaste.value.trim()) {
      newHtmlBase64 = textToBase64(pubHtmlPaste.value);
      newHtmlFilename = code + "_Complete_Study_Guide.html";
    } else if (htmlSource === "upload" && pubHtmlFile.files[0]) {
      const buf = await readFileAsArrayBuffer(pubHtmlFile.files[0]);
      newHtmlBase64 = arrayBufferToBase64(buf);
      newHtmlFilename = pubHtmlFile.files[0].name;
    }

    const pdfFile = pubPdfFile.files[0] || null;
    if (!newHtmlBase64 && !pdfFile) {
      statusEl(publishStatus, "Provide new HTML content/file, a PDF, or both.", "error");
      return;
    }

    const slug = slugify(code);
    const subjectId = "y" + year + "-s" + sem + "-" + slug;
    const basePath = "assets/guides/year-" + year + "/sem-" + sem + "/" + slug + "/";
    const message = pubMessage.value.trim() || ("Publish " + code + " (Year " + year + " Sem " + sem + ")");

    pubPublishBtn.disabled = true;
    publishResult.hidden = true;
    const { owner, repo, branch, token } = activeConn;

    try {
      statusEl(publishStatus, "Checking existing entry…", "");
      const manifestFile = await getFile(owner, repo, branch, token, "manifest.json");
      if (!manifestFile) throw new Error("manifest.json not found in this repo/branch.");
      const manifestSnapshot = JSON.parse(base64ToText(manifestFile.content));
      const semSnapshot = findSemester(manifestSnapshot, year, sem);
      const existing = semSnapshot.subjects.find((s) => s.id === subjectId) || null;

      if (!existing && !newHtmlBase64 && !pdfFile) {
        throw new Error("No existing guide at this Year/Semester/Code — provide at least one file to create it.");
      }

      // HTML: upload a new one if given, otherwise keep whatever path
      // (if any) the existing entry already had.
      let htmlPath = existing ? existing.html || null : null;
      if (newHtmlBase64) {
        htmlPath = basePath + newHtmlFilename;
        statusEl(publishStatus, "Uploading " + newHtmlFilename + "…", "");
        const existingHtmlFile = await getFile(owner, repo, branch, token, htmlPath);
        await putFile(owner, repo, branch, token, htmlPath, newHtmlBase64, message, existingHtmlFile ? existingHtmlFile.sha : null);
      }

      // PDF: same carry-forward rule.
      let pdfPath = existing ? existing.pdf || null : null;
      if (pdfFile) {
        pdfPath = basePath + pdfFile.name;
        statusEl(publishStatus, "Uploading " + pdfFile.name + "…", "");
        const pdfBuf = await readFileAsArrayBuffer(pdfFile);
        const pdfBase64 = arrayBufferToBase64(pdfBuf);
        const existingPdfFile = await getFile(owner, repo, branch, token, pdfPath);
        await putFile(owner, repo, branch, token, pdfPath, pdfBase64, message, existingPdfFile ? existingPdfFile.sha : null);
      }

      statusEl(publishStatus, "Updating manifest.json…", "");
      await updateManifest(owner, repo, branch, token, (manifest) => {
        const semObj = findSemester(manifest, year, sem);
        const entry = { id: subjectId, code: code, title: title };
        if (htmlPath) entry.html = htmlPath;
        if (pdfPath) entry.pdf = pdfPath;
        const idx = semObj.subjects.findIndex((s) => s.id === subjectId);
        if (idx >= 0) semObj.subjects[idx] = entry;
        else semObj.subjects.push(entry);
      }, message);

      const primaryPath = htmlPath || pdfPath;
      const pagesUrl = "https://" + owner + ".github.io/" + repo + "/" + primaryPath;
      const label = htmlPath ? "Gizmo-ready URL (this file only, no site chrome):" : "Direct PDF URL:";
      statusEl(publishStatus, "Published.", "success");
      publishResult.hidden = false;
      publishResult.innerHTML =
        '<div class="admin-result-label">' + label + '</div>' +
        '<div class="admin-result-url"><code>' + pagesUrl + '</code>' +
        '<button class="copy-btn" type="button" data-copy="' + pagesUrl + '">Copy</button></div>' +
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
          if (!s.subjects || s.subjects.length === 0) return;
          any = true;
          html += '<div class="gl-section-title">' + (y.label || "Year " + y.year) + " · " + (s.label || "Semester " + s.sem) + "</div>";
          s.subjects.forEach((subj) => {
            const url = "https://" + owner + ".github.io/" + repo + "/" + subj.html;
            html +=
              '<div class="admin-tree-item">' +
              '<div class="admin-tree-item-main">' +
              '<span class="gl-item-code">' + subj.code + "</span>" +
              '<span class="gl-item-title">' + subj.title + "</span>" +
              "</div>" +
              '<div class="admin-tree-item-url"><code>' + url + '</code>' +
              '<button class="copy-btn" type="button" data-copy="' + url + '">Copy</button></div>' +
              '<button class="delete-btn" type="button" data-delete-id="' + subj.id + '" data-year="' + y.year + '" data-sem="' + s.sem + '">Delete</button>' +
              "</div>";
          });
        });
      });
      libraryTree.innerHTML = any ? html : '<div class="gl-empty">Nothing published yet.</div>';
    } catch (err) {
      libraryTree.innerHTML = '<div class="gl-error">Couldn\'t load: ' + err.message + "</div>";
    }
  }

  libraryTree.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn || !activeConn) return;
    const subjectId = btn.dataset.deleteId;
    const year = parseInt(btn.dataset.year, 10);
    const sem = parseInt(btn.dataset.sem, 10);
    if (!confirm("Delete this guide's files and remove it from the library? This can't be undone from here.")) return;

    btn.disabled = true;
    btn.textContent = "Deleting…";
    const { owner, repo, branch, token } = activeConn;

    try {
      const file = await getFile(owner, repo, branch, token, "manifest.json");
      const manifest = JSON.parse(base64ToText(file.content));
      const semObj = findSemester(manifest, year, sem);
      const subject = semObj.subjects.find((s) => s.id === subjectId);
      if (!subject) throw new Error("Already gone from manifest.json.");

      const message = "Remove " + subject.code;
      if (subject.html) {
        const htmlFile = await getFile(owner, repo, branch, token, subject.html);
        if (htmlFile) await deleteFile(owner, repo, branch, token, subject.html, htmlFile.sha, message);
      }
      if (subject.pdf) {
        const pdfFile = await getFile(owner, repo, branch, token, subject.pdf);
        if (pdfFile) await deleteFile(owner, repo, branch, token, subject.pdf, pdfFile.sha, message);
      }

      await updateManifest(owner, repo, branch, token, (m) => {
        const s2 = findSemester(m, year, sem);
        s2.subjects = s2.subjects.filter((s) => s.id !== subjectId);
      }, message);

      loadLibraryTree();
    } catch (err) {
      alert("Couldn't delete: " + err.message);
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  });
})();
