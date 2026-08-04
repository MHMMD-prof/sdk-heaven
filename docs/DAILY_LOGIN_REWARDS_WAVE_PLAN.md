# Daily Login Rewards — Production Wave Plan

## Implementation status

- Wave 1: implemented locally and verified on 2026-07-31.
- Wave 2: implemented locally and automated verification passed on 2026-07-31.
  Physical Android compact/standard/tall RTL acceptance remains a device smoke
  check because no ADB device or emulator is available in this workspace.
- Wave 3: deployment and dark launch completed on 2026-07-31.
  Backend, rules, indexes, and the admin dashboard are live. Development
  campaign revision 1 is published for 2026-08-01 00:00 Baghdad time.
  The campaign became effective without intervention.
- Wave 4: currency-only production acceptance completed on 2026-08-02.
  Coin claims are enabled; diamond values remain zero and item rewards remain
  disabled.

### Wave 4 live acceptance record

- Enabled rollout stage 1 with `daily_login_rewards=true` and
  `daily_login_reward_items=false`.
- Ran two simultaneous authenticated claims for development UID
  `qLaisDcEGpcp5XIJ8XqHpigZqDJ3`. Exactly one credited the wallet and exactly
  one replayed the same economic result.
- Replayed the winning request ID and received the same receipt, settlement,
  reward, and balances without a second credit.
- Issued day-1 reward: 10 coins, 0 diamonds, and no items for Baghdad day
  `day_2026-08-02_asia-baghdad`.
- Reconciled receipt `dlc_88be4f6bbe3d79c72709f4451ba377201eded999`
  and settlement `dls_82c5dbe19d33b96311a47984399a98e30e781622`:
  one balanced claim, zero discrepancies, and zero errors.
- Post-acceptance status reports campaign revision 1, one claim sample,
  unpaused claims, and the currency-only rollout stage.
- Item rewards remain gated until a future item-bearing campaign and clean
  entitlement reconciliation are deliberately approved.

### Wave 3 live rollout record

- Deployed Firestore rules and the `days.kind` / `requests.replayOfReceiptId`
  collection-group indexes needed by claim and replay monitoring.
- Deployed `dailyLoginCommand`, `activateDailyLoginCampaign`, and the updated
  `adminDashboard` function in `us-central1`.
- Deployed the Daily Login owner workspace to
  `https://yallgame-ebd19.web.app`.
- Published immutable campaign revision 1 with coin rewards
  `10, 15, 20, 25, 30, 40, 50`; seven-day maximum is 190 coins per user.
  Diamonds and item rewards are zero.
- Explicitly wrote and audited the dark flag state:
  `daily_login_rewards=false` and `daily_login_reward_items=false`.
- Live unauthenticated requests return HTTP 401.
- An authenticated development-account smoke test returns HTTP 200 with
  `claimable=false` and `reason=FEATURE_DISABLED`.
- Live reconciliation baseline: zero claims, zero discrepancies, zero errors.
- Currency-only stage was activated after revision 1 became effective. Item
  rewards remain a later stage requiring a non-empty, clean entitlement
  reconciliation.
- Rollout commands:
  - Inspect: `npm --prefix functions run daily-login:status -- --assert-dark`
  - Enable currency after the readiness gate:
    `npm --prefix functions run daily-login:rollout -- --stage 1 --apply
    --acknowledge-economic-impact --actor-uid <owner-uid>`
  - Immediate rollback:
    `npm --prefix functions run daily-login:rollout -- --stage 0 --apply
    --actor-uid <owner-uid>`

### Wave 2 delivery record

- Added the owner-only Daily Login workspace to the existing Incentives page.
- Added audited seven-day drafts, immutable version publication, next-Baghdad-
  midnight scheduling, rollback-as-new-version, optimistic revision checks, and
  idempotent admin commands.
- Added separate immediate controls for claim pause, presentation visibility,
  emergency disable, and emergency re-enable.
- Added live preview, 100/1,000/10,000-user liability examples, claim/replay/
  failure/hold metrics, settled reward totals, and reconciliation status.
