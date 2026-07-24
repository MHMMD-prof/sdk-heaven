# Store Wave 7: representative receipts and hardening

Wave 7 adds server-owned receipts to the representative transfer flow and closes
idempotency ambiguity in administrator permission updates.

## Receipt flow

- Every successful representative transfer writes one immutable receipt under
  `representativeTransferReceipts/{uid}/items/{transferId}` in the same Firestore
  transaction as both wallet mutations and both wallet ledger entries.
- `get-representative-status` returns at most the latest 20 receipts, newest first.
- Receipt mapping rejects malformed, incomplete, non-completed, or invalid-currency
  documents before they cross the callable boundary.
- The mobile representative page renders recipient normal ID, currency, amount,
  and completion time, then refreshes from the server after each successful transfer.
- Direct client access to receipt documents remains denied by Firestore rules.

## Hardening

- Retrying the same transfer request remains idempotent and creates only one receipt.
- Reusing an administrator request ID with different representative permissions now
  returns HTTP 409 rather than silently accepting a conflicting operation.
- Mobile submission remains locked for the complete request and refresh cycle.

Deploy only `socialCommand` and Firestore rules. Hosting and `adminDashboard` remain
excluded under the current deployment instruction.
