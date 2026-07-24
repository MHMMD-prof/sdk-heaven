# Admin Store and User Workspace Refinement

## Goal

Bring Store management and the user information workspace to the same professional,
Arabic RTL standard as the dashboard home page while completing the operational
workflows that are currently only partially represented in the UI.

This is a refinement of the existing Wave 2 and Wave 4 work. It does not replace the
existing data model, moderation protections, audit trail, or deployed admin endpoint.

## Delivery status

- Wave 0 — audit and UX specification: complete (2026-07-21)
- Wave 1 — Store management refinement: in progress (foundation delivered 2026-07-21)
- Wave 2 — user workspace refinement: in progress (foundation delivered 2026-07-21)
- Wave 3 — integration and release hardening: in progress (automated hardening delivered 2026-07-21)

## Wave 0 findings

### Existing Store capability to preserve

- Dedicated Arabic RTL workspace with catalog, gifts, special IDs, and economy-ledger tabs.
- Search, status/category/currency/type filters, cursor pagination, and summary counters.
- General item, gift, and special-ID creation/editing with required audit reasons.
- Catalog conflict detection using `expectedUpdatedAt` and idempotent request IDs.
- Sold/reserved special-ID protection and safe item retirement behavior.
- Firebase Storage uploads with type and size validation plus live item previews.
- Server-enforced `store:view` and `store:manage` permissions.

### Confirmed Store gaps

#### P0 — data correctness and safe editing

- The general item editor does not expose duration, duration unit, stock mode, or
  remaining stock even though these are required parts of the production catalog contract.
- The editor does not expose the English description; it silently copies the Arabic
  description into the English field when saving.
- `purchasingEnabled` and `availability` are separate production states, but the list
  communicates only availability. Operators cannot see why an apparently available item
  cannot be purchased.
- Asset files are uploaded before the Firestore catalog mutation. A later validation or
  conflict failure can leave a newly uploaded asset attached to an unchanged catalog record.
  Versioned object paths and post-save cleanup are needed to avoid partial edits.
- Special-ID filtering cannot select `sold`, although sold records are a first-class state.
- Catalog, gift, and special-ID pages paginate by document ID but sort each fetched page in
  memory. The displayed order is therefore not globally stable across pages.

#### P1 — professional operations

- Summary cards show inventory counts only; there is no period revenue, purchase volume,
  gifting volume, sold-out count, or failed-transaction signal.
- The ledger supports a backend source filter but does not expose it in the UI. It also lacks
  date range, export, transaction detail, and a direct path to the affected user.
- Product rows do not show purchase state, duration, purchasing toggle, sales/ownership
  context, or a compact health warning for missing assets and depleted stock.
- No product-detail history combines catalog changes, purchases, gifts, and stock movement.
- Editors have no unsaved-change warning, field-level error summary, image replacement state,
  or explicit preview for Arabic and English content.
- There are no duplicate-item or carefully scoped bulk enable/disable tools.

#### P2 — polish and efficiency

- Gifts and special IDs use card grids even when an operator needs dense comparison and
  sorting; the view should support a professional table/card switch where useful.
- Filters are not represented in the URL, so returning from another workspace loses context.
- Empty states do not distinguish an empty catalog from a filtered result with no matches.
- Read-only administrators can see mutation controls that the backend will reject.

### Existing user capability to preserve

- Search by name, email, UID, public ID, or special ID.
- Filters for moderation, profile readiness, avatar review, country, and relationship state.
- Paginated desktop table and mobile cards with user summary indicators.
- Six detail tabs: overview, moderation, economy, social, notes, and activity.
- Warning, mute, suspension, ban, avatar review, forced sign-out, wallet adjustment,
  representative permissions, couple dissolution, and internal notes.
- Confirmation dialogs, required reasons for moderation/wallet changes, optimistic conflict
  protection, focus trapping, Escape handling, and backend audit records.
- Server-enforced `users:view`, `users:note`, `users:manage`, and `store:manage` permissions.

