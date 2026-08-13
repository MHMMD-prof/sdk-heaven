# VIP, SVIP, and Aristocracy — Wave 5 Status Center

Status: implemented locally on 2026-08-13. Nothing was deployed, published, or enabled by this wave.

## Delivered

- Added one authenticated Status Center, reachable from both compact Me-page cards and Wallet.
- Added Arabic RTL and English UI for VIP/SVIP progress, tier road, eligible-recharge explanation, point history, Aristocracy rank comparison, expiry, benefits, and transaction history.
- Added authoritative server quotes that show operation, final coin price, wallet balance before/after, and resulting expiry before confirmation.
- Purchase, renewal, and upgrade use wallet coins only. The UI and server contract explicitly require `autoRenew: false`; no Apple, Google, external subscription, or recurring billing path exists.
- Added public-status visibility controls. The client cannot write public profile status directly; an idempotent authenticated command writes private visibility and queues the existing projection worker.
- Added loading, offline, stale-data, retry, frozen, review, expired, feature-paused, insufficient-funds, quote-expired, quote-stale, catalog-changed, downgrade-blocked, and success states.
- Owner history and expiry remain available when shop or public-presentation flags are disabled. Disabling commerce never erases or hides existing owner truth.

## Security and integrity

- `get-status-center` returns a bounded maximum of 20 recent VIP point events and 20 Aristocracy transactions.
- History is sanitized server-side and excludes actor IDs, representative IDs, wallet transaction IDs, request IDs, internal notes, and source document paths.
- `update-status-visibility` validates an exact boolean payload, uses an idempotency record, and queues projection; public Firestore writes remain denied.
- Purchase retries reuse the quote ID as the command request ID, so a lost response cannot produce a second debit.
- The mobile client validates every Status Center and quote response and fails closed on malformed authority data.

## Verification

- TypeScript: pass (`npx tsc --noEmit`).
- Source syntax: pass for changed Cloud Functions files.
- Focused Wave 5 tests: pass.
- Full Vitest suite: 326 files, 1,793 tests passed.
- Firestore and Storage rules: 2 files, 76 tests passed. The existing emulator shutdown null warnings and Java shutdown exception remain non-test failures; the runner reported exit code 0.
- `git diff --check`: pass, with only the repository's existing line-ending warnings.

## Remaining exit-gate work

The implementation is code-complete, but the Wave 5 exit gate is not fully closed until authenticated physical-device checks pass on Android and iOS for:

- Arabic RTL and English layouts, large text, TalkBack, and VoiceOver;
- Me-card and Wallet navigation into the correct initial tab;
- live quote, successful purchase, retry after a dropped response, insufficient balance, expired/stale quote, and changed catalog;
- frozen/review/expired accounts and shop-disabled owner visibility;
- visibility change propagation to profile, room, chat, discovery, and entry surfaces;
- offline refresh with retained stale data and recovery after reconnection.

Do not claim production readiness or enable public flags until these physical-device flows are signed off. Wave 6 still owns operational dashboards, alerting, reconciliation drills, support tooling, and direct activation readiness.
