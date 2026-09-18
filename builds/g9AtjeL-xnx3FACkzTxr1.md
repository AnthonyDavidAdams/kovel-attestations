# Build g9AtjeL-xnx3FACkzTxr1

**First beta build — verifier, honest retention copy, rate limits, tripwire**

## Summary

Same code as 7d480c8 plus a deploy-script fix; nothing in the browser bundle differs from that note.

This is the first build published to the attestation log, so there is no
previous build to diff against; everything below is what the browser bundle
now contains compared with the last deploy on 2026-08-24.

In the client code: the portal shows whether the Kovel Verifier extension is
installed and what it reports; the unlock form asks for an explicit
acknowledgement before a passphrase is typed into a page the verifier has
not confirmed, and offers "Unlock with Kovel Verifier" when the extension
holds the passphrase. Every page carries a build id meta tag. New public
pages: /verify, /resources, /tripwire. Copy on /privacy and /playbook no
longer asserts zero retention at the AI provider, because that arrangement
is not in force; the attorney attestation was rewritten to match. The chat
and attorney sign-in routes are rate limited. /admin no longer keeps its
secret in the URL.

Nothing in the encryption code changed.

## Commits
- 7d480c8 release/deploy: untracked files do not make the tree dirty
- ee9ebac Publish the Privilege Tripwire at /tripwire and a /resources index
- 292c599 Build attestation and the Kovel Verifier (KOV-53)
- afeb811 Hardening before beta: rate limits, admin cookie, noindex, robots and sitemap
- 0f57812 Zero retention is not in force: say so on privacy, playbook and the forms (KOV-19, KOV-25)
- fcded7f Stop asserting that privilege attaches (KOV-15)
- ad844c7 Attorney key rotation UI in the counsel portal
- 086cb23 Counsel training: codes affirmation gate, assessment fixes, progress rework

## Changed files
- book/05-marketing/privilege-tripwire/SKILL.md
- book/05-marketing/privilege-tripwire/short-custom-instructions.txt
- content/HANDOFF.md
- content/books/_doctrine/heppner.md
- course/README.md
- course/chatbot.md
- course/cle-strategy.md
- course/firm-access-model.md
- docs/build-attestation.md
- docs/security/01-authentication.md
- docs/security/02-authorization.md
- docs/security/03-data-security.md
- docs/security/04-input-validation-and-injection.md
- docs/security/05-llm-and-prompt-security.md
- docs/security/06-privilege-integrity.md
- docs/security/07-network-and-transport.md
- docs/security/08-dependencies-and-supply-chain.md
- docs/security/09-secrets-management.md
- docs/security/10-logging-and-incident-response.md
- docs/security/11-billing-and-pii.md
- docs/security/12-platform-specific-attacks.md
- docs/security/13-summary-and-prioritized-plan.md
- package.json
- public/book-forms/defense-filings.md
- public/tripwire/SKILL.md
- public/tripwire/custom-instructions.txt
- public/verifier/kovel-verifier-0.1.0.zip
- scripts/attestation-test.ts
- scripts/build-manifest.mjs
- scripts/deploy.mjs
- scripts/publish-attestation.mjs
- scripts/release-note.mjs
- scripts/sync-attestation-repo.sh
- src/app/.well-known/kovel-build.json/route.ts
- src/app/_components/CopyBlock.tsx
- src/app/admin/actions.ts
- src/app/admin/page.tsx
- src/app/api/chat/route.ts
- src/app/api/counsel/auth/magic/route.ts
- src/app/api/training/assessment/start/route.ts
- src/app/api/training/assessment/submit/route.ts
- src/app/attorneys/page.tsx
- src/app/counsel/(authed)/_keys/RotateKey.tsx
- src/app/counsel/training/[moduleId]/ModulePlayer.tsx
- src/app/counsel/training/[moduleId]/SlideAudio.tsx
- src/app/counsel/training/[moduleId]/page.tsx
- src/app/counsel/training/_course/codes-gate.ts
- src/app/counsel/training/_course/progress.ts
- src/app/counsel/training/assessment/AffirmationForm.tsx
- src/app/counsel/training/assessment/AssessmentRunner.tsx
- src/app/counsel/training/assessment/page.tsx
- src/app/counsel/training/page.tsx
- src/app/firm/page.tsx
- src/app/intake/IntakeForm.tsx
- src/app/intake/byol/ByolForm.tsx
- src/app/layout.tsx
- src/app/page.tsx
- src/app/playbook/page.tsx
- src/app/portal/Portal.tsx
- src/app/portal/UnlockMatter.tsx
- src/app/portal/VerifierBanner.tsx
- src/app/portal/layout.tsx
- src/app/portal/library/Library.tsx
- src/app/privacy/page.tsx
- src/app/resources/page.tsx
- src/app/robots.ts
- src/app/sitemap.ts
- src/app/tripwire/page.tsx
- src/app/verify/page.tsx
- src/lib/adminAuth.ts
- src/lib/anthropic.ts
- src/lib/attestation.ts
- src/lib/email.ts
- src/lib/truth/claims.ts
- src/lib/verifierBridge.ts
- src/middleware.ts
- verify/README.md
- verify/cli/kovel-verify.mjs
- verify/core.mjs
- verify/extension/background.js
- verify/extension/content.js
- verify/extension/core.js
- verify/extension/icons/128.png
- verify/extension/icons/16.png
- verify/extension/icons/48.png
- verify/extension/manifest.json
- verify/extension/options.html
- verify/extension/options.js
- verify/extension/popup.html
- verify/extension/popup.js

## Diff stat
```
 90 files changed, 5929 insertions(+), 165 deletions(-)
```
