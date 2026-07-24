# Representative WebView Wave 1 foundation

## Outcome

Wave 1 implements the fail-closed backend foundation for the representative portal. It does not enable representative transfers, build the portal UI, or deploy any component. Production must keep `representativeTransfers` disabled until the later PIN, transfer-hardening, portal, mobile, receipt, reversal, and operational-control waves pass their release gates.

## Runtime configuration

- `appConfig/socialFeatures.wallet` and `appConfig/socialFeatures.representativeTransfers` must both be exactly `true`.
- `appConfig/representativeTransferPolicy.limits` must contain complete valid limits for coins and diamonds.
- `REPRESENTATIVE_PORTAL_ORIGIN` must be an origin-only HTTPS URL. It is declared as a Functions string parameter and documented in `functions/.env.example`.
- An active `representativePrivileges/{uid}` document must grant at least one currency.
- The representative must have a valid active public profile and normal seven-digit public-ID reservation.

Missing or malformed configuration fails closed. Status may explain which readiness condition is absent, but ticket creation, ticket exchange, status access through the portal, recipient preview, and the existing transfer path reject unavailable configurations.

The policy shape is:

```json
{
  "limits": {
    "coins": {
      "maxPerTransfer": 100000,
      "maxPerDay": 1000000,
      "maxTransfersPerHour": 20
    },
    "diamonds": {
      "maxPerTransfer": 10000,
      "maxPerDay": 100000,
      "maxTransfersPerHour": 10
    }
  }
}
```

Optional per-representative overrides use the same complete three-field currency object under `representativePrivileges/{uid}.limits`. An override may cover coins, diamonds, or both. Invalid overrides make the representative unavailable instead of falling back silently.

## Mobile bootstrap contract

The authenticated `socialCommand` action `create-representative-portal-ticket` accepts no payload. It returns a random opaque ticket, its ISO expiry, and the configured portal origin only after rechecking flags, policy, privilege, and profile state.

Only the SHA-256 digest is stored in `representativePortalBootstrapTickets/{ticketHash}`. The ticket lasts 60 seconds, is bound to the representative UID and exact portal origin, and is consumed atomically once. Replay, expiry, wrong origin, revocation, and feature deactivation are rejected.

The raw ticket must be delivered to the portal in a URL fragment or equivalent mechanism that does not enter access logs or referrer headers. Firebase ID tokens are never sent to the portal URL.

## Portal HTTP contract

The public `representativePortal` HTTP function accepts only `POST` JSON from the configured exact origin. It sets explicit no-store headers and returns CORS headers only to that origin. `OPTIONS` is supported for the approved origin.

Supported actions are exact-schema requests:

- `exchange` with the one-time bootstrap ticket;
- `status` with an opaque bearer session;
- `recipient-preview` with an opaque bearer session and a normal seven-digit ID.

Exchange returns a new opaque 32-byte session token. Only its SHA-256 digest is stored in `representativePortalSessions/{sessionHash}`. The session is origin-bound, representative-bound, one-purpose, and expires after 15 minutes. Status and preview recheck the session, flags, policy, privilege, and representative profile.

Portal status exposes only the shared wallet balances/update time, effective limits, remaining UTC-day allowance, PIN readiness, granted currencies, feature readiness, and public receipt fields. It removes wallet UIDs, privilege UIDs, recipient UIDs, and legacy transfer IDs that may embed internal UIDs.

## Recipient verification

Recipient lookup resolves only `publicIds/{normalSevenDigitId}`. Custom/VIP identifiers, self lookup, missing reservations, profile mismatches, and inactive profiles fail.

A successful response contains only moderated avatar URL, current display name, normal public ID, proof, and proof expiry. The raw proof lasts 60 seconds; only its SHA-256 digest is stored in `representativeRecipientProofs/{proofHash}`. The stored proof binds representative UID, recipient UID, normal ID, state, and expiry. Wave 2 consumes it authoritatively during transfer.

Lookups use a server-owned fixed window at `representativePortalRateLimits/{uid}`: 20 attempts per 60 seconds. Invalid attempts count. Invalid and rate-limited attempts create server-only, secret-free records in `representativePortalSecurityEvents`; attempted IDs and raw credentials are not recorded.

## Server-only data and retention

Firestore clients cannot read or write bootstrap tickets, portal sessions, recipient proofs, lookup rate limits, portal security events, PIN documents, or transfer counters. Functions use Admin SDK access.

The credential and proof documents include `expiresAt` so Firestore TTL cleanup can be configured before production. TTL is housekeeping only; every authorization path rejects expired documents independently.

No Firestore composite index or Realtime Database change is needed in Wave 1.

## Mobile and dashboard source

The mobile feature mapper treats missing or non-boolean `representativeTransfers` as false. The Me-page entry requires both an active representative privilege and authoritative feature availability. The current native transfer screen also fails closed; it is replaced by the WebView shell in Wave 4.

The admin dashboard source recognizes the flag so the client can operate it after their own deployment. Codex did not and must not deploy the admin dashboard or its dedicated function.

## Verification evidence

- Full non-emulator app/Functions suite: 84 files and 540 tests passed after the final security-signal change and after removal of all partial Wave 2 work.
- Representative focused regression: 5 files and 35 tests passed, including disabled feature, origin, replay/expiry, status redaction, preview proof, malformed/self/missing recipient behavior, enumeration limits, and server-only security signals.
- Functions syntax/lint passed.
- Mobile TypeScript passed.
- Admin dashboard typecheck passed and 8 files / 19 tests passed.
- Admin dashboard production build and bundle check passed; it remained local and was not deployed.
- Firestore and Storage emulator rules suite passed.
- No backend, rules, portal, mobile, or dashboard deployment occurred.

## Release and rollback

Do not enable the flag after Wave 1. The legacy transfer function does not yet require a PIN or consume recipient proof and counters; Wave 2 closes those paths. If any Wave 1 code is staged in an environment, keep the dedicated flag false. Rollback is setting `representativeTransfers` false, preserving all server records, and allowing short-lived tickets/sessions/proofs to expire.
