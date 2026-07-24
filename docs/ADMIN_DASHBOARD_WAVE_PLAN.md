# Admin Dashboard Improvement Plan

## Goal

Bring every Arabic RTL admin page to the visual quality of the Overview page while completing the operational functionality needed for safe day-to-day administration.

Each wave is a complete vertical slice: UI, backend contract, permissions, audit logging, loading/error/empty states, responsive behavior, and tests ship together.

## Current baseline

- Overview has the strongest visual direction and becomes the reference design system.
- Users, Rooms, Reports, and Audit currently share a generic panel/list treatment.
- Settings has no route or page; its button currently opens Audit.
- Gift and special-ID catalog controls are mixed into Users.
- The backend supports a general store catalog that the admin client does not expose.
- List endpoints return at most 25 records for users, rooms, reports, and audit with no cursor pagination.
- Operational details, histories, bulk actions, administrator selection, and richer moderation actions are incomplete.

## Shared product rules

- Arabic-first copy and true RTL layout; IDs, email addresses, timestamps, and numeric fields retain controlled LTR rendering.
- Reuse the Overview palette, architectural background, brass borders, typography, spacing, and restrained decoration.
- Dense operational screens use tables on desktop and cards on small screens.
- Destructive actions require a reason, a confirmation dialog, visible progress, and an audit event.
- Never ask an administrator to manually type a UID when a searchable selector can be provided.
- Every list supports skeleton, empty, filtered-empty, error, retry, and permission-denied states.
- Every mutation uses an idempotency key and refreshes only the affected record where possible.

---

## Wave 0 — Dashboard foundation

### Style

- Extract the Overview visual language into reusable page primitives: page header, KPI card, panel, filter bar, data table, status badge, drawer, modal, toast, skeleton, empty state, and pagination.
- Define consistent Arabic typography, spacing, row density, focus states, icon sizes, and responsive breakpoints.
- Keep decoration around page framing and headers; keep data-heavy areas clean and readable.
- Split the monolithic dashboard component and stylesheet into page and component modules.

### Functionality

- Add explicit routes for Settings and Store.
- Correct browser history, active navigation, page titles, and direct-link behavior.
- Introduce a consistent API result/error shape and mutation feedback.
- Add cursor metadata to list contracts before page-specific pagination is implemented.
- Add shared confirmation, notification/toast, and permission-boundary infrastructure.

### Exit criteria

- All current pages render through shared primitives without visual regressions.
- Settings no longer opens Audit.
- Desktop, tablet, and mobile shells pass RTL visual checks.

---

## Wave 1 — Reports and moderation queue

This page establishes the table, drawer, filters, and action patterns reused by later waves.

**Implementation status (2026-07-18): complete.** The vertical slice now includes KPIs, RTL queue table, cursor pagination, status/severity/source/assignee/room/date filters, report and Public-ID search, administrator assignment, bulk assign/triage, identity and evidence context, detail/history drawer, every workflow action, idempotency, and concurrent-update detection.

### Style

- Add report KPIs: open, urgent, unassigned, overdue, and resolved today.
- Replace repeated report cards with a professional queue table.
- Add severity/status/source badges and an SLA/age indicator.
- Open each report in a rich side drawer containing context, evidence, identities, room, notes, and decision history.

### Functionality

- Cursor pagination and filters for status, severity, source, assignee, room, and date range.
- Search by report, reporter, target, public ID, or room ID.
- Searchable administrator assignment instead of manual UID entry.
- Actions: assign, move to triage, resolve, reopen, escalate, and add internal note.
- Bulk assignment and bulk triage for selected reports.
- Report detail/history endpoint and audit events for every transition.
- Preserve the resolution note and expose it in resolved-report views.

### Exit criteria

- A moderator can find, inspect, assign, and resolve a report without leaving the page or entering raw identifiers.
- Concurrent updates are detected and do not silently overwrite another moderator's decision.

---

## Wave 2 — Users and user profile operations

**Implementation status: complete (2026-07-18).** The directory, filters, cursor pagination, six-tab profile drawer, audited moderation and session actions, avatar review, notes, wallet adjustments, relationship dissolution, and voice mute enforcement are implemented. Production deployment of the new functions and Firestore indexes remains an environment operation.

### Style

