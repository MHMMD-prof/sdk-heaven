# Representative WebView Wave 0 contract

## Status and scope

Wave 0 freezes the version-one product, security, data, and rollout contracts. It does not connect the new feature flag, portal, PIN, limits, badge, or reversal behavior to production code. Existing native representative transfers therefore continue to behave exactly as they did before this wave.

The executable constants and pure validators live in `functions/representativePortalCore.js`. Later waves must consume that module rather than redefining its TTLs, state names, feature key, origin rules, PIN format, or limit shape.

## Runtime availability

Representative transfer availability is fail-closed. Both of these fields must be exactly `true` in `appConfig/socialFeatures`:

- `wallet`
- `representativeTransfers`

A missing, malformed, or false value disables the portal. Later backend endpoints must also require an active `representativePrivileges/{uid}` record with permission for the selected currency.

The feature-status response is authoritative for presentation, but every mutation repeats the checks transactionally. Hiding a mobile button or closing a WebView is never treated as authorization.

## Portal origin and navigation

- Production and preview portals use one fixed origin-only HTTPS URL per build environment.
- Paths, query strings, fragments, embedded credentials, wildcard origins, arbitrary dashboard URLs, mixed content, and insecure remote HTTP origins are rejected.
- Explicit localhost HTTP origins are allowed only in local development.
- The dashboard may enable or disable the feature but cannot edit the portal origin.
- The mobile WebView may navigate only within the fixed origin. External schemes, windows, downloads, and unapproved origins are blocked.

## State machine

The portal uses these states:

1. `bootstrapping`
2. `recipient-entry`
3. `verifying`
4. `verified`
5. `review`
6. `pin-challenge`
7. `submitting`
8. `completed`

`failed`, `locked`, and `unavailable` are explicit exceptional states. The allowed transitions are exported and tested by `representativePortalCore.js`. The UI must not jump directly from recipient entry or verification to submission.

Changing the recipient ID clears the preview and returns to `recipient-entry`. Starting another transfer after completion also returns to `recipient-entry` with a new request ID and verification proof.

## WebView bootstrap and session

1. The signed-in mobile app requests a portal bootstrap ticket.
2. The backend requires the wallet flag, representative flag, active profile, active representative privilege, and at least one currency permission.
3. It creates 32 random bytes and stores only their cryptographic digest with the representative UID, creation time, 60-second expiry, expected portal origin, and unused state.
4. The opaque ticket is passed in the URL fragment or another mechanism that does not place it in server access logs or referrer headers.
5. The fixed portal origin exchanges it once. Consumption is atomic; expiry, origin mismatch, privilege revocation, feature disablement, and replay all fail.
6. The resulting portal session lasts at most 15 minutes. A new session requires returning through the authenticated mobile app.
7. Feature status is refreshed no less often than every 15 seconds and whenever the app resumes. Transfer endpoints check it again, so disabling the feature blocks money movement immediately even before the next UI poll.

Firebase ID tokens, passwords, transfer PINs, wallet balances, and internal UIDs must never appear in portal URLs, analytics, error messages, or client logs.

## Recipient verification

- Only active representatives may look up recipients.
- Only the normal public-ID reservation at `publicIds/{sevenDigitId}` is used. Custom/VIP IDs are never resolved for transfers.
- A preview contains only the current display name, moderated avatar, and exact normal public ID.
- Self, missing, incomplete, suspended, removed, or malformed recipients are rejected.
- Lookups are rate-limited to prevent profile enumeration.
- Successful verification creates a signed or server-stored opaque proof lasting 60 seconds.
- The proof binds the representative UID, recipient UID, normal public ID, verification/request identifier, and expiry.
- The proof is consumed by the matching idempotent transfer. It cannot authorize a changed recipient.

## Shared wallet and amount policy

There is one wallet per user. Representative transfers debit the same coin or diamond balance used by the rest of the app. No float, stock, business, or secondary representative wallet will be introduced.

Representatives may enter any positive whole-number amount, but the authoritative backend applies:

- sufficient current balance;
- granted currency permission;
- `maxPerTransfer` for that currency;
- `maxPerDay` for that currency;
- `maxTransfersPerHour` for that currency;
- an optional non-empty per-representative override for coins, diamonds, or both.

Global production policy must contain complete positive limits for both currencies, and `maxPerDay` must not be smaller than `maxPerTransfer`. There are no implicit production limits: the feature remains disabled until an administrator configures and reviews them. Daily and hourly counters use deterministic UTC buckets; clients display the reset time in local time.

## Transfer PIN

- The PIN is exactly six numeric characters and remains a string so leading zeroes are preserved.
- PIN setup and reset require a newly issued portal session backed by fresh account authentication.
- The server stores a modern salted password hash and its parameters, never plaintext or reversible encryption.
- The PIN is verified server-side for every transfer.
- Five consecutive failures create a 15-minute lock. Lock and attempt counters are server-owned and updated transactionally.
- A successful verification resets the failed-attempt counter.
- Administrators may mark the PIN as reset-required but may not set, read, recover, log, or export it.
- PIN values are excluded from command documents, receipts, notifications, audit events, analytics, and logs.
- Biometrics are outside version one and cannot replace server authorization.

## Transfer and idempotency

