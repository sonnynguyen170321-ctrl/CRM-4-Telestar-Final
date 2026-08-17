'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, Pencil, UserX, UserCheck, LogOut } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAppContext } from '@/context/AppContext';
import { readApiError } from '@/lib/api/client';
import AdminTable, { type Column } from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/admin/ConfirmDialog';
import ImpactPanel, {
  emptyChoice,
  isChoiceComplete,
  type ImpactChoice,
  type UserImpact,
} from '@/components/admin/ImpactPanel';
import UserFormModal, { type AdminUser } from '@/components/admin/UserFormModal';

interface AdminUsersPayload {
  users: AdminUser[];
  campaigns: { id: string; name: string; clientName: string }[];
  canCreateUsers: boolean;
}

const ROLES = [
  'director',
  'floor_manager',
  'team_lead',
  'sdr',
  'leadgen_manager',
  'leadgen',
] as const;

export default function AdminUsersPage() {
  const { showToast } = useToast();
  const { currentRole } = useAppContext();
  const isDirector = currentRole === 'director';
  const canManageUsers = currentRole === 'director' || currentRole === 'floor_manager';

  const [data, setData] = useState<AdminUsersPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [gapFilter, setGapFilter] = useState<'' | 'no_campaign' | 'no_manager'>('');

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);

  // Deactivation goes through the same impact gate as campaign-member removal.
  const [pendingDeactivate, setPendingDeactivate] = useState<AdminUser | null>(null);
  const [impact, setImpact] = useState<UserImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [choice, setChoice] = useState<ImpactChoice>(emptyChoice);
  const [busy, setBusy] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) setData(await res.json());
      else showToast(await readApiError(res, 'Failed to load users'), 'error');
    } catch {
      showToast('Network error while loading users', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const rows = useMemo(() => {
    const all = data?.users ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((u) => {
      if (statusFilter === 'active' && !u.isActive) return false;
      if (statusFilter === 'inactive' && u.isActive) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (gapFilter === 'no_campaign' && u.campaigns.length > 0) return false;
      if (gapFilter === 'no_manager' && u.managerId !== null) return false;
      if (q && !`${u.name} ${u.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, roleFilter, statusFilter, gapFilter]);

  /**
   * Revoke every active session for a user without changing their account.
   *
   * The endpoint bumps `authVersion`, which every protected request revalidates against,
   * so existing tokens stop working on their next request rather than at expiry. Distinct
   * from deactivating: the user keeps their access and simply has to sign in again. That
   * is what you want after a shared laptop, a lost phone, or a password typed into the
   * plain-HTTP demo box.
   */
  const signOutAll = useCallback(async (user: AdminUser) => {
    if (!confirm(`Sign ${user.name} out of all sessions? They will need to sign in again.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${user.id}/sign-out-all`, { method: 'POST' });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to sign out sessions'), 'error');
        return;
      }
      showToast(`${user.name} signed out of all sessions`, 'success');
    } catch {
      showToast('Failed to sign out sessions', 'error');
    }
  }, [showToast]);

  const openDeactivate = useCallback(async (user: AdminUser) => {
    setPendingDeactivate(user);
    setChoice(emptyChoice);
    setImpact(null);
    setImpactLoading(true);
    try {
      const res = await fetch(`/api/users/${user.id}/impact`);
      setImpact(res.ok ? await res.json() : null);
    } catch {
      setImpact(null);
    } finally {
      setImpactLoading(false);
    }
  }, []);

  /**
   * Handle the work first, then flip the flag. Doing it the other way round
   * would leave a window where the work is owned by an inactive user.
   */
  const confirmDeactivate = useCallback(async () => {
    if (!pendingDeactivate) return;
    setBusy(true);
    try {
      if (choice.mode === 'transfer_work' && choice.transferToUserId) {
        const res = await fetch('/api/admin/transfer-work', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromUserId: pendingDeactivate.id,
            toUserId: choice.transferToUserId,
            includeLeads: true,
            includeOpenTasks: true,
            includeScheduledMeetings: true,
            includeOpenOpportunities: true,
            requestId: crypto.randomUUID(),
            reason: choice.reason.trim(),
          }),
        });
        if (!res.ok) {
          showToast(await readApiError(res, 'Failed to transfer work'), 'error');
          return;
        }
      }

      const res = await fetch(`/api/users/${pendingDeactivate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to deactivate user'), 'error');
        return;
      }

      showToast(`${pendingDeactivate.name} deactivated`, 'success');
      setPendingDeactivate(null);
      fetchUsers();
    } catch {
      showToast('Network error while deactivating', 'error');
    } finally {
      setBusy(false);
    }
  }, [pendingDeactivate, choice, showToast, fetchUsers]);

  const reactivate = useCallback(
    async (user: AdminUser) => {
      try {
        const res = await fetch(`/api/users/${user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: true }),
        });
        if (!res.ok) {
          showToast(await readApiError(res, 'Failed to reactivate user'), 'error');
          return;
        }
        showToast(`${user.name} reactivated`, 'success');
        fetchUsers();
      } catch {
        showToast('Network error while reactivating', 'error');
      }
    },
    [showToast, fetchUsers]
  );

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (u) => (
        <div>
          <div className="font-semibold text-text-primary">{u.name}</div>
          <div className="type-meta text-text-muted font-mono">{u.email}</div>
        </div>
      ),
    },
    { key: 'role', label: 'Role', render: (u) => u.role.replace('_', ' ') },
    {
      key: 'manager',
      label: 'Manager',
      render: (u) =>
        u.managerName ?? <span className="text-brand-orange-text">No manager</span>,
    },
    {
      key: 'campaigns',
      label: 'Campaigns',
      render: (u) =>
        u.campaigns.length === 0 ? (
          <span className="text-brand-orange-text">None</span>
        ) : (
          <span title={u.campaigns.map((c) => c.name).join(', ')}>{u.campaigns.length}</span>
        ),
      numeric: true,
    },
    { key: 'openLeads', label: 'Open leads', render: (u) => u.openLeads, numeric: true },
    { key: 'openTasks', label: 'Due tasks', render: (u) => u.openTasks, numeric: true },
    {
      key: 'status',
      label: 'Status',
      render: (u) => <StatusBadge status={u.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (u) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton
            title={canManageUsers ? 'Edit user' : 'Only managers can edit users'}
            disabled={!canManageUsers}
            onClick={() => setEditing(u)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            title={canManageUsers ? 'Sign out of all sessions' : 'Only managers can revoke sessions'}
            disabled={!canManageUsers}
            onClick={() => signOutAll(u)}
          >
            <LogOut className="w-3.5 h-3.5" />
          </IconButton>
          {u.isActive ? (
            <IconButton
              title={canManageUsers ? 'Deactivate user' : 'Only managers can deactivate users'}
              disabled={!canManageUsers}
              onClick={() => openDeactivate(u)}
            >
              <UserX className="w-3.5 h-3.5" />
            </IconButton>
          ) : (
            <IconButton
              title={canManageUsers ? 'Reactivate user' : 'Only managers can reactivate users'}
              disabled={!canManageUsers}
              onClick={() => reactivate(u)}
            >
              <UserCheck className="w-3.5 h-3.5" />
            </IconButton>
          )}
        </div>
      ),
      className: 'text-right',
    },
  ];

  const selectClass =
    'bg-card-bg border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          <Users className="w-4 h-4 text-text-muted" aria-hidden="true" />
          People
          <span className="type-meta font-normal text-text-muted font-mono">({rows.length})</span>
        </h2>

        {canManageUsers && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New user
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          aria-label="Search users"
          className={`${selectClass} w-56`}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className={selectClass}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by status"
          className={selectClass}
        >
          <option value="active">Active only</option>
          <option value="inactive">Deactivated only</option>
          <option value="all">All statuses</option>
        </select>
        <select
          value={gapFilter}
          onChange={(e) => setGapFilter(e.target.value as typeof gapFilter)}
          aria-label="Filter by gaps"
          className={selectClass}
        >
          <option value="">No gap filter</option>
          <option value="no_campaign">No campaign assigned</option>
          <option value="no_manager">No manager assigned</option>
        </select>
      </div>

      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        isLoading={loading}
        emptyIcon={<Users className="w-8 h-8 text-text-muted" aria-hidden="true" />}
        emptyMessage="No users match these filters."
      />

      {(creating || editing) && (
        <UserFormModal
          user={editing}
          managers={(data?.users ?? []).filter((u) => u.isActive)}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            fetchUsers();
          }}
        />
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title={`Deactivate ${pendingDeactivate.name}`}
          tone="danger"
          confirmLabel="Deactivate user"
          isBusy={busy}
          isConfirmDisabled={!isChoiceComplete(impact, choice)}
          onConfirm={confirmDeactivate}
          onClose={() => setPendingDeactivate(null)}
          body={
            <ImpactPanel
              impact={impact}
              isLoading={impactLoading}
              subjectName={pendingDeactivate.name}
              context="user"
              choice={choice}
              onChoiceChange={setChoice}
            />
          }
        />
      )}
    </div>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1.5 rounded-lg border border-card-border text-text-muted hover:text-text-primary hover:border-brand-orange/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
