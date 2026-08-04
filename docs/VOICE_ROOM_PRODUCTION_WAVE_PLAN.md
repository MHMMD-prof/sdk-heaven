# Voice Room Production Wave Plan

## Objective

Replace the current technical voice-room proof with a production room experience built around microphone seats, a role-aware Command Center, lightweight chat, gifts, entry vehicles, device music, room games, persistent ownership, and strong room/platform moderation.

Every wave is a releasable vertical slice. A wave includes contracts, server enforcement, Firestore and Storage rules, mobile UI, admin tooling where applicable, automated tests, native-device verification, observability, a rollout flag, and a rollback path. A feature is not complete because its screen exists; it is complete only when the backend is authoritative and failure/reconnect/abuse cases pass.

This plan targets the repository's installed Expo SDK 56 stack. Re-check the exact versioned Expo documentation at <https://docs.expo.dev/versions/v56.0.0/> before every native or Expo configuration change.

---

## Current repository baseline

The implementation is an upgrade, not a rewrite. The repository already has:

- Expo SDK 56, React Native 0.85, React 19, React Navigation, a native dev client, and Android/iOS app configuration.
- LiveKit React Native connectivity, microphone publishing, speaker playback, speaking indicators, reconnect handling, and token issuance.
- Firestore room discovery, creation, membership, presence, participant counts, public/private room fields, and visited rooms.
- A prototype `VoiceRoomScreen` showing speakers, listeners, audio controls, debug state, host moderation actions, and a Drawing Guess launch.
- Server room commands for promotion, demotion, removal, reporting, and room closure.
- Firestore rules and emulator tests for rooms, members, and presence.
- A production-oriented admin dashboard with room inspection, reports, user operations, room actions, audit history, roles, and settings.
- Store categories including cars, chat themes, avatar frames, game items, and IDs.
- Wallet, ledger, purchase, gift, recipient receipt, representative transfer, and notification foundations.
- Carrom and Drawing Guess game systems, including LiveKit data transport for Drawing Guess.

The existing prototype has important limitations that this plan must remove:

- `host`, `speaker`, and `listener` combine authority and microphone state; room authority and seat occupancy need to become separate concepts.
- `hostId` currently represents creator/host and is assumed to be present. The production room has a persistent owner who may be offline.
- Room mutations are split between direct client Firestore writes and `roomCommand`; production-critical state needs one authoritative command boundary.
- Seats are derived from speaker membership rather than explicit, transactionally claimed resources.
- There is no room chat, Command Center, moderator role, DJ privilege, ownership-transfer workflow, entry-effect runtime, or room gift flow.
- The current platform `moderator` role is global and has no regional scope. The intended Super Moderator is a different, region-scoped operational role.
- Store/gift wallets currently use coins and diamonds, but game rewards and creator gift earnings are not yet isolated as separate accounting domains.

## Fixed product decisions

- The app is mature-only.
- Rooms are public in the first production release.
- A room persists and can operate while its owner is offline.
- A room has exactly one owner. The creator is the initial owner and may transfer ownership.
- A room may have multiple owner-appointed moderators, initially capped at 20.
- Platform Owner is the highest platform role. Region-scoped Super Moderators sit above all room roles.
- Microphone seat count is owner-configurable, with a production maximum of 20 in v1.
- Reducing the seat count never ejects current speakers. Occupied overflow seats retire only when vacated.
- Seat modes are open, request, invite, and locked. The owner chooses the default mode.
- Owner and room moderators may broadcast device music. The owner may grant a session-scoped DJ privilege to another user. Only one DJ source may be active.
- Anyone may create a game invitation, but nobody may force the entire room into a game. One room-linked game session is active at a time in v1.
- Chat exists but remains visually secondary to voice.
- Every equipped entry vehicle may play on entry, subject to queue, expiry, performance, and viewer reduction controls.
- Gift commission is configured by authorized platform staff in the dashboard and snapshotted into each immutable gift transaction.
- Purchased spending currency, closed-loop game rewards, gift earnings, and promotional credits remain separate accounting domains.
- Safety recording uses an encrypted five-minute rolling buffer. A report preserves the relevant evidence window for 30 days; confirmed serious cases or legal holds may retain evidence for up to 180 days.
- Room deletion is recoverable for 30 days.
- Kick, temporary room ban, permanent room ban, platform suspension, and platform ban are distinct actions.
- Gambling-like games remain closed-loop entertainment in this plan: no cash redemption and no wagering of gift earnings. Real-money gambling, withdrawal, or tradable winnings are out of scope.

## Authority terminology

| Level | Role | Scope |
| --- | --- | --- |
| 1 | Platform Owner | Entire platform, governance, economy, administrators, and irreversible escalation |
| 2 | Super Moderator / Regional Manager | Assigned countries/regions; operational safety authority over users and rooms in scope |
| 3 | Room Owner | Exactly one persistent owner of one room |
| 4 | Room Moderator | Owner-appointed daily room moderation |
| 5 | Speaker / Listener | Microphone state or audience state, not authority |

Never call a Room Owner an admin in product copy. Never expose platform roles as room membership roles. A Super Moderator cannot be kicked, muted, demoted, or blocked by room staff.

---

## Target architecture

### System ownership

- **Firestore:** durable product state, room configuration, memberships, seats, messages, bans, ownership transfers, gift/economy records, moderation records, evidence metadata, and discovery projections.
- **Cloud Functions/server services:** the only authority for consequential mutations, permission resolution, idempotency, wallet changes, seat transactions, moderation, transfers, and LiveKit administration.
- **LiveKit media tracks:** microphones and the eventual approved DJ audio track.
- **LiveKit data/room events:** ephemeral low-latency cues such as animation triggers, speaking/game presence, and optimistic UI reconciliation. Durable facts must also exist in Firestore or a server ledger.
- **Cloud Storage:** approved room art, catalog assets, entry-effect bundles, and encrypted evidence output. No executable remote bundles.
- **Mobile client:** presentation, local controls, optimistic intent, and reconciliation. It never decides authority or economic outcomes.
- **Admin dashboard:** scoped operational control, review, configuration, appeals, and immutable audit inspection.

