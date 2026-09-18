const $ = (id) => document.getElementById(id);
let state = null;

async function load() {
  state = await chrome.runtime.sendMessage({ type: "popup:get" });
  const v = state && state.verdict;
  const head = $("head");
  head.className = "head " + (v ? v.status : "NONE");
  if (!v) { $("status").textContent = "Not a Kovel page"; $("sub").textContent = "Open kovel.io and this will check it."; return; }
  const labels = { VERIFIED: "Verified", MISMATCH: "Does not match the published build", UNATTESTED: "Build not in the public log" };
  $("status").textContent = labels[v.status] || v.status;
  $("sub").textContent = `build ${v.buildId || "(unknown)"}${v.gitSha ? " · commit " + v.gitSha.slice(0, 10) : ""} · ${v.verified}/${v.checked} scripts`;
  const d = $("detail");
  d.innerHTML = "";
  if (v.findings && v.findings.length) {
    const ul = document.createElement("ul");
    for (const f of v.findings) { const li = document.createElement("li"); li.className = f.level === "error" ? "err" : "warn"; li.textContent = f.detail; ul.appendChild(li); }
    d.appendChild(ul);
  } else {
    d.innerHTML = '<div class="muted">Every script this page executed matches the manifest Kovel published for this build.</div>';
  }
  if (v.manifestSha256) {
    const m = document.createElement("div"); m.className = "mono";
    m.textContent = `manifest ${v.manifestSha256}` + (v.rekor && v.rekor.checked ? (v.rekor.logged ? " · in Sigstore log" : " · NOT in Sigstore log") : "");
    d.appendChild(m);
  }
  if (v.note && (v.note.title || (v.note.changedFiles && v.note.changedFiles.length))) {
    $("note").hidden = false;
    $("noteTitle").textContent = v.note.title || "(no title)";
    $("noteFiles").textContent = (v.note.changedFiles || []).slice(0, 12).join("\n") + ((v.note.changedFiles || []).length > 12 ? "\n…" : "");
  }
  if (v.matterId) {
    $("keyholder").hidden = false;
    $("khState").textContent = v.keyholder ? `A passphrase is stored for matter ${v.matterId.slice(0, 8)}…` : `No passphrase stored for matter ${v.matterId.slice(0, 8)}…`;
  }
  for (const r of document.querySelectorAll('input[name="policy"]')) r.checked = r.value === state.settings.policy;
}

$("store").onclick = async () => {
  const p = $("pass").value.trim();
  if (!p || !state || !state.verdict) return;
  await chrome.runtime.sendMessage({ type: "popup:store", origin: state.verdict.origin, matterId: state.verdict.matterId, passphrase: p, tabId: state.tabId });
  $("pass").value = "";
  load();
};
$("forget").onclick = async () => {
  if (!state || !state.verdict) return;
  await chrome.runtime.sendMessage({ type: "popup:store", origin: state.verdict.origin, matterId: state.verdict.matterId, passphrase: "", tabId: state.tabId });
  load();
};
$("recheck").onclick = async () => { await chrome.runtime.sendMessage({ type: "popup:recheck" }); setTimeout(load, 1500); };
$("options").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
for (const r of document.querySelectorAll('input[name="policy"]')) r.onchange = () => chrome.runtime.sendMessage({ type: "popup:settings", settings: { policy: r.value } });
load();
