# Weekly Room Incentives — Wave 5 trusted attendance

## Status

The report-only implementation is complete locally. Nothing in this wave pays a
salary, changes production data, deploys a function, or enables a feature flag.
Production rollout and the physical Android exit matrix remain release work.

## Authority model

- `livekitAttendanceWebhook` verifies LiveKit's signed raw webhook body before
  accepting participant join, leave, abort, publish, or unpublish events.
- LiveKit does not currently publish microphone mute/unmute as webhook events.
  The mobile client therefore sends only a hint after a successful local mute
  change. `roomAttendanceCommand` asks LiveKit's server API for the actual
  participant track state before recording it.
- `reconcileLiveKitAttendance` polls every connected attendance session once per
  minute. This closes sessions after missed webhooks, catches a modified client
  that withholds mute hints, and processes five-minute mute deadlines.
- A connected LiveKit identity is not enough. The Firestore membership must
  point at a seat whose server-owned seat document names the same UID.
  `projectRoomAttendanceSeatState` projects authoritative seat changes.
- Firebase UID is the LiveKit participant identity. Clients cannot provide a
  different attendance identity.

## Interval rules

- Qualification requires LiveKit connected + authoritative speaker seat +
  published microphone.
- Muted time remains qualified until exactly five continuous minutes after the
  first server-verified muted observation. It closes at that deadline even when
  a later poll processes the transition.
- Unmuting after the deadline starts a new interval. Unmuting before it keeps
  the original interval continuous.
- Disconnect, microphone unpublish, and seat leave close immediately.
- Stale events are retained as receipts but cannot rewind state. Event IDs make
  webhook replays idempotent.
- Daily reporting clips intervals to the Baghdad day boundary and unions
  overlaps by UID, so concurrent rooms/devices cannot double count.
- Raw evidence includes room, seat, timestamps, state, and close reason. Speech
  content is never captured or analyzed.

## Shadow operations

The Incentives dashboard includes a payroll-permission-gated UID lookup showing:

- daily qualified minutes for the last eight days;
- raw intervals and exclusion reasons;
- connected session state;
- five-minute grace configuration;
- platform outage time;
- repeated mute/unmute reset warnings.

`attendanceOutageWindows` is backend-only. Platform Owners can create or revoke
a bounded window from the same dashboard using a required audit reason; payroll
auditors can view the resulting evidence but cannot mutate it.

## Device integrity

Expo SDK 56 documents `@expo/app-integrity` as alpha. The Wave 5 contract accepts
only an opaque random installation ID plus a verified Play Integrity verdict
reference; unknown fields such as IMEI are rejected. Enforcement remains off.
Before enabling it:

1. add the alpha native module to an Expo development build;
2. configure the Google Cloud project and Play Integrity provider;
3. verify request-hash binding and server-side verdict decryption;
4. run replacement/recovery and false-positive tests on a physical Android
   device;
5. record the approval evidence, then separately enable
   `voice_room_attendance_device_attestation`.

Device uniqueness is an abuse signal with manual review, not a guarantee.

## Data and flags

Backend-only collections:

- `roomAttendanceEventReceipts`
- `roomAttendanceSessions`
- `roomAttendanceIntervals`
- `attendanceOutageWindows`
- `attendanceOutageCommands`
- `attendanceDeviceEnrollments`

Independent flags:

- `voice_room_attendance_shadow`
- `voice_room_attendance_device_attestation`

Both default to false. Payroll tracking and payroll payouts remain separate
existing flags and are not enabled by attendance.

## Release gate

- Deploy indexes/rules/functions with both attendance flags off.
- Configure the signed LiveKit webhook URL.
- Run webhook replay, stale-event, disconnect, and missed-webhook drills.
- Run physical Android cases for mute 4:59/5:00, background, reconnect, network
  switch, midnight, concurrent rooms, and device replacement.
- Compare one full report-only week with controlled sessions.
- Enable shadow reporting only for test payroll identities.
- Do not enable device enforcement or salary payout in Wave 5.
