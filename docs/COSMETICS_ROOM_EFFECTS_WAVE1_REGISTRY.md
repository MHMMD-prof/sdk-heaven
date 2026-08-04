# Cosmetics and Room Effects — Wave 1 Registry

Status: local implementation complete on 2026-08-02. The registry remains dark;
existing catalog URLs are still authoritative. Deployment, live inventory review,
and the Wave 0 physical-device media gate are operational gates, not completed by
this code change.

## What Wave 1 adds

- One canonical registry summary at `cosmeticAssets/{assetId}`.
- Immutable version records at `cosmeticAssets/{assetId}/versions/{assetVersionId}`.
- Immutable server validation receipts at `cosmeticAssetValidationReceipts/{receiptId}`.
- Immutable moderation decisions at `cosmeticAssetApprovals/{assetId}__{assetVersionId}`.
- Private custom-submission and upload-authorization rule boundaries. Custom
  assets cannot be public or rendered before an administrator approves and
  publishes a validated canonical version.
- An admin workspace for validation, approval, rejection, publication,
  emergency disable, suspension, and explicit version rollback.
- Daily removal of source objects for rejected or abandoned custom submissions
  older than 90 days. Their audit and submission records remain.
- A read-only legacy inventory command that reports conversion and migration
  problems without changing Firestore, Storage, or current catalogs.

## Immutable publication flow

1. A catalog manager uploads exactly one source object to the canonical path:
   - platform: `cosmetic-assets/platform/{assetId}/{versionId}/source.{ext}`
   - user-derived: `cosmetic-assets/users/{uid}/{assetId}/{versionId}/source.{ext}`
2. The server downloads the bytes from trusted Storage. A client URL or client
   checksum is never accepted as authority.
3. The server verifies content type, actual image/JSON/ISO-BMFF structure,
   dimensions, duration, codecs, frame rate, byte budget, category compatibility,
   and required approved fallback/audio references. It calculates SHA-256.
4. The server creates the immutable version and successful validation receipt.
5. A separate admin action creates one immutable approval or rejection.
6. Publication changes only the mutable summary pointer. It never overwrites the
   bytes or version metadata.
7. Rollback points the summary to an earlier exact approved version. Suspension
   and emergency disable make `renderingEnabled` false immediately.

Every mutation requires a reason, expected revision, unique request ID, and an
authorized admin role. Replayed requests are idempotent only when the actor and
request fingerprint match the original audit event.

## Format policy

New uploads accept only decoded static PNG/JPEG, vector-only Lottie JSON, bounded
H.264 MP4 with optional AAC audio, and AAC-only M4A. Static WebP is recognized
only as a grandfathered legacy format. GIF, animated WebP, MP3, HEVC, arbitrary
remote URLs, and extension-only type claims cannot be published through this
registry.

MP4 and M4A remain schema/validation-capable but must not be enabled in the
production mobile renderer until the Wave 0 physical Android and iOS gate passes.
The ISO-BMFF validator checks container metadata and declared codecs; it is not a
replacement for the pending real-device decode, lifecycle, low-memory, and
LiveKit coexistence acceptance tests.

## Reads and security rules

- Clients cannot write registry summaries, versions, receipts, decisions, or
  upload authorizations.
- Clients can read only a summary that is published, rendering-enabled, and not
  suspended, and only the exact version referenced by that summary.
- Private submissions are readable only by their owner; public clients cannot
  see them.
- Canonical published objects are create-once and cannot be updated or deleted by
  clients.
- A user custom submission needs a matching active, unexpired, server-issued
  authorization and is still private after upload.

## Legacy inventory

Run from the Functions package with Firebase credentials for the intended project:

```powershell
npm --prefix functions run cosmetics:inventory
```

The command scans `storeCatalog`, `giftCatalog`, `roomThemes`, and
`roomRocketCampaigns`. It prints JSON containing discovered references, inferred
formats/categories, unversioned paths, duplicate references, legacy or unsupported
formats, animated assets without a static fallback, and gifts without a visual
asset. It rejects `--apply` and `--write`; Wave 1 never rewrites a catalog or
blindly approves a legacy object. Review the report, convert/copy each accepted
asset to a canonical versioned path, then validate and approve it through the
admin workspace.

Dead-object verification is intentionally limited to a later reviewed migration
step: the inventory does not request arbitrary third-party URLs, avoiding a
server-side request-forgery surface.

## Deployment and rollback

Deploy the Firestore index, Firestore rules, Storage rules, Functions, and admin
dashboard together. Then run the inventory against the target environment and
review every finding before registering legacy versions.

Rollback requires no catalog migration reversal because existing URL fields are
unchanged. Leave the registry dark, disable any published summaries, and roll back
the new backend/admin deployment. Immutable versions, approvals, receipts, and
audit history remain preserved.
