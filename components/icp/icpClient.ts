import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

/** Types and calls shared by every surface that shows or edits ICPs (Automation, campaign ICP page, reviews). */

export type IcpVersionStatus = 'draft' | 'pending_review' | 'published' | 'archived';

export type IcpVersion = {
  id: string;
  versionNumber: number;
  status: IcpVersionStatus;
  rulesJson: IcpVersionRulesV2;
  updatedAt: string;
  submittedAt?: string | null;
  submittedById?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
};

export type IcpProfile = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  kind: 'library' | 'custom';
  ownerUserId: string | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  _count: { campaigns: number };
  versions: IcpVersion[];
  /** What the caller may do with this ICP, decided on the server. */
  canEdit: boolean;
  publishMode: 'publish' | 'submit' | null;
};

export type IcpTemplate = { id: string; name: string; description: string };

export type PublishOutcome = {
  outcome: 'published' | 'submitted';
  version: IcpVersion;
  campaigns: Array<{ id: string; name: string }>;
};

export async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const icpApi = {
  list: () =>
    fetch('/api/icp/profiles').then((r) =>
      readJson<{ profiles: IcpProfile[]; templates: IcpTemplate[]; canManageLibrary: boolean }>(r),
    ),
  createCustom: (body: { campaignId?: string; templateId?: string; sourceProfileId?: string; name?: string }) =>
    send('/api/icp/profiles', 'POST', { kind: 'custom', ...body }).then((r) =>
      readJson<{ profile: { id: string; name: string }; version: { id: string } }>(r),
    ),
  createLibrary: (body: { name: string; templateId?: string }) =>
    send('/api/icp/profiles', 'POST', { kind: 'library', ...body }).then((r) =>
      readJson<{ profile: { id: string } }>(r),
    ),
  startEdit: (sourceVersionId: string, acknowledgeSimplification: boolean) =>
    send('/api/icp/versions', 'POST', { sourceVersionId, acknowledgeSimplification }).then(readJson),
  saveDraft: (versionId: string, expectedUpdatedAt: string, rulesJson: IcpVersionRulesV2, acknowledgeSimplification: boolean) =>
    send(`/api/icp/versions/${versionId}`, 'PATCH', { expectedUpdatedAt, rulesJson, acknowledgeSimplification }).then(readJson),
  publish: (versionId: string, expectedUpdatedAt: string) =>
    send(`/api/icp/versions/${versionId}/publish`, 'POST', { expectedUpdatedAt }).then((r) => readJson<PublishOutcome>(r)),
  withdraw: (versionId: string) => send(`/api/icp/versions/${versionId}/withdraw`, 'POST').then(readJson),
  approve: (versionId: string) =>
    send(`/api/icp/versions/${versionId}/approve`, 'POST').then((r) =>
      readJson<{ campaigns: Array<{ id: string; name: string }> }>(r),
    ),
  reject: (versionId: string, note: string) => send(`/api/icp/versions/${versionId}/reject`, 'POST', { note }).then(readJson),
  assign: (campaignId: string, icpVersionId: string | null) =>
    send(`/api/icp/campaigns/${campaignId}`, 'PATCH', { icpVersionId }).then(readJson),
};

/** The version a profile shows by default: its open draft or version in review, else the newest published. */
export function currentVersionOf(profile: IcpProfile): IcpVersion | null {
  return (
    profile.versions.find((v) => v.status === 'draft') ??
    profile.versions.find((v) => v.status === 'pending_review') ??
    profile.versions.find((v) => v.status === 'published') ??
    null
  );
}

export function newestPublished(profile: IcpProfile): IcpVersion | null {
  return profile.versions.find((v) => v.status === 'published') ?? null;
}

export function ownerLabel(profile: Pick<IcpProfile, 'kind' | 'owner'>): string {
  if (profile.kind === 'library') return 'Shared library';
  return profile.owner ? `Custom · ${profile.owner.firstName} ${profile.owner.lastName}`.trim() : 'Custom';
}