### Room v2 document

The exact names may change during implementation, but the contract must represent these concepts:

- `schemaVersion`
- `id`, `title`, `countryCode`, `regionCode`, `type`
- `ownerUid`, owner display snapshot, and ownership revision
- `availability`: `active | suspended | removed`
- `visibility: public` for v1
- `seatTargetCount` and `seatMode: open | request | invite | locked`
- `chatMode`, `slowModeSeconds`, keyword-filter policy, and message-history policy
- `effectsPolicy`, `musicPolicy`, `gamePolicy`, and safety-recording policy version
- `participantCount`, `speakerCount`, and last-activity projections
- `activeDjUid`, `activeGameSessionId`, and lockdown state
- `roomImage`, `backgroundTheme`, announcement, and moderation status
- server timestamps, revision, and removal/recovery timestamps

`hostId` must not be renamed in one destructive deployment. Add `ownerUid`, dual-read `ownerUid ?? hostId`, dual-write while old clients exist, backfill, migrate indexes/queries, then remove the compatibility field only after minimum-supported-client enforcement.

### Membership and seat separation

`rooms/{roomId}/members/{uid}` represents durable room relationship and current session projection:

- room authority: `owner | moderator | member`
- enforcement: active, kicked session, temporarily room-banned, permanently room-banned, or removed
- session presence and reconnect deadline
- `seatId` when seated, otherwise null
- server-authorized audio publish state and current mute enforcement
- session privileges such as `dj`
- join/leave/last-seen timestamps and moderation revision

`rooms/{roomId}/seats/{seatId}` is authoritative for microphone occupancy:

- deterministic seat number from 1 through 20
- `open | locked | occupied | reconnecting | retiring`
- occupant UID and occupancy revision
- inviter/approver where applicable
- reconnect reservation expiry
- server timestamps

The owner does not receive a permanent ghost seat. When present, the owner claims a seat like another user but retains owner authority from membership. When `seatTargetCount` shrinks, occupied seats above the target become `retiring`; vacant seats above the target disappear from the client and cannot be claimed.

### Supporting collections

- `rooms/{roomId}/messages`: user, system, moderation, gift, game, and entry messages with soft-delete metadata.
- `rooms/{roomId}/seatRequests`: bounded pending/accepted/rejected/expired requests.
- `rooms/{roomId}/bans`: room ban scope, expiry, actor, reason, and appeal state.
- `rooms/{roomId}/events`: short-retention durable envelope for client effects that must survive brief reconnects.
- `rooms/{roomId}/moderationEvents`: immutable room-owner/moderator actions.
- `roomOwnershipTransfers`: pending/accepted/expired/completed/cancelled transfers with idempotency and audit.
- `roomEvidence`: recording window metadata, report linkage, access log, retention, and legal-hold state.
- platform administrator records: platform role plus region/country scope; do not overload room memberships.
- wallet ledgers: immutable entries for spending coins, game rewards, gift earnings, and promotions.

### Command boundary

Evolve `roomCommand` into versioned, pure-command resolution plus transactional services. Every mutation must include authentication, normalized input, permission resolution, room revision where relevant, an idempotency key, a server timestamp, and an audit envelope.

Command families:

- lifecycle: create, join, leave, reconnect, suspend, restore, remove
- seats: claim, leave, request, approve, reject, invite, accept, lock, unlock, change mode/count
- roles: appoint/revoke moderator, grant/revoke DJ
- voice: mute self, force mute, revoke/restore publish permission, mute all
- chat: send, delete, pin, change mode/slow mode, clear visible history
- music: request control, grant control, start, stop, revoke
- games: create invitation, join lobby, start session, end session
- gifts: quote, send, receipt, room effect event
- ownership: begin, accept, cancel, complete
- safety: report, kick, room ban, lockdown, remove media, suspend room
- platform operations: scoped emergency actions and evidence preservation

Do not grant mobile clients LiveKit `roomAdmin`. The backend uses LiveKit Room Service APIs for forced mute, permission updates, participant removal, and server-sent room events.

---

## Definition of done for every wave

A wave cannot close until all applicable items pass:

- Backward-compatible contract and migration path documented.
- Pure backend authorization/normalization tests cover happy path, cross-role denial, cross-region denial, stale revision, replay, and malformed input.
- Service transaction tests cover idempotency, concurrent requests, partial failure, and audit creation.
- Firestore and Storage emulator tests deny forged client writes and unauthorized reads.
- Mobile model/controller tests cover state transitions separately from rendering.
- `npx tsc --noEmit`, `npm test`, function tests, rules tests, and dashboard tests pass.
- Arabic RTL and English fallback copy are reviewed; identifiers and numeric data use controlled LTR rendering.
- Small Android, large Android, iPhone, and tablet layouts pass safe-area, keyboard, font scaling, and reduced-motion checks.
- Real native dev-client testing is used for LiveKit, microphone, audio routing, notifications, haptics, and media effects. Web is not a release signal.
- Loading, empty, permission-denied, offline, reconnecting, stale, error, retry, and removed/suspended states are implemented.
- Metrics and redacted structured logs exist before rollout.
- Feature flag and rollback procedure are documented.
- No unrelated dirty-worktree changes are overwritten.

---

## Wave 0 — Product contract, UX states, and feasibility spikes

**Implementation status (2026-07-22): complete.** The authority/capability model, mature eligibility prerequisite, 5/10/15/20 seat layouts, seat modes, reconnect/downsize behavior, main-screen state matrix, Command Center information architecture, event priorities, effect budgets, retention defaults, flags, and observability contract are frozen in `docs/VOICE_ROOM_WAVE0_PRODUCT_CONTRACT.md`. The installed Expo/LiveKit stack was inspected for shared device music; it does not expose `expo-audio` playback as a LiveKit audio track, so music remains required but disabled for the initial core release pending the native proof in `docs/VOICE_ROOM_WAVE0_MUSIC_FEASIBILITY.md`. An interactive role/seat/mode wireframe accompanies the contract.

### Deliverables