### Confirmed user-workspace gaps

#### P0 — data correctness and guardrails

- `user-detail` validates the public profile without loading its `publicIds/{publicId}`
  reservation. A healthy detailed profile can therefore be reported as invalid.
- The modal does not receive action-level permissions. Support, auditor, and other read-only
  roles can see controls that the server later rejects.
- The “send warning” action writes an audit event but does not create a user-facing warning or
  notification. The UI wording currently promises more than the backend performs.
- Couple dissolution has no administrator reason in its request or audit record despite being
  a destructive social action.
- One shared `reason` value is reused by moderation and notes. Changing tabs can unintentionally
  carry text into a different operation.
- Wallet and representative changes do not use the same opened-record conflict token as other
  sensitive profile actions.

#### P1 — missing operational information

- Production public-profile fields `bio` and `gender` are absent from the admin detail contract.
- Notification settings are reduced to a configured/not-configured flag; actual preferences and
  registered-device count are unavailable.
- Social detail shows only counts and the current partner. It does not show friendship/request
  summaries, block relationships, recent social gifts, or pending couple requests.
- Economy detail omits owned/equipped store items, expirations, store gifts, recharge receipts,
  and representative transfer history.
- The workspace does not summarize reports involving the user, current/recent rooms, or room
  moderation history even though those records exist elsewhere in the dashboard.
- The identity header lacks quick copy controls, account age, last sign-in recency, profile
  health explanation, and a concise risk/attention summary.
- Notes and activity use fixed recent limits without pagination or a link into the full audit log.

#### P2 — navigation and polish

- The 760 px drawer is too narrow for a complete operational profile and too visually similar
  to a generic form drawer. Desktop should use a large profile workspace while mobile remains
  a full-screen sheet.
- Opening a user is not encoded in the URL, so a profile cannot be bookmarked or reopened after
  refresh, and cross-links from Store, Reports, or Rooms cannot target the profile directly.
- The selected tab is not preserved, and there are no previous/next user controls within the
  current filtered result set.
- Long IDs are truncated without an explicit copy affordance.

## Approved information architecture

### Store workspace

The page remains one route and uses five primary tabs:

1. **Overview** — revenue/purchase signals, inventory health, top items, and recent exceptions.
2. **Catalog** — general store items with dense table, saved filters, sorting, and item inspector.
3. **Gifts and IDs** — two clearly separated catalog modes sharing professional list controls.
4. **Transactions** — wallet, purchase, gift, and representative movements with detail inspection.
5. **Audit** — Store-scoped change history linked to the global audit workspace.

The existing four-tab layout can be migrated incrementally; Overview is additive and Audit may
initially be a filtered global-audit deep link rather than a duplicate data surface.

### Store visual direction

- Preserve the dashboard’s near-black, bronze, burgundy, and warm-gold palette.
- Use a restrained architectural background and fine ornamental separators rather than adding
  decoration inside every card.
- Give the top summary a strong editorial hierarchy: one dominant commercial metric, supporting
  KPIs, and a compact inventory-health rail.
- Use tables for operational comparison and cards only for visual previews.
- Item editing becomes a structured inspector with sticky summary, grouped sections, visible
  save state, and a final change-review step.
- All labels and content remain Arabic RTL; IDs, emails, currency codes, URLs, and timestamps use
  isolated LTR rendering where appropriate.

### User workspace

Desktop uses a modal workspace approximately `min(1180px, 94vw)` wide and `92vh` tall. Tablet and
mobile use a full-screen sheet. The workspace has three persistent regions:

1. **Identity rail** — avatar, name, statuses, public/special IDs, email, country, account age,
   last sign-in, quick copy actions, and attention indicators.
2. **Section navigation** — Overview, Safety, Economy, Social, Content/Rooms, Notes, and Activity.
3. **Working canvas** — section content with a contextual action rail. Destructive actions stay
   in a visually isolated danger zone and never appear beside routine actions.

