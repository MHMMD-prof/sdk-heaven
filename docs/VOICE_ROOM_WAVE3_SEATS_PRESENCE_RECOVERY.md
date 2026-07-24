# Voice Room Wave 3: Seats, Presence, and Recovery

## Status

Implementation is complete locally as of 2026-07-22. Production deployment, staged room activation, and the two-device native acceptance matrix remain release gates. No production data or Firebase resources were changed during implementation.

## Production contract

Wave 3 separates three facts that the prototype previously mixed together:

- Membership is durable room authority and enforcement state.
- Presence is a short, renewable online-session lease at `rooms/{roomId}/presence/{uid}`.
- A microphone seat is the only audio-publish entitlement in an activated seat-engine room.

Room owner/moderator authority comes from membership and remains valid while listening, offline, seated, or reconnecting. The owner has no ghost seat.

### Seat state

`rooms/{roomId}/seats/{01..20}` uses:

- `open`: claimable when the seat is within `seatTargetCount` and not manually locked.
- `locked`: unavailable because of an individual lock or because it is vacant overflow.
- `occupied`: actively assigned.
- `reconnecting`: assigned and reserved until `reservationExpiresAt`.
- `retiring`: an occupied overflow seat preserved after downsizing until its occupant leaves or expires.

Additional server fields include `occupantUid`, `occupancyState`, `retired`, `manuallyLocked`, `sessionId`, `reservationExpiresAt`, and a monotonically increasing seat `revision`.

### Command family

The authenticated `roomCommand` HTTP boundary now dispatches these idempotent seat commands:

| Intent | Commands | Authority |
| --- | --- | --- |
| Immediate seat | `claim-seat`, `leave-seat` | Active member, self only |
| Request mode | `request-seat`, `cancel-seat-request` | Active member, self only |
| Request moderation | `approve-seat-request`, `reject-seat-request` | Owner or room moderator |
| Invite mode | `invite-to-seat` | Owner or room moderator |
| Invite response | `accept-seat-invite`, `decline-seat-invite` | Invited active member |
| Individual lock | `lock-seat`, `unlock-seat` | Owner or room moderator |
| Room configuration | `set-seat-mode`, `resize-seats` | Owner only, optimistic room revision required |
| Recovery | `reserve-seat`, `resume-seat` | Current occupant, self only |

Platform Owner may perform owner configuration. A region-scoped Super Moderator may perform operational seat moderation only in scope. Request and invitation records are deterministic per user, expire after 90 seconds, and remain for the Wave 0 expiry-plus-24-hour operational retention window.

Every applied or denied command stores an immutable server audit and an idempotent command response. LiveKit permission changes use the Wave 2 durable retry path.

## Transaction invariants

All critical seat/member/room/request writes occur in one Firestore transaction.

- A member with a non-null `seatId` cannot claim or accept another seat.
- A seat with an occupant cannot be won by another command.
- The member `seatId` and seat `occupantUid` change together.
- A clean leave clears the seat immediately and revokes microphone publication.
- Kick, ban, and legacy demotion release an occupied or reconnecting seat in the same moderation transaction.
- Owner/moderator authority fields are never changed by seating.
- A forced-muted member may occupy a seat but LiveKit publication remains denied.

The token service disables the old role-based publish bridge when `seatEngineVersion == 1`; membership role alone cannot publish in an activated room.

## Modes

- `open`: a member may transactionally claim an available seat.
- `request`: a member creates one bounded pending request; owner/moderator approval claims the exact requested seat atomically.
- `invite`: owner/moderator creates one bounded invitation; the target claims the exact seat only by accepting before expiry.
- `locked`: new claims, requests, and invitations are denied. Existing occupants remain.

Changing mode does not eject a speaker. Individual locks apply only to vacant seats.

## Reconnect recovery

The reservation window is exactly 45 seconds.

