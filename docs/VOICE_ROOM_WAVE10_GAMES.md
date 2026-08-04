# Voice Room Wave 10 — Room-linked games

## Status

Wave 10 is **deployed and enabled for controlled production testing** on
`yallgame-ebd19` as of 2026-07-26.

- Feature flag: `appConfig/voiceRoomFeatures.voice_room_games = true`
- Region: `us-central1`
- HTTP function:
  `https://us-central1-yallgame-ebd19.cloudfunctions.net/roomGameCommand`
- Cleanup schedule: `cleanupRoomGames`, every 5 minutes
- Activation audit event:
  `adminAuditEvents/voice_room_games_enable_1785070247152`

The production readback confirmed that the flag changed from `false` to `true`
and the activation audit event is `completed`.

## Production scope

- One room-linked game session at a time.
- Any active room member may create an invitation.
- Invitations are optional; they never force the room into a game.
- Leaving a game never closes the voice room.
- Leaving the voice room also removes the user from the current game session.
- Room owners, moderators, Super Moderators, and platform owners can end a
  disruptive or stuck session according to their existing authority.
- Public reward settlement is disabled. Clients and room hosts cannot mint,
  choose, or award game currency.

## Registry

| gameId | clientRoute | mode | players | enabled behavior |
| --- | --- | --- | --- | --- |
| `drawing-guess` | `DrawingGuess` | `multiplayer` | 2–8 | Room invitation, explicit join, isolated data transport |
| `carrom-royal` | `Carrom` | `host-local` | 1 | Host launches the existing local game while staying in voice |
| `royal-majlis` | `MiniGame` | `host-local` | 1 | Host launches the existing local game while staying in voice |

All entries require client version `1.0.0` or newer. Carrom Royal and Royal
Majlis are deliberately labelled `host-local`; their current controllers do not
provide trustworthy multiplayer state synchronization.

## Server contract

`roomGameCommand` supports:

1. `list-room-games`
2. `create-room-game-invite`
3. `join-room-game`
4. `leave-room-game`
5. `end-room-game`

`credit-game-reward` is retired and returns
`REWARD_SETTLEMENT_UNAVAILABLE`. Reward settlement must remain disabled until a
server-authoritative game result system exists.

Commands are authenticated, membership checked, version checked, rate limited,
and idempotent. Session expiry and retained command/rate documents have bounded
cleanup. The global kill switch blocks new/list/join/create activity but still
allows leave/end cleanup so users cannot become trapped in a disabled feature.

## Drawing Guess transport

Drawing Guess receives a separate data-only LiveKit token bound to the exact:

- authenticated Firebase user;
- room game session;
- active player list; and
- internal transport room.

The transport cannot publish audio. The voice-room connection remains owned by
the underlying `VoiceRoomScreen`, so the game cannot create a second microphone
connection or impersonate the previous fixed local player identity.

## Firestore boundary

- Game sessions are server-written and readable only by current room members
  while the feature is enabled.
- Game command request and rate-limit records are client denied.
- Clients cannot write room active-game pointers.
- Kicking or banning a player updates the active session transactionally.
- Expired sessions are abandoned and their room pointers are cleared.

## Controlled acceptance

Use test accounts and nonvaluable balances.

1. Enter the same public room with two users.
2. Create Drawing Guess as user A. Confirm user B sees an optional invitation.
3. Join as user B. Open the game on both devices and confirm drawing/game data
   synchronizes while room voice continues.
4. Exit the game on one device. Confirm only that game seat disappears and the
   voice room remains open.
5. Kick a game participant as an authorized moderator. Confirm the player is
   removed from both the room and session.
6. Launch Carrom Royal and Royal Majlis. Confirm each is clearly described as a
   local host activity and non-hosts are not offered a fake Join action.
7. Confirm no game UI or command can award coins, diamonds, gift earnings, or
   `gameRewards`.
8. Disable the flag in a rollback drill. Confirm new actions stop while existing
   users can still leave/end safely, then re-enable only after verification.

## Operations

Dry run:

```powershell
npm --prefix functions run rooms:games:flag
```

Audited owner-only enable/disable:

```powershell
npm --prefix functions run rooms:games:enable -- --actor-uid <uid> --reason "<reason>" --request-id <id>
npm --prefix functions run rooms:games:disable -- --actor-uid <uid> --reason "<reason>" --request-id <id>
```

Use a unique stable request ID for each intended change. Reusing the same
request ID with the same operation is idempotent; conflicting reuse fails.

## Deferred

- Server-authoritative rewards, entry fees, wagers, and random outcomes
- True multiplayer Carrom Royal or Royal Majlis controllers
- Store game-item eligibility
- Per-region gambling-like mechanics and responsible-use controls
- Shared device music (Wave 11)
