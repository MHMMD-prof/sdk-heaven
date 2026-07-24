# Representative WebView Wave 3 portal

## Outcome

Wave 3 adds the standalone `representative-portal/` web application. It is separate from both the Expo application and the admin dashboard. It is not registered as the existing Firebase Hosting target, because that target currently serves the admin dashboard and Codex must never deploy that dashboard.

The portal remains undeployed. `representativeTransfers` remains disabled. Wave 4 will add the Expo SDK 56 WebView shell only after a fixed HTTPS portal origin and endpoint are available.

## Runtime configuration

The build accepts one public, non-secret variable:

```text
VITE_REPRESENTATIVE_PORTAL_API_URL=https://us-central1-PROJECT.cloudfunctions.net/representativePortal
```

The client rejects malformed endpoint URLs, remote HTTP, embedded credentials, and fragments. HTTP loopback endpoints are accepted only by Vite development builds.

No Firebase configuration, ID token, account password, internal UID, PIN, proof, session, wallet balance, or administrative value is compiled from environment variables.

## Bootstrap and session

The mobile application will open the fixed portal with a one-time bootstrap ticket in `#ticket=...`. The portal:

1. accepts only an exact 43-character opaque ticket and no additional fragment fields;
2. removes the fragment from browser history before starting the exchange;
3. exchanges the ticket once through the fixed portal endpoint;
4. stores the resulting 15-minute bearer session only in a React ref;
5. never writes the ticket or session to local storage, session storage, cookies, URLs, logs, analytics, receipts, or bridge messages;
6. polls authoritative status every 15 seconds and whenever the document becomes visible;
7. clears its in-memory credential on expiry, feature disablement, privilege loss, origin denial, or explicit close.

The portal uses `cache: no-store`, `credentials: omit`, `redirect: error`, and `referrerPolicy: no-referrer` for every request. Requests have an abort timeout.

## Transfer flow

The UI follows the frozen state order:

```text
bootstrapping
  → recipient-entry
  → verifying
  → verified
  → review
  → pin-challenge
  → submitting
  → completed
```

`failed`, `locked`, and `unavailable` are explicit terminal or recovery presentations.

- Editing the normal seven-digit recipient ID immediately clears the preview proof, amount, and request ID.
- Currency choices are rendered from current server-granted permissions.
- Amount entry accepts only ASCII whole-number digits. Formatted or decimal paste is rejected rather than silently changed.
- Quick amounts are non-binding helpers and are disabled above the current balance.
- Review shows the recipient, amount, current balance, resulting balance, and remaining daily allowance.
- The representative must confirm that the external consideration was already collected. The UI states that the application receipt is not proof of external payment.
- Every submission requires the six-digit transfer PIN.
- A synchronous in-memory lock plus reducer state prevents two active submissions.
- Wrong PIN stays in the challenge; server lockout becomes the locked screen; expired proofs return to recipient verification; session/feature errors close the authorization path.
- Successful completion refreshes the mobile wallet through the minimal bridge and allows a new transfer only with a new proof and request ID.

PIN setup and reset-required states are presented inside the portal. The backend still requires the portal session to originate from fresh Firebase authentication. `FRESH_AUTH_REQUIRED` sends the user back through the application instead of weakening that requirement.

## History and receipts

The portal shows the representative's latest safe receipt projections and an accessible receipt-detail sheet.

Shareable receipt text and PNG contain only:

- public receipt reference;
- recipient display-name snapshot;
- recipient normal seven-digit public ID;
- currency and amount;
- completion date;
- the virtual-delivery-only disclaimer.

They omit balances, internal UIDs, device information, PIN state, proof/session values, limit state, IP information, and administrator data. The PNG renderer includes a fallback for older Android WebViews without `CanvasRenderingContext2D.roundRect`.

## Native bridge

All bridge messages are versioned and exact-schema:

- `close`;
- `session-expired`;
- `feature-disabled`;
- `refresh-balance`;
- `receipt-share` with bounded safe text and an optional bounded PNG data URL.

Unknown versions, types, fields, non-PNG payloads, empty text, and oversized payloads are rejected. No bridge message carries a ticket, portal session, PIN, proof, internal UID, or private balance.

## Design and accessibility

The portal uses the project's black, aubergine, ruby, brass, and cream design language without changing the global mobile navigation. It includes:

- Arabic `lang` plus document-level RTL;
- safe-area padding and dynamic viewport units;
- layouts for 420 px and 350 px widths;
- reduced-motion support;
- visible keyboard focus;
- labelled controls and dialogs;
- numeric keyboard hints, exact maximum lengths, enter-key hints, and autocomplete semantics;
- live status/error regions;
- disabled controls while offline, invalid, or submitting.

## Local development

Commands:

```text
npm run portal:dev
npm run portal:test
npm run portal:build
npm run portal:verify
```

`representative-portal/scripts/mockPortalServer.mjs` is a local-only deterministic fixture. It is not imported by the production application or included in the production bundle. Its demonstration PIN and opaque values are fixtures, not credentials.

The bundle uses relative asset paths so it can be mounted under a dedicated portal path or hosted on a separate site. Production hosting must apply no-store HTML, strict transport security, no-referrer, no-sniff, a restrictive permissions policy, and a CSP that permits only the fixed Functions endpoint. Do not point the existing admin-dashboard hosting target at the portal.

## Verification

Wave 3 completed these gates on 2026-07-24:

- portal TypeScript passed;
- 6 portal test files and all 20 portal tests passed;
- the standalone Vite production build passed;
- the full non-emulator repository suite passed: 92 files and 578 tests;
- root TypeScript passed;
- Functions syntax/lint passed;
- static tests cover document RTL, numeric keyboards, exact input lengths, accessible dialog semantics, narrow screens, safe areas, and reduced motion;
- behavior tests cover fragment removal, endpoint security, in-memory bearer use, no-store requests, recipient edits, expired proofs, backend limits, duplicate taps, PIN errors/lockout, session expiry, feature shutdown, exact bridge schemas, and safe receipt sharing.

The in-app browser security policy did not permit opening local-file or self-contained data URLs, and the sandbox terminated local background servers. Therefore visual browser automation could not be completed in this environment. Source-level responsive/accessibility checks and the production bundle passed; an interactive small-screen browser pass remains required before deployment.

No component was deployed and no feature flag was enabled.

## Wave 4 boundary

Wave 4 must install the Expo SDK 56-compatible WebView package through `npx expo install`, replace the inert native representative form, validate the fixed portal origin and all navigations, pass only the one-time fragment ticket, validate every bridge message again on the native side, clear the WebView on terminal states, and preserve the global bottom navigation.
