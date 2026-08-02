'use client';

import React, { useState, useEffect } from 'react';
import { X, Link2, Copy, Check, Lock, Eye, Trash2, Calendar, ShieldAlert } from 'lucide-react';

interface ShareLinkItem {
  id: string;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  createdByName?: string;
}

interface Props {
  reportId: string;
  reportTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ClientReportShareModal({ reportId, reportTitle, isOpen, onClose }: Props) {
  const [links, setLinks] = useState<ShareLinkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [expiryDays, setExpiryDays] = useState('30');
  const [error, setError] = useState<string | null>(null);

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/client-reports/${reportId}/share`);
      const data = await res.json();
      if (res.ok) {
        setLinks(data.shareLinks || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setCreatedUrl(null);
      setError(null);
      fetchLinks();
    }
  }, [isOpen, reportId]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const expiresAt = expiryDays === 'never'
        ? null
        : new Date(Date.now() + parseInt(expiryDays) * 24 * 60 * 60 * 1000).toISOString();

      const res = await fetch(`/api/client-reports/${reportId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresAt,
          password: password.trim() ? password.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate share link');

      setCreatedUrl(data.shareUrl);
      setPassword('');
      fetchLinks();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (linkId: string) => {
    try {
      const res = await fetch(`/api/client-reports/${reportId}/share?linkId=${linkId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setLinks((prev) => prev.filter((l) => l.id !== linkId));
      }
    } catch {
      // Ignored
    }
  };

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card-bg border border-card-border rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-card-border flex items-center justify-between bg-card-border/40/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-brand-red/10 text-brand-red">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-primary">Share Client Report</h3>
              <p className="text-xs text-muted-foreground truncate max-w-sm">{reportTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-text-primary hover:bg-card-border/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* New Link Created Callout */}
          {createdUrl && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                New Link Created
              </span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={createdUrl}
                  className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary focus:outline-none"
                />
                <button
                  onClick={() => handleCopy(createdUrl)}
                  className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Create Form */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Generate New Secure Link
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-primary block mb-1">Expiration</label>
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
                >
                  <option value="7">Expires in 7 days</option>
                  <option value="14">Expires in 14 days</option>
                  <option value="30">Expires in 30 days</option>
                  <option value="90">Expires in 90 days</option>
                  <option value="never">Never expires</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-text-primary block mb-1">Password (Optional)</label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="Leave blank for no password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-bg-main border border-card-border rounded-lg pl-8 pr-3 py-2 text-xs text-text-primary placeholder:text-muted-foreground focus:ring-1 focus:ring-brand-red focus:outline-none"
                  />
                  <Lock className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
                </div>
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full py-2.5 bg-brand-red hover:bg-brand-red/90 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5"
            >
              {creating ? 'Generating...' : 'Generate Public Link'}
            </button>
          </div>

          {/* Active Links List */}
          <div className="space-y-3 pt-4 border-t border-card-border">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Active Share Links ({links.length})
            </h4>

            {loading ? (
              <p className="text-xs text-muted-foreground">Loading links...</p>
            ) : links.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active share links created yet.</p>
            ) : (
              <div className="space-y-2">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="p-3 bg-card-border/40/40 border border-card-border/60 rounded-lg flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">
                          Created {new Date(link.createdAt).toLocaleDateString()}
                        </span>
                        {link.hasPassword && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            <Lock className="w-2.5 h-2.5" /> Protected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Eye className="w-3 h-3" /> {link.viewCount} views
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {link.expiresAt
                            ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}`
                            : 'No expiration'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRevoke(link.id)}
                      title="Revoke Link"
                      className="p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