- Added the authenticated mobile coordinator, persistent Home entry, explicit
  claim sheet, strict response parsing, stable retry request IDs, authoritative
  receipt/balance confirmation, reset countdown, item-art fallback, RTL labels,
  screen-reader state, and reduced-motion handling.
- Added a scheduled activation function and sharded failed-claim telemetry.
- Added explicit client-deny rules for admin commands and failure metrics.
- Verification evidence:
  - `npm test`: 168 files and 934 tests passed.
  - Firestore and Storage emulator rules suites passed.
  - TypeScript `--noEmit` passed.
  - Admin dashboard production build passed.
  - Expo SDK 56 Android export passed (2,170 modules).
  - Focused Daily Login/admin/security suite passed (35 tests).
- Both Daily Login flags remain off and Wave 2 made no production deployment.

## Goal

Add a global, Platform Owner-controlled daily login reward that is safe for the
existing coins, diamonds, and item economy. A signed-in user manually claims
once per Baghdad calendar day. The backend determines eligibility and credits
the reward exactly once.

## Product decisions

- V1 uses a repeating seven-day reward calendar.
- The Platform Owner configures each day's coins, diamonds, and optional item
  reward in the admin dashboard.
- Claiming is manual. Merely opening the app never silently changes a wallet.
- The program resets at midnight in `Asia/Baghdad`.
- Claiming consecutive days advances through days 1–7; day 7 wraps to day 1.
- Missing a required calendar day resets the next claim to day 1.
- There is no retroactive claim, paid catch-up, freeze token, or advertisement
  multiplier in V1.
- Same-day retries return the original receipt without another credit.
- Suspended, banned, or economy-restricted accounts cannot claim.
- Rewards are global in V1; VIP-specific calendars and regional calendars are
  deferred.
- Device identity is recorded as risk telemetry when available but does not
  block legitimate multi-device use.

## Shared contracts

### Campaign

Store the authoritative campaign at `dailyLoginCampaign/current` with immutable
versions beneath `dailyLoginCampaign/current/versions/{revision}`.

`DailyLoginCampaignV1` contains:

- `schemaVersion`, `revision`, and publication status
- `timeZone`, fixed to `Asia/Baghdad` in V1
- seven ordered reward bundles
- optional campaign start and end dates
- minimum compatible client version
- draft, published, emergency-disabled, and next-effective-cycle metadata
- editor and audit metadata

Every reward uses the existing normalized reward bundle:

- non-negative coins
- non-negative diamonds
- optional item entitlements with duplicate fallback
- at least one non-zero reward component

### User state and receipt

- `dailyLoginStates/{uid}` stores the last claimed day, current streak position,
  campaign revision, and last receipt ID.
- `dailyLoginClaims/{uid}/days/{dayId}` is the deterministic claim receipt.
- Wallet and item credits use the existing wallet ledger and entitlement
  services.
- The receipt snapshots the campaign revision, reward bundle, streak position,
  timezone day, wallet transaction IDs, and entitlement IDs.
- Public clients never write state, claims, wallet balances, transactions, or
  entitlements directly.

### Commands

- `get-daily-login-status`
  - Returns today's claimability, streak position, seven-day public calendar,
    next reset time, and the last safe receipt.
- `claim-daily-login-reward`
  - Requires authentication and a stable request ID.
  - Computes the Baghdad day on the server.
  - Validates the published campaign and account status.
  - Creates the deterministic claim and all economic records transactionally.

## Wave 1 — Authoritative backend and economy safety

### Implementation

- Add `daily_login_rewards` and `daily_login_reward_items` flags, both
  fail-closed.
- Add campaign, state, receipt, and command contracts.
- Implement server-side Baghdad day and streak calculation.
- Add an authenticated daily-login command endpoint.
- Use deterministic claim, wallet transaction, settlement, and entitlement IDs.
- Reuse normalized reward bundles and duplicate-item fallbacks.
- Store campaign revision and reward snapshot on every receipt.
- Add bounded rate limiting and stable request replay.
- Add reconciliation:
  - one claim equals one reward receipt
  - wallet deltas equal the snapshotted reward
  - every item reward has exactly one entitlement or duplicate fallback
