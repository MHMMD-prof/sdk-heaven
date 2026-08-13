# Competitive Social Growth — Wave 7

Status: **implemented locally** (families / tribes: create, invite/join, leave, kick, dissolve, profile badge, weekly family boards).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## Locked product decisions (Wave 7)

15. Flag is **`growthFeatures.families`** (fail-closed). Plan text that said
    `socialFeatures.families` is outdated.
16. One family membership per user; size cap **30**.
17. Roles: `owner` | `elder` | `member`. Owner dissolves; members leave;
    owner/elder invite + kick (elders cannot kick elders/owner).
18. Join via invite accept **or** 6-char `inviteCode`.
19. Optional `homeRoomId` is a deep-link shortcut only (no family chat V1).
20. Weekly **family_wealth** / **family_charm** boards only (global).
21. Family war / PK deferred.

## What shipped

| Piece | Location |
|-------|----------|
| Core + roles / caps | `functions/socialFamiliesCore.js` |
| Mutations + overview | `functions/socialFamiliesService.js` |
| socialCommand actions | `functions/index.js` + `socialProfileCore.js` |
| Profile badge | `publicProfiles/{uid}.family` |
| Weekly family board scores | `growthLeaderboardService` → `leaderboardPeriods/{week}/families/{familyId}` |
| Client Families screen | `src/screens/FamiliesScreen.tsx` |
| Me / public badge chips | `MeProfilePage`, `PublicProfilePage` |
| Leaderboard family tabs | `LeaderboardsScreen.tsx` |
| Rules deny client writes | `families/**`, memberships, invites, invite codes |
| Client flag read | `appConfig/growthFeatures` allowlisted in rules |

## Ops

```bash
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Emergency: set `families: false` on `appConfig/growthFeatures` (or stage → `dark`).
UX hides; membership docs retained.

## Exit criteria

- Create / invite-accept / join-code / leave / kick / dissolve deterministic + idempotent requestIds.
- Badge projects to public profile; cleared on leave/kick/dissolve.
- Flag off → `FEATURE_DISABLED` + Me entry hidden.

## Out of scope

- Family war / cross-family PK
- Family chat thread
- Elder promotion UX
- Seat-level family chip (profile badge only in V1)
