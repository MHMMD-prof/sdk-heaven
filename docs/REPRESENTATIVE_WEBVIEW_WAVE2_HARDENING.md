# Representative WebView Wave 2 hardening

## Outcome

Wave 2 replaces the legacy representative money-movement contract with a portal-only, PIN- and recipient-proof-bound transaction. The production `representativeTransfers` flag remains disabled. No backend, rules, portal, mobile, or dashboard component is deployed by this wave.

## PIN lifecycle

The portal adds an exact-schema `pin-setup` action. A PIN:

- is exactly six numeric characters and remains a string;
- is accepted only through the fixed HTTPS portal origin and an active opaque portal session;
- may be created when no PIN exists or replaced when the server-owned document has `resetRequired: true`;
- requires a portal session whose Firebase authentication time was no more than five minutes old;
- is never stored, logged, returned, added to a receipt, or placed in a URL.

`representativePinCore.js` stores a random 16-byte salt and a 32-byte scrypt-derived key with explicit parameters:

- cost: 16,384;
- block size: 8;
- parallelization: 1;
- maximum working memory: 64 MiB.

Verification uses `crypto.timingSafeEqual`. The stored document also owns `failedAttempts`, `lockedUntil`, and `resetRequired`.

Each failed PIN attempt is updated transactionally. Attempts one through four return `PIN_INVALID`. The fifth creates a 15-minute lock and returns `PIN_LOCKED`. Further attempts during the lock do not run scrypt. Successful transfers clear failure state. Server-only security events record `pin-failed` or `pin-locked` without recording the PIN, proof, session token, recipient ID, or wallet data.

## Portal transfer contract

The portal HTTP endpoint adds this exact request:

```json
{
  "action": "transfer",
  "amount": 100,
  "currency": "coins",
  "pin": "012345",
  "proof": "<opaque-recipient-proof>",
  "requestId": "<12-to-80-safe-characters>"
}
```

The recipient ID is not accepted again at transfer time. It is resolved only from the hashed, server-stored recipient proof created by Wave 1. This prevents a verified preview from being reused for an edited ID.

The public response contains amount, currency, the representative's resulting shared balances, the recipient's safe display name and normal public ID, and the random public reference. It removes representative UID, recipient UID, internal transfer ID, proof, session credential, PIN metadata, counter state, and administrative data.

The old authenticated `socialCommand` action `representative-transfer` is no longer accepted. This closes the native pre-portal path so a caller cannot bypass the portal session, recipient proof, or PIN. The current native screen remains inert while the dedicated feature flag stays disabled and is replaced by the WebView shell in Wave 4.

## Authoritative transaction

Before running the expensive PIN derivation, the service rejects disabled features, missing or invalid policy, inactive privilege, unavailable currency permission, and invalid/expired portal sessions.

The final Firestore transaction reads and rechecks:

- exact `wallet` and `representativeTransfers` flags;
- fixed portal origin and active 15-minute portal session;
- active representative privilege and selected-currency permission;
- valid global policy plus valid optional representative override;
- unchanged current PIN hash, reset state, and lock state;
- unused, unexpired proof bound to the representative, recipient UID, and normal public ID;
- both current public profiles and normal public-ID reservations;
- representative and recipient shared wallets;
- per-currency transfer, UTC-day amount, and UTC-hour count limits;
- request command and public-reference uniqueness.

It then atomically:

- debits the representative's normal shared wallet;
- credits the recipient's normal shared wallet;
- creates both wallet ledger entries;
- creates the immutable transfer event;
- creates private representative and recipient receipts;
- consumes the recipient proof with the request ID;
- clears successful PIN failure state;
- increments the deterministic UTC-day amount and UTC-hour count;
- reserves a random `RPT-[0-9A-HJKMNP-TV-Z]{16}` public reference;
- stores the exact idempotency command result.

Any failed check writes no wallet, counter, proof-consumption, receipt, transfer, public-reference, or command state. Wrong PINs intentionally write only PIN-security state and a safe security event.

## Limits and counters

The effective policy is selected independently for coins and diamonds. A valid per-representative override replaces the global limits only for the currencies present in that override.

The transaction enforces:

- `maxPerTransfer`;
- `maxPerDay` using `representativeTransferCounters/{uid}/days/{YYYY-MM-DD}`;
- `maxTransfersPerHour` using `representativeTransferCounters/{uid}/hours/{YYYY-MM-DDTHH}`;
- current sufficient wallet funds.

All buckets use UTC. Status continues to return the remaining UTC-day amount for each currency. Firestore transaction retries serialize competing updates to the wallet, proof, and counter documents.

## Idempotency and concurrency

Commands are stored at `representativeTransferCommands/{uid}/requests/{requestId}`. The immutable fingerprint contains representative UID through the path/document, amount, currency, and hashed proof ID. It never contains the PIN or raw proof.

- Repeating an identical completed request returns the original result.
- Reusing the request ID with a changed amount, currency, or proof returns `REQUEST_CONFLICT`.
- Two simultaneous identical submissions result in one wallet mutation and one result.
- Two different requests using the same proof result in one completed transfer and one `PROOF_INVALID`.
- Different legitimate proofs remain serialized by Firestore and must independently satisfy current wallet and policy limits.

Wave 3 additionally prevents more than one active submission in the portal UI.

## Receipts and compatibility

New transfer events and both private receipts add:

- random public reference;
- representative and recipient normal public IDs;
- safe display-name snapshots;
- amount and currency;
- immutable completion time/status;
- balance-before and balance-after only on the private receipt belonging to that wallet owner.

Legacy receipts remain readable. Optional enrichment fields are omitted rather than returned as empty or `undefined`, preserving their previous exact response shape. Portal status exposes only safe public receipt fields plus the representative's own private before/after balance values.

Both participants continue to receive the existing post-commit notifications. Notification delivery remains retry-safe and cannot roll back a committed wallet transaction.

## Server-only collections and release boundary

Firestore clients cannot access:

- `representativeTransferPins`;
- `representativeRecipientProofs`;
- `representativePortalSessions`;
- `representativeTransferCounters`;
- `representativeTransferCommands`;
- `representativePublicReferences`;
- representative portal security events and rate limits.

No composite Firestore index or Realtime Database change is required.

Do not enable `representativeTransfers` after Wave 2. The portal UI, Expo WebView shell, representative badge, reversal workflow, final admin controls, and production smoke tests are later waves. Rollback is setting the dedicated flag false and preserving all wallet, ledger, receipt, proof, counter, command, and security history.

## Verification

Wave 2 completed these local gates on 2026-07-23:

- all 86 non-emulator test files and all 558 tests passed;
- the focused representative/security suite passed all 50 tests;
- functions syntax/lint passed;
- application TypeScript passed;
- `git diff --check` reported no whitespace errors;
- the recovered `functions/index.js` contains no NUL bytes and all modified backend modules parse.

The Firestore/Storage emulator command could not be rerun in this environment because the required Firebase package/network access was denied after the tool account reached its usage limit. The Wave 2 rule assertions are present and statically reviewed: clients are denied access to transfer commands, public-reference reservations, PINs, recipient proofs, portal sessions, counters, rate limits, and portal security events. This is a verification-environment limitation, not a deployed or enabled feature state; the emulator command remains a required pre-deployment gate.
