'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Bell,
  Plus,
  Check,
  UserCheck,
  ChevronDown,
  AlarmClock,
  X,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react';
import { hardSignOut } from '@/lib/auth/clientSignOut';
import { useAppContext } from '@/context/AppContext';
import { readNotifPrefs, isMuted, NOTIF_PREFS_EVENT } from '@/lib/notifications/prefs';
import { openLeadSlideOver } from '@/lib/leads/openLead';
import EnvironmentBadge from '@/components/operating/EnvironmentBadge';

interface Notification {
  id: string;
  type: string;
  text: string;
  isRead: boolean;
  createdAt: string;
  linkTo?: string;
}

interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  isDismissed: boolean;
  leadId?: string | null;
}

type BellItem =
  | ({ kind: 'notification' } & Notification)
  | ({ kind: 'reminder' } & Reminder);

interface TopbarProps {
  currentRole: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen';
  onRoleChange: (role: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen') => void;
  onNewAction?: (type: 'lead' | 'task' | 'reminder' | 'campaign') => void;
}

export default function Topbar({ currentRole, onRoleChange, onNewAction }: TopbarProps) {
  const { currentUser } = useAppContext();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = (localStorage.getItem('telestar_theme') as 'light' | 'dark') || 'light';
    setTheme(savedTheme);
    document.body.setAttribute('data-theme', savedTheme);
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('telestar_theme', nextTheme);
    document.body.setAttribute('data-theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  const fetchBellData = () => {
    fetch('/api/notifications?unreadOnly=true')
      .then((r) => (r.ok ? r.json() : { notifications: [] }))
      .then((data) => setNotifications(data.notifications ?? []))
      .catch(() => {});
    fetch('/api/reminders')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setReminders(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    // Check for overdue tasks + due reminders on mount and create notifications
    fetch('/api/notifications/check', { method: 'POST' })
      .then(() => fetchBellData())
      .catch(() => fetchBellData());

    // Notification mute preferences (per-browser); re-read when Settings updates them.
    setNotifPrefs(readNotifPrefs());
    const syncPrefs = () => setNotifPrefs(readNotifPrefs());

    // Avatar (server-persisted); refresh live when the profile is saved in Settings.
    const loadAvatar = () => {
      fetch('/api/settings')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setAvatarUrl(d?.avatarUrl ?? null))
        .catch(() => {});
    };
    loadAvatar();

    window.addEventListener('crm:reminder-created', fetchBellData);
    window.addEventListener('crm:notifications-updated', fetchBellData);
    window.addEventListener(NOTIF_PREFS_EVENT, syncPrefs);
    window.addEventListener('crm:profile-updated', loadAvatar);
    return () => {
      window.removeEventListener('crm:reminder-created', fetchBellData);
      window.removeEventListener('crm:notifications-updated', fetchBellData);
      window.removeEventListener(NOTIF_PREFS_EVENT, syncPrefs);
      window.removeEventListener('crm:profile-updated', loadAvatar);
    };
  }, []);

  // Hide notification types the user muted in Settings (always-on events are never muted).
  const visibleNotifications = notifications.filter((n) => !isMuted(n.type, notifPrefs));

  const unreadCount =
    visibleNotifications.filter((n) => !n.isRead).length +
    reminders.filter((r) => !r.isDismissed && new Date(r.dueAt) <= new Date()).length;

  // Unified bell items sorted newest-first (reminders by dueAt, notifications by createdAt)
  const bellItems: BellItem[] = [
    ...visibleNotifications.map((n) => ({ kind: 'notification' as const, ...n })),
    ...reminders.filter((r) => !r.isDismissed).map((r) => ({ kind: 'reminder' as const, ...r })),
  ].sort((a, b) => {
    const aDate = a.kind === 'notification' ? a.createdAt : a.dueAt;
    const bDate = b.kind === 'notification' ? b.createdAt : b.dueAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  const handleNotificationClick = (item: Notification) => {
    setBellOpen(false);
    if (!item.linkTo) return;
    // Notification `linkTo` values are stored as `/leads/{id}`, but that route does not
    // exist — lead detail is a slide-over. Translate it rather than navigating.
    const leadMatch = item.linkTo.match(/\/leads\/([^/?]+)/);
    if (leadMatch) {
      openLeadSlideOver(router, leadMatch[1]);
    } else {
      router.push(item.linkTo);
    }
    // Mark as read
    if (!item.isRead) {
      fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      }).catch(() => {});
      setNotifications((prev) => prev.map((n) => n.id === item.id ? { ...n, isRead: true } : n));
    }
  };

