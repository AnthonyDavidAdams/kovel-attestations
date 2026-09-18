#!/usr/bin/env node
/**
 * kovel-verify — check that the code a browser actually ran on kovel.io
 * matches the build Kovel published to the public log.
 *
 *   node kovel-verify.mjs session.har
 *   node kovel-verify.mjs session.har --manifest builds/<id>.json
 *   node kovel-verify.mjs session.har --repo owner/name   (default: the Kovel attestation repo)
 *   node kovel-verify.mjs session.har --json
 *
 * Input is a HAR file exported from your own logged-in browser (DevTools →
 * Network → right-click → "Save all as HAR with content"). It contains the
 * exact bytes your tab received, which is the only thing worth checking: an
 * anonymous fetch sees clean code because targeted delivery keys on cookie
 * or IP. Nothing here is fetched from kovel.io.
 *
 * Exit 0 VERIFIED · 2 UNATTESTED · 1 MISMATCH or error.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { extractScripts, verify, sha256Hex } from "../core.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const har = args.find((a) => !a.startsWith("--") && a.endsWith(".har"));
const manifestArg = flag("--manifest");
const repo = flag("--repo") || process.env.KOVEL_ATTESTATION_REPO || "AnthonyDavidAdams/kovel-attestations";
const originArg = flag("--origin");
const json = args.includes("--json");
if (!har) { console.error("usage: kovel-verify <session.har> [--manifest file|url] [--repo owner/name] [--origin https://kovel.io] [--json]"); process.exit(1); }

const log = JSON.parse(fs.readFileSync(har, "utf8")).log;
const entries = log.entries ?? [];
const bodyOf = (e) => {
  const c = e.response?.content ?? {};
  if (c.text == null) return null;
  return c.encoding === "base64" ? Buffer.from(c.text, "base64") : Buffer.from(c.text, "utf8");
};
const mime = (e) => (e.response?.content?.mimeType ?? "").toLowerCase();

// Which origin are we checking? The one that served HTML with a kovel-build meta.
const htmlEntries = entries.filter((e) => mime(e).includes("text/html") && bodyOf(e));
let origin = originArg;
let buildId = null;
const pages = [];
for (const e of htmlEntries) {
  const html = bodyOf(e).toString("utf8");
  const m = /<meta\s+name="kovel-build"\s+content="([^"]+)"/i.exec(html);
  const o = new URL(e.request.url).origin;
  if (!origin && m) origin = o;
  if (origin && o === origin) {
    pages.push({ url: e.request.url, html });
    if (m && !buildId) buildId = m[1];
  }
}
if (!origin) { fail("No HTML document with a kovel-build meta tag in this HAR. Load a kovel.io page with the HAR recorder open."); }

// Bytes actually received for every same-origin script, keyed by path.
const received = new Map();
for (const e of entries) {
  try {
    const u = new URL(e.request.url);
    if (u.origin !== origin) continue;
    const b = bodyOf(e);
    if (!b) continue;
    if (/javascript|ecmascript|text\/css|wasm/.test(mime(e)) || /\.(m?js|css|wasm)$/.test(u.pathname)) {
      received.set(u.pathname, createHash("sha256").update(b).digest("hex"));
    }
  } catch { /* skip */ }
}

const scripts = [];
for (const p of pages) {
  for (const s of extractScripts(p.html)) {
    if (s.src) {
      let pathname = null;
      try { const u = new URL(s.src, origin); if (u.origin === origin) pathname = u.pathname; } catch {}
      scripts.push({ src: s.src, type: s.type, sha256: pathname ? received.get(pathname) ?? null : null, where: p.url });
    } else {
      scripts.push({ src: null, type: s.type, text: s.text, where: p.url });
    }
  }
}
// Scripts loaded later (lazy chunks) never appear in the HTML; check them too.
const referenced = new Set(scripts.filter((s) => s.src).map((s) => { try { return new URL(s.src, origin).pathname; } catch { return null; } }));
for (const [pathname, sha256] of received) {
  if (!referenced.has(pathname) && pathname.startsWith("/_next/static/")) scripts.push({ src: pathname, type: null, sha256, where: "(loaded later)" });
}

let manifest = null;
const src = manifestArg || (buildId ? `https://raw.githubusercontent.com/${repo}/main/builds/${buildId}.json` : null);
if (src) {
  try {
    const raw = /^https?:/.test(src) ? await (async () => { const r = await fetch(src); if (r.status === 404) return null; if (!r.ok) throw new Error(`${r.status} fetching ${src}`); return Buffer.from(await r.arrayBuffer()); })() : fs.readFileSync(src);
    if (raw) manifest = JSON.parse(raw.toString("utf8"));
    if (raw) manifest.__sha256 = await sha256Hex(raw);
  } catch (e) { fail(`Could not load manifest: ${e.message}`); }
}

const result = verify({ origin, buildId, scripts }, manifest);
result.manifestSource = src;
result.manifestSha256 = manifest?.__sha256 ?? null;
if (json) { console.log(JSON.stringify(result, null, 2)); }
else {
  console.log(`${result.status}  build ${result.buildId ?? "(unknown)"}${result.gitSha ? "  commit " + result.gitSha.slice(0, 12) : ""}`);
  console.log(`  origin ${origin} · ${pages.length} page(s) · ${result.verified}/${result.checked} scripts verified`);
  if (result.manifestSha256) console.log(`  manifest sha256 ${result.manifestSha256}  (${src})`);
  if (result.note?.title) console.log(`  latest change: ${result.note.title}${result.note.reviewed ? "" : "  [note not marked reviewed]"}`);
  for (const f of result.findings) console.log(`  ${f.level === "error" ? "!!" : " ?"} ${f.detail}${f.expected ? `\n       expected ${f.expected}\n       actual   ${f.actual}` : ""}`);
}
process.exit(result.status === "VERIFIED" ? 0 : result.status === "UNATTESTED" ? 2 : 1);

function fail(msg) { console.error("ERROR " + msg); process.exit(1); }
