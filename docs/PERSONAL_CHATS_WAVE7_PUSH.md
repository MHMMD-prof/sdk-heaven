# Personal Chats Wave 7 — Push notifications and privacy settings

Status: implemented locally. Salam/Hilo-simple model: reuse the existing Expo
social push stack, extend `notificationPreferences/{uid}` with a few chat
booleans, hide request previews always, honor one accepted-chat preview toggle,
and coalesce rapid pushes per conversation for 30 seconds.

Exit gate: hidden preview reveals neither sender nor content; muted / blocked /
preference-disabled / no-device cases skip Expo; replayed `requestId` values
return `duplicate` without a second send.

## Preference keys

| Key | Default | Role |
| --- | --- | --- |
| `directMessages` | `true` | Accepted-conversation pushes |
| `directMessageRequests` | `true` | Pending message-request pushes |
| `showMessagePreview` | `true` | Accepted chats only |
| `readReceipts` | `true` | Peer-visible receipt document |
| `showOnlineStatus` | `true` | Client publishes online presence |

Legacy 3-key and 4-key preference payloads still normalize; missing chat keys
fill from defaults. Mobile settings show three sections: social alerts, private
messages, and privacy.

## Delivery

`deliverDirectChatNotification` in `functions/socialNotificationsService.js`:

1. Gates: global `pushNotifications`, category pref, active devices, mute,
   bilateral blocks, recipient `moderationStatus === 'active'`.
2. Idempotency via `createNotificationDeliveryId(actorUid, requestId)`.
3. Coalesce via `notificationCoalesce/{hash}` with `lastSentAtMs` (30s window);
   coalesced deliveries are recorded but do not call Expo.
4. Content from `buildDirectChatNotificationContent` — requests always generic;
   accepted + preview off generic; accepted + preview on uses name + short body.
5. Payload `{ route: 'DirectChat', targetUid: actorUid }` on channel `social`.

Wired from `directChatCommand` after successful non-replayed
`send-direct-message` (accepted or pending) and `send-message-request`.

## Privacy

- `readReceipts: false` still advances `lastReadSequence` / unread, but skips
  writing `receipts/{uid}`.
- `showOnlineStatus: false` stops publishing online presence from
  `useDirectChatThread` (prefs loaded once through `DirectChatProvider`).

## Tap routing

`usePushNotificationCoordinator` navigates `DirectChat` with
`source: 'notification'` and `targetUid` from the payload actor.

## Verification

- Full non-emulator suite: **1,230/1,230 pass** (core preview/coalesce/normalize,
  service mute/block/pref/duplicate/coalesce/hidden-preview, mark-read without
  receipt).
- Functions lint: pass.
- Root TypeScript: pass.
- Admin dashboard typecheck: only the seven known `DailyLoginRewardsPanel.tsx`
  errors.
- Android Expo SDK 56 export: pass.

## Out of scope (Wave 8+)

Owner dashboard notification defaults, push metrics, separate privacy document,
three-tier preview enum, dedicated OS channel, server-enforced online rules.