- Freeze the role/action matrix for Platform Owner, Super Moderator, Room Owner, Room Moderator, DJ, Speaker, and Listener.
- Freeze seat presets or allowed counts from 1–20, whether the UI offers presets or a validated stepper, and the visual layouts for each supported count.
- Define the complete main-screen state model: joining, connected listener, seated, speaking, locally muted, force-muted, reconnecting, room lockdown, suspended, removed, and evidence notice.
- Produce Arabic-first wireframes for the header, stage/seats, chat/event stream, bottom action bar, overlays, participant sheet, gift sheet, game invitation, and Command Center.
- Define event priorities so safety notices and connection failures always outrank gifts and entry effects.
- Define effect budgets: maximum simultaneous overlay, queue length, expiry, memory ceiling, and reduced-effects behavior.
- Define retention tables for messages, room events, moderation events, transfers, and recording evidence.
- Add feature-flag names and kill switches for room v2, chat, gifts, entry effects, DJ music, games, recording, ownership transfer, and Super Moderator actions.

### Mandatory music feasibility spike

`expo-audio` playback does not by itself become a LiveKit-published audio track. Before scheduling the final DJ implementation:

- Prove an authorized user can select a permitted local audio item and publish it as a distinct LiveKit audio source on Android and iOS.
- Verify microphone and music mixing, interruption handling, Bluetooth/headphone route changes, phone calls, app backgrounding, volume control, and immediate server revocation.
- Determine whether the solution requires a maintained native module/custom WebRTC audio source, supported screen-share audio, or a server-ingress design.
- Verify platform media-library restrictions and exclude DRM-protected sources that cannot legally or technically be rebroadcast.
- Measure CPU, battery, echo, latency, and audio quality on a mid-range Android device.
- If the spike fails, keep the Command Center music tile behind a disabled flag and ship the rest of the room. Do not simulate shared music by playing it only on the DJ's phone.

### Exit gate

- Product contract has no unresolved authority or state ambiguity.
- Main-screen/Command-Center wireframes are approved.
- Music has a proven native approach or is explicitly removed from the initial launch scope.

---

## Wave 1 — Room v2 contracts and safe migration

**Implementation status:** Complete. Production index/rules deployment and the full-project dry-run/apply/post-check remain rollout gates. See `VOICE_ROOM_WAVE1_CONTRACTS_MIGRATION.md`.

### Backend and data

- Introduce versioned room/member/seat/message contracts and strict mappers in shared-equivalent mobile/backend modules.
- Add `ownerUid` compatibility without breaking existing `hostId` rooms or discovery queries.
- Separate room authority from seat/audio state.
- Add room revisions and server-controlled timestamps.
- Create the 20 deterministic seat documents lazily or transactionally on first v2 activation.
- Add indexes for owner lookup, public discovery, region operations, active bans, pending seat requests, message pagination, and moderation history.
- Deny direct client mutation of owner, authority, seat occupant, enforcement, wallet, commission, and evidence fields.
- Write an idempotent backfill/dry-run script with counts, malformed-document reporting, checkpoints, and no destructive default.

### Mobile compatibility

- Dual-read v1 and v2 rooms behind a mapper.
- Preserve old room discovery and joining while v2 is dark.
- Add explicit unsupported-schema handling rather than silently dropping rooms.

### Exit gate

- Existing rooms continue to discover, join, speak, and leave on old and new clients.
- Backfill dry run accounts for every room and member.
- Rules tests prove clients cannot promote themselves, claim two seats, change ownership, or bypass bans.

---

## Wave 2 — Authoritative room command service and role engine

**Implementation status:** Complete. Production index/rules/functions deployment, LiveKit secret verification, and scoped operator smoke tests remain rollout gates. See `VOICE_ROOM_WAVE2_COMMAND_SERVICE.md`.

### Backend

- Split command normalization/authorization from Firestore/LiveKit side effects so the permission matrix is exhaustively testable.
- Move consequential room writes from direct mobile Firestore transactions into the command service.
- Add request IDs, replay-safe results, optimistic revision checks, consistent error codes, and structured audit events.
- Issue LiveKit tokens from server-resolved membership and seat state. Never trust a client-provided `canPublishAudio` value.
- Revoke or refresh participant permissions after seat, mute, ban, lockdown, or role changes.
- Add the platform `super-moderator` role and server-side region scopes. Keep claims compact; store detailed region assignments in authoritative administrator records and verify them on each request.
- Make scope resolution deny by default when a room has missing/invalid region data.

### Client

- Replace generic string errors with stable command error mapping and actionable Arabic UI.
- Add mutation locking only where duplicate intent is harmful; safe retries reuse the request ID.
- Reconcile optimistic UI against authoritative snapshots.

### Exit gate

- A forged client cannot gain audio, moderator, DJ, owner, or staff authority.
- Stale/replayed commands are safe and return deterministic results.
- Cross-region Super Moderator actions are denied and audited.

---

## Wave 3 — Seat engine, presence, and reconnect recovery

**Implementation status (2026-07-22): complete locally.** Transactional seats, all four modes, individual locks, moderated requests/invitations, 45-second reconnect reservations, server expiry recovery, non-ejecting downsizing, leased presence, source-count reconciliation, safe per-room activation, kill switches, LiveKit permission reconciliation, and concurrency tests are implemented. Production deployment, staged activation, and the two-device native acceptance matrix remain rollout gates. See `VOICE_ROOM_WAVE3_SEATS_PRESENCE_RECOVERY.md`.

### Seat behavior

- Implement transactional open-seat claims and explicit seat leave.
- Implement open, request, invite, and locked modes.
- Implement individual and global seat locks.
- Implement owner/moderator approval and invitations with expiry.
- Reserve an occupied seat for 45 seconds during reconnect and display a reconnecting state.
- Release expired reservations server-side; do not rely on a disconnected client cleanup.
- Implement graceful downsizing: mark occupied overflow seats `retiring`, hide vacant overflow seats, and remove retiring seats only when vacated.
- Prevent one user occupying multiple seats and prevent two users winning the same seat.
- Ensure owner/moderator authority persists whether seated, listening, offline, or reconnecting.

