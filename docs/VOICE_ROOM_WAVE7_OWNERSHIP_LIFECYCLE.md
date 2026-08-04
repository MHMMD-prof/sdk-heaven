# Voice Room Wave 7 — Ownership and persistent lifecycle

## Status

Wave 7 backend is **deployed dark** to `yallgame-ebd19` (2026-07-25): Firestore rules,
ownership/lifecycle indexes (already present), `roomOwnershipCommand`,
`expireRoomOwnershipOffers`, `finalizeRemovedRooms`, `roomCommand` (legacy
`transfer-ownership` retired), and `adminDashboard` (`reverse-ownership-transfer`).
The feature remains fail-closed behind:

- `appConfig/voiceRoomFeatures.voice_room_ownership_transfer`

Do not enable the flag until Android/iOS two-account acceptance passes.

## Ownership contract

- The old `transfer-ownership` room command is retired and returns
  `OWNERSHIP_OFFER_REQUIRED`; it cannot perform an immediate swap.
- The current owner reauthenticates with their Firebase email/password and
  creates one offer tied to the current ownership revision.
- The recipient must be an active room member with complete private/public
  profiles, active moderation status, a supported country, and no block in
  either direction.
- Offers expire after 15 minutes. The recipient may accept or decline; the
  owner may cancel. Every command is idempotent.
- Acceptance reauthenticates the recipient and atomically updates:
  - owner/host snapshots and ownership revision;
  - both memberships;
  - the former owner to Room Moderator;
  - moderator count;
  - accepted transfer record;
  - seven-day cooldown;
  - recipient/owner notification records;
  - room system message when chat is enabled;
  - immutable moderation audit event.
- Stale ownership revisions, concurrent offers, self-transfer, replay
  conflicts, suspended accounts, blocks, expired offers, and moderator-limit
  overflow fail closed.
- Only the owner and selected recipient may read the transfer. Clients cannot
  write transfer, command, notification, audit, or room ownership fields.

The app is mature-only, so Wave 7 uses the current complete active account as
the eligibility boundary. A future identity/age-verification product may add
an additional eligibility claim without weakening this service.

## Persistent lifecycle

- Leaving the room never closes or removes it.
- Owner removal closes and hides the room, records actor/reason, marks the
  removal recoverable, and schedules finalization after 30 days.
- Platform staff `reopen-room` restores a recoverable room and clears the
  removal schedule. A finalized room cannot be reopened.
- The daily finalizer creates a backend-only safety archive, removes discovery
  and media pointers, clears invitations/pending ownership, and permanently
  marks the room `purged`. Moderation/report evidence remains inaccessible to
  ordinary clients rather than being destroyed.
- A Platform Owner-only `reverse-ownership-transfer` backend operation verifies
  the latest accepted transfer and reverses it atomically with a high-risk
  audit. Authorization uses `resolveAdminRole` so legacy Platform Owners with
  `admin: true` and an empty `adminRole` still qualify. Super Moderators and
  room staff cannot use it.

## Rollout and rollback

Inspect only:

```powershell
npm --prefix functions run rooms:ownership:flag
```

Activation and rollback require an active Platform Owner:

```powershell
npm --prefix functions run rooms:ownership:enable -- --actor-uid <uid>
npm --prefix functions run rooms:ownership:disable -- --actor-uid <uid>
```

Rollback stops new offers. Existing offers remain harmless and expire through
the scheduled cleanup.

## Acceptance matrix

Before activation, verify on physical Android and iOS devices:

- owner and recipient on separate accounts/devices;
- correct and incorrect password reauthentication;
- accept, decline, cancel, expiry, background/foreground, and network retry;
- owner offline after creating the offer;
- blocked/suspended/removed recipient;
- simultaneous offer and accept attempts;
- former-owner moderator controls after acceptance;
- 7-day cooldown;
- removed-room discovery denial, restore, and expired recovery denial;
- Arabic RTL, large fonts, screen reader labels, keyboard avoidance, and
  reduced motion.
