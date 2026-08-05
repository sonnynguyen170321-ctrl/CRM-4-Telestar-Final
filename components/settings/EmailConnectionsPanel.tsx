'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Mail,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  isActive: boolean;
  signature?: string | null;
}

interface OAuthProviderStatus {
  configured: boolean;
  missing: string[];
}

/**
 * Email account connections for the current user — Gmail/Outlook OAuth, manual
 * IMAP/SMTP, and per-account signatures.
 *
 * Extracted from `app/settings/page.tsx` to bring that file back under the 800-line
 * cap. Behaviour is unchanged. `useSearchParams` (below, for the OAuth callback
 * toasts) needs a Suspense boundary — the page already wraps `SettingsPageInner`
 * in one, so this component must stay inside it.
 */
export default function EmailConnectionsPanel() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [providerStatus, setProviderStatus] = useState<{ gmail: OAuthProviderStatus; outlook: OAuthProviderStatus } | null>(null);
  const [connectedEmails, setConnectedEmails] = useState<EmailAccount[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpServer, setSmtpServer] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [mailPassword, setMailPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const [editingSignatureAccountId, setEditingSignatureAccountId] = useState<string | null>(null);
  const [signatureText, setSignatureText] = useState('');
  const [isSavingSignature, setIsSavingSignature] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    const success = searchParams.get('success');

    if (error === 'google_not_configured') {
      showToast('Gmail OAuth not configured — credentials missing in .env.local', 'error');
    } else if (error === 'microsoft_not_configured') {
      showToast('Outlook OAuth not configured — credentials missing in .env.local', 'error');
    } else if (error === 'google_auth_failed') {
      showToast('Google OAuth failed — check your Client ID, Secret, and redirect URI', 'error');
    } else if (error === 'google_invalid_state') {
      showToast('Google OAuth state mismatch — please try connecting again', 'error');
    } else if (error === 'google_token_exchange_failed') {
      showToast('Google token exchange failed — check your OAuth credentials', 'error');
    } else if (error === 'google_missing_refresh_token') {
      showToast('Google did not return a refresh token — remove the app grant in Google and reconnect', 'error');
    } else if (error === 'microsoft_auth_failed') {
      showToast('Microsoft OAuth failed — check your credentials and redirect URI', 'error');
    } else if (error === 'microsoft_invalid_state') {
      showToast('Microsoft OAuth state mismatch — please try connecting again', 'error');
    } else if (error === 'microsoft_token_exchange_failed') {
      showToast('Microsoft token exchange failed — check your OAuth credentials', 'error');
    } else if (error === 'microsoft_missing_refresh_token') {
      showToast('Microsoft did not return a refresh token — reconnect and confirm offline_access consent', 'error');
    } else if (error === 'microsoft_no_email') {
      showToast('Microsoft profile did not include an email address', 'error');
    } else if (success === 'gmail_connected') {
      showToast('Gmail connected successfully!', 'success');
    } else if (success === 'outlook_connected') {
      showToast('Outlook connected successfully!', 'success');
    }

    // Clean up URL params so they don't persist on refresh
    if (error || success) {
      router.replace('/settings');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch('/api/email/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setConnectedEmails(Array.isArray(data) ? data : []))
      .catch(() => showToast('Failed to load connected email accounts', 'error'));

    fetch('/api/email/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setProviderStatus(data); })
      .catch(() => {});
  }, [showToast]);

  const handleStartEditSignature = (account: EmailAccount) => {
    setEditingSignatureAccountId(account.id);
    setSignatureText(account.signature ?? '');
  };

  const handleSaveSignature = async () => {
    if (!editingSignatureAccountId) return;
    setIsSavingSignature(true);
    try {
      const res = await fetch(`/api/email/accounts/${editingSignatureAccountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: signatureText || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        setConnectedEmails((prev) =>
          prev.map((e) => (e.id === editingSignatureAccountId ? { ...e, signature: updated.signature } : e))
        );
        setEditingSignatureAccountId(null);
        setSignatureText('');
        showToast('Email signature updated!', 'success');
      } else {
        showToast('Failed to save email signature', 'error');
      }
    } catch {
      showToast('Network error saving email signature', 'error');
    } finally {
      setIsSavingSignature(false);
    }
  };

  const handleConnectGmail = () => {
    if (providerStatus && !providerStatus.gmail.configured) {
      showToast(`Gmail OAuth missing: ${providerStatus.gmail.missing.join(', ')}`, 'error');
      return;
    }
    const authUrl = `/api/email/oauth/google`;
    showToast('Redirecting to Google OAuth...', 'info');
    window.location.href = authUrl;
  };

  const handleConnectOutlook = () => {
    if (providerStatus && !providerStatus.outlook.configured) {
      showToast(`Outlook OAuth missing: ${providerStatus.outlook.missing.join(', ')}`, 'error');
      return;
    }
    const authUrl = `/api/email/oauth/microsoft`;
    showToast('Redirecting to Microsoft OAuth...', 'info');
    window.location.href = authUrl;
  };

  const handleConnectManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    const res = await fetch('/api/email/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'imap_smtp',
        email: manualEmail,
        imapHost: imapServer,
        imapPort: parseInt(imapPort),
        smtpHost: smtpServer,
        smtpPort: parseInt(smtpPort),
        password: mailPassword,
      }),
    });
    setIsConnecting(false);
    if (res.ok) {
      const created = await res.json();
      setConnectedEmails((prev) => [...prev, created]);
      setShowManualForm(false);
      setManualEmail('');
      setImapServer('');
      setImapPort('993');
      setSmtpServer('');
      setSmtpPort('465');
      setMailPassword('');
      showToast(`IMAP/SMTP connected for ${created.email}`, 'success');
    } else {
      showToast(await readApiError(res, 'Failed to connect IMAP account'), 'error');
    }
  };

  const handleDeleteEmail = async (id: string) => {
    const target = connectedEmails.find((e) => e.id === id);
    const res = await fetch(`/api/email/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setConnectedEmails((prev) => prev.filter((e) => e.id !== id));
      if (target) showToast(`Disconnected ${target.email}`, 'info');
    }
  };

  const providerLabel = (provider: string) => {
    switch (provider) {
      case 'gmail': return 'Gmail (OAuth)';
      case 'outlook': return 'Outlook / Exchange';
      case 'imap_smtp': return 'IMAP/SMTP (Roundcube)';
      default: return provider;
    }
  };

  const missingText = (status: OAuthProviderStatus) => status.missing.join(', ');

  return (
    <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
      <h2 className="type-section text-text-primary flex items-center gap-2">
        <Mail className="w-4 h-4 text-blue-500" />
        <span>Email Accounts Integration</span>
      </h2>
      <p className="text-xs text-text-secondary leading-relaxed max-w-[68ch]">
        Connect the campaign-specific mail servers. Supports Google OAuth, Microsoft Graph,
        and legacy IMAP/SMTP (Roundcube).
      </p>

      <div className="space-y-2.5">
        {connectedEmails.length === 0 && (
          <p className="text-xs text-text-muted italic">No email accounts connected yet.</p>
        )}
        {connectedEmails.map((item) => (
          <div
            key={item.id}
            className="p-3 border border-card-border rounded-xl flex items-center justify-between text-xs bg-bg-main/20"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-base flex-shrink-0">📧</span>
              <div className="min-w-0">
                <p className="font-semibold text-text-primary truncate">{item.email}</p>
                <p className="text-[10px] text-text-muted font-mono mt-0.5">
                  Connected via{' '}
                  <span className="text-brand-orange-text">{providerLabel(item.provider)}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 py-0.5 bg-green-500/10 text-green-500 text-[9px] font-bold border border-green-500/20 rounded font-mono mr-1.5">
                ACTIVE
              </span>
              <button
                onClick={() => handleStartEditSignature(item)}
                className="p-1 hover:bg-brand-orange/10 text-text-muted hover:text-brand-orange-text rounded"
                title="Edit Email Signature"
              >
                <Pencil className="w-4.5 h-4.5" />
              </button>
              <button
                onClick={() => handleDeleteEmail(item.id)}
                className="p-1 hover:bg-brand-red/10 text-text-muted hover:text-brand-red rounded"
                title="Disconnect Account"
              >
                <Trash2 className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingSignatureAccountId && (
        <div className="border border-brand-orange/20 rounded-xl p-4 bg-brand-orange/[0.01] space-y-3 animate-in fade-in duration-200 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-brand-orange-text uppercase">
              Edit Email Signature for {connectedEmails.find(e => e.id === editingSignatureAccountId)?.email}
            </h3>
            <button
              onClick={() => { setEditingSignatureAccountId(null); setSignatureText(''); }}
              className="p-1 hover:bg-card-border/60 text-text-muted hover:text-text-primary rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] text-text-secondary leading-relaxed">
              This signature will be appended to the end of all emails sent from this account (HTML supported).
            </p>
            <textarea
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
              className="w-full bg-bg-main border border-card-border rounded-xl p-3 text-text-primary focus:outline-none focus:border-brand-red h-24 placeholder-text-muted resize-none leading-relaxed font-mono text-xs"
              placeholder="Best regards,<br><b>Dean</b><br>Director"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setEditingSignatureAccountId(null); setSignatureText(''); }}
              className="px-3 py-1.5 bg-bg-main border border-card-border text-text-secondary hover:text-text-primary text-xs font-semibold rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSignature}
              disabled={isSavingSignature}
              className="px-3 py-1.5 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
            >
              {isSavingSignature ? 'Saving...' : 'Save Signature'}
            </button>
          </div>
        </div>
      )}

      {/* Provider status badges */}
      {providerStatus !== null && (
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded border font-semibold ${providerStatus.gmail.configured ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
            {providerStatus.gmail.configured ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            Gmail OAuth {providerStatus.gmail.configured ? 'configured' : 'not configured'}
          </span>
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded border font-semibold ${providerStatus.outlook.configured ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
            {providerStatus.outlook.configured ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            Outlook OAuth {providerStatus.outlook.configured ? 'configured' : 'not configured'}
          </span>
        </div>
      )}

      {/* Not-configured warning */}
      {providerStatus !== null && (!providerStatus.gmail.configured || !providerStatus.outlook.configured) && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">OAuth credentials missing</p>
            {!providerStatus.gmail.configured && (
              <p className="text-amber-400/80 font-mono text-[10px] max-w-[68ch] break-words">Gmail: set {missingText(providerStatus.gmail)} in .env.local</p>
            )}
            {!providerStatus.outlook.configured && (
              <p className="text-amber-400/80 font-mono text-[10px] max-w-[68ch] break-words">Outlook: set {missingText(providerStatus.outlook)} in .env.local</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={handleConnectGmail}
          disabled={providerStatus !== null && !providerStatus.gmail.configured}
          title={providerStatus !== null && !providerStatus.gmail.configured ? `Gmail OAuth missing: ${missingText(providerStatus.gmail)}` : undefined}
          className="px-3 py-1.5 border border-blue-500/30 hover:border-blue-500 bg-blue-500/5 hover:bg-blue-500/15 text-blue-500 text-xs font-semibold rounded-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          + Connect Gmail
        </button>
        <button
          onClick={handleConnectOutlook}
          disabled={providerStatus !== null && !providerStatus.outlook.configured}
          title={providerStatus !== null && !providerStatus.outlook.configured ? `Outlook OAuth missing: ${missingText(providerStatus.outlook)}` : undefined}
          className="px-3 py-1.5 border border-indigo-500/30 hover:border-indigo-500 bg-indigo-500/5 hover:bg-indigo-500/15 text-indigo-500 text-xs font-semibold rounded-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          + Connect Outlook
        </button>
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="px-3 py-1.5 border border-brand-orange/30 hover:border-brand-orange bg-brand-orange/5 hover:bg-brand-orange/15 text-brand-orange-text text-xs font-semibold rounded-lg transition-all active:scale-95"
        >
          + Connect Roundcube (IMAP)
        </button>
      </div>

      {showManualForm && (
        <form
          onSubmit={handleConnectManual}
          className="border border-card-border rounded-xl p-4 bg-bg-main/30 space-y-3.5 text-xs animate-in slide-in-from-top-2 duration-150"
        >
          <h3 className="font-display font-semibold text-text-primary">Manual Server Settings</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase">
                Email Address
              </label>
              <input
                type="email"
                placeholder="user@customdomain.com"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-red"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase">
                IMAP Server
              </label>
              <input
                type="text"
                placeholder="mail.domain.com"
                value={imapServer}
                onChange={(e) => setImapServer(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-red"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase">
                IMAP Port
              </label>
              <input
                type="text"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-red"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase">
                SMTP Server
              </label>
              <input
                type="text"
                placeholder="smtp.domain.com"
                value={smtpServer}
                onChange={(e) => setSmtpServer(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-red"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase">
                SMTP Port
              </label>
              <input
                type="text"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-red"
                required
              />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase">
                Password
              </label>
              <input
                type="password"
                value={mailPassword}
                onChange={(e) => setMailPassword(e.target.value)}
                className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-red"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="px-3 py-1.5 border border-card-border rounded-lg text-[10px] font-bold font-mono hover:bg-card-border/30 text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isConnecting}
              className="px-3 py-1.5 bg-brand-orange hover:bg-brand-orange-hover text-white text-[10px] font-bold font-mono rounded-lg shadow-sm disabled:opacity-60"
            >
              {isConnecting ? 'Verifying...' : 'Save and Connect'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
