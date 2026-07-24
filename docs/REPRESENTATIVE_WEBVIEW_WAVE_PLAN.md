# Representative WebView implementation waves

## Product contract

- An administrator may grant a user representative access for coins, diamonds, or both.
- Representatives use the same wallet as every other user. There is no separate representative balance.
- A representative may send any positive whole-number amount that is permitted by their balance and policy limits.
- The recipient is selected only through the normal unique seven-digit public ID. Custom/VIP IDs are not accepted.
- The representative must verify a limited recipient preview containing the current display name, avatar, and normal ID before continuing.
- The recipient does not approve a recharge. A confirmed transfer completes immediately and atomically.
- Every transfer requires the representative's six-digit transfer PIN. Biometrics are deferred.
- Only one transfer request may be active at a time. Backend idempotency remains authoritative.
- Both participants receive transfer notifications and immutable receipts.
- An administrator may reverse the full transfer within 24 hours when the recipient still owns the full amount. Reversal never edits or deletes the original transaction.
- The representative experience is hosted as a dedicated web portal and opened by the mobile app in a WebView.
- A server-owned feature flag controls both visibility and backend availability. Turning the flag off hides the entry point, blocks new sessions, rejects transfer operations, and closes active mobile sessions on their next status check.
- The WebView origin is fixed at build/deployment time and cannot be changed from the dashboard.
- A server-owned authorized-representative badge is visible throughout supported identity surfaces. Compact surfaces use an icon; profiles and the verification sheet use the full Arabic label `وكيل معتمد`.
- The global bottom navigation is unchanged.
- Admin dashboard source may be changed, but Codex must never deploy the admin dashboard or its dedicated function.

## Wave 0 - Contracts, threat model, and release boundaries

**Status: complete (2026-07-22).** The version-one constants and pure validators are isolated in `functions/representativePortalCore.js`; the detailed state, security, migration, and rollback contract is recorded in `docs/REPRESENTATIVE_WEBVIEW_WAVE0_CONTRACT.md`. No runtime module imports the new contract yet, so this wave changes no live behavior or schema.

### Work

- Document the transfer state machine: `bootstrapping -> recipient entry -> verifying -> verified -> review -> PIN challenge -> submitting -> completed/failed`.
- Define the dedicated `representativeTransfers` feature flag and its fail-closed behavior.
- Define a fixed HTTPS portal origin per environment and reject every other WebView navigation origin.
- Define the one-time WebView bootstrap-ticket contract: opaque, single-use, short-lived, bound to the authenticated UID and representative privilege, and exchanged only by the portal origin.
- Define recipient-preview expiry. Editing the ID or allowing the preview to expire clears verification.
- Define global coin and diamond policy fields: maximum per transfer, maximum per day, maximum transfer count per hour, and optional per-representative overrides.
- Keep the production flag disabled until real limits are configured. Test environments may use explicit fixtures.
- Define the six-digit PIN lifecycle: first-time setup, verification, five-attempt temporary lock, reset-required state, and reset after fresh account authentication. PINs are salted and hashed server-side; administrators never see them.
- Define receipt, reversal, badge, audit, and notification contracts before changing stored data.
- Record deployment boundaries: backend, rules/indexes, portal, and mobile may be deployed when requested; admin dashboard and its function remain local.

### Exit gate

- Contract tests and migration/rollback notes exist before schema or interface changes begin.

## Wave 1 - Feature flag, portal session, and recipient verification backend

**Status: complete (2026-07-22).** The dedicated flag, fail-closed status contract, hashed bootstrap/session credentials, fixed-origin HTTP exchange, recipient-preview proof, enumeration throttle/security signals, client-denied server collections, and mobile/admin flag mappings are implemented. See `docs/REPRESENTATIVE_WEBVIEW_WAVE1_FOUNDATION.md`. The production flag remains disabled and no component was deployed.

### Work

- Add `representativeTransfers` to the server-owned feature configuration and mobile mapping.
- Make representative status return feature availability, permissions, wallet balance, configured limits, remaining daily allowance, PIN state, and recent receipts.
- Add a mobile-authenticated action that creates a one-time portal bootstrap ticket only for an active representative while the feature is enabled.
- Store only a hash of the bootstrap ticket. Enforce short expiry, one-time consumption, UID binding, and replay rejection.
- Add the portal exchange endpoint that consumes the ticket and establishes a short-lived authenticated portal session without placing Firebase ID tokens, passwords, or PINs in the URL.
- Add a representative-only recipient-preview action returning only avatar, display name, and normal seven-digit ID.
- Rate-limit recipient enumeration and record security-relevant failures without logging secrets.
- Recheck feature status and representative privilege on every endpoint; never trust mobile visibility or portal state.

### Exit gate