1. Before a native app backgrounds, it sends `reserve-seat` and then disconnects LiveKit.
2. The seat becomes `reconnecting` (or remains `retiring` with reconnecting occupancy), gets a fixed expiry, and publication is revoked.
3. On foreground, `resume-seat` runs before the new LiveKit connection. A valid reservation returns the seat to occupied and refreshes publication from server state.
4. A scheduled server job detects crashed/stale presence and creates the same reservation without trusting client cleanup.
5. A scheduled server job releases every expired reservation, clears member audio state, updates counts, writes an audit, and creates a retryable LiveKit permission task.

Repeated background events do not extend an existing reservation. Presence uses one deterministic user document and one stable session ID for the screen session, so background/foreground churn does not create duplicate join records or entry-effect identities.

## Presence and count repair

Clients renew a 45-second presence lease every 20 seconds while active. Security rules bind identity, profile snapshot, authority, seat, and audio projection to the server-controlled membership and cap `leaseExpiresAt` to 60 seconds beyond request time. Clients cannot write seats, requests, invitations, counts, or enforcement state.

`recoverVoiceRoomSeats`, scheduled every minute, performs three bounded passes:

- stale presence becomes `stale`, and an occupied seat receives one reconnect reservation;
- expired reservations are released server-side;
- `participantCount` is recomputed from fresh online presence and `speakerCount` from occupied source seats.

These projections are repairable; correctness never depends only on client increments.

## Downsizing

On `resize-seats`, the transaction reads all 20 deterministic seats before writing:

- vacant seats above the new target become hidden locked overflow;
- occupied seats above the target become `retiring` and keep their occupant;
- a retiring seat becomes locked overflow only when cleanly left, kicked, banned, or expired;
- increasing the target reopens retired vacant seats unless they were manually locked.

No resize path forcibly ejects an occupied speaker.

## Safe activation and rollback

Seat commands require both global flags and per-room activation:

- `appConfig/voiceRoomFeatures.voice_room_v2_mutations == true`
- `appConfig/voiceRoomFeatures.voice_room_seats == true`
- `rooms/{roomId}.seatEngineVersion == 1`

This two-key gate prevents the first new seat claim from silently stranding speakers on an old room.

Recommended rollout:

1. Deploy rules and indexes.
2. Deploy functions while both flags remain disabled.
3. Run the existing v2 migration dry run and apply flow.
4. Run `npm --prefix functions run rooms:seats:activate -- --limit 200` until every room is accounted for.
5. Apply activation in bounded pages with `rooms:seats:activate:apply -- --actor-uid UID --limit 200 --start-after ROOM_ID`. Existing legacy publishers are assigned deterministic seats; overflow publishers become retiring rather than being ejected.
6. Enable flags with `rooms:seats:enable -- --actor-uid UID` for the staged release.
7. Monitor denial codes, reservation expiry, count repairs, LiveKit retry backlog, and reconnect success before expanding.

Rollback uses `rooms:seats:disable -- --actor-uid UID`. New claims/configuration stop immediately, while leave, reserve, resume, request cancellation, and invite decline stay available so the kill switch cannot trap an occupant. Per-room activation is intentionally not destructively reversed.

## Verification completed

- Pure authorization and activation-plan tests.
- Serialized simultaneous same-seat claims: exactly one winner.
- One-user/two-seat denial.
- Resize-plus-claim serialization.
- Owner-offline moderator request approval.
- Invitation expiry.
- Clean leave, reconnect/resume, server expiry release, and stale-presence recovery.
- Kick during reconnect releases the seat atomically.
- Occupied overflow retirement and release after vacancy.
- Source-based participant/speaker count repair.
- Feature kill-switch behavior and safe exit.
- Firestore and Storage emulator rules tests.
- TypeScript compilation and Functions syntax validation.

## Remaining release gates

- Run the activation dry run against the real project and account for every room before any apply.
- Deploy indexes, rules, and functions in the documented order.
- Complete the two-device native matrix for open/request/invite/locked modes, forced mute, background/foreground, network loss, process kill, kick, ban, and owner-offline moderation.
- Validate Android/iOS microphone permission, Bluetooth/headset routes, interruption handling, and Arabic/English error copy.
- Confirm scheduler, LiveKit retry, and count-repair metrics in the staged region.
