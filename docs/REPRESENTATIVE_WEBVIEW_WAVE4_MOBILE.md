# Representative WebView Wave 4 mobile integration

## Outcome

Wave 4 replaces the obsolete native representative-transfer form with a dedicated Expo SDK 56 WebView shell. The existing `RepresentativeTransfer` route remains parameterless, the global bottom navigation is unchanged, and the Me page remains the only caller that supplies the entry callback.

The representative portal, backend, Firebase rules, mobile bundle, and admin dashboard remain undeployed. The production `representativeTransfers` feature remains disabled.

## Dependency

The mobile project uses `react-native-webview` 13.16.1, installed through:

```text
npx expo install react-native-webview
```

This is the version recommended by the versioned Expo SDK 56 WebView documentation.

## Entry and authorization

The Me page shows the representative entry only after `requestRepresentativeStatus` reports:

- the representative feature is available; and
- the current account has an active representative privilege.

Opening the route does not trust that earlier UI check. The screen requests authoritative status again before requesting a new one-time bootstrap ticket. An inactive privilege, disabled flag, incomplete policy, or unconfigured portal fails closed.

The bootstrap ticket:

- must be the exact 43-character opaque token issued by the backend;
- must have a valid future expiry;
- is placed only in the HTTPS portal URL fragment;
- remains in component memory and is never persisted or logged;
- is consumed and removed from browser history by the portal;
- is discarded when the WebView is disposed.

## WebView boundary

The native boundary accepts only an origin-only HTTPS value and exact same-origin navigation. It rejects HTTP, external origins, embedded credentials, `file:`, `data:`, `blob:`, `javascript:`, malformed URLs, and lookalike hostnames.

The WebView is configured with:

- incognito mode and disabled resource cache;
- no shared or third-party cookies;
- no DOM storage;
- no file access or file-URL escalation;
- mixed-content mode set to `never`;
- popups and multiple windows disabled;
- downloads intercepted and stopped;
- back/forward gestures disabled;
- no automatic media playback or fullscreen video;
- exact native `onShouldStartLoadWithRequest` validation for every navigation.

No Firebase ID token, account password, transfer PIN, proof, portal session, wallet balance, or administrative value is injected by the mobile application.

## Lifecycle and terminal behavior

- The header back button and Android hardware back both stop the WebView, clear its history, discard the launch data, and return to Me.
- Losing screen focus stops the embedded page. Returning to the route requests a new authoritative status and ticket instead of reviving an old session.
- Returning from background causes a native status recheck. Valid sessions receive the minimal `refresh-balance` command; disabled or revoked access disposes the WebView.
- The portal continues its own 15-second authoritative status polling and sends `feature-disabled` or `session-expired` terminal messages.
- Network/process/load failures remove the WebView and show a native retry state. Retry performs the entire status-and-ticket bootstrap again.
- A bootstrap-ticket expiry is checked only before loading. Once exchanged, the portal's separately issued session controls the active session lifetime.

## Native bridge

The native parser mirrors the portal's exact version-one schema:

- `close`;
- `feature-disabled`;
- `session-expired`;
- `refresh-balance`;
- `receipt-share` with bounded text and an optional bounded PNG data URL.

Unknown versions, types, keys, malformed JSON, non-PNG image data, and oversized messages are ignored. Receipt sharing uses the native share sheet; Android receives safe receipt text, while iOS may also receive the bounded PNG data URL.

The portal now listens on both WebView message event locations used by Android and iOS and handles only the exact `refresh-balance` command.

## Local verification

Completed:

- exact portal launch/origin/navigation unit tests;
- exact native bridge and receipt payload unit tests;
- portal TypeScript, all portal tests, and production portal build;
- root TypeScript;
- all 95 non-emulator repository test files and all 594 tests;
- Expo dependency compatibility check;
- Expo SDK 56 Android bundle export.

Required on a physical Android device before enabling the feature:

- header and hardware-back behavior;
- hostile external link, custom-scheme, popup, and download blocking;
- background/resume balance refresh;
- connectivity loss and retry;
- WebView renderer termination recovery;
- feature disablement and representative privilege revocation during an active session;
- native receipt share behavior.

No component was deployed and no feature flag was enabled.
