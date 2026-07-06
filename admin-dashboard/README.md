# Admin Dashboard

Standalone Vite React website for trusted app administration. This package is intentionally separate from the Expo mobile app.

## Setup

Create `admin-dashboard/.env.local` using `admin-dashboard/.env.example`. Only use public Firebase web config values with `VITE_` names. Do not put service account credentials, private keys, LiveKit secrets, or admin bootstrap secrets in this package.

## Scripts

```bash
npm --prefix admin-dashboard install
npm --prefix admin-dashboard run dev
npm --prefix admin-dashboard run typecheck
npm --prefix admin-dashboard run build
```

The signed-in Firebase user must have the `admin: true` custom claim. Use the trusted Functions script documented in `docs/ADMIN_DASHBOARD_AUTH.md` to grant or revoke that claim.
