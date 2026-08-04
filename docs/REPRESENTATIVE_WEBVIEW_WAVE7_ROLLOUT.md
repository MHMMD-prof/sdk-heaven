# Representative WebView Wave 7 administration and rollout

## Outcome

Wave 7 completes the local administrative and operational source for representative transfers. It does not enable the production feature and it does not deploy the admin dashboard or its dedicated `adminDashboard` function.

The dashboard source now provides:

- global coin and diamond transfer limits;
- representative activation and independent coin/diamond permissions;
- optional per-representative limit overrides;
- transfer-PIN reset-required enforcement;
- public-reference receipt inspection;
- backend-derived reversal eligibility and full reversal;
- recent transfer, reversal, security, and administrative audit history;
- the existing server-owned `representativeTransfers` feature flag.

The fixed representative portal URL remains a deployment parameter and is not visible or editable in the dashboard.

## Administrative safety contract

Every mutable representative control requires a reason and an explicit confirmation in the dashboard. Destructive changes use destructive confirmation treatment.

The backend treats the revision displayed to the administrator as part of the mutation:

- feature-flag updates compare the `appConfig/socialFeatures.updatedAt` revision;
- privilege/currency and override updates compare the representative privilege revision;
- global limit changes compare the transfer-policy revision;
- PIN reset-required changes compare the PIN-document revision;
- reversals compare the exact immutable public reference, currency, and amount reviewed by the administrator.

A changed record produces an HTTP 409 conflict and no audit record or partial update. Reusing an idempotency request ID by the same actor for the same completed action returns the original event. A conflicting reuse is rejected.

Malformed legacy per-representative limits are not projected into the dashboard. Missing legacy revisions are represented by the explicit `missing` sentinel and become timestamped on the first successful governed mutation.

## Emergency kill switch

The server-credential command is independent of the dashboard deployment. It defaults to a non-mutating preview and defaults the requested state to disabled.

From the repository root, with Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS` configured for the correct Firebase project:

```powershell
npm --prefix functions run representative:flag
```

Emergency disable:

```powershell
npm --prefix functions run representative:disable -- --actor-uid OWNER_FIREBASE_UID --reason "Incident reference and operator explanation"
```

The recorded actor must have an active `owner` entry in `adminProfiles`. The transaction changes only `appConfig/socialFeatures.representativeTransfers`, preserves all other flags, and creates an immutable `server-credential-cli` audit event.

Emergency re-enable is intentionally harder and must not be used until the rollout checklist is complete:

```powershell
npm --prefix functions run representative:flag -- --apply --enable --acknowledge-enable --actor-uid OWNER_FIREBASE_UID --reason "Signed-off recovery reference"
```

After either applied command, independently verify the flag document and its new audit event. Never paste service-account JSON, PINs, portal sessions, or bootstrap tickets into terminal arguments or incident notes.

## Deployment boundary

Codex must never deploy either of these:

- Firebase Hosting configured at the repository root, because it serves `admin-dashboard/dist`;
- `functions:adminDashboard`.

The client may deploy those two components themselves if they want the new dashboard controls live.

When an explicit production deployment is requested, the safe order for components Codex is allowed to deploy is:

1. Firestore rules and indexes.
2. Only named non-admin functions required by the representative flow, including `socialCommand`, `representativePortal`, and `projectRepresentativeBadge` when its source changed.
3. The representative portal to a separately configured Hosting site or another fixed HTTPS origin. Do not reuse the repository-root admin-dashboard Hosting target.
4. A new mobile build configured with exactly that HTTPS origin.

Set the backend `REPRESENTATIVE_PORTAL_ORIGIN` parameter and the mobile portal-origin build value to the same origin before smoke testing. No Realtime Database deployment or migration is required.

## Production smoke test

Keep `representativeTransfers` disabled while completing these checks:

1. Confirm the global coin and diamond limits are configured and independently reviewed.
2. Confirm the dedicated portal serves the expected build over HTTPS and rejects framing, downloads, popups, mixed content, and off-origin navigation.
3. Confirm an unauthorized user cannot create a bootstrap ticket or see the Me-page representative entry.
4. Grant a non-production user one currency, verify the public badge, and confirm the other currency remains unavailable.
5. Create and exchange one bootstrap ticket; confirm replay and wrong-origin exchange fail.
6. Configure the six-digit transfer PIN after fresh authentication.
7. Preview a normal seven-digit ID, confirm a custom/VIP ID and self-recipient fail, then complete a small transfer.
8. Confirm the same shared wallet was debited, the recipient was credited, both receipts and both notifications exist, and retrying the same request does not transfer twice.
9. Inspect the transfer by public reference and exercise one eligible reversal. Confirm the original records are unchanged and compensating wallets, ledger entries, receipts, notifications, reversal lock, and audit event exist.
10. Confirm expired, repeated, mismatched, and insufficient-balance reversals fail without partial writes.
11. Disable the feature with the server-credential command while a portal session is open. Confirm new tickets fail, portal actions fail closed, the active mobile WebView closes at its next status check, and the Me-page entry disappears.
12. Only after sign-off, re-enable with the explicit acknowledgement command and repeat one small transfer.

If any step fails, disable the flag through the server-credential command. Do not roll back immutable transfers or receipts manually.

## Validation record

Wave 7 adds focused automated coverage for:

- policy, override, PIN-reset, receipt-query, and kill-switch input validation;
- global policy creation, idempotency, audit evidence, and stale conflicts;
- per-representative override preservation and stale conflicts;
- PIN reset-required behavior and missing-PIN rejection;
- balance-aware and reversal-aware receipt inspection;
- active Platform Owner authorization and explicit kill-switch re-enable acknowledgement.

The feature remains disabled until the production smoke test and physical Android acceptance are signed off.
