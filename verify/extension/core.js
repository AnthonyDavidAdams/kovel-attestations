/**
 * Build-attestation verification core. Zero dependencies, ES module, runs in
 * Node (CLI, tests) and in the extension's background worker unchanged.
 *
 * The contract: a page is VERIFIED when every script the browser executed is
 * accounted for by the published manifest for the build the page claims to be.
 *   - every external same-origin script's bytes hash to the manifest entry
 *   - every inline script matches one of the manifest's allowed bootstrap forms
 *   - every cross-origin script is one the manifest declares
 * Anything else is a MISMATCH naming the exact script, and an unknown build id
 * is UNATTESTED (not yet in the log, or never published), which is a warning
 * rather than an alarm because a deploy can be seconds ahead of its log entry.
 *
 * This file has no knowledge of hashes for any particular build. That is the
 * point: hashes come from the public log at check time, so a legitimate deploy
 * needs no update to the verifier and cannot produce a false positive.
 */

export const SCHEMA = "kovel-build/1";

/** Inline scripts Next.js emits itself. Anchored, so a payload appended after
 *  the bootstrap call does not slip through on the prefix. */
export const DEFAULT_INLINE_ALLOW = [
  String.raw`^\(self\.__next_f=self\.__next_f\|\|\[\]\)\.push\(\[0\]\)$`,
  String.raw`^self\.__next_f\.push\(\[1,"[\s\S]*"\]\)$`,
  String.raw`^self\.__next_f\.push\(\[2,"[\s\S]*"\]\)$`,
  String.raw`^self\.__next_f\.push\(\[3,"[\s\S]*"\]\)$`,
];

/** Pull <script> tags out of an HTML document. Deliberately tolerant: it does
 *  not need a full parser to be right about the one tag it cares about. */
export function extractScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    out.push({
      src: src ? src[1] : null,
      type: type ? type[1].toLowerCase() : null,
      text: m[2],
      offset: m.index,
    });
  }
  return out;
}

/** Data blocks the browser never executes. */
export function isNonExecutableType(type) {
  if (!type) return false;
  const t = type.toLowerCase();
  return t === "application/json" || t === "application/ld+json" || t === "importmap" || t === "speculationrules";
}

export function classifyInline(text, allowPatterns) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, reason: "empty" };
  for (const p of allowPatterns) {
    if (new RegExp(p).test(trimmed)) return { ok: true, reason: "bootstrap" };
  }
  return { ok: false, reason: "unexpected inline script" };
}

export function normalizePath(src, origin) {
  try {
    const u = new URL(src, origin);
    if (u.origin !== new URL(origin).origin) return { external: true, url: u.href };
    return { external: false, path: u.pathname };
  } catch {
    return { external: true, url: src };
  }
}

/**
 * observed: {
 *   origin: "https://kovel.io",
 *   buildId: string|null,
 *   scripts: [{ src|null, type|null, text|null, sha256|null, where }]
 * }
 * manifest: the published kovel-build/1 document, or null if not found.
 */
export function verify(observed, manifest) {
  const findings = [];
  if (!observed.buildId) {
    findings.push({ level: "warn", code: "no-build-id", detail: "Page did not declare a build id (missing <meta name=\"kovel-build\">)." });
  }
  if (!manifest) {
    findings.push({ level: "warn", code: "unattested", detail: `No published manifest for build ${observed.buildId ?? "(unknown)"}. Either the log entry has not landed yet or this build was never published.` });
    return { status: "UNATTESTED", buildId: observed.buildId, findings, verified: 0, checked: 0 };
  }
  if (manifest.schema !== SCHEMA) {
    findings.push({ level: "error", code: "bad-manifest", detail: `Manifest schema ${manifest.schema} is not ${SCHEMA}.` });
  }
  if (observed.buildId && manifest.buildId !== observed.buildId) {
    findings.push({ level: "error", code: "build-id-mismatch", detail: `Page claims build ${observed.buildId}; manifest is for ${manifest.buildId}.` });
  }
  const allow = manifest.inlineScriptAllow ?? DEFAULT_INLINE_ALLOW;
  const external = new Set(manifest.externalScripts ?? []);
  let verified = 0, checked = 0;

  for (const s of observed.scripts) {
    if (isNonExecutableType(s.type)) continue;
    checked++;
    if (s.src) {
      const n = normalizePath(s.src, observed.origin);
      if (n.external) {
        if (external.has(n.url)) { verified++; continue; }
        findings.push({ level: "error", code: "undeclared-external", where: s.where, detail: `Cross-origin script not declared by the manifest: ${n.url}` });
        continue;
      }
      const expected = manifest.files?.[n.path];
      if (!expected) {
        findings.push({ level: "error", code: "unknown-file", where: s.where, detail: `Script ${n.path} is not in the manifest for build ${manifest.buildId}.` });
        continue;
      }
      if (!s.sha256) {
        findings.push({ level: "warn", code: "not-captured", where: s.where, detail: `Script ${n.path} was referenced but its bytes were not captured, so it could not be checked.` });
        continue;
      }
      if (s.sha256.toLowerCase() !== expected.toLowerCase()) {
        findings.push({ level: "error", code: "hash-mismatch", where: s.where, detail: `Script ${n.path} does not match the published build.`, expected, actual: s.sha256 });
        continue;
      }
      verified++;
    } else {
      const c = classifyInline(s.text ?? "", allow);
      if (c.ok) { verified++; continue; }
      findings.push({ level: "error", code: "inline-script", where: s.where, detail: `${c.reason} in ${s.where ?? "document"}: ${(s.text ?? "").trim().slice(0, 160)}` });
    }
  }
  const errors = findings.filter((f) => f.level === "error");
  const status = errors.length ? "MISMATCH" : "VERIFIED";
  return { status, buildId: manifest.buildId, gitSha: manifest.gitSha, findings, verified, checked, note: manifest.note ?? null };
}

export async function sha256Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const d = await subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buf).digest("hex");
}

/** Canonical bytes for a manifest: sorted keys, 2-space indent, trailing newline. */
export function canonicalJson(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + "\n";
}
