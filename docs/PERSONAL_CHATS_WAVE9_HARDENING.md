# Personal Chats Wave 9 — Hardening (Salam/Hilo-simple)

Status: implemented locally. Outer HTTP throttle, logout private-data wipe,
client array caps, adversarial unit pack, and provisional P95 budgets. App Check
product, physical compact-Android P95 proof, and full TalkBack / rules-emulator
marathon stay deferred.

Exit gate (simple): no unbounded inbox/thread listeners or unbounded client
merge growth; P95 send-ack and inbox-open **defined**; focused suite +
DM-disabled smoke stay green.

## 1. Outer HTTP throttle

`consumeDirectChatCommandHttpRateLimits` in
`functions/directChatHardeningService.js`, wired after auth on
`directChatCommand`:

| Bucket | Doc id | Limit |
| --- | --- | --- |
| UID | `directChatHttpRateLimits/command_{uid}` | 60 / 10s |
| IP hash (optional) | `directChatHttpRateLimits/command_ip_{sha256(ip).slice(0,16)}` | 60 / 10s |

IP is read from `x-forwarded-for` (first hop) or `x-real-ip`, hashed, and never
used as identity. Missing IP still rate-limits by UID. Collection is
backend-only in Firestore rules. App Check enforcement is deferred.

Existing UID send/report policy limits remain the inner envelope.

## 2. Logout private-data wipe

`clearDirectChatPrivateData(uid)` removes AsyncStorage keys under
`@sdk-heaven/direct-chat-draft/v1/{uid}/`. Called from `AuthProvider.signOut`
before Firebase sign-out (non-blocking on failure). Protected media still clears
on UID change; `DirectChatProvider` still resets in-memory inbox when `!uid`.

## 3. Client caps and list tuning

| Cap | Value |
| --- | --- |
| Inbox memory | 150 conversations (newest) |
| Thread memory | 200 messages (tail) |

`directChatPerformanceBudgets.ts` also defines provisional:

- `sendAckP95Ms: 2500`
- `inboxOpenP95Ms: 1500`

Inbox/thread FlatLists use `windowSize={8}`, `maxToRenderPerBatch={10}`,
`removeClippedSubviews`. Physical device P95 proof is deferred.

## 4. Adversarial unit coverage

Unicode/bidi normalize, keyword spam, DM-disabled when only media/requests on,
clock-skew-resistant unsend (`nowMs` authority), delete-for-me vs unsend race,
notification coalesce flood, link spam shapes, outer HTTP throttle, draft wipe
isolation, client cap helpers.

## 5. Verification

- Wave 9 focused suite (direct-chat hardening/core/policy/service, notifications
  coalesce, personalChat client tests including drafts/caps/links): **86/86 pass**.
- DM-disabled smoke: policy rejects when `directMessages` is false even if media
  / requests flags are true.
- Functions lint: pass (includes `directChatHardeningService.js`).
- Root TypeScript: pass.
- Admin dashboard typecheck: only the seven known `DailyLoginRewardsPanel.tsx`
  errors.
- Android Expo SDK 56 export: pass.
- Full `npm test` also surfaces unrelated dirty `src/voice` room-theme WIP
  failures outside this wave; Wave 9 paths above are green.

## Explicitly deferred

App Check enforcement; physical P95 / low-memory Android profiling; full
Firestore+Storage emulator marathon + TalkBack acceptance; hiding Chats tab when
`directMessages` is false (Wave 10).