  const handleDismissNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const handleDismissReminder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/reminders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDismissed: true }),
    });
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const handleDismissAll = async () => {
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    });
    setNotifications([]);
    await Promise.all(
      reminders.map((r) =>
        fetch(`/api/reminders/${r.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDismissed: true }),
        })
      )
    );
    setReminders([]);
  };

  const handleNewClick = (type: 'lead' | 'task' | 'reminder' | 'campaign') => {
    setPlusOpen(false);
    if (onNewAction) onNewAction(type);
  };

  const displayName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(' ')
    : currentRole === 'director'
    ? 'Son Nguyen'
    : 'Team Member';

  const displayInitial = (currentUser?.firstName?.[0] ?? displayName[0]).toUpperCase();

  return (
    <header
      className="fixed top-0 right-0 z-10 flex items-center justify-between px-6 py-3 glass-topbar h-16"
      style={{ left: 'var(--sidebar-w, 56px)' }}
    >
      {/* Global Search — Click to open Spotlight Command Palette */}
      <div className="flex-1 max-w-md relative">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('telestar:open-command-palette'))}
          className="w-full pl-3.5 pr-3 py-2 text-xs bg-zinc-100/90 dark:bg-zinc-800/70 hover:bg-white dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 rounded-xl text-zinc-500 hover:border-rose-500/40 flex items-center justify-between transition-all duration-150 shadow-xs cursor-pointer text-left group"
          title="Search leads, commands, actions (⌘K or /)"
        >
          <span className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-zinc-400 group-hover:text-rose-500 transition-colors" />
            <span className="font-medium text-zinc-500 dark:text-zinc-400">Search leads, commands, actions...</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 text-zinc-400 dark:text-zinc-300 rounded-md">⌘K</kbd>
          </span>
        </button>
      </div>

      {/* Global Actions */}
      <div className="flex items-center gap-4">
        {/* Demo tenant + send-safety reassurance. Renders nothing outside the demo tenant. */}
        <EnvironmentBadge />

        {/* + New Button */}
        <div className="relative">
          <button
            onClick={() => setPlusOpen(!plusOpen)}
            aria-label="New action menu"
            aria-expanded={plusOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-all duration-150 hover:scale-[1.02] active:scale-[0.97] focus-ring"
          >
            <Plus className="w-4 h-4" />
            <span className="inline">New Action</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-80" />
          </button>

          {plusOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPlusOpen(false)} />
              <div role="menu" aria-orientation="vertical" className="absolute right-0 mt-2 w-48 bg-card-bg border border-card-border rounded-xl shadow-lg shadow-black/5 z-40 py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  role="menuitem"
                  onClick={() => handleNewClick('lead')}
                  className="w-full text-left px-4 py-2 text-xs text-text-primary hover:bg-bg-main transition-colors flex items-center gap-2"
                >
                  <span className="text-blue-500">👥</span> New Lead
                </button>
                <button
                  role="menuitem"
                  onClick={() => handleNewClick('task')}
                  className="w-full text-left px-4 py-2 text-xs text-text-primary hover:bg-bg-main transition-colors flex items-center gap-2"
                >
                  <span className="text-brand-orange-text">📋</span> New Task
                </button>
                <button
                  role="menuitem"
                  onClick={() => handleNewClick('reminder')}
                  className="w-full text-left px-4 py-2 text-xs text-text-primary hover:bg-bg-main transition-colors flex items-center gap-2"
                >
                  <span className="text-brand-gold-text">🔔</span> New Reminder
                </button>
                {(currentRole === 'director' || currentRole === 'floor_manager') && (
                  <>
                    <div className="my-1 border-t border-card-border" />
                    <button
                      role="menuitem"
                      onClick={() => handleNewClick('campaign')}
                      className="w-full text-left px-4 py-2 text-xs text-text-primary hover:bg-bg-main transition-colors flex items-center gap-2"
                    >
                      <span className="text-emerald-500">🚀</span> New Campaign
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Theme Mode Switcher */}
        <button
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all duration-150 cursor-pointer"
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-amber-400" />}
        </button>

        {/* Notifications Bell */}
        <div className="relative">
          <button
            onClick={() => setBellOpen(!bellOpen)}
            aria-label={`Notifications — ${unreadCount} unread`}
            aria-expanded={bellOpen}
            aria-haspopup="dialog"
            className="relative p-2 text-text-secondary hover:text-text-primary hover:bg-card-border/30 rounded-lg transition-colors duration-150 focus-ring"
          >
            <Bell className="w-4 h-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span aria-live="polite" aria-atomic="true" className="absolute top-1.5 right-1.5 w-4 h-4 bg-brand-red border-2 border-topbar-bg text-[9px] font-bold text-white flex items-center justify-center rounded-full">
                {unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 mt-2 w-80 bg-card-bg border border-card-border rounded-xl shadow-xl shadow-black/10 z-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="flex items-center justify-between px-4 py-3 border-b border-card-border bg-bg-main/50">
                  <span className="font-display font-bold text-xs text-text-primary flex items-center gap-1.5">
                    <span>🔔</span> Notifications &amp; Reminders
                  </span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleDismissAll}
                      className="text-[10px] text-brand-red hover:underline font-medium"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-card-border">
                  {bellItems.length === 0 ? (
                    <div className="p-6 text-center text-xs text-text-muted">
                      All caught up — no notifications or reminders.
                    </div>
                  ) : (
                    bellItems.map((item) => {
                      if (item.kind === 'reminder') {
                        const isOverdue = new Date(item.dueAt) < new Date();
                        return (
                          <div key={`rem-${item.id}`} className={`p-3 text-xs flex items-start gap-2.5 hover:bg-bg-main/80 relative ${isOverdue ? 'bg-brand-gold/[0.03]' : ''}`}>
                            <AlarmClock className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isOverdue ? 'text-brand-gold-text' : 'text-text-muted'}`} aria-hidden="true" />
                            <div className="flex-1 min-w-0 pr-6">
                              <p className="text-text-secondary text-[11px] leading-normal">{item.text}</p>
                              <span className={`text-[9px] mt-1 inline-block font-mono ${isOverdue ? 'text-brand-gold-text' : 'text-text-muted'}`}>
                                {isOverdue ? '⚠ overdue · ' : ''}
                                {new Date(item.dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                                {new Date(item.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <button
                              onClick={(e) => handleDismissReminder(item.id, e)}
                              title="Dismiss reminder"
                              className="absolute right-2 top-3 w-5 h-5 flex items-center justify-center bg-card-border hover:bg-brand-red/10 hover:text-brand-red text-text-muted rounded-full transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      }
                      // Notification
                      return (
                        <div
                          key={`notif-${item.id}`}
                          onClick={() => handleNotificationClick(item)}
                          className={`p-3 text-xs transition-colors hover:bg-bg-main/80 relative flex items-start gap-2.5 ${item.linkTo ? 'cursor-pointer' : ''} ${!item.isRead ? 'bg-brand-red/[0.02]' : ''}`}
                        >
                          <span className="mt-0.5 text-base flex-shrink-0">
                            {item.type === 'meeting_booked' ? '🎉' : item.type === 'overdue_tasks' ? '⚠️' : item.type === 'lead_reply' ? '📧' : '🔔'}
                          </span>
                          <div className="flex-1 min-w-0 pr-6">
                            <p className="text-text-secondary text-[11px] leading-normal">{item.text}</p>
                            <span className="text-[9px] text-text-muted mt-1 inline-block font-mono">
                              {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <button
                            onClick={(e) => handleDismissNotification(item.id, e)}
                            title="Dismiss"
                            className="absolute right-2 top-3 w-5 h-5 flex items-center justify-center bg-card-border hover:bg-brand-red/10 hover:text-brand-red text-text-muted rounded-full transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Persona / User Menu */}
        <div className="relative border-l border-topbar-border pl-4">
          <button
            onClick={() => setPersonaOpen(!personaOpen)}
            aria-label={`User menu — ${displayName}, ${currentRole}`}
            aria-expanded={personaOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 hover:bg-card-border/30 px-2 py-1.5 rounded-lg transition-colors duration-150 focus-ring"
          >
            <div className="w-7 h-7 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center text-xs font-bold text-brand-orange-text uppercase overflow-hidden">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                displayInitial
              )}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-semibold text-text-primary leading-tight">{displayName}</span>
              <span className="text-[10px] text-text-muted leading-tight font-mono capitalize">
                {currentRole.replace('_', ' ')}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          </button>

          {personaOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPersonaOpen(false)} />
              <div role="menu" aria-orientation="vertical" className="absolute right-0 mt-2 w-56 bg-card-bg border border-card-border rounded-xl shadow-xl shadow-black/10 z-40 py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                {process.env.NODE_ENV !== 'production' && (
                  <>
                    <div className="px-4 py-2 border-b border-card-border bg-bg-main/30 mb-1">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">
                        Simulate Role (Showcase)
                      </span>
                      <p className="text-[11px] text-text-secondary leading-normal mt-0.5">
                        Test how the interface adapts to different access scopes.
                      </p>
                      <p className="text-[9px] text-brand-orange-text leading-normal mt-1 italic font-medium">
                        ⚠️ UI simulation only — server permissions unchanged.
                      </p>
                    </div>
                    {(
                      [
                        { role: 'sdr', label: 'SDR View', icon: '👤' },
                        { role: 'leadgen', label: 'Leadgen View', icon: '🧩' },
                        { role: 'leadgen_manager', label: 'Leadgen Manager View', icon: '🧠' },
                        { role: 'team_lead', label: 'Team Lead View', icon: '🎯' },
                        { role: 'floor_manager', label: 'Floor Manager View', icon: '🏢' },
                        { role: 'director', label: 'Director View', icon: '👑' },
                      ] as const
                    ).map(({ role, label, icon }) => (
                      <button
                        key={role}
                        role="menuitem"
                        onClick={() => { onRoleChange(role); setPersonaOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-xs transition-colors flex items-center justify-between ${
                          currentRole === role
                            ? 'text-brand-red font-semibold bg-brand-red/5'
                            : 'text-text-primary hover:bg-bg-main'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <UserCheck className="w-3.5 h-3.5 text-brand-orange-text" aria-hidden="true" /> {icon} {label}
                        </span>
                        {currentRole === role && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                      </button>
                    ))}
                    <div className="my-1 border-t border-card-border" />
                  </>
                )}
                <button
                  role="menuitem"
                  onClick={() => { void hardSignOut('/login'); }}
                  className="w-full text-left px-4 py-2 text-xs text-brand-red hover:bg-brand-red/5 transition-colors flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
