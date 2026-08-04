# Personal Chats Wave 5 — Protected media and expressive messages

Status: implemented locally; `directMessageMedia` remains rollout-controlled.

## Delivered

- Short-lived, conversation-bound upload authorizations with deterministic IDs,
  exact content type/size/custom-metadata checks, create-only quarantine paths,
  and scheduled cleanup for rejected and abandoned uploads.
- Backend-only finalization that rechecks friendship/accepted-chat access, account
  moderation, restrictions, both block directions, feature flags, reply targets,
  rate limits, authorization expiry, and source-object identity in the commit
  transaction.
- Image decode validation for JPEG/PNG/WebP, 8,192-pixel dimension bounds,
  single-frame enforcement, orientation normalization, EXIF removal, sRGB WebP
  derivatives bounded to 1,600 pixels, and fail-closed Google Vision SafeSearch.
- Server-side AAC ADTS/M4A inspection with a 120-second and 5 MB hard cap. The
  client cannot declare or override the accepted duration.
- Immutable private finalized media paths. Only the two conversation members can
  read the exact derivative recorded in the finalized upload document; clients
  cannot read quarantine data or write processed objects.
- Expo SDK 56 photo-library/camera flow with Android pending-result recovery,
  local validation, upload progress, cancel, retry, and no committed message on
  failure.
- Expo SDK 56 press-and-hold voice recording with permission handling, exclusive
  audio focus, 120-second native stop, local preview, protected upload, cached
  authenticated playback, and cache clearing on logout/account switch.
- Emoji messages and a new Store `stickers` category. Sticker sends resolve an
  active ownership and an available catalog item server-side, then persist only
  the approved immutable asset identity. The dashboard validates the referenced
  published `room-reaction` asset version.
- Explicit loading, unavailable, unsupported, and unsent attachment states.
  Disabling `directMessageMedia` hides image/voice actions without disabling text,
  emoji, or owned stickers.

## Security properties tested

- Spoofed content types, changed byte sizes, malformed image metadata, animated
  images, oversized dimensions, malformed/overlong AAC, expired authorizations,
  cross-conversation path reuse, cross-account upload attempts, and non-member
  finalized reads are rejected.
- Image sources are re-encoded rather than copied, so source EXIF/location data
  cannot survive in the delivered derivative.
- If a block or account restriction appears after upload but before finalize, no
  message is committed and any newly generated derivative is deleted.
- Cancelled, rejected, or failed uploads never create a broken chat message.

## Verification

- Root TypeScript: pass.
- Android Expo SDK 56 export: pass (2,250 modules).
- Focused media/chat/store tests: pass.
- Full non-emulator application suite: 1,100/1,100 pass.
- Admin Store editor tests: 5/5 pass.
- Firebase rule assertions were added for exact authorization, MIME spoofing,
  immutable reuse, account binding, conversation binding, member reads, and
  non-member denial. The local Java emulator again stalled before running the
  assertions, so this check remains required before enabling the flag.
- Admin-dashboard typecheck is still blocked by pre-existing errors in
  `DailyLoginRewardsPanel.tsx`; Wave 5 introduced no remaining dashboard type
  errors.

## Rollout boundary

Before enabling `directMessageMedia`, deploy Functions, Firestore/Storage rules,
and the client together; enable the Cloud Vision API for the Functions runtime;
run the Firebase rule suite successfully; and perform an Android device check for
camera return, microphone denial, 120-second stop, audio interruption, RTL, large
text, cancel/retry, block-during-upload, and offline/missing-media placeholders.

Keep `directMessages` enabled independently so text chat continues when media is
disabled. SafeSearch deliberately fails closed: an unavailable or unauthorized
Vision adapter rejects images instead of publishing them unscanned.
