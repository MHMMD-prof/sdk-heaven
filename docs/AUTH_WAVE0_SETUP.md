# Auth Wave 0 Setup

This wave locks the Android Firebase identity for the production auth foundation.

## Firebase project

- Project ID: `yallgame-ebd19`
- Firebase config file: `google-services.json`
- Android package: `com.mh.games`
- Android Firebase app ID: `1:799789130161:android:ba45e9ef11171196b1dd90`

## Expo config

- `expo.android.package` must stay aligned with `google-services.json`.
- `expo.android.googleServicesFile` points to `./google-services.json` for native/EAS builds.

## Auth provider checklist

- Enable Email/Password authentication in Firebase Console for `yallgame-ebd19`.
- Enable and review the Firebase password policy in Firebase Console.
- Keep iOS Firebase setup deferred until the iOS release wave.
- Do not regenerate `google-services.json` in this wave.

## Wave 1 env configuration

Firebase client config is public, but it is read from Expo public env vars so preview and
production builds can point at different Firebase apps when needed.

Required values:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

Wave 1 also requires verified email before entering the main app. Password reset and
verification emails are sent by Firebase Auth.

## Wave 2 profile documents

Wave 2 adds owner-only Firestore user profiles at `users/{uid}`.

Required fields:

- `uid`
- `email`
- `displayName`
- `avatarLabel`
- `createdAt`
- `updatedAt`

Deploy `firestore.rules` with the Firebase project before production use. The rules allow
only signed-in, email-verified users to read or write their own profile document.

## Wave 3 LiveKit token auth

The `livekitToken` Cloud Function requires `Authorization: Bearer <Firebase ID token>`.
Clients send only:

- `roomId`
- `canPublishAudio`

The function verifies the Firebase ID token, requires `email_verified`, loads
`users/{uid}`, and derives LiveKit identity, display name, avatar label, and metadata
from trusted Firebase/Auth profile data. Client-sent `userId` and `displayName` are not
accepted by the token endpoint.

## Wave 4 room membership auth

Wave 4 adds public active rooms at `rooms/{roomId}` and owner membership documents at
`rooms/{roomId}/members/{uid}`. Verified users with complete profiles can create rooms
and join listed rooms. LiveKit token issuance now also requires an active room document
and a membership document for the Firebase `uid`.

Room membership is the publish authority:

- `host` and `speaker` memberships may publish audio unless the client asks for
  `canPublishAudio: false`.
- `listener` memberships cannot publish audio.

Deploy both `firestore.rules` and the `livekitToken` Function together for this wave.
Older clients or undeployed rules/functions will fail token issuance because open
`roomId` access is no longer accepted.

## Wave 5 host controls

Wave 5 adds the `roomCommand` Cloud Function for host-controlled room moderation.
Set `EXPO_PUBLIC_ROOM_COMMAND_ENDPOINT` for clients, or let the app derive it from
`EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` when both Functions share the same Firebase
Functions base URL.

Supported command actions:

- `promote-speaker`
- `demote-listener`
- `remove-member`
- `close-room`
- `report-member`

Only active host memberships can promote, demote, remove, or close a room. Active
members can report another member. The Function writes moderation audit events under
`rooms/{roomId}/moderationEvents/{eventId}`. Client Firestore rules intentionally do
not allow direct role/status changes or moderation event writes.
