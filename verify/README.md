# Kovel Verifier

Code you control that checks the code Kovel serves you.

Kovel serves the JavaScript that encrypts a client's matter. A court could order
Kovel to serve modified code to one person and forbid Kovel from saying so. That
cannot be prevented by the party that controls the origin. It can be detected by
something the client installed before it happened, whose logic Kovel does not
control, and whose expected values come from a public, append-only log rather
than from kovel.io.

This directory is that something, in three forms that share one comparison
(`core.mjs`):

| Path | What | Who runs it |
|---|---|---|
| `extension/` | Chrome/Edge/Brave extension (Manifest V3). Watches every script a kovel.io page executes, re-reads the bytes from the browser's own cache, compares with the published manifest for that build, draws its own badge outside the page. Keyholder mode holds the matter passphrase and releases it only into a verified build. | Every client, installed on day one |
| `cli/kovel-verify.mjs` | Same comparison over a HAR file exported from a logged-in browser. Zero dependencies, Node 20+. | Auditors, firm IT, a scheduled monitor account |
| `core.mjs` | The comparison. Pure functions, no I/O, no knowledge of any particular build. | Both of the above, and `scripts/attestation-test.ts` |

## What is published, and where

At every deploy `scripts/build-manifest.mjs` hashes every file a browser can
receive (`/_next/static/**` and executable files under `/public`) and embeds the
release note for the commit. `scripts/publish-attestation.mjs` then writes the
manifest to:

1. a public repository (`ATTESTATION_REPO`, default `AnthonyDavidAdams/kovel-attestations`) as `builds/<buildId>.json` plus `builds/<buildId>.md` and a `deploy-<buildId>` tag;
2. the Sigstore Rekor transparency log as a `hashedrekord` of the manifest bytes.

The manifest is also served at `https://kovel.io/.well-known/kovel-build.json`.
That copy is a convenience so a verifier can learn the build id; it is not the
trust anchor, because a server that can be compelled to serve modified code can
be compelled to serve a matching manifest.

## Three states

- **VERIFIED** — every script executed matches the manifest for the build the page claims to be.
- **MISMATCH** — at least one script differs, is missing from the manifest, is an undeclared cross-origin script, or is an inline script that is not one of Next.js's own bootstrap forms. The finding names it.
- **UNATTESTED** — the build id is not in the log. A fresh deploy can be a minute ahead of its log entry; if it persists, treat it as a mismatch.

No hashes live in the verifier. A legitimate deploy publishes first and shows as
a new build with a note. That is what keeps false positives at zero and leaves
Kovel free to ship.

## What it does not do

- Prevent anything. Modified code that captures a passphrase can open everything in that matter, past and present. The verifier is so you find out before you type.
- Help after the fact. Install it before you need it.
- Check data. A substituted key during attorney key exchange is covered by the six-word fingerprint read back out of band.
- Prove the source. Next.js builds are not reproducible; the manifest hashes what was deployed.

## Developing

```
npm run attest:test        # synthetic build + real .next, CLI, tamper cases
npm run attest:manifest    # write .next/kovel-build.json for the current build
npm run verify -- session.har --manifest .next/kovel-build.json
```

`extension/core.js` must stay byte-identical to `core.mjs`; the test checks.
