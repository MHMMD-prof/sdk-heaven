# Voice Room Wave 0 Product Contract

## Status

Wave 0 product decisions are frozen for implementation unless a later decision record explicitly changes them. This document turns the broader production plan into testable room behavior and a concrete screen/Command Center specification.

The implementation remains behind feature flags until the Wave 3 seat engine and Wave 4 production screen satisfy their release gates.

## Wave 0 outcome

- The production room vocabulary and authority hierarchy are fixed.
- Room authority is independent from microphone-seat state.
- Main-screen information hierarchy and overlay priority are fixed.
- Seat counts, modes, reconnect behavior, and graceful downsizing are fixed.
- Command Center contents are fixed by capability.
- Retention and effect budgets have initial production defaults.
- Mature eligibility is a server-enforced prerequisite.
- Shared device music remains a required roadmap feature but is not allowed into the initial production launch until a native LiveKit publication proof passes on Android and iOS.

---

## Product vocabulary

| Product term | Meaning |
| --- | --- |
| Platform Owner | Highest platform authority with governance, economy, administrator, and irreversible escalation powers |
| Super Moderator | Region-scoped platform safety operator above every room role |
| Room Owner | Exactly one persistent owner of a room; initially the creator and transferable later |
| Room Moderator | Owner-appointed room operator for everyday moderation |
| DJ | Session-scoped music-broadcast privilege; not an authority rank |
| Speaker | A member currently occupying a microphone seat |
| Listener | A present room member not occupying a microphone seat |
| Seat | One server-authoritative microphone slot numbered from 1 to the configured target |
| Command Center | Role-aware room tool drawer opened from the persistent bottom bar |
| Room Lockdown | Emergency state that mutes microphones, locks seats, pauses disruptive features, and preserves safety context |

Do not use “host” as the production authority term. During migration, `hostId` is a compatibility field only. Do not call the Room Owner an admin in user-facing copy.

## Fixed launch defaults

| Decision | Default |
| --- | --- |
| Audience | Mature-eligible users only |
| Visibility | Public rooms only |
| Seat layouts | 5, 10, 15, or 20 seats |
| Initial layout | 10 seats unless an existing room is migrated with another supported count |
| Reconnect reservation | 45 seconds |
| Moderator limit | 20 per room |
| Ownership-transfer cooldown | 7 days |
| Former owner after transfer | Room Moderator |
| Active room-linked games | One |
| Active DJ sources | One |
| Entry-effect duration target | 3–5 seconds |
| Major overlay concurrency | One |
| Ordinary message retention | 30 days |
| Recoverable room removal | 30 days |
| Rolling safety buffer | 5 minutes when recording is enabled |
| Reported voice evidence | 30 days |
| Confirmed severe/legal hold | Up to 180 days |

The platform may lower effect, audience, or feature limits through configuration. A ceiling is never a promise that every device or region receives that capacity immediately.

---

## Authority and capability contract

### Platform Owner

- Manages platform administrators, Super Moderator scopes, economy policy, commission, catalogs, feature flags, and platform safety configuration.
- May perform or approve high-risk platform actions including permanent deletion, fraudulent ownership-transfer reversal, and legal-hold administration.
- All high-risk operations require fresh authentication, reason, request ID, and immutable audit.

### Super Moderator

- Operates only in assigned countries/regions.
- Can inspect public rooms, participants, reports, and moderation context in scope.
- Can mute one/all, lock seats, disable chat, stop music/game/effects, kick, room-ban, regionally suspend, remove room media, lockdown, suspend, restore, remove recoverably, and preserve evidence.
- Cannot change economy, commission, catalog, or administrator governance unless a separate platform permission grants it.
- Cannot act outside assigned scope.
- Cannot be kicked, muted, demoted, or blocked by room roles.

### Room Owner

- Owns the room whether online or offline, seated or listening.
- Configures seat count/mode, locks, room appearance, chat/effect policies, moderators, DJ privileges, room bans, ownership transfer, and recoverable removal.
- May perform every Room Moderator action.
- Cannot interfere with in-scope Super Moderator enforcement.

### Room Moderator

