# Voice Room Reference Parity — Wave 9 Release Acceptance

## Status

Automated release gates and an arm64 release APK are complete locally. Physical
Android visual evidence is pending because no phone or Android Virtual Device
was connected during this wave.

## Release-overlay hardening

- Removed `SYSTEM_ALERT_WINDOW` from Expo's production Android permissions and
  the main Android manifest.
- Retained the permission only in the debug and debug-optimized manifests where
  Expo development tooling may require it.
- Added a regression test that fails if the overlay permission returns to the
  production configuration or if a floating developer/settings control is
  introduced into `VoiceRoomScreen`.
- Verified the actual merged release manifest contains no overlay permission,
  dev-launcher/dev-menu component or debuggable flag.
- Built the arm64 release APK successfully. The initial universal local build
  exhausted Gradle's 512 MB metaspace while compiling Reanimated for x86_64;
  the phone-targeted arm64 build completed normally.
- The grey gear seen in earlier captures is not an application room control.
  A release build must still be visually inspected to rule out a device-vendor
  gaming overlay in the final evidence.

## Required physical evidence

Use a release variant, not Expo Go or a development client. Capture the room in
RTL at 5, 10, 15 and 20 seats for each theme:

1. Majlis Default
2. Royal Theater
3. Ruby Constellation

For every theme verify the Rocket/Target rail, weekly Top-3, Target percentage
and return, activity preview, user-owned avatar frames, and Command Center.
Also verify TalkBack traversal, 200% font scaling, reduced motion, reconnect,
live theme switching and that no floating grey gear belongs to the app.

## Exit gate

- Release merged manifest contains no `SYSTEM_ALERT_WINDOW` permission.
- Release APK/AAB builds successfully.
- Automated three-theme and 5/10/15/20 layout suites pass.
- Physical screenshots and accessibility checks pass on at least one compact
  and one tall Android device.
- Any vendor overlay is disabled before taking approval evidence.

## Local verification

- Focused release/theme suite: 4 files, 28 tests passing.
- Release manifest merge: pass.
- Packaged APK permission inspection: pass; `SYSTEM_ALERT_WINDOW` absent.
- Arm64 release APK: pass, 94,503,572 bytes.
- APK SHA-256:
  `C96E6C03D9C6EC2EBEE4954C4D279FCC745B49A8834510C4CDE245633F9918E1`.
