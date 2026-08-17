'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Shield,
  Loader2,
  AlertTriangle,
  Code,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

const AVAILABLE_SCOPES = [
  { id: 'leads:read', label: 'Read Leads', desc: 'Query and search lead details' },
  { id: 'leads:write', label: 'Write Leads', desc: 'Ingest and update leads from Apollo/Clay' },
  { id: 'calls:write', label: 'Log VOIP Calls', desc: 'Push call recordings, duration, and outcomes' },
  { id: 'enrich:write', label: 'Enrich Intelligence', desc: 'Push tech stacks and research summaries' },
  { id: 'activities:write', label: 'Write Activities', desc: 'Log notes and timeline events' },
];

export default function DeveloperApiKeysPanel() {
  const { showToast } = useToast();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'leads:read',
    'leads:write',
    'calls:write',
    'enrich:write',
  ]);
  const [isCreating, setIsCreating] = useState(false);

  // Secret display state
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const fetchKeys = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/developer/keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch {
      showToast('Failed to load API keys', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      showToast('Please enter a key name', 'error');
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch('/api/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: keyName.trim(),
          scopes: selectedScopes,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setNewlyCreatedKey(data.secretKey);
        showToast('API key generated successfully!', 'success');
        fetchKeys();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create API key', 'error');
      }
    } catch {
      showToast('Network error creating API key', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke "${name}"? Any external tool using this key will immediately lose access.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/developer/keys/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast('API key revoked', 'success');
        setKeys((prev) => prev.filter((k) => k.id !== id));
      } else {
        showToast('Failed to revoke API key', 'error');
      }
    } catch {
      showToast('Network error revoking API key', 'error');
    }
  };

  const handleCopySecret = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const toggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-border bg-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-foreground">API Keys & External Integrations</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Authenticate external VOIP dialers (Aircall, Twilio), leadgen enrichers (Clay, Apollo), and Zapier workflows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/docs"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-background hover:bg-muted text-foreground transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            Interactive Docs
            <ExternalLink className="w-3 h-3 opacity-60" />
          </Link>

          <button
            onClick={() => {
              setKeyName('');
              setNewlyCreatedKey(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create API Key
          </button>
        </div>
      </div>

      {/* Keys Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">Active API Keys</span>
          <span className="text-xs text-muted-foreground">{keys.length} keys active</span>
        </div>

        {isLoading ? (
          <div className="p-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-xs">Loading API keys...</span>
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Shield className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-xs font-medium text-foreground">No API keys created yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Generate an API key to connect external dialers, lead research scrapers, or automation webhooks.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/20 text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Name</th>
                  <th className="py-2.5 px-4 font-medium">Token Prefix</th>
                  <th className="py-2.5 px-4 font-medium">Scopes</th>
                  <th className="py-2.5 px-4 font-medium">Last Used</th>
                  <th className="py-2.5 px-4 font-medium">Created</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-muted/10 transition-colors">
                    <td className="py-3 px-4 font-semibold text-foreground">{k.name}</td>
                    <td className="py-3 px-4 font-mono text-[11px] text-emerald-500">{k.keyPrefix}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <span
                            key={s}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground border border-border"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleRevokeKey(k.id, k.name)}
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Revoke API key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create API Key */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-scale-up">
            {!newlyCreatedKey ? (
              <form onSubmit={handleCreateKey} className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">Create API Key</h3>
                  <p className="text-xs text-muted-foreground">
                    Assign a descriptive name and choose permission scopes for this integration.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground">Key Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Aircall VOIP Caller, Clay Prospector"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground">Permission Scopes</label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {AVAILABLE_SCOPES.map((sc) => (
                      <label
                        key={sc.id}
                        onClick={() => toggleScope(sc.id)}
                        className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                          selectedScopes.includes(sc.id)
                            ? 'border-primary/50 bg-primary/5'
                            : 'border-border hover:bg-muted/20'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedScopes.includes(sc.id)}
                          onChange={() => {}}
                          className="mt-0.5 rounded border-border"
                        />
                        <div className="space-y-0.5 text-xs">
                          <div className="font-semibold text-foreground">{sc.label}</div>
                          <div className="text-[11px] text-muted-foreground">{sc.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Generate Key
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-500 font-semibold text-sm">
                  <Check className="w-4 h-4" />
                  API Key Generated
                </div>

                <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2 text-xs text-amber-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    Please copy this secret key now. For your security, <strong>it will never be displayed again</strong>.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Your Secret API Key</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={newlyCreatedKey}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-muted/40 text-emerald-400 font-mono text-xs select-all"
                    />
                    <button
                      onClick={() => handleCopySecret(newlyCreatedKey)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold flex-shrink-0"
                    >
                      {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSecret ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => {
                      setIsModalOpen(false);
                      setNewlyCreatedKey(null);
                    }}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
