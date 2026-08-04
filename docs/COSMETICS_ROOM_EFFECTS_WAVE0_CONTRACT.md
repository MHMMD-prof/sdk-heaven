# Cosmetics and Room Effects — Wave 0 Contract

Status: local contract and feasibility implementation complete; physical-device
media gates remain open until approved MP4 and M4A fixtures are supplied.

This wave changes no production catalog data, equipment, room events, or public
rendering. The feasibility screen and its navigation route exist only when
`__DEV__` is true.

## Frozen runtime versions

The versions follow the Expo SDK 56 bundled-module map:

| Runtime | Dependency range | Resolved version |
| --- | --- | --- |
| Expo | `~56.0.18` | `56.0.18` |
| `expo-image` | `~56.0.11` | `56.0.11` |
| `expo-video` | `~56.1.4` | `56.1.4` |
| `expo-audio` | `~56.0.13` | `56.0.13` |
| `expo-asset` | `~56.0.21` | `56.0.21` |
| `lottie-react-native` | `~7.3.4` | `7.3.8` |

Do not upgrade these independently. Re-check the exact SDK 56 documentation
and Expo bundled-module versions before changing them.

## Accepted V1 formats

| Format | Accepted use | Hard rule |
| --- | --- | --- |
| PNG | Transparent static frames, overlays, bubbles, badges, effects | At most 3 MiB and 2560 px on either axis |
| JPEG | Opaque profile and room backgrounds | At most 3 MiB and 2560 px on either axis |
| Lottie JSON | Transparent/scalable motion | Vector shapes only, at most 1 MiB, 30 FPS, 6 seconds, with a static fallback |
| MP4/H.264 | Opaque gift, entrance, and room-theme cinema | No transparency; 720p/30 FPS; 5 MiB and 6 seconds, except room themes at 10 MiB and 30 seconds; static poster required |
| M4A/AAC | Optional short effect audio | Separate file, at most 500 KiB and 6 seconds; visual completion cannot depend on it |
| legacy WebP | Read-only migration compatibility | Cannot be submitted as a new asset |

Reject GIF, APNG, animated WebP, SVG, MOV, WebM, HEVC, transparent video,
HTML/script bundles, arbitrary external URLs, unknown MIME types, and files
whose bytes do not match their claimed format.

MP4 remains restricted because it is efficient and reliable for opaque
full-screen motion but does not provide the transparent compositing required
by borders, bubbles, nameplates, badges, and seat overlays. Those surfaces use
PNG or Lottie.

## Category canvases and safe areas

Coordinates are pixels in the authoring canvas. Important faces, names, text,
logos, and effect focal points must remain inside the safe area. Decorative
particles may extend outside it.

| Category | Canvas | Safe area `(x, y, width, height)` | Loop |
| --- | --- | --- | --- |
| Avatar frame | 512×512 | 56, 56, 400, 400 | Allowed |
| Profile skin | 1440×1920 | 96, 192, 1248, 1536 | No |
| Chat bubble | 1080×420 | 96, 60, 888, 300 | Allowed |
| Nameplate | 1000×240 | 80, 40, 840, 160 | Allowed |
| Cosmetic badge | 256×256 | 24, 24, 208, 208 | Allowed |
| Entry effect | 1280×720 | 64, 72, 1152, 576 | No |
| Seat effect | 512×512 | 56, 56, 400, 400 | Allowed |
| Gift effect | 1280×720 | 64, 72, 1152, 576 | No |
| Room theme | 1280×720 | 64, 72, 1152, 576 | Allowed |
| Room reaction | 512×512 | 48, 48, 416, 416 | Allowed |
| Couple effect | 1080×420 | 96, 60, 888, 300 | Allowed |

The canonical values also live in
`src/cosmetics/contracts.ts`; runtime and intake code must not invent different
dimensions.

## Equipment, authority, and publication

There is one equipped item per slot:

`avatar-frame`, `profile-skin`, `chat-bubble`, `nameplate`,
`cosmetic-badge`, `entry-effect`, and `seat-effect`.

Platform authority, room owner/moderator, representative, safety, speaking,
muted, and connection indicators are not cosmetics. A cosmetic cannot hide or
imitate them.

A submitted asset follows:

```text
draft -> processing -> pending -> approved
                              \-> rejected
approved -> suspended
```

Approval and publication are separate. Public rendering requires the exact
immutable version to be both `approved` and `published`, with an approval ID
bound to its checksum and metadata. Editing bytes creates a new pending
version. User-owned assets are private and unusable until an admin approves and
publishes them.

