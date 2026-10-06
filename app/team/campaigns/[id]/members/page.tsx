'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import CampaignMembersManager from '@/components/campaigns/CampaignMembersManager';

/**
 * Campaign membership for a team lead, outside the admin area (which stays director and floor
 * manager only, at the edge in proxy.ts). The API scopes what a team lead may change to their own
 * pod on the campaigns they can see; this page only gives them a way in.
 */
export default function TeamCampaignMembersPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isManager, isSessionLoading } = useAppContext();

  useEffect(() => {
    if (!isSessionLoading && !isManager) router.replace('/');
  }, [isSessionLoading, isManager, router]);

  if (isSessionLoading || !isManager) return null;
  return (
    <div className="space-y-4 flex-1">
      <h1 className="font-display font-extrabold text-2xl text-text-primary">Campaign members</h1>
      <CampaignMembersManager campaignId={params.id} backHref="/team" />
    </div>
  );
}