### Presence

- Separate persistent membership from ephemeral online presence.
- Make participant/speaker counts repairable from source records rather than relying only on increments.
- Add stale-presence cleanup and count reconciliation jobs.
- Prevent background/foreground churn from creating duplicate join/leave events or entry animations.

### Verification

- Concurrency tests with simultaneous claims, resize plus claim, kick plus reconnect, invitation expiry, and owner-offline operation.
- Two-device native tests for every microphone mode and forced mute.

### Exit gate

- Zero double-seat outcomes under concurrency tests.
- A seat is recovered correctly after clean leave, crash, network loss, kick, ban, and reservation expiry.
- Downsizing never ejects an occupied speaker.

---

## Wave 4 — Production room main screen

**Implementation status (2026-07-23): complete locally.** The proof-style scroll screen has been replaced by a fixed production shell with a compact room header, adaptive five-column stage for 5–20 authoritative seats, independent owner/moderator badges, bounded notice/activity layers, persistent voice controls, a participant sheet, and the first production Command Center drawer. Tools belonging to later waves remain visibly disabled rather than simulating a successful action. Native-device visual/accessibility acceptance and staged rollout remain release gates. See `VOICE_ROOM_WAVE4_MAIN_SCREEN.md`.

### Layout

- Replace the scrollable proof screen with a fixed, full-height room composition using safe areas.
- Header: leave, room identity, owner snapshot, room ID, audience count, popularity/gift summary if approved, share, and overflow.
- Stage: adaptive seat grid for 1–20 seats with owner/moderator badges independent of seat position.
- Seat states: empty, locked, requested, invited, occupied, speaking, locally muted, force-muted, reconnecting, retiring, and connection-poor.
- Activity layer: bounded entry/gift/game/system overlays that cannot cover safety, connection, or critical seat controls.
- Secondary chat/event viewport in the lower room area with readable contrast over every theme.
- Persistent bottom bar: gift, Command Center, reactions, microphone/seat action, speaker output, and chat composer toggle.
- Participant sheet from audience count and avatar taps, with search and role-safe actions.

### Controller architecture

- Break `VoiceRoomScreen` into room shell, stage, seat, activity queue, bottom bar, participant sheet, and controller/model modules.
- Keep network/media/business state outside presentational components.
- Preserve LiveKit connection while opening sheets and game surfaces.
- Add connection-quality and reconnection UI without exposing debug text in production.
- Ensure screen readers announce role, seat number, speaking/mute state, and destructive-action confirmations.

### Exit gate

- The main screen works for every seat count and state on target form factors.
- Voice controls remain reachable with keyboard open and with large font settings.
- No gift, vehicle, or chat layer obscures a safety notice or forced-action message.

---

## Wave 5 — Command Center and owner room settings

**Implementation status (2026-07-24): backend deployed, dark pending physical-device acceptance.** The Wave 4 drawer is capability-driven for member, room-moderator, and owner authority. Authoritative microphone queues, moderator/DJ controls, ownership transfer, bans/unbans, bounded moderation history, room settings, lockdown, and recoverable removal use revisioned, idempotent command transactions. The owner room-image path is immutable, independently validated, private while pending, reviewed by region-scoped Super Moderators or the Platform Owner, and covered by retention cleanup. Both `voice_room_command_center` and `voice_room_media` fail closed. Automated contracts, application tests, Storage/Firestore emulator rules, Expo Doctor, and production admin build pass. Firestore rules/indexes and Storage rules are deployed; Storage is permanently located in owner-selected `me-central1` (Doha), Firestore remains in `me-central2` (Dammam), and the active Node.js 22 media functions remain in `us-central1`. The physical Android/iOS acceptance matrix remains the release gate; neither flag was activated as part of deployment.

### Command Center information architecture

- **Quick actions:** share, invite, music, games, gifts, reactions.
- **Microphones:** seat count, open/request/invite/locked mode, individual locks, pending requests, invitations, mute all.
- **People:** moderators, DJ privilege, room bans, blocked users, participant list.
- **Room appearance:** approved room image, background/theme, announcement, welcome message.
- **Chat and effects:** chat mode, slow mode, keyword filter, history visibility, entry/gift-effect policy, viewer reduction preference.
- **Safety:** reports, moderation log, lockdown, recording notice, blocked list.
- **Ownership and lifecycle:** ownership transfer, recoverable room removal.

### Behavior

- Render tools by capability, not merely by role label.
- Hide irrelevant owner-only controls from ordinary users; do not fill the sheet with disabled actions.
- Separate destructive controls visually and require confirmation, reason, and fresh state.
- Keep frequently used tools in the first row and retain stable positions across sessions.
- Allow owner/moderator management while the owner is not seated; owner-only settings still require the owner.

### Room media safety

- Upload room images through validated Storage paths with MIME, byte, dimension, and ownership checks.
- Introduce pending/approved/rejected media states if moderation review is not immediate.
- Super Moderators can remove an offending image and suspend customization without destroying the room.

### Exit gate

- Every approved product setting is reachable in three taps or fewer from the room.
- Capability tests show no control that the backend would reject and no missing control for an authorized role.

---

## Wave 6 — Chat, blocking, reporting, and room moderation

**Implementation status (2026-07-24): backend deployed, dark pending physical-device acceptance.** The dedicated chat/safety service is server-authoritative, revision-independent, idempotent, rate-limited, normalized, filtered, paginated, and covered by 30-day retention with evidence holds. Firestore Rules enforce active membership and owner-selected history boundaries. Soft deletion, pinning, personal blocks, structured reports, report evidence snapshots, and the existing admin triage workflow are integrated. The Node.js 22 command/retention functions, Firestore Rules, and message indexes are live. Both `voice_room_chat` and `voice_room_safety` fail closed and were not activated by deployment.

### Chat

- Add server-authoritative text messages with bounded length, rate limits, normalized content, server timestamps, pagination, and stable ordering.
- Support user, reply/mention if approved, system, moderation, gift, game, and entry-event presentation without turning chat into the primary room surface.
- Add optimistic pending/failed/sent states without duplicating retries.
- Implement soft deletion with tombstones so moderation context and reply integrity remain intact.
- Add pin/unpin, slow mode, owner-configured chat mode, and server-side keyword filtering.
- Set explicit message-history retention and viewer-history rules.

