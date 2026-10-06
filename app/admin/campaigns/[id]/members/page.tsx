'use client';

import { useParams } from 'next/navigation';
import CampaignMembersManager from '@/components/campaigns/CampaignMembersManager';

export default function CampaignMembersPage() {
  const params = useParams<{ id: string }>();
  return <CampaignMembersManager campaignId={params.id} backHref="/admin/campaigns" />;
}