- Mutes speakers, manages requests/invitations, moves/removes speakers, locks individual seats during operations, deletes/pins messages, kicks, applies allowed temporary room bans, manages immediate room order, starts/stops music when permitted, and ends disruptive game sessions.
- Cannot change ownership, transfer the room, appoint/remove moderators, permanently remove the room, change economy, act on the Room Owner, or reverse staff enforcement.
- Has default DJ capability while the moderator role is active.

### DJ privilege

- May control the single shared music source for the current room session.
- Is granted/revoked by the Room Owner.
- Ends on leave, ban, session expiry, explicit revoke, or ownership/moderation enforcement.
- Grants no kick, mute, seat, chat, or settings authority.

### Member

- Joins a public room, listens, claims/requests/accepts a seat according to mode, controls local audio output, uses chat/reactions, sends gifts, starts a game invitation, reports/blocks, and manages personal effect preferences.
- Cannot decide microphone publishing, economic outcomes, moderation, or durable room configuration.

---

## Mature eligibility contract

The room client must not be the source of truth for age eligibility.

- Server profile contains an eligibility state such as `unknown | eligible | restricted | review` and a policy version.
- Room join, gifts, dating interactions, gambling-like game entry, and voice publishing check eligibility at the server boundary.
- `unknown`, `restricted`, or stale-policy users cannot enter mature rooms.
- The UI explains the blocked state without exposing internal risk or moderation signals.
- A changed policy requires re-acceptance before the next mature action.
- The eligibility system must be designed separately from a simple date picker; the release owner decides the appropriate age-assurance method per market.

Wave 0 does not implement identity/age verification. It makes server eligibility a prerequisite so later UI cannot accidentally bypass it.

---

## Seat contract

### Supported layouts

- 5 seats: one row of five.
- 10 seats: two rows of five.
- 15 seats: three rows of five.
- 20 seats: four rows of five.
- On narrow screens, preserve logical numbering and use a responsive five-column stage with size reduction before changing reading order.
- Seat number is a stable logical identifier; visual RTL placement does not change its stored ID.

### Seat modes

| Mode | Empty-seat behavior |
| --- | --- |
| Open | Eligible member taps an open seat and the server transaction claims it immediately |
| Request | Tap submits one expiring request; owner/moderators approve or reject |
| Invite | Only owner/moderator invitation can be accepted into a seat |
| Locked | No ordinary claim/request; owner/moderator may unlock or directly invite where policy allows |

The owner chooses the room default. Individual seat locks may override the default without changing it.

### Seat states

- `open`: visible and claimable according to the room mode.
- `locked`: visible but unavailable to ordinary members.
- `occupied`: one user is seated.
- `reconnecting`: occupant is temporarily disconnected and holds the seat until the 45-second deadline.
- `retiring`: occupied seat lies above the new target after downsizing; occupant stays until leave, then the seat disappears.

### Required invariants

- One user occupies at most one seat in one room.
- One seat has at most one occupant.
- Room authority does not depend on seat occupancy.
- A listener token cannot publish microphone audio.
- A server seat transition and LiveKit permission transition reconcile idempotently.
- Expired reconnect reservations are released by server cleanup, not the old client.
- Owner/moderator actions never silently unmute a user's local microphone; forced actions may revoke publication or keep a track server-muted.

### Downsizing

Example: an owner changes 20 seats to 10 while seats 14 and 18 are occupied.

- Vacant seats 11–20 disappear immediately.
- Occupied seats 14 and 18 remain visible as retiring seats.
- No new user can claim or move into 14 or 18.
- When either occupant leaves, that seat disappears.
- The room reaches the 10-seat target naturally without ejecting anyone.

### Reconnect

- Seat changes to reconnecting as soon as the server recognizes the media/session disconnect.
- UI shows the participant and a reconnecting treatment without replaying their entry vehicle.
- Successful reconnect restores occupied state and current mute enforcement.
- Deadline expiry releases the seat and emits one bounded system event.

---

## Room main-screen specification

### Information hierarchy

1. Safety and connection state.
2. Microphone stage and speaking state.
3. Persistent user controls.
4. Room identity and audience context.
5. Secondary chat and system activity.
6. Gifts, vehicles, reactions, and other celebratory effects.

Entertainment can never cover a safety notice, forced-mute result, reconnect action, or critical control.

