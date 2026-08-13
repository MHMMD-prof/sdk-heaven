# Voice Room Reference Parity — Wave 4

Wave 4 replaces the development-style seat circles with a production seat presentation contract.

## Delivered

- Seats retain their stable document ID and React key while visual coordinates change.
- Accessibility traversal is always sorted by numeric seat number, independent of visual z-order.
- Empty seats show their number once, inside the seat marker; the duplicate `مقعد N` label is removed.
- Open, locked, reconnecting, retiring, occupied, muted and actively speaking states are visually distinct.
- Owner, moderator, representative and mute indicators occupy separate badge anchors.
- Speaking is an external status halo and does not replace or recolor the avatar border.
- Occupied avatar borders are never read from the room theme:
  - the user's equipped avatar frame is authoritative when present;
  - a neutral application fallback is used when the user has no equipped frame.
- Theme `emptySeatFrame` artwork and theme colors apply only to empty-seat presentation.
- Seat movement uses the required 250 ms transition and becomes immediate when reduced motion is enabled.

## Tests

- `roomSeatPresentationModel.test.ts` covers lifecycle states, role labels, pending state and numeric ordering.
- `voiceRoomSeatVisualContract.test.ts` protects stable keys, user-owned border authority, single numbering, empty-frame scoping and motion behavior.

## Deferred to Wave 5

- Final production artwork for the three room themes.
- Physical-device visual tuning for 5, 10, 15 and 20 seats on compact and tall Android screens.
