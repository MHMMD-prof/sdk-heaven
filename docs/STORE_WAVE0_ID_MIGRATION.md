# Store Wave 0: seven-digit ID migration

Both normal account IDs and optional custom IDs use exactly seven numeric characters.
Normal IDs are allocated from `1000000` through `9999999`; custom IDs may begin with
zero. A number cannot be reserved in both namespaces.

## Required rollout order

1. Deploy the backend validators and collision checks together.
2. Run the profile backfill in dry-run mode and save its JSON-line output.
3. Resolve any existing custom ID that is not exactly seven digits before applying
   the public-ID migration. Do not silently discard or truncate purchased IDs.
4. Apply the profile migration in bounded batches.
5. Re-run dry-run mode until every profile reports `ready`.
6. Deploy the matching Firestore rules and mobile validation.

## Commands

Dry-run is the default and performs no writes. It audits both custom-ID collections
before scanning profiles:

```powershell
npm --prefix functions run social:backfill -- --actor-uid=ADMIN_UID --limit=500
```

Apply only after reviewing the dry-run output:

```powershell
npm --prefix functions run social:backfill:apply -- --actor-uid=ADMIN_UID --limit=500
```

Use `--start-after=UID` to resume from the cursor printed in the summary. The apply
path uses the same collision-safe transaction as normal profile provisioning. When
an owned legacy public-ID reservation is replaced, the old reservation is deleted
inside that transaction.

The custom-ID preflight reports `invalid-custom-id-format` and
`normal-custom-id-collision`. Apply mode stops before changing profiles when either
issue exists. Use `--special-id-limit=10000` when the custom-ID namespace is larger
than the default 1000-document audit bound.

## Rollback

Do not roll back the schema after new seven-digit IDs have been issued. If the mobile
release must be rolled back, keep the backend validators and reservations in place,
disable the store feature flag, and ship a forward fix. Audit events written by the
migration provide the user-to-ID mapping needed for recovery.
