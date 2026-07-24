# Store Wave 9: recipient recharge receipts

Wave 9 gives recharge recipients a verifiable server-owned history.

- A successful representative transfer creates a recipient receipt in the same Firestore transaction as both wallet mutations, both ledger entries, the sender receipt, and the transfer event.
- `get-wallet-store` returns at most the latest 20 valid receipts, newest first.
- Each receipt contains amount, currency, representative normal public ID, representative UID, completion time, and transfer ID.
- Invalid or incomplete receipt documents are filtered at the backend boundary.
- Direct client access to `walletRechargeReceipts` is denied.
- The wallet page displays both coin and diamond balances plus incoming recharge history.

Deploy `socialCommand` and Firestore rules only. Hosting and `adminDashboard` remain excluded.
