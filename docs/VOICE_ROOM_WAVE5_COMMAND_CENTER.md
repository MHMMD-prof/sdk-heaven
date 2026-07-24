# Voice Room Wave 5 — Command Center

## Status

Wave 5 engineering is complete and remains dark behind two independent flags:

- `appConfig/voiceRoomFeatures.voice_room_command_center`
- `appConfig/voiceRoomFeatures.voice_room_media`

No room or rollout cohort is activated by deployment.

## Delivered

- Capability-driven Command Center tiles:
  - everyone: share, games, gifts, reactions, participants, and reporting;
  - Room Moderator: microphone, people, and safety operations;
  - Room Owner: all moderator tools plus room settings and ownership/lifecycle.
- Owner settings persisted through the authoritative `roomCommand` transaction:
  - announcement and welcome message;
  - approved built-in theme identifier;
  - chat mode and slow-mode interval;
  - history visibility and keyword-filter policy;
  - entry/gift effects policy.
- Microphone panel:
  - global audio lockdown with immediate LiveKit permission revocation;
  - owner-only seat count and seat mode;
  - owner/moderator individual seat locks;
  - live pending request and invitation queues;
  - approve, reject, cancel, accept, and decline flows.
- People panel:
  - owner appointment/removal of Room Moderators;
  - owner/moderator DJ privilege management;
  - hierarchy-safe kick and room-ban actions.
- Ownership/lifecycle panel:
  - confirmed ownership transfer to an active member;
  - reason-required, recoverable room removal that retains moderation context.
- Safety panel:
  - bounded moderation-event history;
  - live room-ban list;
  - owner/moderator unban control;
  - client ban and audit writes remain backend-only.
- Moderated room-image workflow:
  - owner-only 16:9 image selection and immutable upload;
  - JPEG, PNG, and WebP support up to 4 MiB;
  - independent client, Storage Rules, and server-side Sharp validation;
  - pending images remain private to the owner and app operations;
  - region-scoped Super Moderator or Platform Owner approval/rejection;
  - active-image removal can suspend room customization;
  - operations can restore customization;
  - replaced images become `superseded`;
  - orphan uploads expire after two hours and rejected, removed, or superseded
    objects are purged after 30 days while audit metadata is retained.
- Admin dashboard review:
  - authenticated image preview;
  - approve, reject, remove/suspend, and restore controls;
  - optimistic room-revision conflict handling.
- Optimistic revision checks, request idempotency, role/target protection, audit
  events, and fail-closed client/server feature gates.

## Setting contract

| Field | Allowed value |
| --- | --- |
| `announcement` | trimmed text, 0–160 characters |
| `welcomeMessage` | trimmed text, 0–200 characters |
| `themeId` | `midnight`, `royal`, `ocean`, `emerald` |
| `chatMode` | `everyone`, `followers`, `off` |
| `slowModeSeconds` | `0`, `5`, `10`, `30`, `60` |
| `historyVisibility` | `everyone`, `after-join`, `hidden` |
| `keywordFilterMode` | `off`, `standard`, `strict` |
| `effectsPolicy` | `full`, `reduced`, `off` |

Unknown keys, invalid enum values, overlong text, stale revisions, and empty
patches are rejected by the backend.

## Rollout and rollback

The flag is absent/false by default. Inspect it without mutation:

```powershell
npm --prefix functions run rooms:command-center:flag
```

Activation and rollback require an active Platform Owner identity:

```powershell
npm --prefix functions run rooms:command-center:enable -- --actor-uid <uid>
npm --prefix functions run rooms:command-center:disable -- --actor-uid <uid>
```

The client hides authority tools while disabled. The server independently
rejects `update-room-settings` and `remove-room`, so a modified or stale client
cannot bypass rollout state. Existing moderation and seat kill switches remain
independent.

Inspect the media flag without mutation:

```powershell
npm --prefix functions run rooms:media:flag
```

Activation and rollback also require an active Platform Owner:

```powershell
npm --prefix functions run rooms:media:enable -- --actor-uid <uid>
npm --prefix functions run rooms:media:disable -- --actor-uid <uid>
```

## External release gates

- Firebase Storage is initialized in the owner-selected permanent
  `me-central1` (Doha) region and the reviewed `storage.rules` are deployed.
  The existing default Firestore database remains in `me-central2` (Dammam).
  The project currently rejects Cloud Functions creation in `me-central2`; the
  media functions therefore remain in `us-central1` until the project location
  policy is changed. This split is intentional for the current release but
  should be included in latency and egress monitoring.
- Replay the capability matrix on physical Android and iOS devices, including
  RTL, large fonts, screen readers, keyboard handling, destructive dialogs,
  photo permissions, background/foreground recovery, and weak-network retries.
