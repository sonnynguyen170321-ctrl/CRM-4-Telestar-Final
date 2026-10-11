/**
 * A published shared ICP to put on a new campaign.
 *
 * Creating a campaign requires an ICP (a campaign with none is not scored), so every spec that
 * creates one needs a published library version to point at. The audit fixture and the demo seed do
 * not promise one, so this finds the template ICP and, if the tenant has none, makes and publishes
 * one through the same routes the UI uses. Call it as a director or floor manager: only they may
 * author the shared library.
 */
import type { APIRequestContext } from '@playwright/test';

type RequestOptions = { headers?: Record<string, string> };

export async function ensureLibraryIcpVersionId(
  api: APIRequestContext,
  options: RequestOptions = {}
): Promise<string> {
  const listed = await api.get('/api/icp/versions', options);
  if (listed.ok()) {
    const versions = ((await listed.json()).versions ?? []) as Array<{
      id: string;
      icpProfile?: { isDefault?: boolean };
    }>;
    const preferred = versions.find((v) => v.icpProfile?.isDefault) ?? versions[0];
    if (preferred) return preferred.id;
  }

  const library = await api.get('/api/icp/profiles', options);
  if (!library.ok()) throw new Error(`Cannot read ICPs (${library.status()})`);
  const templates = ((await library.json()).templates ?? []) as Array<{ id: string }>;
  const created = await api.post('/api/icp/profiles', {
    ...options,
    data: {
      kind: 'library',
      name: `PW_E2E_ICP_${Date.now().toString(36)}`,
      templateId: templates[0]?.id,
    },
  });
  if (!created.ok()) throw new Error(`Cannot create the e2e ICP (${created.status()}): ${await created.text()}`);
  const { version } = (await created.json()) as { version: { id: string; updatedAt: string } };
  const published = await api.post(`/api/icp/versions/${version.id}/publish`, {
    ...options,
    data: { expectedUpdatedAt: version.updatedAt },
  });
  if (!published.ok()) throw new Error(`Cannot publish the e2e ICP (${published.status()}): ${await published.text()}`);
  return version.id;
}

export const libraryIcp = (icpVersionId: string) => ({ mode: 'library' as const, icpVersionId });
