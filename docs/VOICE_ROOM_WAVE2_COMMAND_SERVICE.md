# Voice Room Wave 2 Authoritative Command Service

## Status

Wave 2 implementation is complete and locally verified. Production deployment, LiveKit secret binding, index creation, and regional operator assignments remain explicit rollout operations; this implementation did not mutate production data or access.

Wave 1 migration and its post-check remain prerequisites before enabling the v2-only ownership and moderator commands in production.

## Authoritative command boundary

The existing `roomCommand` HTTP endpoint remains stable, but command decisions and side effects are now separated:

- `roomCommandCore.js` owns normalization, role resolution, regional scope resolution, optimistic revision checks, the permission matrix, error codes, and mutation planning.
- `roomCommandService.js` owns the Firestore transaction, replay records, room/member/ban changes, reports, structured audits, and LiveKit reconciliation.
- `index.js` verifies Firebase authentication, delegates to the service, maps the stable response, and triggers immediate LiveKit synchronization.

New clients send a request ID and expected room revision. Transitional legacy clients without those fields remain accepted; v2 clients receive the full replay-safe result contract.

## Role hierarchy

| Actor | Scope | Key abilities |
| --- | --- | --- |
| Platform owner | All rooms | All room intervention actions except ownership transfer, which remains with the current room owner |
| Super Moderator | Server-assigned country/region codes | Mute, unmute, remove, ban, audio lockdown, close room, and reports inside assigned regions |
| Room owner | One owned room | Room moderation, moderator assignment, DJ privilege, ownership transfer, lockdown, and closure |
| Room moderator | One room | Normal member moderation and DJ privilege; cannot act on owner/other moderators |
| Member | Joined room | Report another active member |

Super Moderator scope denies by default when the room country is absent/invalid, the operator profile is missing/pending/revoked, or the room country is not in `adminProfiles/{uid}.regionCodes`. Cross-region attempts are written as denied moderation events.

The platform claim remains compact (`admin: true`, `adminRole: super-moderator`). Detailed region assignments live in the server-controlled administrator profile.

## Supported commands

- Compatibility audio: `promote-speaker`, `demote-listener`.
- Enforcement: `mute-member`, `unmute-member`, `remove-member`, `ban-member`.
- Room authority: `assign-moderator`, `remove-moderator`, `transfer-ownership`.
- Privileges: `grant-dj`, `revoke-dj`.
- Emergency room control: `lock-audio`, `unlock-audio`, `close-room`.
- Safety: `report-member`.

Owner, moderator, DJ, microphone, and seat state remain separate fields. A client-supplied role, privilege, or publishing request never grants authority.

## Replay and concurrency contract

Every v2 mutation contains:

- a 16–96 character request ID;
- the room revision observed by the client;
- the action, room, target, and bounded reason.

The transaction stores `rooms/{roomId}/commandRequests/{requestId}` with a command fingerprint and deterministic result. Replaying the same fingerprint returns the previous result without a second mutation. Reusing the ID for different input returns `REQUEST_ID_CONFLICT`. A stale revision returns `REVISION_CONFLICT` and the authoritative revision.

Successful state mutations increment the room revision exactly once. Reports are replay-safe but do not increment it. The client retries one network/server failure with the same request ID and reconciles against Firestore snapshots.

## Stable errors

The service returns codes including:

- `INVALID_REQUEST`, `PROFILE_REQUIRED`, `ACCOUNT_RESTRICTED`;
- `ROOM_NOT_ACTIVE`, `ROOM_MIGRATION_REQUIRED`, `MEMBERSHIP_REQUIRED`;
- `REVISION_REQUIRED`, `REVISION_CONFLICT`, `REQUEST_ID_CONFLICT`;
- `FORBIDDEN`, `REGION_SCOPE_DENIED`, `TARGET_INVALID`, `TARGET_PROTECTED`;
- `MODERATOR_LIMIT_REACHED`, `COMMAND_FAILED`.

The mobile client maps these to actionable Arabic messages and shows moderation errors on the room screen.

## LiveKit authority

Token issuance now ignores client-computed `canPublishAudio`. The server independently verifies:

- private profile and active public moderation status;
- active room availability and membership;
- active/unexpired room ban;
- force-mute and room-wide audio lockdown;
- explicit seat ownership/state when a member has a seat;
- the controlled legacy speaker bridge until Wave 3 activates seats everywhere.

Command commits update connected LiveKit participants immediately:

- permission changes atomically replace publish permissions and restrict publishing to microphone tracks;
- kick/ban removes the participant and revokes the current token timestamp;
- lockdown removes publishing from every connected participant;
- unlock recomputes each connected participant from Firestore rather than blindly restoring audio;
- room closure deletes the active LiveKit room.

Firestore remains the source of truth. If LiveKit is temporarily unavailable, the command stays applied with `liveKitSyncStatus: pending`. A scheduled worker retries oldest pending records every minute. Offline/not-found participants count as synchronized because their next token is server-resolved.

## Super Moderator provisioning

First grant the `super-moderator` role from the administrator dashboard. New operators remain `pending` until a platform owner assigns at least one region.

Dry run:

```powershell
npm --prefix functions run rooms:super-scope -- --actor-uid=OWNER_UID --target-uid=OPERATOR_UID --regions=IQ,SA
```

Apply:

```powershell
npm --prefix functions run rooms:super-scope:apply -- --actor-uid=OWNER_UID --target-uid=OPERATOR_UID --regions=IQ,SA
```

An empty region list returns the operator to `pending`. Every applied scope change writes an administrator-security audit event.

## Deployment order

1. Complete the Wave 1 room/member migration and zero-pending post-check.
2. Deploy Firestore indexes and wait for the command retry and regional moderation indexes to become ready.
3. Deploy the backward-compatible Firestore rules.
4. Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`, then deploy `livekitToken`, `roomCommand`, and `retryRoomLiveKitSync`.
5. Smoke-test one owner action, one moderator denial, one same-ID replay, one stale revision, and one offline LiveKit target.
6. Grant and scope one non-production Super Moderator; verify same-region success and cross-region audited denial.
7. Release the mobile client and monitor command error codes, revision conflicts, pending LiveKit sync age, and unexpected token denials.
8. Expand rollout only while the pending sync queue drains and cross-region denial remains correct.

Rollback order is mobile first, functions second. Do not remove v2 command records or revert the additive room/member fields. Tokens must continue using server-resolved publishing authority even during rollback.

## Verification

- TypeScript compile passed.
- 524 non-emulator tests passed.
- Firestore and Storage emulator suites passed.
- Functions syntax validation passed.
- Administrator dashboard production build passed.
- Tests cover permission hierarchy, forged owner denial, moderator limits, missing/invalid region denial, cross-region audit/replay, revision conflicts, same-ID replay, conflicting request IDs, Firestore mutation plans, LiveKit permission/removal calls, authoritative seats, force-mute, lockdown, bans, and client mutation denial.

## Wave 3 handoff

Wave 3 can implement transactional seat claims using the established `seatId`, deterministic seat documents, room revision, request ID, stable error, token, and LiveKit synchronization boundaries. It must remove the controlled legacy speaker bridge only after every active room uses the seat engine.
