# Store Wave 3: transactional purchases and ownership

Wave 3 adds authenticated customer catalog reads and atomic self-purchases through
the `socialCommand` callable. Direct Firestore access remains denied.

## Commands

- `get-store-catalog` returns visible catalog cards and the caller's server wallet.
  Disabled items are hidden; unavailable and sold-out items remain visible with
  their state.
- `purchase-store-item` accepts only `itemId` and `currency`. Price, availability,
  stock, duration, and custom-ID data are always read from the server catalog.

## Purchase transaction

A successful purchase atomically:

1. validates the active profile, feature flag, wallet, item, currency, and stock;
2. prevents self-purchasing an item already present in My Items;
3. debits exactly one selected currency and writes immutable wallet/store ledgers;
4. creates `storeOwnerships/{uid}/items/{itemId}`;
5. unequips the previously equipped item in that category without deleting it;
6. equips the new item through `storeEquipment/{uid}`;
7. decrements limited stock;
8. claims and activates an exact seven-digit custom ID when applicable; and
9. stores the result under the request ID for safe retries.

Permanent ownership has no expiry. Timed ownership uses fixed days, seven-day
weeks, and thirty-day months. `expireStoreOwnerships` runs every thirty minutes,
marks elapsed ownership as expired, and clears only that equipped slot. It never
auto-equips an older item.

Gift purchases are intentionally outside Wave 3. They require a separate recipient
flow so duplicate self-ownership rules cannot be bypassed accidentally.
