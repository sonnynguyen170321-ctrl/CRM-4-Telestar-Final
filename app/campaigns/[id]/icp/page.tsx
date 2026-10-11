'use client';

import { useParams } from 'next/navigation';

import { CampaignIcpPanel } from '@/components/icp/CampaignIcpPanel';

/**
 * A campaign's ICP and scoring, for everyone who can see the campaign. What each person may do is
 * decided by the API (library ICPs are read-only for reps; a rep's own custom ICP is theirs to edit
 * and submit), so this page opens for every role and the buttons follow the server.
 */
export default function CampaignIcpPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="flex-1 space-y-4">
      <CampaignIcpPanel campaignId={params.id} backHref="/team" />
    </div>
  );
}
