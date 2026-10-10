import type { TelephonyPayload } from './useTelephonySettings';

/** The switches that live in the server environment: shown, not editable, and never with a value. */
export default function DeploymentCard({ deployment }: { deployment: TelephonyPayload['deployment'] }) {
  const rows: Array<[string, string]> = [
    ['TELEPHONY_ENABLED', deployment.enabledFlag ? 'On' : 'Off: no one can call, whatever is set below'],
    ['TELEPHONY_DRY_RUN', deployment.dryRunFlag ? 'Dry run: calls are checked and recorded, none is placed' : 'Live: real calls are placed'],
    [
      'Provider variables',
      deployment.configured ? 'All configured' : `Missing: ${deployment.missing.join(', ')}`,
    ],
  ];
  return (
    <section aria-labelledby="deployment-heading" className="rounded-2xl border border-card-border bg-card-bg p-5 shadow-sm">
      <h2 id="deployment-heading" className="type-section text-text-primary">Server switches</h2>
      <p className="mt-1 text-xs text-text-muted">Set by whoever runs the server. Read-only here; values are never shown.</p>
      <dl className="mt-3 space-y-2 text-xs">
        {rows.map(([name, state]) => (
          <div key={name} className="flex flex-wrap gap-x-3">
            <dt className="w-44 shrink-0 font-mono font-semibold text-text-muted">{name}</dt>
            <dd className="text-text-primary">{state}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs font-semibold text-text-primary">
        {deployment.demoTenant
          ? 'This is a demo workspace: it never dials.'
          : deployment.effectiveEnabled
            ? 'The server allows calling for this team (the team settings below still apply).'
            : 'The server does not allow calling for this team yet.'}
      </p>
    </section>
  );
}