- Add Firestore indexes and deny all client economic writes.
- Add audit events for campaign changes, emergency disable, reconciliation, and
  manual holds.

### Required tests

- First claim, same-day replay, concurrent claims, and reused request ID
- Baghdad midnight before/after boundary
- Consecutive streak, day-7 wrap, missed-day reset, and clock skew
- Disabled/missing/expired campaign
- Suspended and economy-restricted account
- Insufficient or malformed campaign configuration
- Wallet and item grant failure with no partial credit
- Duplicate item fallback and settlement replay
- Rules tests for cross-user receipt and state access

### Exit gate

- Exactly-once tests pass under concurrent requests.
- Dry-run reconciliation reports zero unexplained wallet or entitlement drift.
- Both feature flags remain off in production.

## Wave 2 — Admin dashboard and mobile experience

### Admin dashboard

- Add a Daily Login Rewards workspace available only to authorized incentive
  managers.
- Provide seven editable reward cards with coins, diamonds, item ID, and
  duplicate fallback.
- Show total seven-day liability and examples for 100, 1,000, and 10,000
  claimants.
- Support draft, preview, publish for next Baghdad day, emergency disable, and
  rollback.
- Separate stopping new claims from hiding the client presentation.
- Show claim counts, reward liability, failed claims, replay rate, held claims,
  and reconciliation status.
- Preserve immutable published versions and the existing audit trail.

### Mobile

- On authenticated app entry, request status once and show the reward sheet only
  when today's reward is unclaimed.
- Add a persistent Daily Rewards entry on the Home page so dismissal does not
  lose access.
- Display seven reward days, current position, claimed states, today's reward,
  and Baghdad reset countdown.
- Require a deliberate Claim button.
- Show the confirmed receipt and updated balances after success.
- Handle offline, timeout, replay, disabled campaign, and already-claimed states
  without optimistic wallet changes.
- Provide RTL Arabic, English fallback, screen-reader labels, large text, and
  reduced-motion behavior.
- Item art comes from the existing catalog; missing art falls back safely.

### Exit gate

- Dashboard publish/rollback and permission tests pass.
- Mobile compact, standard, and tall Android layouts pass in RTL.
- Closing, reopening, reconnecting, or signing in on another device never
  duplicates a reward.

## Wave 3 — Deployment, staged rollout, and acceptance

### Deployment order

1. Deploy backend, rules, indexes, dashboard, and both disabled flags.
2. Publish a seven-day development campaign with small rewards.
3. Keep the global flags dark and run an authenticated status smoke test using
   an existing development account.
4. After the campaign becomes active, enable the currency-only stage. No
   allowlist is used because the app has no real users yet.
5. Test the same development account on two devices and across a Baghdad
   midnight boundary.
6. Run concurrent claim and forced-retry tests.
7. Reconcile wallet, receipt, settlement, and audit records.
8. Enable item rewards only after a separate item campaign and entitlement
   reconciliation pass.

### Monitoring and rollback

- Monitor claim volume, duplicate replays, failures, liability, wallet drift,
  item fallback rate, and endpoint latency.
- Emergency disable blocks new claims immediately without deleting streaks or
  receipts.
- Disabling item rewards leaves coin/diamond claims independently controllable.
- Rollback changes the next eligible reward version; it never rewrites an
  already-issued receipt.

### Final acceptance

- One user cannot receive more than one reward for one Baghdad day.
- Client clocks and client streak counters are never trusted.
- Scheduler or endpoint retries cannot create duplicate currency or items.
- Every credit is explainable through a claim receipt, campaign version, wallet
  transaction, and audit trail.
- The dashboard can change future reward values without an app rebuild.
- Ordinary login, Home navigation, wallets, store items, rooms, and voice audio
  continue working when the entire feature is disabled.

## Deferred extensions

- Monthly calendars
- VIP or representative-specific calendars
- Paid catch-up and streak-freeze items
- Advertisement multipliers
- Region-specific reset times
- Random reward chests
- Social sharing and referral bonuses

These extensions require separate economy and abuse review and are not part of
the initial implementation.