### User safety

- User block controls local visibility/subscription and prevents disallowed interaction, but never hides staff safety notices.
- Report user, message, room image, room, gift, and voice behavior with structured reason categories.
- Voice reports attach the evidence preservation request from the recording wave once enabled.
- Distinguish kick, temporary room ban, permanent room ban, platform suspension, and platform ban in UI and backend.
- Room moderators cannot act on the owner, Super Moderators, or out-of-scope staff.

### Exit gate

- Spam/rate-limit tests, message deletion races, blocked-user tests, and report creation all pass.
- Deleted content disappears for users but remains available to authorized safety review with audit context.

---

## Wave 7 — Ownership transfer and persistent lifecycle

**Implementation status (2026-07-25): backend deployed dark; physical-device acceptance remains the release gate.** The legacy immediate ownership swap is retired. A dedicated fail-closed service now creates 15-minute recipient-approved offers, requires Firebase password reauthentication for offer and acceptance, enforces active/complete profiles, blocking restrictions, ownership revisions, replay safety, and a seven-day cooldown, and completes both role changes atomically. Firestore limits transfer visibility to the two parties and denies all client writes. Recoverable room removal schedules 30-day finalization, Platform Owners can restore during that window, and the finalizer preserves a safety archive while making the room permanently undiscoverable. Production deploy on `yallgame-ebd19` left `voice_room_ownership_transfer` disabled. See `VOICE_ROOM_WAVE7_OWNERSHIP_LIFECYCLE.md`.

### Transfer workflow

- Owner selects an eligible existing user with complete mature-account eligibility and no blocking restriction.
- Require fresh authentication or an approved transaction PIN from the current owner.
- Recipient receives a pending transfer and must explicitly accept before expiry.
- Complete transfer in one server transaction: room owner, both memberships, ownership revision, former-owner moderator role, transfer record, notifications, and audit.
- Apply a seven-day room transfer cooldown.
- Reject self-transfer, stale acceptance, concurrent transfers, suspended accounts, region-ineligible targets, and replay conflicts.
- Notify the room with a system event after completion.

### Lifecycle

- Leaving never closes or removes the room.
- Recoverable removal hides and closes the room, revokes joining, preserves evidence/audit, and schedules deletion after 30 days.
- Restore is allowed within policy and audit constraints.
- Platform Owner can review and reverse proven fraudulent transfers through a separate, high-risk audited workflow.
- Room assets and history remain with the room; personal vehicles, wallet, frames, and personal gifts remain with the user.

### Exit gate

- Transfer concurrency and replay tests prove exactly one owner at every point.
- Owner offline, deleted app session, recipient timeout, and recovery flows pass.

---

## Wave 8 — Room gifts and separated economy

**Implementation status (2026-07-25): backend deployed dark.** Spend coins and diamonds stay separate from new economy balances (`giftEarnings`, `gameRewards`, `promotions`). Room gifts use quote → atomic send behind `voice_room_gifts`, snapshot versioned commission policy, debit coins, credit gift earnings, write dual ledgers/receipts/room events, and emit effects only after commit. Diamonds are not redefined as earnings. Production deploy on `yallgame-ebd19` left `voice_room_gifts` disabled. See `VOICE_ROOM_WAVE8_GIFTS_ECONOMY.md`.

### Economy contract

- Define distinct ledgers/balance fields for purchased spend coins, closed-loop game rewards, gift earnings, and promotions.
- Decide whether existing `diamonds` migrate to gift earnings or remain a legacy display name; do not silently change economic meaning.
- Store dashboard-controlled commission and conversion policy as a versioned configuration with effective timestamps.
- Gift quote returns current price, commission, recipient credit, platform share, policy version, and expiry.
- Gift send transaction atomically debits the sender, credits the recipient earning balance, writes both immutable ledger entries, writes the room gift event, and returns a receipt.
- Snapshot item name/asset version, room, sender, recipient, price, currency, commission, conversion, and policy version.
- Prevent self-gifting, replay, balance underflow, catalog mismatch, removed recipient, and refund double-spend.

### Room experience

- Target one user, selected microphone users, or room owner only when the corresponding backend mode is implemented.
- Gift sheet shows wallet, price, recipient, quantity, and final confirmation.
- Effect event is emitted only after the server transaction commits.
- Queue animations by priority and expiry; a failed payment never produces a success animation.
- Add sender and recipient receipts and room-level gift/contribution summaries as separate projections.

### Exit gate

- Wallet invariants reconcile to zero mismatch under concurrency and retry tests.
- Commission changes affect only new quotes/transactions and never rewrite historical receipts.

---

## Wave 9 — Entry vehicles and room effects runtime

**Implementation status (2026-07-26): enabled for controlled production testing.** Equipped cars announce once per presence session behind `voice_room_entry_effects`. The hardened runtime has duration-based queue advancement, per-kind feature isolation, compact reduced/off presentation, presence/block filtering, cancellation controls, request rate limiting, bounded retention cleanup, version compatibility checks, and approved immutable static assets. `roomEntryEffectCommand`, `cleanupRoomEntryEffects`, and Firestore rules are deployed on `yallgame-ebd19`; the flag is enabled with the isolated one-coin `wave9_test_royal_car` test item. No Lottie/video dependency was added before the Expo 56 asset-format gate. See `VOICE_ROOM_WAVE9_ENTRY_EFFECTS.md`.

### Catalog and equipment

- Extend car catalog metadata with effect asset version, duration, dimensions, fallback artwork, sound policy, minimum client version, and performance tier.
- Validate ownership, expiry, and equipped state on the server when producing an entry event.
- Cache only approved immutable assets and verify download integrity/version.

### Runtime

