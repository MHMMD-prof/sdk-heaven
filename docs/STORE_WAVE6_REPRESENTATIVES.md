# Wave 6: representative wallet transfers

## Delivered

- Admin-controlled representative privilege with independent coin and diamond permissions.
- Separate Me-page row and full-screen transfer page, visible only to active representatives.
- Recipient resolution exclusively through the normal seven-digit `publicIds` namespace.
- Atomic sender debit and recipient credit with immutable ledger entries and transfer audit event.
- Immediate completion without recipient acceptance or renewal.
- Idempotent requests, self-transfer rejection, insufficient-funds enforcement, and one in-flight mobile submission.
- Push notifications for both representative and recipient.

## Server-owned collections

- `representativePrivileges/{uid}`
- `representativeTransfers/{representativeUid_requestId}`
- `walletTransactions/representative_*`

Direct client reads and writes remain denied; all access crosses the callable backend boundary.

## Deployment boundary

Deploy `socialCommand` and Firestore rules. Do not deploy Hosting or the `adminDashboard` function under the current project instruction; its representative-control source remains local.
