'use client';

import React, { useEffect, useState } from 'react';
import { FlaskConical, MailX } from 'lucide-react';

/**
 * A quiet reassurance in the header: this is the demo tenant, and mail is not going anywhere.
 *
 * Renders nothing at all outside the demo tenant, so a real deployment never shows it. It is
 * informational, not a warning — an alarming banner over a customer demo undermines the exact
 * confidence it should be building.
 */

interface Environment {
  isDemoTenant: boolean;
  emailDryRun: boolean;
}

export default function EnvironmentBadge() {
  const [env, setEnv] = useState<Environment | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/demo/environment')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (!cancelled && body) setEnv(body); })
      .catch(() => { /* the badge is decoration; its absence must never break the header */ });
    return () => { cancelled = true; };
  }, []);

  if (!env?.isDemoTenant) return null;

  return (
    <div className="flex items-center gap-1.5" data-testid="demo-environment">
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 type-micro whitespace-nowrap"
        title="Isolated demo tenant. npm run demo:reset only touches this tenant's rows."
      >
        <FlaskConical className="w-3 h-3" aria-hidden="true" />
        Demo environment
      </span>
      {env.emailDryRun && (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-card-border bg-gray-50 text-text-secondary type-micro whitespace-nowrap"
          title="EMAIL_SEND_DRY_RUN is on. Outbound messages are recorded end to end but never reach a provider."
          data-testid="email-dry-run"
        >
          <MailX className="w-3 h-3" aria-hidden="true" />
          Email dry run
        </span>
      )}
    </div>
  );
}
