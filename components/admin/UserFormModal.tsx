'use client';

import React, { useState } from 'react';
import { X, Loader2, Copy, Check } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: string;
  managerId: string | null;
  managerName: string | null;
  isActive: boolean;
  timezone: string;
  createdAt: string;
  openLeads: number;
  openTasks: number;
  campaigns: { id: string; name: string }[];
}

interface Props {
  /** `null` creates a new user. */
  user: AdminUser | null;
  managers: AdminUser[];
  onClose: () => void;
  onSaved: () => void;
}

const ROLES = [
  { value: 'sdr', label: 'SDR' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'floor_manager', label: 'Floor Manager' },
  { value: 'director', label: 'Director' },
  { value: 'leadgen', label: 'Leadgen' },
  { value: 'leadgen_manager', label: 'Leadgen Manager' },
];

/** Which roles may manage each role — mirrors `lib/admin/orgRules.ts`. */
const MANAGER_ROLES: Record<string, string[]> = {
  sdr: ['team_lead', 'floor_manager', 'director'],
  team_lead: ['floor_manager', 'director'],
  floor_manager: ['director'],
  leadgen: ['leadgen_manager', 'director'],
  leadgen_manager: ['director'],
  director: [],
};

export default function UserFormModal({ user, managers, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  useEscapeClose(onClose);
  const isEdit = user !== null;

  const [form, setForm] = useState({
    email: user?.email ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    role: user?.role ?? 'sdr',
    managerId: user?.managerId ?? '',
    newPassword: '',
  });
  const [saving, setSaving] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const eligibleManagers = managers.filter(
    (m) => m.id !== user?.id && (MANAGER_ROLES[form.role] ?? []).includes(m.role)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      showToast('First and last name are required', 'error');
      return;
    }
    if (!isEdit && !form.email.trim()) {
      showToast('Email is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = isEdit
        ? await fetch(`/api/users/${user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firstName: form.firstName,
              lastName: form.lastName,
              role: form.role,
              managerId: form.managerId || null,
              ...(form.newPassword ? { newPassword: form.newPassword } : {}),
            }),
          })
        : await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: form.email.trim(),
              firstName: form.firstName,
              lastName: form.lastName,
              role: form.role,
              managerId: form.managerId || null,
              // No password field — the server generates one and returns it once.
            }),
          });

      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to save user'), 'error');
        return;
      }

      const saved = await res.json();
      if (saved.generatedPassword) {
        // Hold the dialog open so the director can copy it — this is the only
        // time the plaintext exists.
        setGeneratedPassword(saved.generatedPassword);
        showToast('User created', 'success');
        return;
      }

      showToast(isEdit ? 'User updated' : 'User created', 'success');
      onSaved();
    } catch {
      showToast('Network error while saving user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full bg-bg-main border border-card-border rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';
  const labelClass = 'block type-meta font-semibold text-text-primary mb-1';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isEdit ? 'Edit user' : 'Create user'}
          className="bg-card-bg border border-card-border rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-card-border">
            <h3 className="type-subsection font-bold text-text-primary">
              {isEdit ? `Edit ${user.name}` : 'New user'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {generatedPassword ? (
            <div className="px-5 py-4 space-y-3">
              <p className="type-body text-text-secondary leading-normal prose-measure">
                Account created. This is the only time the initial password is shown — copy it and
                give it to the new user.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-bg-main border border-card-border rounded-lg px-3 py-2 font-mono type-body text-text-primary break-all">
                  {generatedPassword}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedPassword);
                    setCopied(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={onSaved}
                  className="px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
              {!isEdit && (
                <div>
                  <label className={labelClass} htmlFor="user-email">
                    Email
                  </label>
                  <input
                    id="user-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={set('email')}
                    className={inputClass}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="user-first">
                    First name
                  </label>
                  <input
                    id="user-first"
                    required
                    value={form.firstName}
                    onChange={set('firstName')}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="user-last">
                    Last name
                  </label>
                  <input
                    id="user-last"
                    required
                    value={form.lastName}
                    onChange={set('lastName')}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="user-role">
                    Role
                  </label>
                  <select
                    id="user-role"
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value, managerId: '' }))}
                    className={inputClass}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="user-manager">
                    Manager
                  </label>
                  <select
                    id="user-manager"
                    value={form.managerId}
                    onChange={set('managerId')}
                    disabled={form.role === 'director'}
                    className={`${inputClass} disabled:opacity-50`}
                  >
                    <option value="">
                      {form.role === 'director' ? 'Top of the chain' : 'No manager'}
                    </option>
                    {eligibleManagers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role.replace('_', ' ')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {isEdit && (
                <div>
                  <label className={labelClass} htmlFor="user-password">
                    Reset password <span className="font-normal text-text-muted">(optional)</span>
                  </label>
                  <input
                    id="user-password"
                    type="text"
                    value={form.newPassword}
                    onChange={set('newPassword')}
                    placeholder="Leave blank to keep the current password"
                    className={inputClass}
                  />
                </div>
              )}

              {!isEdit && (
                <p className="type-meta text-text-muted leading-normal">
                  An initial password is generated automatically and shown once after you save.
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isEdit ? 'Save changes' : 'Create user'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