- Trigger once per genuine join session, not for transient reconnect or app foregrounding.
- Allow one major entry animation at a time, maintain a bounded queue, and drop expired low-priority events.
- Default duration target is 3–5 seconds.
- Provide full, reduced, and off viewer modes; room policy may reduce effects but joining never waits for animation.
- Respect OS reduced-motion and low-memory conditions automatically.
- Pause/cancel effects immediately for lockdown, urgent moderation, app background, navigation away, or memory warning.
- Prevent effect audio from overpowering voice and give it an independent preference.

### Asset-format gate

- Benchmark candidate formats on representative Android/iOS devices before choosing the production format.
- Verify transparency, decode cost, bundle/cache size, frame pacing, memory release, and graceful fallback.
- Do not add an animation/video dependency until it passes Expo 56/native-build compatibility testing.

### Exit gate

- Busy-room stress test with simultaneous joins stays within the agreed frame-time and memory budgets.
- Reconnect storms do not replay vehicles.

---

## Wave 10 — Room-linked games and closed-loop rewards

**Implementation status (2026-07-26): deployed and enabled for controlled production testing.** The shared session envelope supports Drawing Guess as isolated multiplayer and exposes Carrom Royal plus Royal Majlis honestly as host-local activities. The fail-closed `voice_room_games` flag is enabled on `yallgame-ebd19`; activation is recorded in `adminAuditEvents/voice_room_games_enable_1785070247152`. Public reward minting was retired because no server-authoritative result system exists, so all game rewards remain disabled. See `VOICE_ROOM_WAVE10_GAMES.md`.

### Game orchestration

- Introduce a room game registry mapping every current game to capabilities, player limits, client route, reward policy, region availability, and minimum client version.
- Any member may create an invitation when no room-linked session is active.
- Invitation appears as an optional card; users explicitly join the lobby.
- Voice remains connected when game UI opens and nonplayers remain in the room.
- One room-linked game session at a time in v1, with expiry and abandoned-session cleanup.
- Owner/moderators/Super Moderators may end a disruptive or stuck session.
- Drawing Guess uses the common multiplayer session envelope and an isolated, data-only LiveKit transport. Carrom Royal and Royal Majlis use the same launch envelope in truthful `host-local` mode until multiplayer controllers exist.

### Game economy boundary

- Reward settlement remains unavailable until the server can authoritatively decide eligibility, outcomes, and credits.
- Clients, room hosts, and room staff cannot mint game rewards or mix them with coins, diamonds, gift earnings, or gift-recipient balances.
- Store game items and promotional credits declare explicitly whether they are eligible for a given game.
- Add per-region kill switches and responsible-use controls before enabling gambling-like mechanics.

### Exit gate

- Game invitations never replace the room for nonparticipants.
- Reconnect, host/authority changes, game abandonment, reward replay, and concurrent-start tests pass.

---

## Wave 11 — Shared device music and DJ controls

**Implementation status (2026-07-26): deployed and enabled for controlled production testing.** The fail-closed `voice_room_shared_music` flag now enables foreground, server-clock-synchronized catalog playback through `expo-audio`, with lease heartbeat/expiry, client deadline enforcement, drift correction, independent listener volume/mute, rate limits, bounded retention, minute cleanup, and DJ removal/lockdown/room-close termination. Activation is recorded in `adminAuditEvents/voice_room_shared_music_enable_1785075336558`. User-selected device-file → distinct LiveKit audio-track publishing remains disabled until a native audio-source bridge exists. See `VOICE_ROOM_WAVE11_SHARED_MUSIC.md`.

### Permissions and state

- Owner and moderators receive default music capability; owner may grant session-scoped DJ capability to another member.
- Only one active DJ source exists per room.
- Starting control uses a server lease with heartbeat and expiry, not a client boolean.
- Owner/moderator/Super Moderator can stop the source immediately through backend LiveKit administration.
- Leaving, losing privilege, ban, app termination, or lease expiry stops the published source.

### Experience

- V1 provides an allowlisted catalog, synchronized play/pause, late-join seeking, drift correction, and now-playing metadata. Local picker, queue, manual seek, and skip remain deferred.
- Separate listener volume and mute controls for room music versus voices.
- Clear DJ identity and source state in the room without exposing local filesystem paths.
- Handle calls, alarms, route changes, Bluetooth disconnect, microphone coexistence, backgrounding, and network degradation.
- Do not upload a user's full media file to Firestore or Storage as an implementation shortcut.

### Exit gate

- Two-platform native matrix proves foreground catalog playback converges within the synchronization tolerance and remains independently controllable from voices. A distinct published LiveKit music source remains the exit gate for device-file broadcasting.
- Forced stop completes within the operational target and cannot be bypassed with an old token or reconnect.

---

## Wave 12 — Super Moderator regional operations and emergency control

**Implementation status (2026-07-26): deployed and enabled for production testing.** Fail-closed `voice_room_super_moderation`, explicit owner/Super Moderator hierarchy, dashboard region assignment, scoped discovery/actions/exports/evidence, exact-state staff lockdown recovery, LiveKit-backed kick-everyone and reconnect denial, platform-staff target protection, fresh-auth on high-risk actions, owner notification/appeal records, and repeated-emergency alerts are active on `yallgame-ebd19`. The sole legacy administrator was migrated to an explicit Platform Owner and both migration and activation were audited. Automated, rules-emulator, build, Hosting, function-state, and production read-back checks pass; physical-device acceptance and emergency drills remain before broad release. See `VOICE_ROOM_WAVE12_SUPER_MODERATORS.md`.

### Governance

- Add `super-moderator` as an explicit platform role separate from the current global dashboard moderator semantics.
- Assign one or more allowed countries/regions through server-owned administrator records.
- Restrict room and user discovery, actions, exports, and evidence access to the assigned scope.
- Platform Owner manages assignments and reviews role changes.
- Economy/catalog/commission powers remain separate and are not implicitly granted.

### Emergency room controls

- Enter/inspect a public room in scope with a staff identity and operational context.
- Mute one speaker, mute all, lock seats, disable chat, stop music, stop games, pause gifts/effects, kick one/everyone, room-ban, regionally suspend users, remove room media, suspend/restore room, and preserve evidence.
- One Room Lockdown command atomically establishes the desired lockdown state, then reconciles LiveKit side effects idempotently.
- Room staff cannot block or reverse staff enforcement.
- Prefer suspend/remove with 30-day recovery over immediate hard deletion.

