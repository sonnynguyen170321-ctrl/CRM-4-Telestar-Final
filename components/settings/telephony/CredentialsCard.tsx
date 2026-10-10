'use client';

import { useState } from 'react';

import { useToast } from '@/context/ToastContext';
import type { CredentialDto } from '@/lib/telephony/settingsNumbers';
import type { SendResult } from './useTelephonySettings';

type Props = {
  credentials: CredentialDto[];
  send: (url: string, method: 'DELETE') => Promise<SendResult<{ providerRevoked?: boolean }>>;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

/** Each rep's softphone login. Revoking stops the rep getting a token at once and deletes the provider's copy. */
export default function CredentialsCard({ credentials, send }: Props) {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (credential: CredentialDto) => {
    if (credential.status === 'active' && !window.confirm(`Revoke ${credential.userName}'s softphone access? They will not be able to call until it is reset.`)) return;
    setBusyId(credential.id);
    const result = await send(`/api/telephony/settings/credentials/${credential.id}`, 'DELETE');
    setBusyId(null);
    if (!result.ok) return showToast(result.error, 'error');
    showToast(
      result.data.providerRevoked === false
        ? 'Revoked here, but the provider could not be reached. Press "Retry at provider" later.'
        : 'Softphone access revoked',
      result.data.providerRevoked === false ? 'error' : 'success'
    );
  };

  return (
    <section aria-labelledby="credentials-heading" className="space-y-3 rounded-2xl border border-card-border bg-card-bg p-5 shadow-sm">
      <div>
        <h2 id="credentials-heading" className="type-section text-text-primary">Softphone logins</h2>
        <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary">
          A login is created the first time a rep opens the softphone. Revoke one when a laptop is lost or a rep leaves.
        </p>
      </div>
      {credentials.length === 0 ? (
        <p className="text-xs text-text-muted">Nobody has used the softphone yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Softphone logins</caption>
            <thead>
              <tr className="text-[10px] font-bold uppercase text-text-muted">
                <th scope="col" className="py-1 pr-3">Rep</th>
                <th scope="col" className="py-1 pr-3">Status</th>
                <th scope="col" className="py-1 pr-3">Last token issued</th>
                <th scope="col" className="py-1 pr-3">Last registered</th>
                <th scope="col" className="py-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id} className="border-t border-card-border">
                  <td className="py-2 pr-3 font-semibold text-text-primary">{c.userName}</td>
                  <td className="py-2 pr-3 text-text-secondary">{c.status === 'active' ? 'Active' : `Revoked ${when(c.revokedAt)}`}</td>
                  <td className="py-2 pr-3 text-text-secondary">{when(c.lastTokenAt)}</td>
                  <td className="py-2 pr-3 text-text-secondary">{when(c.lastRegisteredAt)}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => void revoke(c)}
                      className="rounded-md border border-card-border px-2 py-1 text-[11px] font-semibold text-brand-red hover:bg-card-border/30 disabled:opacity-60"
                      aria-label={`${c.status === 'active' ? 'Revoke' : 'Retry at provider for'} ${c.userName}`}
                    >
                      {c.status === 'active' ? 'Revoke' : 'Retry at provider'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
