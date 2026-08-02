'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Users, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

type TeamUser = { id: string; firstName: string; lastName: string; email: string; role: string; createdAt: string };
type Metrics = { qualifiedByMember: { id: string; name: string; count: number }[] };

const ROLE_LABEL: Record<string, string> = {
  leadgen_manager: 'Leadgen Manager',
  leadgen: 'Leadgen',
  sdr: 'SDR',
  director: 'Director',
  floor_manager: 'Floor Manager',
};

export default function TeamTab() {
  const { showToast } = useToast();
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [assignedCounts, setAssignedCounts] = useState<Record<string, number>>({});
  const [qualifiedMap, setQualifiedMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, mRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/leadgen-pool/metrics'),
      ]);
      if (!uRes.ok) throw new Error(await readApiError(uRes, 'Failed to load team'));
      const users: TeamUser[] = await uRes.json();
      const filtered = users.filter(
        (u) => u.role === 'sdr' || u.role === 'leadgen' || u.role === 'leadgen_manager' || u.role === 'director' || u.role === 'floor_manager'
      );
      setTeam(filtered);

      const metrics: Metrics | null = mRes.ok ? await mRes.json() : null;
      const qMap: Record<string, number> = {};
      for (const m of metrics?.qualifiedByMember ?? []) qMap[m.id] = m.count;
      setQualifiedMap(qMap);

      const counts: Record<string, number> = {};
      await Promise.all(
        filtered
          .filter((u) => u.role === 'sdr' || u.role === 'leadgen')
          .map(async (u) => {
            try {
              const res = await fetch(`/api/leadgen-pool?sdrId=${u.id}&pageSize=1`);
              if (res.ok) {
                const data = await res.json();
                counts[u.id] = data.total ?? 0;
              }
            } catch {
              /* ignore per-user errors */
            }
          })
      );
      setAssignedCounts(counts);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load team', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const roleOrder: Record<string, number> = { leadgen_manager: 0, leadgen: 1, sdr: 2, director: 3, floor_manager: 4 };
  const sorted = [...team].sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <Users className="w-5 h-5 text-purple-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display">{team.length}</div>
            <div className="text-[10px] text-text-muted font-mono uppercase tracking-wide">Team members</div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display">
              {Object.values(qualifiedMap).reduce((s, n) => s + n, 0)}
            </div>
            <div className="text-[10px] text-text-muted font-mono uppercase tracking-wide">Records qualified</div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display">
              {Object.values(assignedCounts).reduce((s, n) => s + n, 0)}
            </div>
            <div className="text-[10px] text-text-muted font-mono uppercase tracking-wide">Records held by SDRs</div>
          </div>
        </div>
      </div>

      <div className="bg-card-bg border border-card-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-card-border bg-background/60">
                <th className="px-4 py-3 text-[10px] font-mono uppercase text-text-muted">Member</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase text-text-muted">Role</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase text-text-muted">Records Qualified</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase text-text-muted">Assigned Pool Records</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase text-text-muted">Joined</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-xs text-text-muted italic">No team members.</td>
                </tr>
              ) : (
                sorted.map((u) => (
                  <tr key={u.id} className="border-b border-card-border/60 hover:bg-background/40">
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-text-primary">{u.firstName} {u.lastName}</div>
                      <div className="text-[10px] font-mono text-text-muted">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-500/10 text-purple-300 border-purple-500/20 uppercase">
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-text-secondary">{qualifiedMap[u.id] ?? 0}</td>
                    <td className="px-4 py-3 text-xs font-mono text-text-secondary">
                      {(u.role === 'sdr' || u.role === 'leadgen') ? (assignedCounts[u.id] ?? 0) : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[10px] font-mono text-text-muted">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