### Layer A — Room background

- Owner-selected approved room theme or safe default.
- Background is decorative only and cannot encode state.
- A contrast scrim guarantees stage, chat, and controls remain readable.
- Reduced-effects mode removes animated background motion.

### Layer B — Header

- Leave button.
- Room title and stable room ID.
- Room Owner avatar/name snapshot with owner badge.
- Audience count opens the participant sheet.
- Share action.
- Compact staff/recording/lockdown indicator area when active.
- Do not show a large descriptive paragraph or debug/provider label.

### Layer C — Microphone stage

- Adaptive 5/10/15/20-seat grid.
- Each seat shows number, avatar or empty symbol, display name, room-role badge when relevant, microphone state, speaking ring, reconnect/retiring state, and invitation/request state for the local user.
- Speaking animation is restrained and does not continuously resize layout.
- Tapping own seat opens self actions; another member opens a participant sheet; empty seat performs the mode-appropriate intent.
- Long names truncate visually but remain available to accessibility APIs.

### Layer D — Activity and chat

- Chat occupies a bounded lower region and remains visually secondary.
- System, moderation, gift, game, and entry events use distinct prefixes/icons and concise copy.
- Important notices remain longer than entertainment messages.
- Deleted messages show a neutral tombstone where reply/order integrity requires it.
- Keyboard opening reduces the chat viewport without moving microphone and leave controls offscreen.

### Layer E — Persistent bottom controls

RTL product order should be validated visually, but control identities remain stable:

- Gifts.
- Command Center.
- Reactions.
- Microphone/seat action: take/request/leave seat or mute/unmute when seated.
- Speaker/audio output.
- Chat composer.

The central microphone/seat action receives the strongest emphasis because voice is primary.

### Layer F — Modal surfaces

- Command Center sheet.
- Participant sheet.
- Gift sheet.
- Game invitation/lobby.
- Chat composer/replies.
- Confirmations and report flow.

Only one modal surface is interactive at a time. Opening a safety confirmation pauses decorative overlay interaction but does not disconnect audio.

---

## Main-screen state matrix

| State | Stage | Main action | Persistent notice |
| --- | --- | --- | --- |
| Joining | Skeleton/current cached layout | Disabled | Connecting |
| Connected listener/open | Live seats | Take seat | None |
| Connected listener/request | Live seats | Request seat | Pending result when submitted |
| Connected listener/invite | Live seats | Await invitation | Invitation when received |
| Seated and live | Own occupied seat | Mute | None |
| Locally muted | Own muted seat | Unmute | None |
| Force-muted | Own forced-muted seat | Disabled/request review if allowed | Muted by room staff |
| Reconnecting | Cached stage | Disabled | Reconnecting with retry/leave |
| Seat reserved during reconnect | Own seat marked reconnecting | Disabled | Reservation countdown is not announced every second |
| Room lockdown | Seats locked; speaking state frozen to authoritative updates | Disabled except leave/report | Official lockdown notice |
| Room suspended | Room content replaced | Leave | Suspension notice and appeal/help route |
| User kicked | Room content replaced | Return to discovery | Kick reason where policy permits |
| User room-banned | Room content replaced | Return to discovery | Ban expiry/permanent status |
| Unsupported client/schema | No partial room | Update/leave | Client update required |

---

## Command Center specification

The drawer is capability-driven. It does not show a large grid of forbidden disabled tools.

### Everyone

- Share room.
- Invite friends.
- Games.
- Reactions.
- Personal audio output.
- Full/reduced/off effects preference.
- Blocked users.
- Report room.
- Leave room.

### Seated member additions

- Mute/unmute self.
- Leave seat.
- Personal microphone effect when equipped and allowed.

### DJ additions

- Music source/queue.
- Start/stop shared music after the native feature is enabled.
- Release DJ control.

### Room Moderator additions

- Pending seat requests and invitations.
- Seat move/remove and individual locks.
- Mute speaker/mute all.
- Participant moderation: kick and allowed temporary bans.
- Chat deletion/pinning and immediate chat controls.
- Stop active music or game.
- Moderation log and lockdown.

### Room Owner additions