### Accountability

- Require structured reason, optional case/report ID, target scope, and confirmation.
- Store before/after state, actor role/scope, affected identities, LiveKit side-effect result, and request ID.
- Require fresh authentication for room removal, permanent bans, ownership reversals, and evidence access.
- Notify room owner and provide appeal status unless a safety investigation requires delayed disclosure.
- Alert Platform Owner on unusual bulk actions or repeated emergency use.

### Exit gate

- Cross-region denial, self-escalation denial, protected-role hierarchy, lockdown partial-failure recovery, and audit completeness pass.
- A Room Owner cannot interfere with Super Moderator enforcement.

---

## Wave 13 — Rolling safety recording and evidence governance

**Implementation status (2026-07-27): rejected by product and permanently disabled.** The production flag is forced false, the authenticated command endpoint returns `410 RECORDING_REJECTED`, and launch stage 9 cannot become ready. Historical metadata and cleanup code remain only to safely retire any prior records. See `VOICE_ROOM_WAVE13_SAFETY_RECORDING.md`.

### Recording service

- Use server-side LiveKit audio-only egress/segmented output; never record safety evidence on an ordinary user's device.
- Maintain an encrypted rolling five-minute buffer for active room audio and automatically delete overwritten/unreported segments.
- On a qualifying voice report, preserve the configured pre/post window and link it to the report.
- Default retained evidence to 30 days; confirmed severe cases or legal hold may extend to 180 days.
- Store evidence and encryption keys with separate access controls and least-privilege service identities.
- Track missing/partial egress explicitly so staff never assume evidence exists when it does not.

### Consent and access

- Show the mature-room safety-recording notice before first room join and whenever policy materially changes.
- Display an always-available recording/safety indicator and policy explanation.
- Only authorized in-scope safety staff can request playback; owner and room moderators cannot download evidence.
- Every playback, export if ever permitted, retention extension, and deletion is audited.
- Support user privacy requests and legal holds without silently violating evidence obligations.

### Cost and reliability gate

- Load-test concurrent audio-only egress, storage lifecycle rules, segment cleanup, and report preservation.
- Dashboard reports recording health, failed egress, orphaned segments, retention backlog, and access anomalies.
- Obtain market-specific legal/privacy review before external release.

### Exit gate

- Unreported audio expires automatically and cannot be retrieved.
- Reported windows are complete, encrypted, access-scoped, auditable, and deleted on schedule.

---

## Wave 14 — Scale, resilience, accessibility, and abuse hardening

**Implementation status (2026-07-27): deployed and enabled for controlled production testing.** The new-joins freeze is server-authoritative with live-lease reconnect semantics; revoked tokens are rejected; global and per-action rolling limits cover denied, seat, command, and gift traffic; expiring operational records have scheduled cleanup; LiveKit retries use a worker lease and propagate dead-letter alerts; and presence/count recovery uses fair ordering plus a persistent room cursor. The sole production room passed the v2/seat preflight, was migrated, and has seat-engine version 1. Firestore rules/indexes, seven functions, the audited flags, and production read-back are complete. Recording remains explicitly disabled. Physical load/chaos/accessibility testing, App Check rollout, economy anomaly fanout, and measured telemetry remain Wave 15 broad-release gates. See `VOICE_ROOM_WAVE14_HARDENING.md`.

### Scale and performance

- Establish supported audience target through staged load tests; do not promise “unlimited.” Start with the proven limit and raise it from measured results.
- Test room joins, Firestore listeners, chat write throughput, effect storms, gift bursts, presence churn, and LiveKit subscriptions separately and together.
- Remove Firestore hot documents: use repairable/sharded projections where counters or high-rate activity require them.
- Paginate participants/messages and unsubscribe offscreen/nonessential listeners.
- Set performance budgets for join time, command latency, render frame time, memory, asset cache, and battery.

### Resilience

- App kill/relaunch, airplane mode, Wi-Fi/cellular switching, duplicate device login, token expiry, clock skew, stale snapshots, Cloud Function retry, Firestore offline cache, LiveKit reconnect, and regional outage drills.
- Reconcile Firestore and LiveKit state after partial side effects.
- Add dead-letter/retry handling for notifications, effect events, evidence preservation, and admin operations.
- Add kill switches that can disable music, effects, games, gifts, chat, recording, or new room joins independently.

### Accessibility and localization

- Arabic-first RTL visual review with English fallback and no mojibake.
- Dynamic type, screen reader, focus order, switch control, touch targets, contrast over all room themes, reduced motion, and reduced effects.
- Haptics supplement visual/audio feedback but never become the only signal.

### Security and abuse

- Rate limits per user, device, IP/risk signal, room, and command type where appropriate.
- App Check/integrity enforcement plan, token revocation, least-privilege service accounts, secret rotation, upload validation, and dependency review.
- Economy anomaly detection, alternate-account gift abuse, refund fraud, game reward farming, mass moderation, and ownership-transfer abuse alerts.

### Exit gate

- Agreed load, chaos, accessibility, security, and economy reconciliation suites pass with no release-blocking findings.

---

## Wave 15 — Staged launch and production acceptance

**Implementation status (2026-07-27): deployed and enabled for development testing; real-user release blocked.** Because the app has no real users, stage 10 testing is open to every authenticated development account with minimum client version `1.0.0`; no release allowlist is used. Firestore rules, LiveKit token issuance, and all command endpoints enforce the policy. Production mocks fail closed, recording is permanently rejected, and the live readiness report returns `highestReadyStageId=10` with `broadReleaseReady=false`. See `docs/VOICE_ROOM_WAVE15_STAGED_LAUNCH.md`.

### Rollout order

1. Staff-only rooms and dashboard operators.
2. Internal Android/iOS native test matrix with synthetic economy.
3. Small invited cohort with recording disabled but all notices/states testable.
4. One low-risk region with room v2, seats, Command Center, and moderation.
5. Add chat and ownership transfer.
6. Add gifts and effects after wallet reconciliation remains clean.
7. Add games.
8. Add music only after the native feasibility and operational stop controls pass.
9. Recording is rejected and this stage remains permanently unavailable.
10. Increase audience and region coverage gradually.

