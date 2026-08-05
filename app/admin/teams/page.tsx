'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAppContext } from '@/context/AppContext';
import { readApiError } from '@/lib/api/client';
import type { AdminUser } from '@/components/admin/UserFormModal';

/** Which roles may manage each role — mirrors `lib/admin/orgRules.ts`. */
const MANAGER_ROLES: Record<string, string[]> = {
  sdr: ['team_lead', 'floor_manager', 'director'],
  team_lead: ['floor_manager', 'director'],
  floor_manager: ['director'],
  leadgen: ['leadgen_manager', 'director'],
  leadgen_manager: ['director'],
  director: [],
};

interface TreeNode {
  user: AdminUser;
  children: TreeNode[];
}

export default function AdminTeamsPage() {
  const { showToast } = useToast();
  const { currentRole } = useAppContext();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      } else {
        showToast(await readApiError(res, 'Failed to load the org chart'), 'error');
      }
    } catch {
      showToast('Network error while loading the org chart', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  /**
   * Build the tree from `managerId`. Anyone whose manager is not in the visible
   * set becomes a root, so a floor manager still sees their own subtree rather
   * than an empty page.
   */
  const { roots, orphans } = useMemo(() => {
    const active = users.filter((u) => u.isActive);
    const byId = new Map(active.map((u) => [u.id, u]));
    const childrenOf = new Map<string, AdminUser[]>();
    const rootUsers: AdminUser[] = [];

    for (const u of active) {
      if (u.managerId && byId.has(u.managerId)) {
        childrenOf.set(u.managerId, [...(childrenOf.get(u.managerId) ?? []), u]);
      } else {
        rootUsers.push(u);
      }
    }

    const build = (u: AdminUser): TreeNode => ({
      user: u,
      children: (childrenOf.get(u.id) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(build),
    });

    return {
      roots: rootUsers
        .filter((u) => u.role === 'director' || u.managerId === null)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(build),
      orphans: active.filter((u) => u.managerId === null && u.role !== 'director'),
    };
  }, [users]);

  const changeManager = useCallback(
    async (user: AdminUser, managerId: string) => {
      setSavingId(user.id);
      try {
        const res = await fetch(`/api/users/${user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ managerId: managerId || null }),
        });
        if (!res.ok) {
          showToast(await readApiError(res, 'Failed to change manager'), 'error');
          return;
        }
        showToast(`${user.name}'s manager updated`, 'success');
        fetchUsers();
      } catch {
        showToast('Network error while changing manager', 'error');
      } finally {
        setSavingId(null);
      }
    },
    [showToast, fetchUsers]
  );

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const { user } = node;
    const eligible = users.filter(
      (m) => m.isActive && m.id !== user.id && (MANAGER_ROLES[user.role] ?? []).includes(m.role)
    );

    return (
      <li key={user.id}>
        <div
          className="flex items-center gap-3 py-2 border-b border-card-border/50 flex-wrap"
          style={{ paddingLeft: `${depth * 1.5}rem` }}
        >
          <span className="font-semibold text-text-primary type-body">{user.name}</span>
          <span className="type-meta text-text-muted uppercase">{user.role.replace('_', ' ')}</span>
          <span className="type-meta text-text-muted font-mono">
            {user.campaigns.length} campaign{user.campaigns.length === 1 ? '' : 's'}
          </span>

          {user.role !== 'director' && (
            <label className="flex items-center gap-1.5 ml-auto">
              <span className="type-meta text-text-muted">Reports to</span>
              <select
                value={user.managerId ?? ''}
                disabled={savingId === user.id || currentRole !== 'director'}
                onChange={(e) => changeManager(user, e.target.value)}
                className="bg-card-bg border border-card-border rounded-lg px-2 py-1 text-text-primary focus:outline-none focus:border-brand-red type-meta disabled:opacity-50"
                title={
                  currentRole === 'director'
                    ? `Change ${user.name}'s manager`
                    : 'Only a director can restructure reporting lines here'
                }
              >
                <option value="">No manager</option>
                {eligible.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role.replace('_', ' ')})
                  </option>
                ))}
              </select>
              {savingId === user.id && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" aria-hidden="true" />
              )}
            </label>
          )}
        </div>
        {node.children.length > 0 && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="glass-card p-4 space-y-4">
      <div>
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          <Network className="w-4 h-4 text-text-muted" aria-hidden="true" />
          Teams &amp; reporting lines
        </h2>
        <p className="type-meta text-text-muted prose-measure mt-0.5">
          Pod scoping is driven entirely by these lines — a Team Lead sees the SDRs who report to
          them. Self-management and circular chains are rejected by the server.
        </p>
      </div>

      {orphans.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-brand-red/5 border border-brand-red/20 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-brand-red shrink-0 mt-0.5" aria-hidden="true" />
          <p className="type-meta text-text-secondary leading-normal">
            <span className="font-semibold text-text-primary">{orphans.length}</span> active user
            {orphans.length === 1 ? '' : 's'} have no manager, so they fall outside every pod:{' '}
            {orphans.map((o) => o.name).join(', ')}.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-text-muted type-meta font-mono">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading org chart…
        </div>
      ) : roots.length === 0 ? (
        <p className="type-meta text-text-muted py-8 text-center">No users in your scope.</p>
      ) : (
        <ul>{roots.map((r) => renderNode(r, 0))}</ul>
      )}
    </div>
  );
}
