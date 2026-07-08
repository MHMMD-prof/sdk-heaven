# Auth iOS Firebase Setup

This runbook completes the iOS Firebase release handoff for project `yallgame-ebd19`.

## Firebase Console

- Create an iOS app in Firebase project `yallgame-ebd19`.
- Use iOS bundle ID `com.mh.games`.
- Download the real `GoogleService-Info.plist` from Firebase Console.
- Place it at the repository root as `GoogleService-Info.plist`.
- Do not reuse the Android app id from `google-services.json` for iOS builds.

## Expo Config

- `expo.ios.bundleIdentifier` is `com.mh.games`.
- `expo.ios.googleServicesFile` points to `./GoogleService-Info.plist`.
- `expo.android.googleServicesFile` remains `./google-services.json`.

## Environment

For iOS preview or production builds, set the existing public Firebase env vars to the iOS Firebase app values:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

## Smoke Test

- Confirm `GoogleService-Info.plist` exists at the repository root before a native iOS build.
- Run `npx tsc --noEmit`.
- Run `npm test`.
- Run an iOS dev-client or release-like build only on a machine with Xcode and the real plist.
- Sign in, complete email verification, load profile setup, save a profile, sign out, sign back in, and request password reset from the app.
