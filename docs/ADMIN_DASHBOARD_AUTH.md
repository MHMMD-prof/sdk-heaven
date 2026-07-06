# Admin Dashboard Auth

The admin dashboard uses Firebase Auth custom claims as the only authority for admin access. Firestore documents may describe an admin user for display or audit context later, but Firestore must never grant dashboard access by itself.

## Bootstrap First Admin

Run the claim script from a trusted machine or CI job that has Firebase Admin credentials for project `yallgame-ebd19`.

```bash
npm --prefix functions run admin:claim -- --grant --email admin@example.com
```

You can also target a Firebase Auth uid:

```bash
npm --prefix functions run admin:claim -- --grant --uid firebase-auth-uid
```

After the claim is set, the user must sign in again or refresh their Firebase ID token before the dashboard can see `admin: true`.

## Revoke Admin

```bash
npm --prefix functions run admin:claim -- --revoke --uid firebase-auth-uid
```

Revocation also requires the user to refresh their token or sign in again before the claim disappears from the active client session.

## Security Rules

- Do not expose this script through a public HTTP Function.
- Do not store service account JSON, private keys, or bootstrap secrets in the Vite dashboard, Expo app, or checked-in env files.
- Preserve existing custom claims when granting or revoking admin access.
- Backend dashboard APIs must verify the caller's Firebase ID token and require `admin === true`.
