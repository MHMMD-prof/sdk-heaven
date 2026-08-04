# Personal Chats Wave 4 — Mobile experience

Status: implemented locally; rollout flags remain off.

## Delivered

- Five-tab main shell with centered Chats tab, exact account unread badge, and
  mounted tab screens so Home, Rooms, Games, and Me retain local state.
- Ruby/gold inbox with bounded realtime data, requests/conversations sections,
  loaded-result search, pagination, loading/error/offline/empty states, mute and
  archive gestures, long-press actions, and screen-reader actions.
- Private thread with deterministic pair routing, request decisions, text send,
  optimistic retry, five-minute unsend, reply previews, timestamps, pagination,
  typing/online state, monotonic read receipts, and per-account drafts.
- Profile and room-participant entry points, authoritative block/unblock support,
  app-switcher privacy shield, custom-scheme deep links, Arabic/English direction,
  large-text bounds, keyboard avoidance, and reduced-motion behavior.
- Backend-maintained `directChatInboxSummaries/{uid}` and participant-readable
  `directConversations/{conversationId}/receipts/{uid}`. Clients cannot write
  either collection.

The request Report control is intentionally a safe unavailable-state affordance;
server-captured evidence and report submission belong to Wave 6 and must not be
simulated with client-authored evidence.

## Verification

- TypeScript: pass.
- Functions syntax suite: pass.
- Wave 4 focused tests: 60/60 pass.
- Android Expo SDK 56 export: pass (2,244 modules).
- Full non-emulator suite: 1,075/1,076 pass. The sole failure is the pre-existing
  Store Wave 0 category test, which still expects five legacy categories while
  the implemented catalog includes five additional cosmetics categories.
- Firestore/Storage emulator wrapper: attempted twice; the local Java emulator
  remained in startup with an empty log and never invoked Vitest. No rule
  assertion failed, but this environment-level check must be rerun before rollout.

## Rollout boundary

Do not enable `directMessages` or `directMessageRequests` from this wave. Rules,
functions, client, and the later safety/reporting waves must be deployed and the
rule emulator plus physical Android acceptance must pass before staged rollout.
