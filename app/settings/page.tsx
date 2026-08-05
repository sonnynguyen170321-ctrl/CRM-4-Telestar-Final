'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Mail,
  Key,
  Globe,
  Trash2,
  Loader2,
  Users,
  X,
  Bell,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import TeamAccountsPanel from '@/components/settings/TeamAccountsPanel';
import BookingLinkSettingsPanel from '@/components/meetings/BookingLinkSettingsPanel';
import { NOTIF_EVENTS, NOTIF_PREFS_KEY, NOTIF_PREFS_EVENT, readNotifPrefs } from '@/lib/notifications/prefs';
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

// useSearchParams() requires a Suspense boundary for static prerendering
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { currentRole, currentUser } = useAppContext();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [providerStatus, setProviderStatus] = useState<{ gmail: OAuthProviderStatus; outlook: OAuthProviderStatus } | null>(null);

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

  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileTimezone, setProfileTimezone] = useState('Asia/Ho_Chi_Minh');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [connectedEmails, setConnectedEmails] = useState<EmailAccount[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpServer, setSmtpServer] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [mailPassword, setMailPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  // Notification prefs — persisted to localStorage, consumed by the Topbar bell (NOTIF_EVENTS shared).
  const [defaultLeadView, setDefaultLeadView] = useState<'kanban' | 'table'>('kanban');
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});

  const [editingSignatureAccountId, setEditingSignatureAccountId] = useState<string | null>(null);
  const [signatureText, setSignatureText] = useState('');
  const [isSavingSignature, setIsSavingSignature] = useState(false);

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

  useEffect(() => {
    const savedView = localStorage.getItem('crm:defaultLeadView');
    if (savedView === 'kanban' || savedView === 'table') setDefaultLeadView(savedView);

    const savedItems = parseInt(localStorage.getItem('crm:itemsPerPage') ?? '25', 10);
    if ([25, 50, 100].includes(savedItems)) setItemsPerPage(savedItems);

    setNotifPrefs(readNotifPrefs());
  }, []);
  const isNotifEnabled = (key: string) => notifPrefs[key] !== false;
  const toggleNotif = (key: string, always: boolean) => {
    if (always) return;
    setNotifPrefs((prev) => {
      const next = { ...prev, [key]: !isNotifEnabled(key) };
      if (typeof window !== 'undefined') {
        localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(NOTIF_PREFS_EVENT));
      }
      return next;
    });
  };

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setProfileFirstName(data.firstName ?? '');
          setProfileLastName(data.lastName ?? '');
          setProfileTimezone(data.timezone ?? 'Asia/Ho_Chi_Minh');
          setProfileAvatarUrl(data.avatarUrl ?? '');
        }
      })
      .catch(() => {});

    fetch('/api/email/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setConnectedEmails(Array.isArray(data) ? data : []))
      .catch(() => showToast('Failed to load connected email accounts', 'error'));

    fetch('/api/email/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setProviderStatus(data); })
      .catch(() => {});
  }, [showToast]);

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: profileFirstName, lastName: profileLastName, timezone: profileTimezone, avatarUrl: profileAvatarUrl }),
    });
    setIsSavingProfile(false);
    if (res.ok) {
      // Let the Topbar avatar update without a reload.
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('crm:profile-updated'));
      showToast('Profile updated successfully!', 'success');
    } else {
      showToast(await readApiError(res, 'Failed to update profile'), 'error');
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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }
    setIsChangingPassword(true);
    const res = await fetch('/api/settings/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setIsChangingPassword(false);
    if (res.ok) {
      showToast('Password updated', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      showToast(await readApiError(res, 'Failed to change password'), 'error');
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
    <div className="space-y-6 flex-1 flex flex-col animate-in fade-in duration-200">
      <div>
        <h1 className="font-display font-extrabold text-2xl text-text-primary tracking-tight">
          Workspace Settings
        </h1>
        <p className="text-xs text-text-secondary mt-0.5 prose-measure">
          Configure profile settings, connect campaign email servers, and manage user pods.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6 items-start">
        {/* Personal Profile & Email Connections */}
        <div className="col-span-2 space-y-6">
          {/* Profile Card */}
          <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="type-section text-text-primary flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand-orange-text" />
              <span>Personal Profile</span>
            </h2>
            <div className="flex items-center gap-3">
              {profileAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileAvatarUrl} alt="Your avatar" className="w-12 h-12 rounded-full object-cover border border-card-border flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-brand-red/10 text-brand-red flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {(profileFirstName?.[0] ?? currentUser?.email?.[0] ?? '?').toUpperCase()}
                </div>
              )}
              <div className="flex-1 space-y-1 text-xs">
                <label className="text-[10px] font-bold text-text-muted uppercase block">Avatar URL</label>
                <input
                  type="url"
                  value={profileAvatarUrl}
                  onChange={(e) => setProfileAvatarUrl(e.target.value)}
                  placeholder="https://…/avatar.png  (leave blank to use initials)"
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red font-medium"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase block">
                  First Name
                </label>
                <input
                  type="text"
                  value={profileFirstName}
                  onChange={(e) => setProfileFirstName(e.target.value)}
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase block">
                  Last Name
                </label>
                <input
                  type="text"
                  value={profileLastName}
                  onChange={(e) => setProfileLastName(e.target.value)}
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase block">
                  Work Email
                </label>
                <input
                  type="email"
                  defaultValue={currentUser?.email ?? ''}
                  disabled
                  className="w-full bg-card-border/30 border border-transparent rounded-lg px-2.5 py-1.5 text-text-muted cursor-not-allowed font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase block">
                  Timezone
                </label>
                <select
                  value={profileTimezone}
                  onChange={(e) => setProfileTimezone(e.target.value)}
                  className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none"
                >
                  <option value="Asia/Ho_Chi_Minh">Asia/Ho Chi Minh (GMT+7)</option>
                  <option value="Europe/London">Europe/London (GMT+1)</option>
                  <option value="America/New_York">America/New York (GMT-5)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60"
              >
                {isSavingProfile && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                Save Profile
              </button>
            </div>
          </div>

          {/* Display Preferences */}
          <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="type-section text-text-primary flex items-center gap-2">
              <Globe className="w-4 h-4 text-indigo-400" />
              <span>Display Preferences</span>
            </h2>
            <div className="space-y-4 text-xs">
              {/* Default pipeline view */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-text-primary">Default Pipeline View</p>
                  <p className="text-[10px] text-text-muted font-mono mt-0.5">Saved to this browser</p>
                </div>
                <div className="flex bg-card-border rounded-lg p-0.5 gap-0.5">
                  {(['kanban', 'table'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setDefaultLeadView(mode);
                        if (typeof window !== 'undefined') localStorage.setItem('crm:defaultLeadView', mode);
                      }}
                      className={`px-3 py-1 rounded text-[10px] font-bold font-mono capitalize transition-all ${defaultLeadView === mode ? 'bg-brand-red text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items per page */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-text-primary">Leads Per Page</p>
                  <p className="text-[10px] text-text-muted font-mono mt-0.5">Table view row limit</p>
                </div>
                <div className="flex bg-card-border rounded-lg p-0.5 gap-0.5">
                  {([25, 50, 100] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setItemsPerPage(n);
                        if (typeof window !== 'undefined') localStorage.setItem('crm:itemsPerPage', String(n));
                      }}
                      className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all ${itemsPerPage === n ? 'bg-brand-red text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-text-muted font-mono border-t border-card-border/50 pt-3">
                Telestar uses a single light theme, tuned for speed and all-day readability.
              </p>
            </div>
          </div>

          {/* Security — Change Password */}
          <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="type-section text-text-primary flex items-center gap-2">
              <Key className="w-4 h-4 text-brand-orange-text" />
              <span>Security</span>
            </h2>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-muted uppercase block">Current Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-text-muted uppercase block">New Password</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="8+ characters"
                      className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-text-muted uppercase block">Confirm New Password</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60"
                >
                  {isChangingPassword && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                  Update Password
                </button>
              </div>
            </form>
          </div>

          {/* Email Account Connections */}
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

          {/* Booking Links (Director / Floor Manager / Team Lead) */}
          {(currentRole === 'director' || currentRole === 'floor_manager' || currentRole === 'team_lead') && (
            <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
              <BookingLinkSettingsPanel />
            </div>
          )}
        </div>

        {/* Notification Preferences */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
          <h2 className="type-section text-text-primary flex items-center gap-2">
            <Bell className="w-4 h-4 text-brand-gold-text" />
            <span>Notification Preferences</span>
          </h2>
          <p className="text-[11px] text-text-muted font-mono">Toggle which events trigger in-app notifications. "Always on" events cannot be disabled.</p>
          <div className="space-y-2">
            {NOTIF_EVENTS.map(({ key, label, always }) => {
              const enabled = isNotifEnabled(key);
              return (
                <div key={key} className="flex items-center justify-between py-1.5 border-b border-card-border/40 last:border-0">
                  <div>
                    <span className="text-xs text-text-primary font-medium">{label}</span>
                    {always && <span className="ml-2 text-[9px] font-mono text-brand-gold-text bg-brand-gold/10 px-1.5 py-0.5 rounded">Always on</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleNotif(key, always)}
                    disabled={always}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-70 ${enabled ? 'bg-brand-red' : 'bg-card-border'}`}
                    aria-pressed={enabled}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Leadgen account assignment.
            User, campaign, client and team management moved to /admin (Admin
            Control Center). Leadgen roles are blocked from /admin by proxy.ts,
            so this panel remains their only route to account assignment. */}
        {(currentRole === 'leadgen_manager' || currentRole === 'leadgen') && (
          <div className="bg-card-bg border border-card-border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="type-section text-text-primary flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-red" />
              <span>Team &amp; Accounts</span>
            </h2>
            <TeamAccountsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