### Release indicators

Set final SLOs from baseline measurements, then require at least:

- crash-free room sessions at the agreed production target
- join and reconnect success targets by platform/network class
- p95 room-command latency within the agreed target
- zero unresolved double-seat, double-owner, duplicate-wallet, or commission-rewrite incidents
- wallet ledger reconciliation with no unexplained imbalance
- bounded effect queue and no sustained room frame-rate regression
- moderation actions fully audited with no cross-region authorization escape
- historical evidence retention/deletion jobs remain healthy
- support and appeal runbooks staffed for enabled regions

### Rollback

- Disable the affected feature flag first.
- Keep room read/join/audio compatibility when possible.
- Stop new mutations before attempting repair.
- Use idempotent reconciliation scripts with dry-run and explicit approval.
- Never roll back schema by deleting v2 fields while supported clients may still depend on them.
- Economy or ownership incidents trigger an immediate mutation freeze and audited reconciliation, not client-side compensation.

### Final acceptance

- Product, engineering, moderation operations, economy, privacy/legal, and support owners sign the release checklist.
- No debug panels, mock-room fallback, private-room controls, or prototype copy leak into the public room path unless intentionally supported.
- Production monitoring, escalation contacts, kill switches, and recovery procedures are verified in the live environment.

---

## Recommended implementation sequence and dependencies

| Wave | Depends on | May ship independently? |
| --- | --- | --- |
| 0 Product/feasibility | Current baseline | Planning only |
| 1 Contracts/migration | Wave 0 | Dark, backward-compatible |
| 2 Commands/roles | Wave 1 | Dark behind room-v2 flag |
| 3 Seats/presence | Waves 1–2 | Staff cohort |
| 4 Main screen | Wave 3 | Yes, with basic tools |
| 5 Command Center | Waves 3–4 | Yes |
| 6 Chat/safety | Waves 2, 4–5 | Yes |
| 7 Ownership/lifecycle | Waves 1–2, 5 | Yes |
| 8 Gifts/economy | Waves 2, 4–6 | Yes, separately flagged |
| 9 Vehicles/effects | Waves 4, 8 | Yes, separately flagged |
| 10 Games | Waves 2, 4–6 | Yes, separately flagged |
| 11 Music | Wave 0 music proof, Waves 2, 4–5 | Yes, separately flagged |
| 12 Super Moderators | Waves 1–2, 5–7 | Required before broad launch |
| 13 Recording | Waves 2, 6, 12 | Separate legal/operational launch |
| 14 Hardening | All enabled waves | Required before broad launch |
| 15 Rollout | Wave 14 | Final gate |
| 16 Room themes | Waves 4–5, 8, 14 | Rendering may ship independently; purchases stay separately flagged |

Critical path for a credible first room release: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 12 → 14 → 15**. Gifts, entry effects, games, music, and recording are separately controlled expansions and must not delay a safe, excellent voice-room core.

## Expected repository touch points

- Mobile room contracts/controllers: `src/types/voice.ts`, `src/voice/*`, and new room-domain modules.
- Room presentation: replace/decompose `src/screens/VoiceRoomScreen.tsx` into focused components and models.
- Navigation/game launch: `src/navigation/RootNavigator.tsx`, game registry, Drawing Guess, and Carrom launch adapters.
- Store/equipment/gifts: `src/store/*`, social/wallet request layers, and room gift/effect components.
- Backend: `functions/roomCommandCore.js`, `functions/index.js`, LiveKit token logic, room services, social gift/wallet cores, admin claims/dashboard cores, and new focused service modules.
- Security/data: `firestore.rules`, emulator tests, `firestore.indexes.json`, `storage.rules`, and migration/reconciliation scripts.
- Operations UI: `admin-dashboard/src/RoomsPanel.tsx`, administrator settings/roles, reports, audit, and new evidence/region controls.
- Native configuration: `app.json`, EAS/native build settings, and only dependencies proven compatible with Expo SDK 56.

## Primary risks to track from day one

1. **Device-local DJ music:** technically uncertain until a distinct LiveKit audio publication is proven on both platforms.
2. **Authority migration:** current host/audio role coupling can create privilege bugs unless owner, moderator, seat, and publish permission are separated atomically.
3. **Firestore contention/cost:** presence, counts, chat, and effects can create hot documents or excessive listeners without projections and pagination.
4. **Economy integrity:** gifts and games must never share ambiguous balances or client-authoritative outcomes.
5. **Effect performance:** transparent animation formats can exhaust memory on mid-range Android devices.
6. **Staff power abuse:** Super Moderator actions require regional scope, fresh authentication, immutable audit, anomaly alerts, and appeals.
7. **Recording privacy/cost:** rolling egress must remain separately gated until retention, deletion, access, and legal review are proven.
8. **Dirty migration/rollback:** existing users and rooms require dual-read/dual-write compatibility and minimum-client enforcement before cleanup.

Following these gates yields a production room in layers: first trustworthy voice and seats, then excellent room control and safety, then monetization and entertainment. It avoids putting expensive visual features on top of an authority or economy model that would need to be rewritten later.

## Versioned technical references

- Expo SDK 56 reference: <https://docs.expo.dev/versions/v56.0.0/>
- Expo SDK 56 Audio: <https://docs.expo.dev/versions/v56.0.0/sdk/audio/>
- Expo SDK 56 Notifications: <https://docs.expo.dev/versions/v56.0.0/sdk/notifications/>
- Expo SDK 56 Haptics: <https://docs.expo.dev/versions/v56.0.0/sdk/haptics/>
- LiveKit Room Service API: <https://docs.livekit.io/reference/other/roomservice-api/>
- LiveKit participant management: <https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/>
- LiveKit room/participant state: <https://docs.livekit.io/transport/data/state/>
- LiveKit audio-only composite egress: <https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/>
- LiveKit recording outputs and segments: <https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/>
