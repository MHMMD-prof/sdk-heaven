# Voice Room Wave 8 — Room gifts and separated economy

## Status

Wave 8 backend repairs are **deployed and enabled for testing** on
`yallgame-ebd19` (2026-07-26): Firestore rules and `roomGiftCommand` are live,
the commission policy is version 1 at 10%, and the feature is controlled by:

- `appConfig/voiceRoomFeatures.voice_room_gifts`

The isolated `wave8_test_rose` catalog item costs 10 coins and exists only to
exercise the full 9-credit recipient / 1-credit platform split. Replace or
disable it when the final commercial catalog is approved. Device acceptance
remains required before a public release.

## Economy decision

- `balances.coins` remain purchased spend coins.
- `balances.diamonds` remain the existing spendable/store currency. They are
  **not** redefined as gift earnings.
- New non-spend economy balances live beside the wallet:
  - `economyBalances.giftEarnings`
  - `economyBalances.gameRewards`
  - `economyBalances.promotions`
- Room gifts debit spend `coins` and credit recipient `giftEarnings`.
- The platform share is credited atomically to
  `platformEconomyAccounts/room-gifts`, with an immutable
  `platformEconomyTransactions` ledger leg. Every event records the invariant
  `senderDebit == recipientCredit + platformCredit`.
- Game rewards and promotions are reserved fields for later waves; room gifts
  do not mix them.

## Commission policy

Versioned document: `appConfig/roomGiftCommissionPolicy`

- `version`
- `commissionBps` (0–10000)
- Gift earnings are permanently denominated 1:1 with spend coins; no mutable
  conversion rate participates in room-gift accounting.
- `effectiveAt`

Inspect / apply:

```powershell
npm --prefix functions run rooms:gifts:policy
npm --prefix functions run rooms:gifts:policy:apply -- --actor-uid <uid> --commission-bps 1000 --reason "Approved commission change"
```

Quotes snapshot the active policy. Later policy or catalog changes neither
invalidate an unexpired quote nor rewrite committed receipts. Owner dashboard
updates use optimistic revision checks and create both an immutable
`roomGiftCommissionPolicyVersions` record and an `adminAuditEvents` record.

## Command flow

Dedicated HTTP function `roomGiftCommand`:

1. `quote-room-gift` — validates room membership, recipient, catalog item, and
   policy; stores an expiring quote; returns price, commission, recipient
   credit, platform share, policy version, and expiry.
2. `send-room-gift` — consumes the quote atomically:
   - debit sender coins
   - credit recipient gift earnings
   - credit the platform commission account
   - write immutable spend + earnings + platform ledger rows
   - write `rooms/{roomId}/giftEvents/{eventId}`
   - write sender/recipient receipts
   - update room contribution projection
   - bump public `giftScore`
   - emit a short-lived room effect event only after commit

Hard denials: feature off, self-gift, blocked relationship, replay conflict,
insufficient funds, malformed quote snapshot, expired quote, inactive/removed
recipient.

## Client

- Feature flag mapped in `voiceRoomFeatureFlags.gifts`
- Room gift sheet opens from the room bottom bar / Command Center gift action
  when the flag is on; otherwise it reports unavailable
- Effect label appears only after a successful send response

## Rollout and rollback

```powershell
npm --prefix functions run rooms:gifts:flag
npm --prefix functions run rooms:gifts:enable -- --actor-uid <uid>
npm --prefix functions run rooms:gifts:disable -- --actor-uid <uid>
```

Rollback stops new quotes/sends immediately. Historical receipts remain intact.

## Remaining product extensions

- Multi-target modes (all speakers / owner-only blast)
- Spending gift earnings, converting diamonds, or game-reward payouts
- Fancy animation runtime beyond the post-commit effect envelope
