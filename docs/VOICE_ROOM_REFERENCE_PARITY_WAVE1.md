# Voice Room Reference Parity — Wave 1 Visual Contract

## Status

Wave 1 freezes the measured visual contract. It intentionally makes no visible
room changes; Waves 2–8 must implement and verify this contract.

## Evidence set

All three current captures are 716 × 1600 (aspect 0.4475). The approved concept
captures are 852/853 × 1844/1846 (aspect approximately 0.462). Both sets are in
the tall-phone class, so the large differences are not caused by an incomparable
device shape.

| Theme | Current capture | Approved reference | Required composition |
| --- | --- | --- | --- |
| Majlis Default | `codex-clipboard-bc622215-f540-41a0-8f1b-1ec0d5fa9106.png` | `codex-clipboard-123785ea-6d0f-4e51-aa4a-ed98ff9b4934.png` | Furnished horseshoe Majlis |
| Royal Theater | `codex-clipboard-425c75b5-9fc8-4f8d-8c6e-22117db03381.png` | `call_7JXnuSQbZMwWYSnpfgMzeA7K.png` | Central focal seat and curved theater tiers |
| Ruby Constellation | `codex-clipboard-0a6c9f47-777d-4f94-a0dc-3f84bfadc9d9.png` | `codex-clipboard-a64a904e-cdb1-41a1-a0bf-2a7e5e8d8875.png` | Hierarchical modular grid |

## Verified causes in the current implementation

1. `VoiceRoomScreen` stretches the background across the full screen, while
   `VoiceRoomStage` receives only the flexible space left after header, ticker,
   notices and launchers. Background landmarks and seat coordinates therefore
   use different coordinate systems.
2. `VoiceRoomStage` converts normalized positions using that changing stage
   rectangle and fixed 70 × 86 seat footprints. It cannot preserve alignment
   across compact and tall screens.
3. `functions/scripts/seedRoomThemes.js` generates paid-theme layouts with
   generic `spread()` rows. Those rows do not follow the theater tiers or the
   constellation hierarchy in the approved concepts.
4. The mobile runtime renders the theme background, but the stage, empty-seat,
   badge, dock and drawer slots do not yet contribute to the visible room.
5. Empty seats render both `مقعد N` and a second numeric label.
6. Rocket and Room Target are absolutely positioned at a fixed top offset and
   compete with the announcement and seats.

The grey floating gear in the captures is not emitted by `VoiceRoomScreen`,
`VoiceRoomStage`, `VoiceRoomHeader`, `VoiceRoomBottomBar`, or the Command Center.
It is classified as a probable development/device overlay. Wave 8 must confirm
that it is absent from a release build before any unrelated app control is
removed.

## Shared region contract

The usable room viewport is divided into ordered regions:

1. Header
2. Announcement
3. Theme stage
4. Chat/event preview
5. Bottom Command Center

Rocket and Room Target occupy a compact incentive rail inside the stage canvas.
That rail is a forbidden seat region. Room Target remains directly below Rocket.
The normalized compact, standard and tall measurements live in
`src/voice/roomSceneVisualContract.ts`.

## Theme seat topology

Topology describes visual tiers from the focal seat outward. It does not reserve
a seat, move an occupant, or grant authority.

| Seat count | Visual tiers |
| --- | --- |
| 5 | 1 focal + 4 surrounding |
| 10 | 1 focal + 4 upper + 5 lower |
| 15 | 1 focal + 4 upper + 5 middle + 5 lower |
| 20 | 1 focal + 4 upper + three tiers of 5 |

- Majlis maps the tiers onto the furnished horseshoe.
- Royal Theater maps them onto the throne and curved theater rows.
- Ruby Constellation maps them onto a centered hierarchical grid.
- Seat 1 is the visual focal anchor, but remains a normal server-owned seat.
- Accessibility traversal always remains numeric seat order.

## Non-negotiable invariants

- A user-owned avatar border is the only cosmetic that defines an occupied
  avatar border. Themes may decorate furniture, empty seats, role badges and an
  outer speaking effect, but never replace or compete with that border.
- Themes cannot change seat IDs, seat actions, occupancy, roles or permissions.
- Header, chat and Command Center locations stay stable between themes.
- A missing or invalid theme still falls back to Majlis without a blank frame.
- Theme artwork must not contain baked avatars, text, seat numbers or controls.

## Wave 1 acceptance

- Current and reference captures are paired unambiguously.
- Compact, standard and tall normalized regions are bounded and non-overlapping.
- The incentive rail remains inside the stage and outside future seat placement.
- Every theme defines complete 5/10/15/20 topology.
- User-border and seat-behavior ownership are frozen in a tested contract.
- No production rendering or backend state changes occur in this wave.