- Replace user cards with a searchable table containing avatar, identity, account state, country, public ID, wallet summary, and last activity.
- Add a profile drawer with tabs: Overview, Moderation, Economy, Social, Notes, and Activity.
- Move gift and special-ID catalog forms out of Users.
- Use high-visibility warning zones for destructive account actions.

### Functionality

- Cursor pagination and filters for account state, country, profile readiness, avatar moderation, and relationship state.
- Complete user detail endpoint including wallet balances, moderation history, notes, active restrictions, and recent sessions/activity summaries.
- View note history and add internal notes.
- Actions: warn, suspend, unsuspend, ban, unban, mute, and avatar approve/reject.
- Wallet credit and debit/adjustment with required reason, before/after balance, idempotency, and ledger entry.
- Preserve couple dissolution, but move it into Social with clear relationship context.
- Optional forced sign-out/session revocation for compromised accounts.

### Exit criteria

- All user operations are discoverable from one profile drawer, permission-checked, confirmed, and audited.
- Catalog administration is no longer mixed with user moderation.

---

## Wave 3 — Live rooms

**Implementation status: complete (2026-07-18); backend deployed to `yallgame-ebd19`.** The room directory, operational KPIs, cursor pagination, filters, detail drawer, participant presence, linked reports, game context, moderation timeline, and audited room/participant actions are implemented. Dashboard Hosting deployment remains a separate release operation.

### Style

- Add KPIs for active rooms, listeners, games, private rooms, and rooms with moderation events.
- Use a live table/grid with status, type, host, participant count, visibility, age, and last activity.
- Add a room drawer with room information, participant list, game state, and moderation timeline.
- Visually distinguish healthy, idle, full, flagged, and closing rooms.

### Functionality

- Cursor pagination, live refresh, and filters for status, type, visibility, host, capacity, and flags.
- Room detail and participant-list endpoints.
- Actions: close room, reopen when allowed, remove participant, mute participant, and transfer host when safe.
- Require a reason for moderation actions and show affected member/room context in confirmation dialogs.
- Surface active reports and moderation events associated with the room.

### Exit criteria

- An administrator can understand a room's current state and moderate it without manually entering a member UID.

---

## Wave 4 — Store and economy

**Implementation status: complete (2026-07-18); backend deployed to `yallgame-ebd19`.** The dedicated RTL Store workspace now includes operational KPIs, general catalog, gifts, special IDs, wallet-ledger search, cursor metadata, real item previews, safe retire/enable flows, required change reasons, conflict detection, sold/reserved ID protection, and economy audit context. Dashboard Hosting deployment remains a separate release operation.

### Style

- Add a dedicated Store navigation page with tabs for general catalog, gifts, and special IDs.
- Use catalog tables/cards with icon preview, Arabic name, category, price, score/value, availability, order, and last editor.
- Add create/edit drawers with a real preview of how the item appears in the app.

### Functionality

- Connect the existing general `store-catalog` backend support to the dashboard.
- Add list/read endpoints for gifts and special IDs; the current admin client only exposes upsert forms.
- Create, edit, enable/disable, reorder, and safely retire catalog entries.
- Prevent modification of sold/reserved special IDs and clearly explain conflicts.
- Add economy audit history and searchable wallet ledger views.
- Validate duplicate IDs, invalid pricing, and unsafe value changes before submission.

### Exit criteria

- All catalog types can be viewed and managed from dedicated pages; no catalog form remains inside Users.

---

## Wave 5 — Audit and accountability

**Implementation status: complete (2026-07-21); backend deployed to `yallgame-ebd19`.** The audit workspace now includes operational KPIs, cursor pagination, administrator/action/entity/target/result/date filters, Public-ID-aware search, a responsive timeline table, redacted detail views with before/after summaries, links to related entities, and permission-checked CSV export capped at 1,000 rows. A 365-day retention policy is surfaced with automatic secret, token, password, authorization, and invite-code redaction. Dashboard Hosting deployment remains a separate release operation.

### Style

- Replace metadata cards with a dense audit table/timeline.
- Columns: timestamp, administrator, action, target, entity, result, and source.
- Add an expandable detail drawer showing notes and a structured before/after change summary.

### Functionality

