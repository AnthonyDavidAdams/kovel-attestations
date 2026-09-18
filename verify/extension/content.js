// Kovel Verifier — content script. Runs at document_start, before any page
// script, on kovel.io only.
//
// Job 1: record every script this document executes, external or inline, as it
// is inserted. A MutationObserver installed this early sees a <script> before
// it runs and keeps a reference even if the script later removes itself.
// Job 2: re-read the bytes of each external same-origin script from the
// browser's own cache (immutable, force-cache), hash them, and hand the list to
// the background worker, which compares against the public log and answers.
// Job 3: relay the verdict to the page and, in keyholder mode, answer the
// page's unlock request — but only when the background says the build is
// verified. The page never sees the passphrase otherwise.
//
// Nothing in this file trusts the page. The page's only inputs are a build id
// (which is checked against the log) and a matter id (which is a label).

(() => {
  const VERSION = "0.1.0";
  document.documentElement.dataset.kovelVerifier = VERSION;

  const origin = location.origin;
  const seen = new Map(); // key -> { src|null, type, text, node }
  let scheduled = null;
  let matterId = null;
  let lastVerdict = null;

  const keyFor = (el) => (el.src ? "src:" + el.src : "inline:" + (seen.size + 1) + ":" + (el.textContent || "").slice(0, 40));

  const record = (el) => {
    if (!(el instanceof HTMLScriptElement)) return;
    for (const [, v] of seen) if (v.node === el) return;
    seen.set(keyFor(el), { src: el.src || null, type: el.type || null, text: el.src ? null : el.textContent, node: el });
    schedule();
  };
  const scan = (root) => {
    if (root instanceof HTMLScriptElement) record(root);
    if (root.querySelectorAll) root.querySelectorAll("script").forEach(record);
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach(scan);
      if (m.type === "characterData" && m.target.parentNode instanceof HTMLScriptElement) {
        // inline text arriving after insertion: refresh the recorded text
        for (const [, v] of seen) if (v.node === m.target.parentNode) v.text = m.target.parentNode.textContent;
        schedule();
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scan(document.documentElement);

  function schedule() {
    clearTimeout(scheduled);
    scheduled = setTimeout(report, 400);
  }
  window.addEventListener("load", () => setTimeout(report, 800));

  async function hashUrl(url) {
    try {
      // force-cache: chunks are immutable, so this returns the cached bytes the
      // page just executed rather than asking the server again. credentials
      // included so the cache partition matches the page's own request.
      const r = await fetch(url, { cache: "force-cache", credentials: "include" });
      const buf = await r.arrayBuffer();
      const d = await crypto.subtle.digest("SHA-256", buf);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;
    }
  }

  let reporting = false, again = false;
  async function report() {
    if (reporting) { again = true; return; }
    reporting = true;
    try {
      const meta = document.querySelector('meta[name="kovel-build"]');
      const buildId = meta ? meta.getAttribute("content") : null;
      const scripts = [];
      for (const [, v] of seen) {
        if (v.src) {
          let same = false;
          try { same = new URL(v.src).origin === origin; } catch {}
          scripts.push({ src: v.src, type: v.type, sha256: same ? await hashUrl(v.src) : null, where: location.pathname });
        } else {
          scripts.push({ src: null, type: v.type, text: v.node.textContent ?? v.text ?? "", where: location.pathname });
        }
      }
      const verdict = await chrome.runtime.sendMessage({ type: "verify", origin, buildId, scripts, matterId, url: location.href });
      if (verdict) deliver(verdict);
    } finally {
      reporting = false;
      if (again) { again = false; schedule(); }
    }
  }

  function deliver(verdict) {
    lastVerdict = verdict;
    const detail = {
      status: verdict.status,
      buildId: verdict.buildId,
      findings: verdict.findings,
      note: verdict.note ? { title: verdict.note.title, changedFiles: verdict.note.changedFiles } : null,
      policy: verdict.policy,
      keyholder: !!verdict.keyholder,
      version: VERSION,
    };
    document.dispatchEvent(new CustomEvent("kovel:attestation", { detail }));
  }

  document.addEventListener("kovel:matter", (e) => {
    const id = e.detail && e.detail.matterId;
    if (typeof id === "string" && id.length < 200) {
      matterId = id;
      chrome.runtime.sendMessage({ type: "matter", origin, matterId }).then((v) => v && deliver(v)).catch(() => {});
    }
  });

  document.addEventListener("kovel:request-unlock", async (e) => {
    const id = e.detail && e.detail.matterId;
    const res = await chrome.runtime.sendMessage({ type: "unlock", origin, matterId: id }).catch(() => ({ refused: "verifier unavailable" }));
    if (res && res.passphrase) {
      document.dispatchEvent(new CustomEvent("kovel:unlock", { detail: { matterId: id, passphrase: res.passphrase } }));
    } else {
      document.dispatchEvent(new CustomEvent("kovel:unlock-refused", { detail: { matterId: id, reason: (res && res.refused) || "refused" } }));
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "recheck") schedule();
  });
})();
