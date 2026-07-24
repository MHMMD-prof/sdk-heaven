# Voice Room Wave 0 Shared-Music Feasibility

## Decision

Shared device music remains a required room feature, but `voice_room_shared_music` must default off for the initial production-room release.

The installed Expo/LiveKit stack does not currently provide a proven path from an `expo-audio` local playback item to a second LiveKit-published audio track. Wave 11 is blocked until a native proof passes on real Android and iOS devices. Local-only playback is not an acceptable substitute.

## Inspected baseline

- Expo `~56.0.16`
- `expo-audio ~56.0.12`
- `@livekit/react-native ^2.11.0`
- `@livekit/react-native-webrtc ^144.1.0`
- `livekit-client ^2.19.1`
- `src/voice/LiveKitVoiceClient.ts`
- Installed LiveKit and React Native WebRTC sources/types
- Expo SDK 56 Audio documentation
- Current LiveKit participant/track documentation

## Findings

1. `expo-audio` plays and records through native audio APIs, but its public playback API does not expose the decoded playback stream as a WebRTC `MediaStreamTrack`.
2. LiveKit can publish a supplied audio `MediaStreamTrack`, so the missing component is a supported native source that feeds the chosen device media into WebRTC.
3. The installed React Native WebRTC `getDisplayMedia` native code creates a screen **video** track on Android and iOS. The inspected implementation does not return a system/playback-audio track.
4. The current app starts LiveKit's audio session and publishes only the microphone through `setMicrophoneEnabled(true)`.
5. Playing a song through `expo-audio` beside the microphone would make it audible only on the DJ's device unless it leaks acoustically into the microphone, which would be low quality and unacceptable.
6. Background playback configuration is currently disabled in `app.json`; changing it would require a native rebuild and still would not solve WebRTC publication.

## Candidate approaches

### A. Maintained native WebRTC audio source

Create or adopt a maintained native Expo module that decodes an approved local media item and exposes a WebRTC-compatible audio source/track.

Advantages:

- Meets the intended “music from the user's device” behavior.
- Can publish a distinct LiveKit track with separate listener volume/mute.
- Can be stopped through track unpublish and participant permission revocation.

Risks:

- Native Android/iOS implementation and long-term maintenance.
- Audio-session mixing, resampling, echo cancellation, route changes, background behavior, and battery use.
- iOS/Android media-library and DRM limitations.
- A custom audio device module can interfere with microphone capture if designed incorrectly.

### B. Server-side ingress from an approved uploaded/streamed source

The user selects permitted media, the service obtains an approved server-readable source, and a server ingress publishes it into LiveKit.

Advantages:

- Consistent track publication and centralized stop/control.
- Less device CPU and fewer audio-route conflicts.

Risks:

- It is no longer purely local-device broadcasting.
- Upload/storage/licensing/privacy complexity.
- Startup latency and bandwidth cost.
- Local file paths and protected media cannot be treated as server-readable URLs.

### C. Native screen/system-audio capture

Not viable with the currently installed React Native WebRTC implementation. Even if later supported on one platform, cross-platform restrictions and user-consent UX would need separate proof.

## Recommended path

Prototype approach A first in an isolated native branch after the production voice/seat core is stable. Keep approach B as a product fallback only if the business accepts an approved-catalog/upload model instead of arbitrary device music.

Do not modify the main voice client until the spike proves that microphone and music can coexist without breaking calls, routes, or remote moderation.

## Required proof matrix

### Publication

- Music publishes as a track distinct from the microphone.
- LiveKit subscribers identify it as music and control it separately.
- An old/replayed token cannot restart it after privilege revocation.
- Only one valid DJ lease publishes at a time.

### Android

- Mid-range physical device.
- Speaker, wired headset, Bluetooth headset, and route loss.
- Foreground/background behavior allowed by policy.
- Incoming call/interruption and recovery.
- Microphone plus music, music-only, local mute, and server forced stop.

### iOS

- Physical iPhone; simulator is insufficient.
- Speaker, wired/USB where supported, Bluetooth, and route loss.
- Audio-session interruption and recovery.
- Microphone plus music, music-only, local mute, and server forced stop.
- Approved media-library source and protected-source rejection.

### Quality and operations

- No acoustic microphone loop or echo.
- Agreed latency and synchronization.
- CPU, memory, battery, and thermal measurements.
- Music volume never overrides safety prompts or voice by default.
- Owner, moderator, and Super Moderator stop controls work within the operational target.
- App crash, network loss, leave, kick, ban, and lease expiry release the source.

## Wave 0 exit result

The feasibility question is resolved for launch planning: shared music is **not technically proven in the current stack and therefore cannot block or enter the initial core release**. It remains scheduled as Wave 11 behind a dedicated flag and native proof gate.
