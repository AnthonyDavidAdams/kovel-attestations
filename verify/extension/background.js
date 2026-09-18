// Kovel Verifier — background worker. Fetches the published manifest for a
// build from the public log (never from kovel.io), runs the comparison, keeps a
// verdict per tab, draws the badge, and enforces the user's policy on passphrase
// release. The comparison itself is verify/core.mjs, byte for byte the same
// module the command-line verifier and the test suite use.
import { verify, sha256Hex } from "./core.js";

const DEFAULTS = {
  repo: "AnthonyDavidAdams/kovel-attestations",
  rekor: true,
  policy: "block",       // "warn" | "block"  — what to do with the passphrase on a non-verified build
  graceMinutes: 10,      // UNATTESTED within this many minutes of the manifest's builtAt is treated as "deploy ahead of log"
};
const verdicts = new Map();   // tabId -> verdict
const manifests = new Map();  // buildId -> { manifest, sha256, fetchedAt, rekor }

async function settings() {
  const s = await chrome.storage.local.get(["settings"]);
  return { ...DEFAULTS, ...(s.settings || {}) };
}

async function fetchManifest(buildId) {
  if (!buildId) return null;
  const cached = manifests.get(buildId);
  if (cached && (cached.manifest || Date.now() - cached.fetchedAt < 30_000)) return cached;
  const s = await settings();
  const url = `https://raw.githubusercontent.com/${s.repo}/main/builds/${encodeURIComponent(buildId)}.json`;
  let entry = { manifest: null, sha256: null, fetchedAt: Date.now(), url, rekor: null };
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      entry.manifest = JSON.parse(new TextDecoder().decode(bytes));
      entry.sha256 = await sha256Hex(bytes);
      if (s.rekor) entry.rekor = await rekorLookup(entry.sha256);
    }
  } catch (e) {
    entry.error = String(e && e.message || e);
  }
  manifests.set(buildId, entry);
  return entry;
}

async function rekorLookup(sha256) {
  try {
    const r = await fetch("https://rekor.sigstore.dev/api/v1/index/retrieve", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash: `sha256:${sha256}` }),
    });
    if (!r.ok) return { checked: false };
    const uuids = await r.json();
    return { checked: true, logged: Array.isArray(uuids) && uuids.length > 0, uuid: uuids[0] || null };
  } catch { return { checked: false }; }
}

async function runVerify(msg, tabId) {
  const s = await settings();
  const entry = await fetchManifest(msg.buildId);
  const result = verify({ origin: msg.origin, buildId: msg.buildId, scripts: msg.scripts }, entry && entry.manifest);
  if (result.status === "UNATTESTED" && entry && entry.error) {
    result.findings.push({ level: "warn", code: "log-unreachable", detail: `Could not reach the public log: ${entry.error}` });
  }
  if (entry && entry.rekor && entry.rekor.checked && !entry.rekor.logged) {
    result.findings.push({ level: "warn", code: "not-in-rekor", detail: "The manifest is in the repository but not in the Sigstore transparency log." });
  }
  result.manifestSha256 = entry ? entry.sha256 : null;
  result.rekor = entry ? entry.rekor : null;
  result.policy = s.policy;
  result.origin = msg.origin;
  result.url = msg.url;
  result.checkedAt = Date.now();
  const prev = verdicts.get(tabId) || {};
  result.matterId = msg.matterId || prev.matterId || null;
  result.keyholder = await hasPassphrase(msg.origin, result.matterId);
  verdicts.set(tabId, result);
  await noteNewBuild(msg.origin, result);
  badge(tabId, result);
  return result;
}

async function noteNewBuild(origin, result) {
  if (!result.buildId) return;
  const key = `seen:${origin}`;
  const st = await chrome.storage.local.get([key]);
  const seen = st[key] || {};
  if (!seen[result.buildId]) {
    seen[result.buildId] = { firstSeen: Date.now(), status: result.status, title: result.note && result.note.title || null };
    await chrome.storage.local.set({ [key]: seen });
  }
}

function badge(tabId, r) {
  const map = {
    VERIFIED: { text: "OK", color: "#1F5E3B" },
    MISMATCH: { text: "!", color: "#B33A3A" },
    UNATTESTED: { text: "?", color: "#8A6D3B" },
  };
  const b = map[r.status] || { text: "…", color: "#666" };
  chrome.action.setBadgeText({ tabId, text: b.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
  chrome.action.setTitle({ tabId, title: `Kovel Verifier: ${r.status}${r.buildId ? " · build " + r.buildId : ""}` });
}

async function hasPassphrase(origin, matterId) {
  if (!matterId) return false;
  const st = await chrome.storage.local.get(["passphrases"]);
  return !!((st.passphrases || {})[`${origin}|${matterId}`]);
}

async function releasePassphrase(origin, matterId, tabId) {
  const v = verdicts.get(tabId);
  const s = await settings();
  if (!v || v.origin !== origin) return { refused: "no verdict for this tab yet" };
  if (v.status !== "VERIFIED") {
    if (s.policy === "block") return { refused: `build is ${v.status}; policy is to refuse` };
    return { refused: `build is ${v.status}; open the verifier and choose to proceed` };
  }
  const st = await chrome.storage.local.get(["passphrases"]);
  const p = (st.passphrases || {})[`${origin}|${matterId}`];
  if (!p) return { refused: "no passphrase stored for this matter" };
  return { passphrase: p };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  (async () => {
    if (msg.type === "verify") return runVerify(msg, tabId);
    if (msg.type === "matter") {
      const v = verdicts.get(tabId);
      if (v) { v.matterId = msg.matterId; v.keyholder = await hasPassphrase(msg.origin, msg.matterId); }
      return v || null;
    }
    if (msg.type === "unlock") return releasePassphrase(msg.origin, msg.matterId, tabId);
    if (msg.type === "popup:get") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const v = tab && verdicts.get(tab.id);
      return { verdict: v || null, settings: await settings(), tabId: tab && tab.id };
    }
    if (msg.type === "popup:recheck") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.tabs.sendMessage(tab.id, { type: "recheck" }).catch(() => {});
      return true;
    }
    if (msg.type === "popup:store") {
      const st = await chrome.storage.local.get(["passphrases"]);
      const all = st.passphrases || {};
      if (msg.passphrase) all[`${msg.origin}|${msg.matterId}`] = msg.passphrase; else delete all[`${msg.origin}|${msg.matterId}`];
      await chrome.storage.local.set({ passphrases: all });
      const v = verdicts.get(msg.tabId);
      if (v) v.keyholder = !!msg.passphrase;
      if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, { type: "recheck" }).catch(() => {});
      return true;
    }
    if (msg.type === "popup:settings") {
      const cur = await settings();
      await chrome.storage.local.set({ settings: { ...cur, ...msg.settings } });
      manifests.clear();
      return true;
    }
    return null;
  })().then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => verdicts.delete(tabId));
