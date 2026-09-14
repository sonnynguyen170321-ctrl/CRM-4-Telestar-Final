import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

// Edge-compatible auth config — no Prisma, no bcrypt.
// Used by proxy.ts to validate JWT tokens without importing heavy Node.js modules.
// The full credentials provider (with Prisma) lives in auth.ts.
/**
 * How long a signed-in session stays valid.
 *
 * Auth.js defaults to 30 days, which for a CRM holding a company's whole pipeline is a long time
 * for a laptop left on a train to keep working. Seven days rolling is short enough to matter and
 * long enough that staff are not re-authenticating mid-week; `updateAge` refreshes the token at
 * most once a day so active users are never interrupted.
 *
 * `jwt.maxAge` is set to the same value on purpose. With the JWT strategy the token is the
 * session, and leaving them to drift apart means one of the two silently wins.
 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  // No `cookies` block on purpose.
  //
  // It is tempting to declare httpOnly/secure/sameSite explicitly for auditability, but Auth.js
  // already sets exactly those — `httpOnly: true, sameSite: 'lax', path: '/', secure` when the
  // site URL is HTTPS — and it derives the `__Secure-` / `__Host-` cookie-name prefixes from the
  // same signal. Restating the options means restating the names, and a name that disagrees with
  // what the browser already holds signs every user out at deploy. The explicit block would buy
  // no security and carry that risk, so the defaults stand and this comment is the audit trail.
  pages: { signIn: '/login' },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID || 'dummy-id',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || 'dummy-secret',
      issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/v2.0`,
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.firstName = (user as any).firstName;
        token.lastName = (user as any).lastName;
        token.role = (user as any).role;
        token.isManager = (user as any).isManager;
        token.tenantId = (user as any).tenantId;
        token.authVersion = (user as any).authVersion;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as any).firstName = token.firstName;
        (session.user as any).lastName = token.lastName;
        (session.user as any).role = token.role;
        (session.user as any).isManager = token.isManager;
        (session.user as any).tenantId = token.tenantId;
        // Carried through so `getSessionUser` can compare it against the row. The middleware
        // in proxy.ts is edge-side and cannot reach the database — it only checks that a token
        // exists. Revocation is enforced server-side, not here.
        (session.user as any).authVersion = token.authVersion;
      }
      return session;
    },
  },
};
