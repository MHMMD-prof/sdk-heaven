# Follow Graph V1 Launch

## Scope

One-way follow graph plus social hygiene for V1 parity with peer voice apps.

**In scope**
- `follow-user` / `unfollow-user`
- `get-follow-status`, `get-following`, `get-followers`
- `followerCount` / `followingCount` on `publicProfiles`
- Push kind `new-follower` (preference category `follows`)
- Room `chatMode: 'followers'` gated by real follower edges
- Block hygiene: decrement `friendCount`, clear follow edges both ways, adjust follow counts
- `get-blocked-users` + Blocked Users screen

**Out of scope**
- People-you-may-know / contacts sync
- Online friends roster / friend-in-room
- Privacy ACLs (who can follow)
- Auto-friend on mutual follow
- Couples CP / levels

## Feature flag

`appConfig/socialFeatures.following` — fail closed (`false` by default).

```bash
node functions/scripts/setSocialFeatureFlags.js --actor-uid=<adminUid> --following=true
```

## Collections

| Path | Purpose |
|---|---|
| `following/{uid}/items/{targetUid}` | Users that `uid` follows |
| `followers/{uid}/items/{followerUid}` | Users who follow `uid` |
| `socialFollowRateLimits/{uid}` | Mutation rate window |

Client writes are denied. Mutations go through `socialCommand`.

## Room chat semantics

Enum value `followers` is unchanged on room documents. Access now checks:

`followers/{ownerUid}/items/{actorUid}`

Owner/moderator bypass remains. UI label remains المتابعون.

## Relationship model

Follow is independent of friends. Mutual follow does **not** create a friendship. Block removes friendship (if any) and follow edges in both directions, and corrects counts.

## Client surfaces

- Profile stats: المتابعون / يتابع
- Profile follow button
- `Following` screen (tabs)
- `BlockedUsers` screen (Me secondary actions, Account Settings, Friends header)

## Admin

User operational context samples following + follower edges (limit 20) alongside friendships.