The URL contract should support `?user={uid}&section={section}` while preserving the Users route
filters and scroll position.

### User visual direction

- Treat the profile as an operational dossier, not a generic settings drawer.
- Use one high-quality identity header and fewer, larger information groups.
- Surface “needs attention” states with semantic amber/red indicators; normal information remains
  quiet so the interface does not become a wall of gold borders.
- Keep action buttons contextual to their section and permission. Read-only roles see data and
  audit context without disabled mutation clutter.
- Use human-readable Arabic status text, but retain exact identifiers and raw references as
  copyable secondary data.

## Wave 1 — Store management refinement

### Delivery checkpoint — 2026-07-21

Completed in the first implementation pass:

- Production catalog fields, validation summary, permission-aware controls, stable pagination,
  sold-ID filtering, and versioned asset rollback protection.
- Store Overview with 24-hour purchase, revenue, gift, inventory-health, and recent-movement data.
- Transaction source/date filters, visible-result CSV export, detail inspection, and user deep links.
- Duplicate-item workflow, change review, and unsaved-change protection for catalog items.
- Unit, integration, type, lint, production-build, and bundle-budget checks.

Remaining before Wave 1 can be closed:

- Item-specific sales/ownership metrics and Store-scoped audit history.
- Backend-generated full-result CSV export instead of exporting only rows loaded in the browser.
- Authenticated desktop/tablet/mobile visual QA of the protected Store workspace.
- Firebase Storage emulator verification in an environment where the Firebase CLI can run.

### 1A — contract and safety

- Add duration, stock, and English-description fields to the item editor.
- Add field-level validation matching `storeCore.js` and a form-level error summary.
- Show both availability and purchasing state in lists and previews.
- Add sold-state filtering for special IDs.
- Replace page-local sorting with explicit, stable backend sort contracts and cursors.
- Introduce versioned asset uploads and safe cleanup semantics.
- Pass the session permissions into Store and hide mutation controls without `store:manage`.

### 1B — operations and analytics

- Add the Overview tab and period-aware Store summary endpoint.
- Add transaction source/date filters, CSV export, transaction detail, and user deep links.
- Add item detail metrics and Store-scoped audit history.
- Add unsaved-change protection and a review-before-save summary.
- Add duplicate-item support; defer bulk mutations until the single-item workflow is verified.

### Wave 1 exit criteria

- Every production catalog field can be viewed and intentionally edited.
- Asset or catalog failures cannot silently produce a partial visible edit.
- Pagination order is stable under all supported filters and sorts.
- Read-only roles never see actionable Store mutation controls.
- A transaction can be traced to its user, source, reference, and related Store record.
- Desktop, tablet, and mobile layouts match the dashboard’s established quality bar.

## Wave 2 — user workspace refinement

### Delivery checkpoint — 2026-07-21

Completed in the first implementation pass:

- Correct public-profile health resolution using the matching `publicIds` reservation, with a
  specific health reason exposed to the dashboard.
- Added bio, gender, notification preferences, registered-device count, account creation time,
  and representative update metadata to the protected user-detail contract.
- Replaced the narrow drawer with a large Arabic RTL operational dossier, persistent identity
  rail, attention summary, copy controls, previous/next navigation, and URL-addressable sections.
- Added action-level permission rendering for user management, notes, and economy operations.
- Split moderation, notes, wallet, representative, and couple workflows into independent state;
  notes now use the note-specific endpoint available to support administrators.
- Added required reasons for couple dissolution and optimistic conflict checks for wallet and
  representative edits. Renamed the non-delivered warning action to an internal warning record.
- Added user-to-audit and partner-profile deep links plus audit target URL restoration.

Remaining before Wave 2 can be closed:

- Reports, room participation/moderation, friendship/request/block summaries, and couple requests.
- Owned/equipped Store items, expirations, social gifts, receipts, and representative transfers.
- Paginated notes/activity rather than the current safe recent-record limits.
- Authenticated desktop/tablet/mobile visual QA of the protected dossier.