- Seat count and default seat mode.
- Full seat lock configuration.
- Appoint/remove moderators.
- Grant/revoke DJ privilege.
- Room image, background/theme, announcement, and welcome message.
- Chat mode, slow mode, keyword policy, message history, and effects policy.
- Permanent room bans.
- Ownership transfer.
- Recoverable room removal.

### Super Moderator additions

- Staff inspection context.
- Emergency Room Lockdown.
- Mute one/all and revoke audio publication.
- Lock seats, disable chat, stop music/game/gifts/effects.
- Kick one/everyone.
- Room/region enforcement actions within scope.
- Remove room media, suspend/restore/remove room.
- Preserve evidence and open linked case/report.

Super Moderator tools appear in a visually distinct official operations section. Economy and catalog actions do not appear unless separately authorized at platform level.

---

## Participant sheet contract

- Opens from audience count or participant avatar.
- Separates seated speakers from listeners without implying listeners are less important members.
- Search uses normalized Arabic/Latin text and server pagination when the audience exceeds the local page.
- Each row shows avatar, display name, room-role badge, seat number when seated, mute/connection state, and relationship controls.
- Actions are computed from actor capability and target protection.
- Owner, staff, and self-protection rules are enforced by the backend even if the UI is stale.

## Chat contract

- Text is secondary to voice but fully moderated.
- Default retention is 30 days.
- Rate limits and maximum length are server-controlled.
- Messages have pending, sent, failed, deleted, and moderation-removed presentation states.
- Owner/moderators may pin and delete; deletion never erases audit/evidence context immediately.
- User block hides or suppresses permitted interaction locally/server-side but never hides official notices.
- Content linked to a report follows evidence retention rather than ordinary message retention.

## Ownership-transfer contract

- Current owner initiates and freshly authenticates.
- Eligible recipient accepts before expiry.
- Completion is one server transaction and leaves exactly one owner.
- Former owner becomes a Room Moderator.
- Seven-day transfer cooldown begins at completion.
- Room history/assets/rank remain with the room; personal wallet/cosmetics remain with the person.
- Fraud reversal is a separately authorized Platform Owner workflow, never an ordinary room action.

---

## Event and overlay priority

| Priority | Events | Presentation rule |
| --- | --- | --- |
| P0 | Lockdown, suspension, ban/kick, recording failure requiring action, mature-policy block | Interrupt decorative overlays; persistent until acknowledged or navigation completes |
| P1 | Connection lost/reconnecting, force mute, seat lost, permission revoked, failed payment | Prominent bounded notice; decorative effects paused when necessary |
| P2 | Ownership transfer, moderator action affecting local user, game session ended by staff | System notice with clear result |
| P3 | Gift animation, equipped vehicle entry, game invitation | One major overlay at a time; queued and expiring |
| P4 | Reactions, joins/leaves, ordinary system/chat events | Lightweight and droppable under pressure |

### Initial effect budgets

- One major P3 overlay at a time.
- Maximum pending major-effect queue: 8.
- Drop a queued vehicle after 10 seconds or when its participant has left.
- Drop a queued gift effect after 15 seconds but keep the durable gift event/receipt.
- Reactions may aggregate and are not individually guaranteed.
- No entry effect plays for reconnect, foreground resume, or token refresh.
- Reduced-effects mode replaces motion with a compact banner.
- Off mode retains only financially/safety-relevant text events.

Budgets are remote-configurable within validated bounds and adjusted from device telemetry.

---

## Retention contract

| Data | Default | Notes |
| --- | --- | --- |
| Ordinary room messages | 30 days | Automatic deletion; report-linked copies follow evidence policy |
| Ephemeral room effect events | 24 hours maximum | Most clients need only a short reconnect window |
| Seat requests/invitations | Expiry plus 24 hours | Operational debugging, then deletion |
| Room presence | Current session plus bounded operational history | No permanent presence trail by default |
| Room moderation events | 365 days | Redacted where required; immutable operational audit |
| Platform admin audit | Existing 365-day policy or stricter approved policy | High-risk actions may require longer lawful retention |
| Ownership transfers | Life of room plus approved audit retention | Financial/value-bearing room history |
| Ordinary rolling audio | Five-minute rolling window | Deleted continuously when unreported |
| Reported voice evidence | 30 days | Access-scoped and audited |
| Confirmed severe/legal hold | Up to 180 days | Explicit review/hold required |
| Removed room | 30 days recoverable | Evidence/audit may outlive room recovery window |

