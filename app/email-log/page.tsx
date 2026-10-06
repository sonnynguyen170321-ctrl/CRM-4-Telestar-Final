'use client';

import EmailLogTable from '@/components/email/EmailLogTable';

/**
 * Email Log: every outbound email the viewer can see — sent, waiting, not sent, bounced — with why,
 * and filters to track it (owner, 2026-10-06). Each sequence has the same table under its Sends tab.
 */
export default function EmailLogPage() {
  return (
    <div className="space-y-6 flex-1">
      <div className="page-hero">
        <h1 className="font-display font-extrabold text-2xl text-text-primary">Email Log</h1>
        <p className="text-sm text-text-muted mt-0.5 prose-measure">
          Every email sent or attempted for the leads you can see, with the reason when one did not go out.
        </p>
      </div>
      <EmailLogTable />
    </div>
  );
}