### 2A — contract correctness and identity

- Load the public-ID reservation during user-detail resolution and expose a specific health reason.
- Add bio, gender, full notification preferences, device count, and account metadata.
- Pass session permissions into the user workspace and separate view, notes, user-management,
  and economy-management controls.
- Split form state by action and add action-specific pending/error states.
- Change warning semantics to either deliver a real notification or rename it to an internal
  moderation record; the preferred implementation is a real user-facing warning.
- Require and audit a reason for couple dissolution.

### 2B — complete operational profile

- Add reports, room participation/moderation, social relationship summaries, and block context.
- Add owned/equipped Store items, expirations, gifts, wallet receipts, and transfer history.
- Add paginated notes/activity and deep links to global Reports, Rooms, Store, and Audit views.
- Implement the large desktop dossier and full-screen mobile sheet.
- Add URL-addressable user/section state, copy controls, and list-context restoration.

### Wave 2 exit criteria

- Profile health is accurate and explains what is missing or invalid.
- All visible actions are allowed for the active administrator role.
- Every destructive action records a reason and produces a complete audit event.
- User-facing warning copy corresponds to an actual delivered/persisted user event.
- The profile provides one coherent path through identity, moderation, economy, social, rooms,
  reports, notes, and audit context without requiring manual UID searches.
- Keyboard, RTL, responsive, and reduced-motion behavior pass review.

## Wave 3 — integration and release hardening

### Delivery checkpoint — 2026-07-21

Completed in the automated hardening pass:

- Added shared, testable permission and navigation policies for Store and user workspaces.
- Added dashboard tests for permission variants, URL restoration, Audit deep-link restoration,
  explicit loading/empty/retry states, Store editor validation, and immutable asset paths.
- Added stale-conflict regression tests for wallet and representative mutations.
- Re-ran dashboard typecheck and tests, all function tests, Functions syntax lint, production
  build, and strict bundle-budget verification.
- Confirmed protected Users routes and preserved query parameters reach the correct Arabic
  authentication gate in the local production preview.

Remaining before Wave 3 can be closed:

- Firebase rule emulator tests require a locally available Firebase CLI; no compatible CLI is
  installed in the current environment.
- Authenticated desktop, tablet, and mobile inspection still requires an administrator session.
- Backend deployment is required for the new Store/User contracts, but is intentionally deferred
  until explicitly requested. Dashboard Hosting remains separately gated.

- Add backend normalizer, mapper, authorization, pagination, and idempotency tests for new routes.
- Add component tests for Store editors, permission variants, user actions, and URL restoration.
- Verify empty, loading, stale/conflict, partial-error, retry, and large-data states.
- Verify Storage rules and asset cleanup behavior in emulators.
- Run dashboard typecheck, tests, production build, bundle budget, function tests, lint, and rule tests.
- Perform authenticated visual QA at desktop, tablet, and mobile breakpoints.
- Deploy only changed backend functions/rules when required; dashboard Hosting remains a separate
  explicitly authorized release step.

## Scope boundaries

- No destructive bulk Store mutation in the first refinement pass.
- No direct client access to server-owned Store, wallet, receipt, or audit collections.
- No arbitrary editing of wallet balances, IDs, or relationships outside audited backend actions.
- No dashboard Hosting deployment without explicit approval.
- Existing collection shapes remain backward compatible with the Expo SDK 56 mobile client.

## Recommended implementation order

1. Store contract/safety fixes.
2. Store professional layout and operational detail.
3. User-detail correctness and permission-aware shell.
4. User operational data and action completion.
5. Cross-links, responsive QA, tests, and deployment.

This sequence fixes misleading or incomplete behavior before visual expansion, then builds the
polished UI on stable contracts.

The remaining completion and backend-only release work continues in
[`ADMIN_COMPLETION_WAVES.md`](./ADMIN_COMPLETION_WAVES.md). Dashboard Hosting is excluded from that
plan.
