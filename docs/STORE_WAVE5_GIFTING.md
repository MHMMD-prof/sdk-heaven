# Store Wave 5: immediate item gifting

Wave 5 adds Steam-style gifting through the authenticated `gift-store-item`
command and the item preview modal.

- The sender enters the recipient's normal exact seven-digit account ID. Special
  IDs are never accepted as recipient lookup keys.
- No acceptance step is required. A successful gift creates and auto-equips the
  recipient's ownership immediately.
- The sender may gift an item they already own, but may not purchase another copy
  for themselves.
- The recipient cannot receive an item already present in their My Items library,
  including an expired timed ownership.
- The sender chooses coins or diamonds only when that server catalog price exists.
- Wallet debit, immutable ledgers, stock decrement, recipient ownership, equipment,
  custom-ID activation, and the gift event are one Firestore transaction.
- Store gift event and ownership collections remain server-only.
- Recipient and sender push deliveries are created independently and idempotently.
  Notification failures never roll back a completed economic transaction.

The mobile preview locks all checkout controls while a request is active, preventing
two purchase or gift requests from being submitted at once from the UI.