- Cursor pagination plus filters for date range, administrator, action, entity type, target, and status.
- Search by public ID, UID, report ID, room ID, or event ID.
- Export the currently filtered result set to CSV with server-side permission checks and safe limits.
- Link events back to the related report, user, room, or catalog record.
- Define retention and redaction rules for sensitive event data.

### Exit criteria

- Every mutation introduced in earlier waves can be traced from actor to target and inspected from the audit page.

---

## Wave 6 — Settings, administrators, and authentication states

**Implementation status: complete (2026-07-21); backend deployed to `yallgame-ebd19`.** Settings is now a genuine governance center with Firebase session details, server-persisted density and notification preferences, approved feature flags, role definitions, administrator roster, existing-account role grants, role changes, removals, session revocation, last-owner/self-demotion protection, and governance history. Owner, moderator, support, catalog manager, and auditor roles are enforced at the backend request boundary and mirrored in navigation visibility. Legacy `admin: true` accounts safely migrate as owners until assigned an explicit role. Login, verification, access-denied, and loading states now use the same Arabic RTL black/aubergine/brass identity as Overview. Dashboard Hosting deployment remains a separate release operation.

### Style

- Create a real Settings page matching the Overview visual system.
- Sections: administrator profile, notifications, security, dashboard preferences, and platform configuration.
- Redesign login, verification, access-denied, and failure states using the same black/aubergine/brass identity.

### Functionality

- Administrator list and role-based permissions rather than a single undifferentiated admin claim.
- Roles such as owner, moderator, support, catalog manager, and auditor, with least-privilege capabilities.
- Invite/remove administrators and review role-change history.
- Security/session information and session revocation.
- Configurable admin notifications for urgent reports, flagged rooms, and operational failures.
- Feature-flag management only for explicitly approved flags, with validation and audit logging.
- Persist safe dashboard preferences such as density and notification choices.

### Exit criteria

- Settings has a genuine route and purpose, roles restrict both UI and backend actions, and all authentication states look like the same product.

---

## Wave 7 — Hardening and release readiness

**Implementation status: hardening complete (2026-07-21); backend deployed to `yallgame-ebd19`; final external release gate remains.** The dashboard now has route-level code splitting, enforced bundle budgets, production source maps disabled, 20-second API timeouts, one safe retry for read-only requests, consistent Arabic operational errors, no-store API headers, structured request-duration/failure logs, and a React failure boundary that records redacted operational failures. Keyboard hardening adds skip navigation, route-aware page titles, `aria-current`, focus trapping/restoration, Escape handling, nested-dialog ordering, reduced-motion support, and increased-contrast overrides. The complete automated gate passes (160 backend tests, 5 dashboard tests, TypeScript, function syntax checks, production build, and bundle budget). The remaining release gate is an authenticated browser visual regression and high-risk end-to-end pass at desktop/tablet/mobile sizes plus an explicit Dashboard Hosting deployment; local browser access is blocked by the current execution policy and Hosting has not been authorized in this workflow.

### Quality

- Full RTL visual regression checks at desktop, tablet, and mobile sizes.
- Keyboard navigation, focus management, semantic tables, accessible dialogs, and color-contrast verification.
- End-to-end tests for high-risk flows: report resolution, ban/suspension, wallet adjustment, room closure, catalog update, role change, and logout.
- Contract tests for pagination, authorization, validation, idempotency, and concurrent modification handling.
- Performance review for list queries, indexes, bundle size, and unnecessary full-page reloads.
- Arabic copy review for clarity, consistent terminology, dates, numbers, and pluralization.
- Production monitoring for API errors, failed mutations, and unusual administrative activity.

### Exit criteria

- No critical admin flow depends on raw identifiers, silent failures, unconfirmed destructive actions, or unpaginated list scans.
- The entire dashboard is visually and functionally consistent with Overview.

## Recommended delivery order

1. Wave 0 — Foundation
2. Wave 1 — Reports
3. Wave 2 — Users
4. Wave 3 — Rooms
5. Wave 4 — Store
6. Wave 5 — Audit
7. Wave 6 — Settings and roles
8. Wave 7 — Hardening

Reports comes first after the foundation because its queue, table, drawer, filters, status transitions, and audit patterns become reusable infrastructure for Users, Rooms, Store, and Audit.
