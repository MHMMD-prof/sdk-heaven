# Bottom Effect Stage — Wave 6 Acceptance

**Implementation status:** complete. The sanitized global Firebase rollout was
applied on 2026-08-11 to the empty/test environment, with audit event
`RZgfxksGRQhn7cidfUFG`. A local Android release APK completed successfully with
SHA-256 `0576C75E62A8A5C6F9228EAFEA0FCCE6B3AC788C2E2E45918432D038CCCBD9C0`.
It is debug-signed for direct testing and has not been published to the Play Store.

**Release status:** the empty/test environment is globally enabled at the owner's
request. The physical matrix below must still pass before onboarding users.
Automated checks cannot prove calls,
Bluetooth routing, device memory pressure, decoder behavior, or LiveKit audio on
real hardware.

## Independent rollout

`room_bottom_effect_stage` changes only the entry/major-gift presentation surface.
Turning it off returns those events to the existing compact overlay. It does not
change entry delivery, gift creation, ownership, store publication, wallet debit,
commission, receipt, or audio/video capability flags.

All writes require an active Platform Owner and create an admin audit event.
Tester UIDs passed to the rollout command are SHA-256 hashed locally before they
are stored. The signed-in-readable config contains only those hashes, never the
raw tester UIDs.

```powershell
# Dry-run owner/tester rollout
npm.cmd --prefix functions run cosmetics:bottom-stage:rollout -- --mode testers --test-uid TEST_UID

# Apply owner/tester rollout
npm.cmd --prefix functions run cosmetics:bottom-stage:rollout -- --mode testers --test-uid TEST_UID --apply --actor-uid OWNER_UID

# Expand to selected rooms; repeat --room-id and --test-uid as needed
npm.cmd --prefix functions run cosmetics:bottom-stage:rollout -- --mode rooms --room-id ROOM_ID --test-uid TEST_UID --apply --actor-uid OWNER_UID

# Wider rollout only after every physical row passes
npm.cmd --prefix functions run cosmetics:bottom-stage:rollout -- --mode global --apply --actor-uid OWNER_UID

# Independent rollback
npm.cmd --prefix functions run cosmetics:bottom-stage:rollout -- --mode off --apply --actor-uid OWNER_UID
```

## Automated evidence

- Fail-closed flag parsing and tester → room → global targeting.
- Hashed tester targeting; readable config never exposes raw tester UIDs.
- Fixed-schema telemetry without UID, name, room ID, event ID, URI, or storage path.
- Shown, reduced, fallback, decode error, completion, cancellation, queue drop,
  and combo update outcomes.
- Queue burst cap, priority ordering, duplicate event-ID replacement, expiry,
  reduced-motion/low-memory media stripping, safe layers, and mixed RTL/LTR copy.
- Existing entry, gift, wallet, receipt, block, global eligibility, and combo tests
  remain the authority for financial and delivery invariants.

## Physical device matrix

Every row begins as `NOT RUN`. Record the exact OS, model, app build, asset IDs,
date, tester, and evidence link when executed.

| Platform | Tier | Required hardware | Status |
|---|---|---|---|
| Android | Low | Oldest supported OS; low RAM/GPU | NOT RUN |
| Android | Mid | Common current mid-range phone | NOT RUN |
| Android | High | Current flagship | NOT RUN |
| iOS | Low | Oldest supported iPhone/OS | NOT RUN |
| iOS | Mid | Common supported iPhone | NOT RUN |
| iOS | High | Current Pro-class iPhone | NOT RUN |

Run all cases on every row:

1. Join a LiveKit room with two devices and verify voice remains intelligible
   before, during, and after entry and gift effects.
2. Play entry, major gift, global gift, combo update, and rapid mixed bursts.
   Inline and targeted gifts must retain their existing surfaces.
3. Verify visible and screen-reader copy names the entrant, or gift sender, item,
   quantity, and recipient. Repeat with RTL, LTR, and mixed names.
4. Toggle reduced motion and the room effects policy. Motion and effect audio must
   stop; compact text must remain available.
5. Background and foreground during playback. The queue must clear, audio must
   stop, and an already seen entry must not replay after return.
6. Trigger an incoming/outgoing call interruption and recover. LiveKit and effect
   audio must follow platform audio focus without leaked or doubled playback.
7. Connect, disconnect, and switch wired headphones and Bluetooth during playback.
   Effect audio must follow the active route and stop at completion/cancellation.
8. Apply memory pressure. The client must reduce effects, clear queued media, keep
   room controls usable, and avoid a crash.
9. Test slow download, missing primary, corrupt primary, and missing fallback.
   The stage must show static/text fallback and advance the queue by its lease.
10. Verify the gift sheet, room dock, leave/safety controls, call UI, keyboard,
    and system safe areas are never obscured or blocked.
11. Turn `room_bottom_effect_stage` off while rooms are active. Subsequent effects
    must use the legacy overlay without changing gift balances or entry delivery.

## Pass gate

Wider rollout is allowed only when all six device rows pass with no obscured
controls, stuck queue, replayed entry, duplicate gift transaction, leaked audio,
inaccessible copy, or crash. Any failure requires `--mode off` while the underlying
entry and gift systems remain enabled.
