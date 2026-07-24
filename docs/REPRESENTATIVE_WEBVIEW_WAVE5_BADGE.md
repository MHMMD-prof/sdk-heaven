# Representative WebView Wave 5 authorized badge

## Outcome

Wave 5 adds an administration-owned `وكيل معتمد` identity badge without exposing representative permissions, currency scope, limits, balances, or internal identifiers. The global bottom navigation is unchanged.

The representative transfer feature remains disabled. Firestore rules, `socialCommand`, and the non-admin five-minute badge reconciliation job were deployed to `yallgame-ebd19`. The reconciliation job performs the initial production backfill with its production service identity. The mobile bundle was exported locally but was not distributed.

## Authoritative projection

`representativePrivileges/{uid}` remains the private source of truth. Whenever an administrator activates, suspends, or revokes a representative, the same Firestore transaction updates:

```text
publicProfiles/{uid}.representativeBadge = {
  active: boolean,
  updatedAt: server timestamp
}
```

The privilege document, public projection, and immutable administrative audit event therefore cannot disagree after a successful mutation. Public-profile repair preserves only a well-formed existing projection and never derives it from user input.

A separately deployable non-admin reconciliation job synchronizes privilege state every five minutes. It also backfills existing privileges and removes active badges whose privilege document no longer exists. This keeps production correct while the dedicated `adminDashboard` function remains intentionally excluded from Codex deployments. The job is idempotent and treats missing or malformed privilege state as inactive.

Firestore rules allow the owner to update only the existing safe presentation fields. They reject attempts to add or change `representativeBadge`, and the rules emulator includes an explicit badge-forgery regression test.

## Existing representatives

Existing privilege documents predate the projection. The migration is dry-run first:

```text
npm --prefix functions run representative:badges
npm --prefix functions run representative:badges:apply
```

The script scans `representativePrivileges`, projects both active and inactive states, skips already-correct profiles, reports missing public profiles, supports bounded batches and resume cursors, and uses server timestamps. Run the dry run and inspect every missing-profile warning before applying in production. When local production credentials are unavailable, the deployed reconciliation job performs the same initial projection automatically.

## Client presentation

The reusable badge has two treatments:

- Full Arabic `وكيل معتمد` pill on Me and public profile headers.
- Compact verified seal beside names where space is constrained.

Tapping either treatment opens the same Arabic information sheet. It explains that the platform administration issues and removes the badge and explicitly states that the badge does not reveal balances, transfer limits, or allowed currencies. Nested badge presses stop propagation so the information sheet opens without accidentally navigating the surrounding profile row.

The badge is rendered on every currently implemented server-backed identity surface:

- Me and public user profiles;
- discovery, friends, and couple identities;
- gift recipient and gift-history identities;
- voice-room seats, participant sheets, people management, and ownership transfer candidates.

There is no implemented user-message feed, notification feed, or server-backed in-game player identity surface in the current application. Wave 5 therefore does not invent placeholder badge UI for those absent flows; the reusable component and projection are ready for them when those surfaces are introduced.

## Revocation behavior

Profile headers already use direct public-profile subscriptions. Discovery, friends, couples, gifts, and voice-room identity surfaces now subscribe to the visible users' public projections and fail closed on subscription errors. A privilege revocation updates the public projection atomically and removes the badge without trusting room-member documents or cached social-command responses.

Room-member documents remain client-writable and are not accepted as badge authority. The room screen decorates current participants from live public-profile projections before passing them to seats and management sheets.

## Local verification

Completed:

- root TypeScript compilation;
- backend JavaScript syntax checks, including the migration script;
- focused representative service, profile, discovery, mapping, and UI-contract tests;
- all 101 non-emulator test files and all 617 tests;
- Firestore and Storage rules emulator suite, including owner badge-forgery rejection;
- Expo SDK 56 dependency compatibility check;
- Expo SDK 56 Android production bundle export.

Required before production enablement:

- visually inspect compact badges in long Arabic names, small room seats, and large font scaling;
- verify badge sheet focus, screen-reader order, and Android back behavior on a physical device;
- inspect the reconciliation logs after its initial production execution;
- build and distribute a new mobile binary.

The dedicated `adminDashboard` function and dashboard Hosting were not deployed by Wave 5.
