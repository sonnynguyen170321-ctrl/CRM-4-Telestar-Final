import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { compare } from 'bcryptjs';
import { prisma, tenantStorage } from '@/lib/prisma';
import { authConfig } from './auth.config';
import { evaluateThrottle, normalizeEmail } from '@/lib/auth/loginThrottle';
import {
  clearOnSuccess,
  clientIpFrom,
  getFailureCounts,
  recordFailure,
} from '@/lib/auth/loginThrottleStore';

/**
 * A real bcrypt hash of a value nobody can supply, used to burn the same CPU time when the
 * account does not exist. Its plaintext is irrelevant and it protects nothing — it exists
 * only so the timing of a miss matches the timing of a wrong password.
 */
const DUMMY_PASSWORD_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID || 'dummy-id',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || 'dummy-secret',
      issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/v2.0`,
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        return await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
          if (!credentials?.email || !credentials?.password) return null;

          const email = normalizeEmail(credentials.email as string);
          const ip = clientIpFrom(
            request instanceof Request ? request.headers : new Headers()
          );

          // ── Throttle ───────────────────────────────────────────────────────
          // Checked before the database is touched, so a locked-out client costs a
          // Redis read rather than a bcrypt comparison.
          const decision = evaluateThrottle(await getFailureCounts(ip, email));

          if (decision.alert) {
            // No credentials in the log, ever — scope, address and counts only.
            console.warn(
              `[login-throttle] possible credential stuffing: scope=${decision.reason ?? 'email'} ip=${ip}`
            );
          }

          if (!decision.allowed) {
            console.warn(`[login-throttle] locked: scope=${decision.reason} ip=${ip}`);
            return null;
          }

          if (decision.delayMs > 0) {
            await sleep(decision.delayMs);
          }

          const user = await prisma.user.findUnique({ where: { email } });

          // Hash a dummy password when the user is missing or inactive, so a failure
          // costs the same wall-clock time either way. Skipping the comparison would
          // make unknown addresses answer measurably faster, which is an account
          // enumeration oracle no matter how uniform the error message is.
          if (!user || !user.isActive) {
            await compare(credentials.password as string, DUMMY_PASSWORD_HASH);
            await recordFailure(ip, email);
            return null;
          }

          const passwordMatch = await compare(
            credentials.password as string,
            user.password
          );
          if (!passwordMatch) {
            await recordFailure(ip, email);
            return null;
          }

          await clearOnSuccess(ip, email);

          const reportsCount = await prisma.user.count({
            where: { managerId: user.id, isActive: true },
          });

          return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            isManager: reportsCount > 0 || ['director', 'floor_manager', 'team_lead'].includes(user.role),
            tenantId: user.tenantId,
            // Stamped into the JWT so `getSessionUser` can reject it once the row moves on.
            authVersion: user.authVersion,
          };
        });
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      return await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
        if (account?.provider === 'microsoft-entra-id') {
          if (!user.email) return false;

          const existingUser = await prisma.user.findUnique({
            where: { email: user.email },
          });

          if (!existingUser || !existingUser.isActive) {
            return false;
          }
        }
        return true;
      });
    },
    async jwt({ token, user, account }) {
      return await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
        if (user) {
          if (account?.provider === 'microsoft-entra-id' && user.email) {
            const dbUser = await prisma.user.findUnique({
              where: { email: user.email },
            });
            if (dbUser) {
              const reportsCount = await prisma.user.count({
                where: { managerId: dbUser.id, isActive: true },
              });
              token.id = dbUser.id;
              token.firstName = dbUser.firstName;
              token.lastName = dbUser.lastName;
              token.role = dbUser.role;
              token.isManager = reportsCount > 0 || ['director', 'floor_manager', 'team_lead'].includes(dbUser.role);
              token.tenantId = dbUser.tenantId;
              token.authVersion = dbUser.authVersion;
              return token;
            }
          }
          token.id = user.id;
          token.firstName = (user as any).firstName;
          token.lastName = (user as any).lastName;
          token.role = (user as any).role;
          token.isManager = (user as any).isManager;
          token.tenantId = (user as any).tenantId;
          token.authVersion = (user as any).authVersion;
        }
        return token;
      });
    },
  },
});

