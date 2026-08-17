'use client';

import { useState, useEffect, Suspense } from 'react';
import {
  Key,
  Globe,
  Loader2,
  Users,
  Bell,
} from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import TeamAccountsPanel from '@/components/settings/TeamAccountsPanel';
import EmailConnectionsPanel from '@/components/settings/EmailConnectionsPanel';
import BookingLinkSettingsPanel from '@/components/meetings/BookingLinkSettingsPanel';
import DeveloperApiKeysPanel from '@/components/settings/DeveloperApiKeysPanel';
import { NOTIF_EVENTS, NOTIF_PREFS_KEY, NOTIF_PREFS_EVENT, readNotifPrefs } from '@/lib/notifications/prefs';
import { readApiError } from '@/lib/api/client';

// EmailConnectionsPanel calls useSearchParams(), which requires a Suspense
// boundary for static prerendering — it must stay rendered inside this one.
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

  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileTimezone, setProfileTimezone] = useState('Asia/Ho_Chi_Minh');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  // Notification prefs — persisted to localStorage, consumed by the Topbar bell (NOTIF_EVENTS shared).
  const [defaultLeadView, setDefaultLeadView] = useState<'kanban' | 'table'>('kanban');
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});

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
  }, []);

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

              <p className="text-[10px] text-text-muted font-mono border-t border-card-border/50 pt-3 prose-measure">
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
          <EmailConnectionsPanel />

          {/* Developer API Keys & External Integrations */}
          <DeveloperApiKeysPanel />

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
