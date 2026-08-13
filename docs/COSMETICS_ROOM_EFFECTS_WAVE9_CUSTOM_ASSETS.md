# Cosmetics and Room Effects Wave 9: approved custom user assets

## Outcome

Wave 9 is **local code complete** behind fail-closed flags. It adds:

- server-owned `cosmeticCustomEligibility/{uid}` allowlist (client writes denied);
- expiring `cosmeticUploadAuthorizations/{uid}` plus immutable
  `cosmeticSubmissions/{submissionId}` workflow;
- quarantine upload under `cosmetic-submissions/{uid}/{submissionId}/{versionId}/...`;
- trusted finalize/process via Admin SDK download (MIME/size/checksum/dimensions/
  Lottie rules; client checksum never trusted; custom MP4 always rejected);
- copyright attestation required before `pending`;
- social commands for create-upload, finalize, attest, list-own, equip/unequip custom;
- admin mutate hooks `approve-custom-submission`, `reject-custom-submission`,
  `suspend-custom-submission`, `grant-custom-eligibility`,
  `revoke-custom-eligibility`;
- admin list/preview APIs that never put quarantine `sourcePath` in ordinary
  queue tables (evidence-style signed preview only);
- admin Cosmetics Asset Registry queue UI with validation/attestation context,
  bounded preview, approve/reject/suspend, and eligibility grant/revoke;
- mobile `customSubmissions` request builders + My Items panel gated by
  submissions flag and explicit eligibility categories (image upload for
  profile-skin / avatar-frame; DocumentPicker Lottie JSON upload for
  entry-effect with required platform fallback IDs; equip approved owner-bound
  assets via server commands only when rendering flag is on);
- room entry announce path that prefers an equipped approved owner-bound
  custom entry-effect when `cosmetics_custom_rendering` is on, and falls
  through to store/platform cars when custom ownership/asset checks fail;
- client fail-closed playback for `customSource` / user-owned bundles when
  custom rendering is off; and
- dark flags `cosmetics_custom_submissions` and `cosmetics_custom_rendering`
  (false-only emergency controls; never enable in this pass).

No function, rule, catalog record, flag, or asset was deployed.

## Ownership and visibility model

Custom approval is **owner-bound render grant**, not public catalog publish:

- approved bytes live under `cosmetic-assets/users/{uid}/...`;
- `cosmeticAssets` summaries use `ownerType: 'user'`, `ownerUid`, and
  `visibility: 'owner-bound'`;
- Firestore `get` of published owner-bound assets is allowed for peer render by
  exact ID; catalog `list` excludes `visibility == 'owner-bound'`;
- `cosmeticCustomOwnerships/{uid}/items/{assetId}` binds checksum + owner;
- private `storeEquipment.customCosmetics` carries `source: 'custom'`;
- public profile projections for skin/frame stay the minimal three-key shape
  (no `source`); entry effects never write onto `publicProfiles`;
- pending/rejected quarantine objects remain private to owner + admin;
- revoking eligibility clears custom equips and leaves store purchases intact.

## Gap-fill (2026-08-04)

Adversarial review closed enablement blockers:

- public profile schema no longer receives `source` / `entryEffect`;
- owner-bound assets are not listable as a public catalog;
- suspend disables render and clears equip in one transaction;
- stale/forged custom entry falls through to store cars;
- `maxPending` uses a transactional `pendingCount` on eligibility;
- eligibility requires an explicit non-empty categories allowlist;
- EquipmentCosmeticAsset and AvatarFrameLayer fail closed for
  `ownerType === 'user'` when custom rendering is dark;
- composite index for admin `status` + `ownerUid` queue filter;
- V1 Lottie safety remains structural + size/format gates (images keep
  `inspectImage`); no invented malware scanner.

## Current acceptance status

Local verification after gap-fill:

- focused Wave 9 core/service/entry/client suites passed;
- root `tsc --noEmit` passed;
- non-emulator suite: **223 files / 1,230 tests** passed;
- functions `lint:cosmetics-wave9` passed;
- admin production build passed;
- rules suite: **66 passed**, with only the pre-existing Wave 6 public-profile
  projection expectation still failing; new owner-bound get-allow / list-deny
  and storage in-place overwrite deny coverage passed.

Open release gates:

1. Physical Android/iOS acceptance for custom Lottie entry playback and the
   DocumentPicker path (native rebuild required for `expo-document-picker`).
2. Approved production platform fallback assets / allowlist for authorized
   creators.
3. Deployment of functions, rules, indexes, and admin surfaces.
4. Explicit later enablement of `cosmetics_custom_submissions` and
   `cosmetics_custom_rendering` (remain dark).

## Rollback

Force `cosmetics_custom_submissions` and `cosmetics_custom_rendering` false.
Preserve private submissions, review decisions, ownership records, and audits.
Store cars and platform entry effects continue on their existing path.