- The existing one-wallet atomic debit/credit model remains.
- The client disables duplicate submission, but the backend is authoritative.
- One request ID represents one exact representative UID, recipient proof, recipient ID, currency, and amount.
- Repeating the identical completed request returns the original result.
- Reusing a request ID with any different value returns `REQUEST_CONFLICT`.
- Feature, privilege, PIN, proof, policy, counter, profile, ID reservation, and both wallet checks happen in the authoritative transaction boundary or through a transaction-safe prerequisite.
- Failure before commit writes no wallet, receipt, counter, transfer, or notification state.

## Receipts and public references

Every successful transfer retains the existing immutable transfer event, both wallet-ledger entries, representative receipt, recipient receipt, and notifications. Version-one enriched receipts add:

- a random public reference matching `RPT-[0-9A-HJKMNP-TV-Z]{16}`;
- sender and recipient normal public IDs;
- safe display-name snapshots;
- amount and currency;
- completion time;
- immutable `completed` event status;
- balance-after only in the private receipt belonging to that wallet owner.

Public/shareable receipts omit wallet balances, Firebase UIDs, device data, PIN state, limit state, IP addresses, and administrator data. They state that the receipt confirms virtual-resource delivery only and does not prove an external cash payment.

## Reversal

- Reversal is an administrator-only compensating transaction, not an edit or delete.
- It is available for 24 hours from the original completion time.
- Only the full original amount and currency may be reversed.
- The original transfer must not already have a reversal.
- The recipient must still hold the full amount.
- Recipient debit, representative refund, linked reversal event, both ledger entries, both receipts, counter metadata, notifications, and admin audit event commit atomically.
- The original transfer and receipts remain immutable with status `completed`. APIs may derive a `reversed` display state from the linked reversal.
- Concurrent recipient spending, a second reversal, an expired request, or insufficient recipient balance fails without partial writes.

## Authorized representative badge

- `representativePrivileges/{uid}` remains the private authority.
- A minimal server-owned public projection contains only active badge state and update metadata. Currency permissions, limits, balances, PIN state, and internal notes stay private.
- The privilege update and badge projection update occur in the same backend transaction.
- Clients cannot create or edit the badge projection.
- Full profile surfaces show `وكيل معتمد`; compact identity surfaces show a consistent gold verification mark with an accessible label.
- Tapping the badge opens a server-verified explanation sheet. It does not open a payment method or expose operational data.
- Revoking or suspending representative privilege removes the badge. A temporary global feature outage does not change the user's underlying authorized role.

## Audit and notifications

Audit events are immutable and include actor, action, target, reason where required, request/reference IDs, safe before/after policy state, and server timestamps. They never contain PINs, bootstrap tickets, portal sessions, or recipient proofs.

Both users receive completed-transfer and completed-reversal notifications through the existing `walletTransfers` preference. Notification delivery remains post-commit and retry-safe; notification failure never rolls back committed money movement.

Security signals record ticket replay, repeated recipient enumeration, PIN lockout, velocity/limit rejection, invalid origin, and repeated reversal attempts using safe identifiers only.

## Migration plan

1. Add the new contract module and tests without runtime imports. This is Wave 0 and causes no data or behavior change.
2. Add `representativeTransfers` to server/mobile/admin flag mappings. Missing values map to false.
3. Deploy backend enforcement with the new flag still false. This intentionally pauses representative transfers during migration.
4. Add policy, portal-session, PIN, recipient-proof, enriched receipt, reversal, and badge collections additively. Do not rewrite existing wallet balances or old receipts.
5. Existing representatives start with PIN state `not-configured` and cannot open the new transfer flow until they create a PIN.
6. Existing completed receipts remain valid legacy receipts. APIs map missing version-one enrichment fields safely and do not invent balance snapshots.
7. Deploy and verify the portal, then the mobile WebView shell.
8. Configure explicit production limits and portal origin, smoke-test with controlled accounts, then enable the flag.
9. Dashboard source changes remain local unless the client deploys them. The server-credential kill-switch script is the operational fallback.

No Realtime Database migration is required. Wallet, receipt, policy, session, and audit transactions remain in Firestore.

## Rollback plan

1. Set `representativeTransfers` to false using the dashboard if the client deployed it, or the server-credential kill-switch script otherwise.
2. Confirm new bootstrap tickets, recipient proofs, and transfers are rejected while normal wallets remain usable.
3. Let existing short-lived portal sessions expire; backend checks prevent them from moving funds immediately after disablement.
4. Roll back portal/mobile presentation only after the backend flag is false.
5. Preserve all wallet ledgers, completed transfers, reversals, receipts, audit events, PIN security metadata, and counters for reconciliation. Never delete financial history during rollback.
6. Ship a forward fix and re-enable only after production smoke tests pass.

Rollback never restores an unprotected native transfer path automatically. Re-enabling representative transfers requires the version-one security prerequisites and explicit operator action.

## Wave 0 exit evidence

- Pure tests pin the contract version, TTLs, lock/reversal windows, fail-closed flag behavior, state transitions, origin rules, limit shape, PIN format, and public-reference format.
- The Functions syntax check includes the new contract module.
- No runtime module imports the contract yet.
- No Firestore rules, indexes, schemas, mobile routes, portal applications, or deployed functions change in Wave 0.
