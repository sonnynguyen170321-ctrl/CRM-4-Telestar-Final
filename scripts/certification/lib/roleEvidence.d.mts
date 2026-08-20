/**
 * Types for `roleEvidence.mjs`.
 *
 * The module is `.mjs` because the certification tooling runs under plain node with no build
 * step - it has to work when nothing else does. The declarations live here so consumers,
 * including its own test, still get checked.
 */

export declare const REQUIRED_ROLES: readonly string[];

export interface RoleNavigation {
  path: string;
  ok: boolean;
  status: number | null;
}

export interface RoleObservation {
  role: string;
  loginOk: boolean;
  landingPath: string | null;
  navigations: RoleNavigation[];
  allowedWorkflow: { name: string; ok: boolean; status?: number } | null;
  forbiddenWorkflow: { name: string; blocked: boolean; status: number | null } | null;
  objectAuthorization: { attempted: boolean; denied: boolean; status: number | null } | null;
  consoleErrors: string[];
  networkFailures: string[];
  screenshot: string | null;
  trace: string | null;
}

export interface RoleVerdict {
  status: 'PASS' | 'FAIL';
  reasons: string[];
  landingPath: string | null;
  navigations: number;
  allowedWorkflow: string | null;
  forbiddenWorkflow: string | null;
  consoleErrors: number;
  networkFailures: number;
  consoleErrorSamples: string[];
  networkFailureSamples: string[];
  screenshot: string | null;
  trace: string | null;
}

export interface EvidenceArtifact {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface RoleBrowserEvidence {
  evidenceId: 'EV-ROLE-BROWSER';
  kind: 'role-browser';
  candidateSha: string;
  environment: string;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  status: 'PASS' | 'FAIL';
  metrics: {
    requiredRoles: readonly string[];
    observedRoles: string[];
    missingRoles: string[];
    failingRoles: string[];
    roles: Record<string, RoleVerdict>;
  };
  artifacts: EvidenceArtifact[];
}

export declare function buildRoleBrowserEvidence(
  observations: Array<Partial<RoleObservation> & { role: string }>,
  meta: {
    candidateSha: string;
    environment: string;
    startedAt: string;
    finishedAt: string;
    command?: string;
  },
): RoleBrowserEvidence;
