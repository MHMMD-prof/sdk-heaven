# VIP, SVIP, and Aristocracy Wave 6 Operations

Status: implementation complete locally; production activation and observation
gates remain open

Implemented: 2026-08-13

Parent plan: [VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md](VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md)

## Outcome

Wave 6 adds the production operations layer without deploying, publishing a
catalog, migrating data, granting status, debiting a wallet, or enabling a
feature flag.

- The Arabic admin dashboard now exposes catalog pointers, independent feature
  flags, queue age/depth, dead letters, reconciliation drift, alerts, migration
  evidence, launch sign-offs, pending proposals, and activation blockers.
- Support can inspect one user's sanitized VIP account, Aristocracy entitlement,
  wallet balance, visibility, contributions, transitions, transactions, and
  recent status commands.
- VIP point corrections, catalog activation/rollback, launch sign-offs, feature
  activation, complimentary Aristocracy grants, entitlement freeze/unfreeze,
  and revocation use typed proposals and independent owner approval.
- A proposal creator cannot approve their own request. The server rechecks both
  administrators, the immutable catalog, and current authority at approval.
- Emergency freeze is owner-only and can only change approved feature flags to
  `false`; it cannot grant, debit, refund, extend, shorten, or erase status.
- Daily full reconciliation records immutable runs. The first dirty pass warns;
  a second consecutive dirty pass creates a critical alert.
- VIP migration has a bounded dry-run and a separate explicit apply path pinned
  to the exact 64-character snapshot hash. Apply is deterministic,
  restart-safe, conflict-detecting, and writes only source outbox events.
- Wave 6 operational collections remain denied to every Firestore client.

## Activation runbook

Run every command from `functions/`. Production execution requires the normal
reviewed release identity; none of these commands was run against production in
this wave.

1. Approve the Wave 0 product/economy contract and original localized assets.
2. Deploy reviewed rules, indexes, Functions, dashboard, and supported mobile
   clients. Confirm all status flags remain `false`.
3. Create published immutable VIP/SVIP and Aristocracy catalog versions with
   different `authoredBy` and `approvedBy` identities.
4. Activate each catalog pointer through a `activate-catalog` proposal and an
   independent owner approval.
5. Inventory legacy data and run:

   ```powershell
   npm run status:vip:migration -- --catalog-version=<version>
   ```

6. Resolve every dry-run error. Preserve the emitted report and hash as release
   evidence. If the report contains zero users, skip the data-write step and
   record migration as not required. Otherwise run exactly:

   ```powershell
   npm run status:vip:migration:apply -- --catalog-version=<version> --expected-hash=<64-hex-hash>
   ```

7. Let the source worker drain the migration events. Run the verification in
   read-only mode first, then explicitly record it only after the report is
   clean:

   ```powershell
   npm run status:vip:migration:verify
   npm run status:vip:migration:verify:apply
   ```

   Run dashboard reconciliation and independently compare counts, signed
   points, accounts, level distribution, transactions, ledgers, entitlements,
   and projections. Mark migration verified only after zero unexplained drift.
8. Pass authenticated physical Android and iOS checks for Arabic RTL, English,
   accessibility, reduced motion, offline/stale states, purchase errors,
   expiry, and static fallbacks.
9. Record Product, Economy, Security, Support, and QA sign-offs through the
   two-person `set-signoffs` operation.
10. Because there are currently no users, a cohort-only dark period is not
    required. If the dashboard reports `directActivationEligible`, propose only
    the required independent flags. A second owner must compare the release
    evidence, approve, and watch the dashboard during activation.

The dashboard is the final go/no-go source. A missing catalog, dead letter,
queue older than five minutes, any reconciliation drift, required unverified
migration, or missing sign-off blocks activation.

## Rollback drill

Perform this drill in a non-production project, then repeat the control-path
portion during the production release window without creating test economy
data.

1. Record active catalog pointers, flags, queue depth/age, reconciliation run,
   and a known test account/entitlement.
2. Replay the same VIP source event and Aristocracy purchase request. Verify no
   duplicate contribution, debit, transition, entitlement, or transaction.
3. Trigger the owner emergency freeze for `aristocracyShop`,
   `statusPresentation`, `statusAnimations`, and `statusAnnouncements`.
4. Verify new quotes/purchases and optional presentation stop, while wallet
   history, VIP accounts, active Aristocracy authority, moderation, and expiry
   remain intact.
5. Propose the previous immutable catalog version and have another owner approve
   the pointer rollback. Existing transactions must retain their original
   catalog version.
6. Drain queues, run reconciliation twice, and verify both are clean with no
   alert. Inspect the audit trail and the test user.
7. Re-enable only through a new dual-approved feature-flag proposal after all
   sign-offs and blockers are clean.

Abort activation immediately on duplicate financial evidence, wallet/history
drift, unknown catalog versions, a dead letter, an overdue queue, stale public
privilege after expiry, or a critical reconciliation alert.

## Incident and support runbook

- Freeze the smallest independent surface first. Shop off preserves existing
  entitlements; presentation off preserves authority; animation off uses static
  UI; announcement off stops new celebrations.
- Do not edit private status, wallet, contribution, or entitlement documents.
  Use compensating VIP corrections or typed Aristocracy proposals with a ticket
  and evidence reference.
- Preserve proposal, approval, transaction, reconciliation, alert, and audit
  IDs in the incident record. Never copy internal wallet references into a
  routine support reply.
- Treat first-pass drift as investigation and confirmed consecutive drift as a
  page. Keep affected features off until two subsequent reconciliations are
  clean and the cause is understood.
- A feature flag is not a refund tool. Coin compensation follows the existing
  audited wallet process and never rewrites an Aristocracy purchase.

## Verification and remaining exit gates

Automated verification is recorded with the final Wave 6 handoff. The following
are necessarily still open because this local implementation did not deploy or
write production data:

- approved catalog values/assets and named Wave 0 decisions;
- reviewed production deployment and App Check/device configuration;
- migration inventory/hash or documented zero-user skip;
- physical Android/iOS acceptance;
- live dual-control and rollback drills;
- a full purchase -> expiry -> manual renewal Aristocracy duration cycle; and
- named product/economy/security/support/QA approval for public rollout.

Wave 7 public rollout must not begin until those evidence gates are closed.