---

## Feature flags and kill switches

Initial names are contractual concepts; implementation may use an approved naming convention.

- `voice_room_v2_read`
- `voice_room_v2_mutations`
- `voice_room_seats`
- `voice_room_command_center`
- `voice_room_chat`
- `voice_room_ownership_transfer`
- `voice_room_gifts`
- `voice_room_entry_effects`
- `voice_room_games`
- `voice_room_shared_music`
- `voice_room_super_moderation`
- `voice_room_safety_recording`
- `voice_room_new_joins`

Every expansion flag supports global and region targeting where relevant. Disabling a decorative feature must not break join, leave, reporting, or core voice.

## Observability contract

### Product events

- room join requested/succeeded/failed and failure class
- first remote audio subscribed
- reconnect started/succeeded/failed
- seat claim/request/invite/leave result
- seat reservation expired
- mic mute/unmute and server permission change result
- Command Center opened and capability section used
- message send/delete/report result
- gift quote/send/effect result with no secret/payment details
- entry effect queued/played/dropped and reason
- game invitation/join/start/end result
- music lease/start/stop/revoke result when enabled
- ownership transfer state changes
- moderation and lockdown result
- evidence preservation request/result when enabled

### Privacy

- Never log raw audio, message bodies, passwords, tokens, invite codes, local media paths, or full payment details.
- Use request, room, session, event, and policy IDs for correlation.
- Staff and destructive events record actor scope and target but are visible only to authorized operations.

## Initial performance targets

Targets are acceptance goals to validate and revise from baseline, not marketing promises.

- Core room controls remain interactive during decorative effects.
- No sustained animation frame loss on the selected mid-range Android reference device.
- Seat and moderation commands present progress immediately and reconcile within the measured backend SLO.
- Reconnect does not duplicate membership, seat, vehicle, gift, or game events.
- Major-effect queue remains bounded in a 20-participant entrance burst.
- Main room screen has no internal full-screen scroll for its primary controls.

---

## Shared device music feasibility decision

### Repository evidence

- Installed `expo-audio` supports device playback and recording but does not expose playback as a WebRTC `MediaStreamTrack`.
- Installed LiveKit client can publish a supplied audio `MediaStreamTrack`.
- Installed React Native WebRTC `getDisplayMedia` implementation returns a screen video track on Android and iOS; the inspected native implementation does not return system/playback audio.
- Existing `LiveKitVoiceClient` only publishes the microphone with `setMicrophoneEnabled` and has no second audio-source abstraction.

### Wave 0 decision

- Shared device music stays in the product plan.
- It is feature-flagged off for the initial production core.
- Wave 11 cannot begin until a maintained native/custom audio-source approach or approved server-ingress approach proves a separate, remotely revocable LiveKit music track on real Android and iOS devices.
- Local-only playback is not an acceptable fake implementation.
- DRM-protected or otherwise non-permitted sources are excluded.

This resolves the Wave 0 launch decision without pretending the current Expo/LiveKit packages already solve device-audio publication.

---

## Wave 0 acceptance checklist

- [x] Authority hierarchy and protected-target rules frozen.
- [x] Seat counts and seat modes frozen.
- [x] Graceful downsizing and 45-second reconnect reservation frozen.
- [x] Main-screen information hierarchy and state matrix frozen.
- [x] Command Center sections by capability frozen.
- [x] Ownership-transfer defaults frozen.
- [x] Mature eligibility made server-authoritative.
- [x] Event priority and initial effect budgets frozen.
- [x] Initial retention defaults frozen.
- [x] Feature flags and kill switches identified.
- [x] Observability/privacy contract identified.
- [x] Shared-music feasibility assessed and launch-gated.
- [x] Interactive wireframe provided for seat count, seat mode, and role/capability inspection.

## Handoff to Wave 1

Wave 1 may now define the exact TypeScript/JavaScript/Firestore contracts and backward-compatible `hostId` to `ownerUid` migration. It must not invent different authority, seat, retention, or Command Center behavior without updating this contract through an explicit decision record.
