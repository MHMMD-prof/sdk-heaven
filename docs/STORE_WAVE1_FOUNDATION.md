# Store Wave 1 foundation

## Catalog contract

Generic items live in `storeCatalog/{itemId}` and are validated by
`functions/storeCore.js`. Every item contains:

- a stable lowercase `itemId` matching its document ID;
- one of `game-items`, `chat-themes`, `avatar-frames`, `cars`, or `custom-ids`;
- Arabic and English names and descriptions;
- separate HTTPS thumbnail and preview asset URLs;
- a positive coin price, diamond price, or both;
- permanent duration or a positive day/week/month duration;
- unlimited stock or a non-negative limited quantity;
- availability, purchasing-enabled state, and admin-controlled ordering;
- an exact seven-digit `customId` only for custom-ID items.

The mobile type contract is `src/store/contracts.ts`. Catalog reads and admin writes
will be added through backend endpoints in later waves; direct Firestore access is
denied now.

## Wallet contract

`walletSummaries/{uid}` uses this canonical shape:

```text
balances:       { coins, diamonds }
lifetimeCredit: { coins, diamonds }
lifetimeDebit:  { coins, diamonds }
uid
createdAt
updatedAt
```

All values are non-negative safe integers. Current special-ID and social-gift
purchases debit coins. Admin credit accepts either currency at the backend and
defaults to coins for the existing dashboard UI.

Every new `walletTransactions` entry includes `currency`, `amount`, `balanceAfter`,
`source`, `type`, actor, owner, and server timestamp. Backend writers use document
creation rather than overwrite, and clients cannot read or write ledger documents.

## Server-only boundaries

Firestore rules deny direct client access to:

- `storeCatalog`
- `storeOwnerships`
- `storeTransactions`
- `walletSummaries`
- `walletTransactions`

## Rollout

1. Deploy all Wave 1 backend writers.
2. Run the wallet migration dry-run and resolve invalid records.
3. Apply the migration in bounded batches.
4. Confirm all wallets report `ready`.
5. Deploy the matching mobile build and Firestore rules.

Do not deploy an older backend after migration because legacy writers would drop the
diamond fields. If rollback is required, disable the wallet/store feature flag and
ship a forward fix while retaining the canonical wallet documents and ledgers.