- Automated tests cover disabled feature, inactive representative, expired/replayed ticket, wrong origin, malformed ID, missing recipient, self-recipient, and preview expiry.

## Wave 2 - PIN, limits, and transfer hardening

**Status: complete (2026-07-23).** The portal-only transfer path now requires a fresh-authenticated scrypt PIN, a short-lived recipient proof, a valid fixed-origin portal session, current representative permission, sufficient shared-wallet funds, and configured per-transfer/day/hour limits. The authoritative transaction serializes wallet, proof, counter, receipt, public-reference, and idempotency-command writes. The legacy native transfer action is rejected, all new authoritative collections are client-denied, and the production flag remains disabled. See `docs/REPRESENTATIVE_WEBVIEW_WAVE2_HARDENING.md`. No component was deployed.

### Work

- Implement PIN setup, verification, failed-attempt counters, temporary lockout, and reset-required handling.
- Require a valid PIN challenge for every transfer. Do not accept a client-only biometric result as authorization.
- Extend transfer input with a short-lived verified-recipient proof so an edited ID cannot reuse an earlier preview.
- Enforce currency permission, current privilege, global/per-representative limits, hourly velocity, sufficient funds, and feature availability inside the authoritative transaction path.
- Keep the existing single wallet and atomic representative debit/recipient credit.
- Preserve request idempotency and reject reuse of a request ID with different payload values.
- Enrich immutable receipts with public reference, recipient/sender public IDs, display-name snapshots, currency, amount, completion time, status, and safe before/after balance fields for the appropriate owner.
- Retain separate sender and recipient receipts plus wallet-ledger entries and notifications.

### Exit gate

- Concurrency tests prove that duplicate submissions, simultaneous requests, stale preview proofs, wrong PINs, exhausted limits, and insufficient funds cannot double-spend or partially write data.

## Wave 3 - Representative web portal

**Status: complete (2026-07-24).** A standalone Arabic RTL portal now lives in `representative-portal/`. It exchanges a one-time fragment ticket, keeps the short portal session only in memory, polls authoritative status, and implements the recipient → value → review → PIN → completed state machine against the Wave 2 endpoint. It includes PIN setup/reset presentation, permission-aware currencies, external-payment acknowledgement, single-submit locking, exceptional states, recent history, safe receipt detail/text/image sharing, an exact-schema native bridge, responsive layouts, and accessibility/keyboard contracts. See `docs/REPRESENTATIVE_WEBVIEW_WAVE3_PORTAL.md`. The production feature flag remains disabled and no portal, backend, mobile, rules, or admin component was deployed.

### Work

- Create a separate RTL representative portal using the project's black, aubergine, ruby, and brass design language.
- Implement secure bootstrap-ticket exchange, session expiry, sign-out, disabled-feature, unauthorized, offline, loading, and retry states.
- Build recipient entry and verified preview with avatar, display name, and exact seven-digit normal ID.
- Build currency selection from the representative's granted permissions.
- Support any positive whole-number amount, supplemented by non-binding quick-amount shortcuts.
- Build a review panel showing recipient, amount, current balance, resulting balance, remaining daily allowance, and a confirmation that external payment has already been collected.
- Prompt for the six-digit PIN on every submission and enforce a single active request in the UI.
- Build success, failure, recent-history, and receipt-detail views.
- Provide shareable receipt text/image that omits wallet balances, internal UIDs, device information, and administrative data. State clearly that it confirms virtual-currency delivery, not external payment.
- Keep the bridge minimal: close, session-expired, feature-disabled, refresh-balance, and receipt-share messages only. Validate every message schema.

### Exit gate

- Portal tests cover RTL layout, keyboard behavior, small screens, accessibility labels, session expiry, duplicate taps, recipient edits, PIN errors, and safe receipt sharing.

## Wave 4 - Expo 56 WebView integration

**Status: implementation complete locally (2026-07-24); physical Android acceptance remains pending.** The obsolete native transfer form has been replaced by a memory-only, fail-closed WebView shell using the Expo SDK 56-compatible `react-native-webview` 13.16.1 package. The shell validates the one-time ticket and exact HTTPS portal origin, blocks off-origin navigation and unsafe WebView capabilities, rechecks authorization on resume, validates the native bridge again, and disposes the embedded session on exit or terminal status. See `docs/REPRESENTATIVE_WEBVIEW_WAVE4_MOBILE.md`. The feature remains disabled and nothing was deployed.

### Work

