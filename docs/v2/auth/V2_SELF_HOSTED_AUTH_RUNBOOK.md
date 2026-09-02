# V2 Self-Hosted Auth Runbook

V2 now uses local email/password auth for VPS, Hostinger, and AWS deployments. Auth0 is not required.

## Required env

Set these on the web app process:

```env
V2_AUTH_SECRET=
V2_AUTH_COOKIE_NAME=v2_session
V2_AUTH_SESSION_DAYS=14
```

Generate `V2_AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Store it as a server-side secret. Rotating it invalidates existing sessions and password pepper verification for existing hashes, so rotate only with a planned password reset.

## Create the first user

Run from the deployed app directory after migrations are applied:

```bash
npm run v2:signup -- --email owner@example.com --name "Owner" --org "TeleStar" --role OWNER
```

If `--password` is omitted, the CLI prints a temporary password once. Use that password at `/v2/login`, then reset by running the same command with `--reset-password --password "new-password"`.

## Runtime model

- `V2UserCredential` stores salted `scrypt` password hashes only.
- `V2AuthSession` stores HMAC hashes of opaque cookie tokens only.
- The browser cookie is `HttpOnly`, `SameSite=Lax`, and secure in production/HTTPS.
- `/v2/logout` revokes the current DB session and clears the cookie.
- V2 tenant isolation still comes from `requireTenantContext()` and active `V2OrganizationMembership` rows.

## Operational notes

- Do not create public self-signup until tenant/billing/anti-abuse policy is decided.
- Disable a user by setting `V2User.status` to `DISABLED`; tenant access will fail.
- Revoke sessions by setting `V2AuthSession.revokedAt`.
- Keep `/v2/outreach/drain`, `/v2/outreach/imap-poll`, and `/v2/outreach/track/*` public to the user-session gate; they have their own worker/tracking protections.