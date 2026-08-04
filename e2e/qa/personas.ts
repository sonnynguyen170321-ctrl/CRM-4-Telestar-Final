/**
 * Shared persona + route constants for the parallel QA lane run.
 *
 * Throwaway QA scaffolding — not part of the committed e2e suite.
 *
 * Roster verified against the DB after `prisma/seed.ts` + the dominic promotion.
 * Seed does NOT create a leadgen_manager (seed.ts:227 sets dominic to `leadgen`);
 * preflight promotes him via scripts/create-user.ts.
 */

/** Every seeded user shares this password — prisma/seed.ts:50. */
export const PASSWORD = 'telestar2026';

/**
 * Lane ownership is encoded here on purpose: lanes run concurrently against one
 * shared dev server, so each write-heavy lane must stick to its own SDR.
 */
export const PERSONAS = {
  director: 'dean@telestar.vn',
  floorManager: 'sonny@telestar.vn',
  floorManagerAlt: 'alayna@telestar.vn',
  teamLead: 'brandon@telestar.vn',

  sdrLaneD: 'lan.pham@telestar.vn',
  sdrLaneE: 'david.miller@telestar.vn',
  sdrLaneF: 'vy.hoang@telestar.vn',
  sdrSpare: 'carlos.reyes@telestar.vn',

  leadgenManager: 'dominic@telestar.vn',
  leadgen: 'alex@telestar.vn',
  leadgenAlt: 'priya@telestar.vn',
} as const;

export type PersonaKey = keyof typeof PERSONAS;

/** Role of each persona, for asserting what the session actually resolves to. */
export const PERSONA_ROLE: Record<PersonaKey, string> = {
  director: 'director',
  floorManager: 'floor_manager',
  floorManagerAlt: 'floor_manager',
  teamLead: 'team_lead',
  sdrLaneD: 'sdr',
  sdrLaneE: 'sdr',
  sdrLaneF: 'sdr',
  sdrSpare: 'sdr',
  leadgenManager: 'leadgen_manager',
  leadgen: 'leadgen',
  leadgenAlt: 'leadgen',
};

/**
 * Routes that actually exist (verified against app/). The source QA doc names
 * several that do not — /dashboard, /performance, /admin index, and an AI
 * Assistant route. Those are absent by design, not bugs to re-file.
 */
export const ROUTES = {
  dashboard: '/',
  login: '/login',
  leads: '/leads',
  meetings: '/meetings',
  opportunities: '/opportunities',
  clientReports: '/client-reports',
  inbox: '/inbox',
  sequences: '/sequences',
  sequencePerformance: '/sequences/performance',
  templates: '/templates',
  team: '/team',
  automation: '/automation',
  emailHealth: '/email-health',
  settings: '/settings',
  director: '/director',
  adminJobs: '/admin/jobs',
  adminOutbound: '/admin/outbound',
  adminImports: '/admin/imports',
  adminWorkerHealth: '/admin/worker-health',
  leadgenManager: '/leadgen-manager',
  leadgen: '/leadgen',
} as const;

/** /leadgen-manager is one route with 7 ?tab= values — app/leadgen-manager/page.tsx:25-33. */
export const LEADGEN_MANAGER_TABS = [
  'overview',
  'pool',
  'qualify',
  'routing',
  'export',
  'team',
  'sources',
] as const;

/**
 * Routes each role should be denied. `edge` = blocked in proxy.ts before HTML is
 * sent. `client` = a useEffect guard that redirects after render, which can leak
 * a frame of real content — worth screenshotting when it does.
 */
export const DENIED: Record<string, { path: string; guard: 'edge' | 'client' }[]> = {
  sdr: [
    { path: ROUTES.adminJobs, guard: 'edge' },
    { path: ROUTES.adminOutbound, guard: 'edge' },
    { path: ROUTES.director, guard: 'client' },
    { path: ROUTES.team, guard: 'client' },
    { path: ROUTES.leadgenManager, guard: 'client' },
  ],
  leadgen: [
    { path: ROUTES.adminJobs, guard: 'edge' },
    { path: ROUTES.director, guard: 'client' },
    { path: ROUTES.team, guard: 'client' },
    { path: ROUTES.leadgenManager, guard: 'client' },
  ],
  leadgen_manager: [
    { path: ROUTES.adminJobs, guard: 'edge' },
    { path: ROUTES.director, guard: 'client' },
  ],
  team_lead: [
    { path: ROUTES.adminJobs, guard: 'edge' },
    { path: ROUTES.director, guard: 'client' },
  ],
};