- Install the Expo SDK 56-compatible `react-native-webview` package through `npx expo install`.
- Replace the native transfer form with a WebView shell that requests a fresh one-time bootstrap ticket and passes it to the fixed portal origin without exposing long-lived credentials.
- Show the Me-page representative entry only when the user is active and the server flag is enabled.
- Preserve the existing route and global bottom navigation behavior.
- Block arbitrary navigation, popups, downloads, mixed content, untrusted schemes, and unapproved origins.
- Handle Android hardware back, header back, loading, portal errors, offline state, expired sessions, app resume, feature deactivation, and representative privilege revocation.
- Dispose of the WebView session when leaving the screen or when the feature is disabled.

### Exit gate

- TypeScript passes, an Expo SDK 56 export succeeds, and physical Android tests cover navigation blocking, back behavior, process resume, connectivity loss, and remote deactivation.

## Wave 5 - Authorized representative badge

**Status: backend released and mobile implementation complete locally (2026-07-24); physical Android visual acceptance and mobile distribution remain pending.** Representative privilege changes now atomically project a client-read-only badge into the public profile. Reusable full and compact Arabic badge treatments, a privacy-safe verification sheet, live revocation subscriptions, and coverage across every currently implemented identity surface are in place. Firestore rules, `socialCommand`, and the non-admin five-minute badge reconciliation job are deployed; the job performs the initial production backfill. See `docs/REPRESENTATIVE_WEBVIEW_WAVE5_BADGE.md`. The transfer feature remains disabled, and neither the admin dashboard function nor dashboard Hosting was deployed.

### Work

- Add a server-owned public badge projection updated whenever representative privilege changes. Clients cannot grant or edit it.
- Add a reusable compact badge beside representative identity in supported profile, discovery, friends, room-member/seat, message, notification, gift, and game identity surfaces.
- Use the full `وكيل معتمد` treatment on Me and public profiles; use only the compact badge where space is constrained.
- Make the badge open a server-verified information sheet explaining the role without exposing permissions, wallet balances, or internal identifiers.
- Remove the badge promptly when privilege is suspended or revoked and invalidate stale caches.
- Do not alter the bottom navigation.

### Exit gate

- Badge tests verify server ownership, revocation, compact/full variants, RTL alignment, accessibility, and consistent behavior across every currently implemented identity surface.

## Wave 6 - Reversal, receipts, and operational controls

### Work

- Add an admin-authorized full reversal command linked to the original transfer.
- Permit reversal only within 24 hours, only once, and only if the recipient still holds the full original amount in the original currency.
- Execute the recipient debit and representative refund atomically in the same shared wallets.
- Create compensating wallet-ledger entries, sender/recipient reversal receipts, notifications, and an immutable admin audit event. Never modify the original ledger entries.
- Add receipt lookup by public reference and paginated representative history with currency/date/status filters.
- Add security signals for repeated failed PINs, recipient enumeration, rapid transfers, limit failures, and repeated reversal attempts.

### Exit gate

- Tests cover reversal expiry, insufficient recipient balance, double reversal, currency mismatch, concurrent spend/reversal, audit completeness, and both-user notifications.

## Wave 7 - Admin dashboard source and final rollout

### Work

- Add local dashboard controls for the representative transfer feature flag, global currency limits, per-representative overrides, privilege/currency assignment, PIN reset-required action, eligible reversal, receipt inspection, and audit history.
- Require a reason and confirmation for disable/enable, privilege changes, PIN resets, limit overrides, and reversals.
- Use stale-record conflict protection for every administrative mutation.
- Keep the portal URL outside dashboard control.
- Add a server-credential CLI fallback for the global kill switch so production can be disabled even when dashboard source has not been deployed by the client.
- Run backend unit tests, focused representative tests, Firestore rules emulator tests, portal tests, mobile TypeScript, copy-encoding checks, and Expo SDK 56 bundle export.
- Deploy in order when requested: required rules/indexes, non-admin backend functions, representative portal hosting, then mobile build.
- Do not deploy admin dashboard Hosting or the dedicated `adminDashboard` function. The client must perform that deployment if they want its new controls live.
- No Realtime Database change is required; representative money, receipts, policy, and audit state remain transactional in Firestore.

### Exit gate

- The feature remains disabled until the deployed portal, backend, limits, mobile shell, receipt flow, reversal flow, and emergency kill switch pass production smoke tests.

## Final acceptance checklist

- Store and My Items remain independent and unchanged by this work.
- The Me page is the only mobile entry to the representative WebView.
- Disabled or unauthorized users cannot see or invoke the representative experience.
- The same balance shown in the normal wallet is debited for representative transfers.
- Only normal seven-digit IDs work, and a current recipient preview is mandatory.
- Every transfer requires the six-digit PIN and only one request may be active.
- Transfers, limits, receipts, notifications, and reversals remain correct under retries and concurrency.
- Representative identity is visibly and consistently server-verified without revealing sensitive operational data.
- No global navigation changes are introduced.
- Admin dashboard code is not deployed by Codex.
