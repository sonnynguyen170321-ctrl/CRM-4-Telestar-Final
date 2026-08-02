import React from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import ClientReportList from '@/components/client-reports/ClientReportList';

export const metadata = {
  title: 'Client Performance Reports | SalesFlow CRM',
  description: 'Manage, generate, approve, and share campaign performance report snapshots.',
};

export default async function ClientReportsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-bg-main p-6">
      <ClientReportList />
    </div>
  );
}
