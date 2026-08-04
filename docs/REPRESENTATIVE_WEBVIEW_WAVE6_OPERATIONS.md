# Representative WebView Wave 6 operations

## Outcome

Wave 6 adds a controlled full-reversal path and a private representative receipt-history experience. The representative transfer feature remains disabled. No backend, portal, mobile, rules, admin-dashboard function, or Hosting component was deployed in this wave.

## Reversal contract

Only an authenticated administrator with the existing store-management scope can request a reversal. The request must provide:

- the original public reference;
- the exact original currency and amount;
- a reason;
- an idempotency request ID.

The backend resolves the public reference to the immutable original transfer and rejects mismatched details. A transfer can be reversed only once, within 24 hours, and only while the recipient still holds the full original amount in that currency.

One Firestore transaction:

- debits the recipient's shared wallet;
- refunds the representative's same shared wallet;
- creates compensating debit and credit wallet-ledger entries;
- creates a transfer-scoped reversal lock/event;
- creates representative and recipient reversal receipts;
- creates an immutable administrative audit event.

The transaction never edits the original transfer, original wallet-ledger entries, or original receipts. The audit document also acts as the exact idempotency boundary for repeated requests.

## Notifications and security signals

A successful reversal produces one wallet-transfer notification for each affected user:

- the recipient is told the delivered balance was reversed;
- the representative is told the balance was returned.

Delivery failures do not roll back the already-committed wallet transaction and are logged for operational inspection.

Server-owned security events now cover:

- repeated failed transfer PIN attempts;
- recipient lookup enumeration and rate limits;
- per-transfer and daily limit failures;
- rapid hourly transfer-limit failures;
- reversal detail mismatches, expiry, insufficient recipient balance, and repeated reversal attempts.

No PIN, proof, bearer session, internal cursor path, or private wallet record is returned to the portal.

## Receipt lookup and history

The representative portal can look up a receipt only by a valid public reference owned by the signed-in representative. Reversal status is derived from the server-owned reversal event and returned as a safe receipt projection.

History supports:

- currency filters for coins or diamonds;
- completed or reversed status;
- inclusive date boundaries;
- page sizes from 1 to 50;
- opaque five-minute cursors bound to the representative, portal session, and exact filter set.

The client never receives Firestore document paths, internal transfer IDs, representative UIDs, recipient UIDs, or cursor state. The portal presents searchable receipts, compact filters, load-more pagination, distinct reversed styling, and reversal-aware receipt details, text sharing, and image export.

## Local verification

Completed:

- backend JavaScript syntax checks;
- focused representative core, portal core, portal service, reversal service, permission, and notification tests;
- all 104 non-emulator test files and all 647 tests;
- all 6 portal test files and all 21 tests;
- representative portal TypeScript and production build;
- Firestore and Storage rules emulator tests;
- root TypeScript compilation;
- Expo Doctor, with all 21 checks passing;
- Expo SDK 56 Android production bundle export.

The Android export completed. Expo also reported the pre-existing absent iOS `GoogleService-Info.plist`; it did not affect the Android export.

Required before production enablement:

- implement and review Wave 7 dashboard controls;
- deploy the eligible non-dashboard backend/rules/portal components in an explicitly authorized release;
- visually inspect the history and reversal receipt states in the production WebView on a physical Android device;
- exercise a real administrative reversal against non-production accounts;
- keep the feature flag disabled until the final operational checklist is signed off.