## Layer order

Lowest to highest:

1. Room theme background
2. Room theme stage treatment
3. Room seats
4. Seat effects
5. User avatar
6. Avatar frame
7. Speaking/muted/seat state
8. Authority and safety badges
9. Room chat and controls
10. Ambient reactions
11. One major effect
12. Safety, moderation, connection, and account notices

The exact numeric order is frozen in `COSMETIC_LAYER_ORDER`.

## Client states and fallback rules

The client recognizes `static`, `loading`, `ready`, `failed`, `disabled`,
`expired`, `incompatible`, `reduced-motion`, `muted`, and `off`.

- Loading never removes the base avatar, text, room, or control.
- Failed, disabled, expired, incompatible, offline, and low-memory assets use
  the approved static fallback or the bundled default.
- OS Reduced Motion wins and selects a static fallback.
- `reduced` removes decorative audio and expensive motion.
- `off` hides decoration, but financially meaningful gift receipts remain as
  compact text.
- Effect-audio mute never suppresses the visual receipt.
- No cosmetic failure may block room join, voice, chat, gifting, moderation,
  navigation, or leaving.

## Lottie designer restrictions

- Export JSON, not `.lottie`, ZIP, or a hosted player.
- Convert all text/fonts to vector shapes.
- Use vector shape layers only.
- Do not include images, base64/data URLs, remote URLs, expressions, 3D layers,
  cameras, layer effects, blur-heavy effects, or third-party plugins.
- Use 30 FPS or less and a maximum six-second composition.
- Deliver a separate PNG fallback from the same approved package.
- Test at avatar size as well as full authoring size when the category is an
  identity cosmetic.

The Wave 0 backend draft performs structural rejection for these features.
Wave 1 must add trusted byte sniffing, normalization, checksum calculation, and
immutable publication before any upload can reach production.

## Artist delivery package

Every package must contain:

- stable proposed asset name, category, and semantic version;
- Arabic and English display names;
- approved source format;
- exact authoring canvas and safe-area declaration;
- duration, frame rate, loop choice, transparency, and performance tier;
- required PNG/JPEG static fallback;
- optional separate M4A/AAC effect sound;
- reduced-motion presentation;
- copyright/ownership attestation for custom work; and
- preview plus intended surfaces.

Accepted example:

```text
gold-lion-entry/
  manifest.json       # category=entry-effect, format=lottie-json, v=1.0.0
  effect.json         # vector only, 1280x720, 30 FPS, 4.2 seconds
  fallback.png        # 1280x720
  sound.m4a           # AAC, 3.8 seconds, optional
  preview.png
  ownership.txt
```

Rejected examples include a GIF border, an MP4 border, Lottie JSON with linked
images or expressions, a video that depends on transparency/chroma key, an
asset without a fallback, and any user asset requested for public use before
admin approval.

## Feasibility lab

In a local development environment only, configure approved HTTPS fixtures:

```dotenv
EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL=https://controlled-cdn.example/effect.mp4
EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL=https://controlled-cdn.example/effect.m4a
```

Open Account Settings, then **Cosmetics Wave 0 Lab**. The lab:

- renders a cached static image;
- renders the bundled vector-only Lottie fixture;
- uses one `textureView` MP4 surface to avoid Android overlapping-view issues;
- enables video caching;
- downloads short effect audio before playback;
- uses `mixWithOthers` so effect audio can coexist with LiveKit;
- pauses animation, video, and audio when backgrounded;
- relies on Expo hooks to release video/audio players on unmount; and
- shows a static fallback when OS Reduced Motion is enabled.

Do not use arbitrary public media URLs. The final MP4 and M4A fixtures should
come from the admin/client asset package so the test validates the same export
pipeline production will use.

## Physical-device gate

Wave 0 cannot close until the following are recorded on a physical iPhone and
a mid-range physical Android phone:

- cold and cached load for PNG, Lottie, MP4, and M4A;
- first-frame/start delay and visible frame drops;
- one Lottie plus one MP4 scenario on Android;
- audio effect during a connected LiveKit room, confirming voice continues;
- reduced motion, effect mute/off, slow network, offline fallback, rapid
  replay, repeated screen entry/exit, background/foreground, and room leave;
- memory behavior and confirmation that no playback continues after teardown;
- no crash, blank avatar/room, stuck major-effect queue, or leaked audio.

If restricted MP4 fails this gate, keep `mp4` reserved in the schema and ship
static/Lottie only. No production feature flag is enabled by Wave 0.
