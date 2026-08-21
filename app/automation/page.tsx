'use client';

import { useState, useEffect } from 'react';
import { 
  Cpu, 
  Play, 
  RefreshCw, 
  Mail, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Webhook, 
  Sliders, 
  Plus, 
  Trash2, 
  Send, 
  Check, 
  Flame, 
  Zap, 
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { DEFAULT_SCORING_RULES, type LeadScoringRules } from '@/lib/leads/scoring';
import type { WebhookConfigPublic, WebhookEvent } from '@/lib/webhooks/dispatcher';

interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  isActive: boolean;
  lastSyncAt: string | null;
  dailySendCount: number;
  dailyCap: number;
  dailySendDate: string | null;
  hourlySendWindow: number;
  user: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface StatsMetrics {
  totalActiveSequences: number;
  totalPendingOutbound: number;
  totalActiveAccounts: number;
  needsAttention: number;
}


const AVAILABLE_EVENTS: Array<{ key: WebhookEvent; label: string; desc: string }> = [
  { key: 'lead.created', label: 'Lead Created', desc: 'Fired when a new prospect is added to the CRM' },
  { key: 'lead.stage_changed', label: 'Lead Stage Changed', desc: 'Fired when a lead advances (e.g. Replied, Won)' },
  { key: 'meeting.booked', label: 'Meeting Booked', desc: 'Fired when a prospect schedules a demo call' },
  { key: 'sequence.completed', label: 'Sequence Completed', desc: 'Fired when all sequence steps finish' },
  { key: 'inbound.reply_received', label: 'Inbound Reply Received', desc: 'Fired when a prospect replies to outreach' },
];

export default function AutomationDashboard() {
  const { isManager, isSessionLoading } = useAppContext();
  const { showToast } = useToast();
  const router = useRouter();

  // Role Gate: Automation Hub is restricted to Floor Managers and above
  useEffect(() => {
    if (!isSessionLoading && !isManager) {
      router.replace('/');
    }
  }, [isSessionLoading, isManager, router]);

  const [activeTab, setActiveTab] = useState<'cadence' | 'webhooks' | 'scoring'>('cadence');

  // Cadence Automation State
  const [metrics, setMetrics] = useState<StatsMetrics>({
    totalActiveSequences: 0,
    totalPendingOutbound: 0,
    totalActiveAccounts: 0,
    needsAttention: 0,
  });
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [isTriggeringSequence, setIsTriggeringSequence] = useState<boolean>(false);
  const [isTriggeringInbox, setIsTriggeringInbox] = useState<boolean>(false);
  const [sequenceResult, setSequenceResult] = useState<any | null>(null);

  // Webhooks State
  const [webhooks, setWebhooks] = useState<WebhookConfigPublic[]>([]);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>([
    'lead.created',
    'meeting.booked',
    'inbound.reply_received',
  ]);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any | null>(null);

  // Lead Scoring Rules State
  const [scoringRules, setScoringRules] = useState<LeadScoringRules>(DEFAULT_SCORING_RULES);
  const [savingScoring, setSavingScoring] = useState(false);
  const [recalculatingScores, setRecalculatingScores] = useState(false);
  const [recalcSummary, setRecalcSummary] = useState<any | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/automation/stats');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
        setEmailAccounts(data.emailAccounts);
      } else {
        showToast('Failed to load automation stats', 'error');
      }
    } catch {
      showToast('Network error loading automation stats', 'error');
    }
  };

  const fetchWebhooks = async () => {
    try {
      const res = await fetch('/api/webhooks');
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks || []);
      }
    } catch {
      showToast('Failed to load webhooks', 'error');
    }
  };

  const fetchScoringRules = async () => {
    try {
      const res = await fetch('/api/leads/scoring-rules');
      if (res.ok) {
        const data = await res.json();
        if (data.rules) setScoringRules(data.rules);
      }
    } catch {
      showToast('Failed to load lead scoring rules', 'error');
    }
  };

  useEffect(() => {
    fetchStats();
    fetchWebhooks();
    fetchScoringRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTriggerSequence = async () => {
    setIsTriggeringSequence(true);
    setSequenceResult(null);
    try {
      const res = await fetch('/api/cron/sequence-engine');
      const data = await res.json();
      if (res.ok) {
        setSequenceResult(data);
        showToast('Sequence Engine execution completed successfully!', 'success');
        fetchStats();
      } else {
        setSequenceResult({ error: data.error || 'Failed to execute Sequence Engine' });
        showToast('Sequence Engine execution failed', 'error');
      }
    } catch {
      setSequenceResult({ error: 'Network error triggering sequence engine' });
      showToast('Sequence Engine trigger failed', 'error');
    } finally {
      setIsTriggeringSequence(false);
    }
  };

  const handleTriggerInbox = async () => {
    setIsTriggeringInbox(true);
    try {
      const res = await fetch('/api/cron/inbox-sync');
      const data = await res.json();
      if (res.ok) {
        showToast('Inbox synchronization completed successfully!', 'success');
        fetchStats();
      } else {
        showToast(data.error || 'Failed to sync inboxes', 'error');
      }
    } catch {
      showToast('Inbox Sync trigger failed', 'error');
    } finally {
      setIsTriggeringInbox(false);
    }
  };

  const handleSaveWebhook = async () => {
    if (!newWebhookUrl.startsWith('http')) {
      showToast('Please provide a valid http/https URL', 'error');
      return;
    }
    if (selectedEvents.length === 0) {
      showToast('Please select at least one trigger event', 'error');
      return;
    }

    setSavingWebhook(true);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newWebhookUrl,
          secret: newWebhookSecret || undefined,
          events: selectedEvents,
          isActive: true,
        }),
      });

      if (res.ok) {
        showToast('Webhook endpoint added successfully!', 'success');
        setShowAddWebhook(false);
        setNewWebhookUrl('');
        setNewWebhookSecret('');
        fetchWebhooks();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to add webhook', 'error');
      }
    } catch {
      showToast('Network error saving webhook', 'error');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook endpoint?')) return;
    try {
      const res = await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Webhook deleted', 'success');
        fetchWebhooks();
      }
    } catch {
      showToast('Failed to delete webhook', 'error');
    }
  };

  const handleTestWebhook = async (webhook: WebhookConfigPublic) => {
    setTestingWebhookId(webhook.id);
    setTestResult(null);
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Send the id, not the URL and secret. The server resolves both, so the signing
          // secret never has to reach the browser (TEL-P1-031).
          webhookId: webhook.id,
          event: webhook.events[0] || 'test.ping',
        }),
      });
      const data = await res.json();
      setTestResult({ webhookId: webhook.id, ...data });
      if (data.success) {
        showToast(`Test ping succeeded! HTTP ${data.statusCode} (${data.latencyMs}ms)`, 'success');
      } else {
        showToast(`Test ping failed: ${data.error || `HTTP ${data.statusCode}`}`, 'error');
      }
    } catch {
      showToast('Failed to dispatch test webhook', 'error');
    } finally {
      setTestingWebhookId(null);
    }
  };

  const handleSaveScoringRules = async () => {
    setSavingScoring(true);
    try {
      const res = await fetch('/api/leads/scoring-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scoringRules),
      });
      if (res.ok) {
        showToast('Lead scoring rules updated!', 'success');
      } else {
        showToast('Failed to save scoring rules', 'error');
      }
    } catch {
      showToast('Network error saving scoring rules', 'error');
    } finally {
      setSavingScoring(false);
    }
  };

  const handleRecalculateScores = async () => {
    setRecalculatingScores(true);
    setRecalcSummary(null);
    try {
      const res = await fetch('/api/leads/recalculate-scores', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRecalcSummary(data);
        showToast(`Recalculated scores for ${data.updatedCount} leads!`, 'success');
      } else {
        showToast(data.error || 'Recalculation failed', 'error');
      }
    } catch {
      showToast('Network error recalculating scores', 'error');
    } finally {
      setRecalculatingScores(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-text-primary flex items-center gap-2.5">
            <Cpu className="w-7 h-7 text-brand-red" />
            Automation & Integrations Hub
          </h1>
          <p className="text-xs text-text-secondary mt-1 font-medium">
            Manage BullMQ background cadences, outbound webhooks, and custom lead scoring algorithms.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-card-bg border border-card-border p-1 rounded-xl gap-1 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('cadence')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'cadence'
                ? 'bg-brand-red text-white shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Cadence Workers</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('webhooks')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'webhooks'
                ? 'bg-brand-red text-white shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Webhook className="w-3.5 h-3.5" />
            <span>Outbound Webhooks</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('scoring')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'scoring'
                ? 'bg-brand-red text-white shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Lead Scoring Rules</span>
          </button>
        </div>
      </div>

      {/* TAB 1: CADENCE WORKERS & QUEUES */}
      {activeTab === 'cadence' && (
        <div className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-3 gap-5 stagger-container">
            <div className="glass-card rounded-2xl p-5 hover-lift relative overflow-hidden flex items-center gap-4 stagger-child">
              <div className="w-12 h-12 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl flex items-center justify-center">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-text-secondary block font-semibold uppercase tracking-wider font-display">Active Sequence Enrolls</span>
                <span className="text-2xl font-extrabold text-text-primary font-display mt-0.5 block">{metrics.totalActiveSequences}</span>
              </div>
            </div>

            <div className="glass-card rounded-2xl p-5 hover-lift relative overflow-hidden flex items-center gap-4 stagger-child">
              <div className="w-12 h-12 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl flex items-center justify-center">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-text-secondary block font-semibold uppercase tracking-wider font-display">Outbound Email Queue</span>
                <span className="text-2xl font-extrabold text-text-primary font-display mt-0.5 block">{metrics.totalPendingOutbound}</span>
              </div>
            </div>

            <div className="glass-card rounded-2xl p-5 hover-lift relative overflow-hidden flex items-center gap-4 stagger-child">
              <div className="w-12 h-12 bg-green-500/10 text-green-400 border border-green-500/20 rounded-xl flex items-center justify-center">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-text-secondary block font-semibold uppercase tracking-wider font-display">Connected Mailboxes</span>
                <span className="text-2xl font-extrabold text-text-primary font-display mt-0.5 block">{metrics.totalActiveAccounts}</span>
              </div>
            </div>
          </div>

          {/* Main Execution Board */}
          <div className="grid grid-cols-12 gap-6 items-start">
            <div className="col-span-5 space-y-6">
              <div className="glass-card rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="font-display font-extrabold text-sm text-text-primary flex items-center gap-2">
                      <Cpu className="w-4.5 h-4.5 text-brand-orange-text" />
                      Outreach Automation Workers
                    </h2>
                    <p className="text-[11px] text-text-secondary leading-relaxed">
                      Automated sequence emails execute continuously in background BullMQ workers. Click below to run a manual maintenance cycle.
                    </p>
                  </div>
                </div>

                {isManager && (
                  <button
                    onClick={handleTriggerSequence}
                    disabled={isTriggeringSequence}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm ${
                      isTriggeringSequence 
                        ? 'bg-brand-dark border border-card-border text-text-muted cursor-not-allowed'
                        : 'bg-brand-red hover:bg-brand-red-hover text-white'
                    }`}
                  >
                    {isTriggeringSequence ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Running Maintenance Check...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        Run Maintenance & Repair Check
                      </>
                    )}
                  </button>
                )}

                {sequenceResult && (
                  <div className={`p-3.5 rounded-xl border text-xs leading-relaxed animate-fade-in ${
                    sequenceResult.error 
                      ? 'bg-red-500/10 border-red-500/20 text-red-400' 
                      : 'bg-green-500/10 border-green-500/20 text-green-400'
                  }`}>
                    {sequenceResult.error ? (
                      <p>Error: {sequenceResult.error}</p>
                    ) : (
                      <div>
                        <p className="font-bold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Check Successful
                        </p>
                        <p className="mt-1 text-[11px] opacity-90">{sequenceResult.message || 'Queues healthy.'}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="glass-card rounded-2xl p-5 space-y-4">
                <div className="space-y-1">
                  <h2 className="font-display font-extrabold text-sm text-text-primary flex items-center gap-2">
                    <RefreshCw className="w-4.5 h-4.5 text-blue-400" />
                    Inbound Mailbox Synchronization
                  </h2>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Synchronizes IMAP/Gmail/Outlook mailboxes, updates prospect reply states, and detects out-of-office replies.
                  </p>
                </div>

                {isManager && (
                  <button
                    onClick={handleTriggerInbox}
                    disabled={isTriggeringInbox}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm ${
                      isTriggeringInbox 
                        ? 'bg-brand-dark border border-card-border text-text-muted cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {isTriggeringInbox ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Syncing Mailboxes...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        Sync Inbound Messages Now
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Right Hand: Mailbox Health & Rate Limits */}
            <div className="col-span-7 space-y-6">
              <div className="glass-card rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="font-display font-extrabold text-sm text-text-primary flex items-center gap-2">
                    <ShieldCheck className="w-4.5 h-4.5 text-green-400" />
                    Mailbox Sending Caps & Health Status
                  </h2>
                  <p className="text-[11px] text-text-secondary">
                    Guardrails and daily deliverability throttling across all connected sales inboxes.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-card-border text-[10px] uppercase text-text-secondary tracking-wider font-semibold">
                        <th className="py-2.5">Mailbox Email</th>
                        <th className="py-2.5">SDR Assignee</th>
                        <th className="py-2.5">Today Sent / Cap</th>
                        <th className="py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/50">
                      {emailAccounts.map((acc) => (
                        <tr key={acc.id} className="hover:bg-card-bg/20 transition-colors">
                          <td className="py-3 font-mono text-[11px] text-text-primary">{acc.email}</td>
                          <td className="py-3 text-text-secondary">{acc.user.firstName} {acc.user.lastName}</td>
                          <td className="py-3 font-medium">
                            <span className={acc.dailySendCount >= acc.dailyCap ? 'text-red-400 font-bold' : 'text-text-primary'}>
                              {acc.dailySendCount}
                            </span>
                            <span className="text-text-muted"> / {acc.dailyCap}</span>
                          </td>
                          <td className="py-3">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/25">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                              Active
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: OUTBOUND WEBHOOKS */}
      {activeTab === 'webhooks' && (
        <div className="space-y-6">
          <div className="glass-card rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-extrabold text-base text-text-primary flex items-center gap-2">
                  <Webhook className="w-5 h-5 text-brand-red" />
                  Real-Time Event Webhook Endpoints
                </h2>
                <p className="text-xs text-text-secondary mt-1">
                  Deliver signed HMAC-SHA256 event streams to your external apps (Zapier, Make, Slack, internal microservices).
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowAddWebhook(true)}
                className="px-3.5 py-2 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Add Webhook Endpoint</span>
              </button>
            </div>

            {/* Add Webhook Modal / Panel */}
            {showAddWebhook && (
              <div className="bg-[#fafafa] border border-card-border rounded-2xl p-5 space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Configure New Webhook</h3>
                  <button onClick={() => setShowAddWebhook(false)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-text-muted uppercase block mb-1">Payload URL (HTTPS required in prod)</label>
                    <input
                      type="url"
                      placeholder="https://api.yourcompany.com/telestar-webhook"
                      value={newWebhookUrl}
                      onChange={(e) => setNewWebhookUrl(e.target.value)}
                      className="w-full bg-white border border-card-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-brand-red"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-text-muted uppercase block mb-1">Signing Secret (Auto-generated if blank)</label>
                    <input
                      type="text"
                      placeholder="whsec_xxxxxxxx..."
                      value={newWebhookSecret}
                      onChange={(e) => setNewWebhookSecret(e.target.value)}
                      className="w-full bg-white border border-card-border rounded-xl px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-brand-red"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-text-muted uppercase block mb-1">Signature Scheme</label>
                    <div className="px-3 py-2 bg-card-bg border border-card-border rounded-xl text-xs font-mono text-text-secondary">
                      X-Telestar-Signature-256 (HMAC-SHA256)
                    </div>
                  </div>

                  <div className="col-span-2 space-y-2">
                    <label className="text-[10px] font-bold text-text-muted uppercase block">Trigger Events</label>
                    <div className="grid grid-cols-2 gap-2">
                      {AVAILABLE_EVENTS.map((evt) => {
                        const isSelected = selectedEvents.includes(evt.key);
                        return (
                          <label
                            key={evt.key}
                            className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                              isSelected ? 'bg-brand-red/5 border-brand-red/30' : 'bg-white border-card-border hover:bg-card-bg/30'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedEvents([...selectedEvents, evt.key]);
                                else setSelectedEvents(selectedEvents.filter((k) => k !== evt.key));
                              }}
                              className="mt-0.5 rounded text-brand-red focus:ring-brand-red"
                            />
                            <div>
                              <p className="text-xs font-bold text-text-primary">{evt.label}</p>
                              <p className="text-[10px] text-text-muted">{evt.desc}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowAddWebhook(false)}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveWebhook}
                    disabled={savingWebhook}
                    className="px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-1.5"
                  >
                    {savingWebhook ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Save Webhook
                  </button>
                </div>
              </div>
            )}

            {/* Webhook Endpoints Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-card-border text-[10px] uppercase text-text-secondary tracking-wider font-semibold">
                    <th className="py-2.5">Endpoint URL</th>
                    <th className="py-2.5">Subscribed Events</th>
                    <th className="py-2.5">Signing Secret</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50">
                  {webhooks.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-text-muted">
                        No webhooks configured yet. Click "Add Webhook Endpoint" above to connect external services.
                      </td>
                    </tr>
                  ) : (
                    webhooks.map((wh) => (
                      <tr key={wh.id} className="hover:bg-card-bg/20 transition-colors">
                        <td className="py-3.5 font-mono text-[11px] text-text-primary max-w-xs truncate">
                          {wh.url}
                        </td>
                        <td className="py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {wh.events.map((e) => (
                              <span key={e} className="px-1.5 py-0.5 bg-card-border/60 rounded text-[9px] font-mono text-text-secondary">
                                {e}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 font-mono text-[10px] text-text-muted">
                          {wh.secretSet ? '••••••••••••' : 'not set'}
                        </td>
                        <td className="py-3.5 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleTestWebhook(wh)}
                            disabled={testingWebhookId === wh.id}
                            className="px-2.5 py-1 rounded-lg bg-card-border hover:bg-card-border/80 text-text-primary text-[10px] font-bold transition-colors inline-flex items-center gap-1"
                          >
                            {testingWebhookId === wh.id ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Pinging...</span>
                              </>
                            ) : (
                              <>
                                <Send className="w-3 h-3" />
                                <span>Test Ping</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteWebhook(wh.id)}
                            className="p-1 rounded-lg text-text-muted hover:text-red-500 transition-colors inline-block align-middle"
                            title="Delete Webhook"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Test Result Inspector Banner */}
            {testResult && (
              <div className={`p-4 rounded-xl border text-xs leading-relaxed animate-fade-in ${
                testResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800' : 'bg-red-500/10 border-red-500/20 text-red-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    {testResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-red-600" />}
                    {testResult.success ? 'Test Ping Delivered Successfully' : 'Test Ping Failed'}
                  </span>
                  <span className="font-mono text-[10px]">
                    Latency: {testResult.latencyMs}ms {testResult.statusCode ? `· HTTP ${testResult.statusCode}` : ''}
                  </span>
                </div>
                {testResult.error && <p className="mt-1 text-[11px] opacity-90">Error: {testResult.error}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CUSTOM LEAD SCORING RULES */}
      {activeTab === 'scoring' && (
        <div className="space-y-6">
          <div className="glass-card rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-extrabold text-base text-text-primary flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-brand-red" />
                  Custom Lead Scoring Algorithm & Weights
                </h2>
                <p className="text-xs text-text-secondary mt-1">
                  Configure real-time point distribution for seniority, intent signals, and cadence engagement.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRecalculateScores}
                  disabled={recalculatingScores}
                  className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-xs"
                >
                  {recalculatingScores ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                  <span>Recalculate All Leads</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveScoringRules}
                  disabled={savingScoring}
                  className="px-3.5 py-2 bg-brand-red hover:bg-brand-red-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  {savingScoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>Save Scoring Weights</span>
                </button>
              </div>
            </div>

            {/* Recalculation Summary Banner */}
            {recalcSummary && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 rounded-xl p-4 flex items-center justify-between animate-fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">Successfully Recalculated {recalcSummary.updatedCount} Leads</p>
                    <p className="text-[10px] opacity-80">Scores & priorities synchronized with multi-tenant database.</p>
                  </div>
                </div>

                <div className="flex gap-2 text-xs font-mono font-bold">
                  <span className="px-2 py-0.5 bg-red-500/20 text-red-700 rounded-md">🔥 {recalcSummary.distribution.hot} Hot</span>
                  <span className="px-2 py-0.5 bg-amber-500/20 text-amber-700 rounded-md">⚡ {recalcSummary.distribution.warm} Warm</span>
                  <span className="px-2 py-0.5 bg-blue-500/20 text-blue-700 rounded-md">❄️ {recalcSummary.distribution.cold} Cold</span>
                </div>
              </div>
            )}

            {/* Scoring Weight Sliders / Inputs */}
            <div className="grid grid-cols-2 gap-6">
              {/* Factor 1: C-Level */}
              <div className="bg-[#fafafa] border border-card-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-text-primary">👑 C-Level / Founder Title Match</span>
                  <span className="text-xs font-mono font-bold text-brand-red">+{scoringRules.titleCLevelWeight} pts</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={scoringRules.titleCLevelWeight}
                  onChange={(e) => setScoringRules({ ...scoringRules, titleCLevelWeight: Number(e.target.value) })}
                  className="w-full accent-brand-red cursor-pointer"
                />
              </div>

              {/* Factor 2: Director */}
              <div className="bg-[#fafafa] border border-card-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-text-primary">💼 Director / VP Title Match</span>
                  <span className="text-xs font-mono font-bold text-brand-red">+{scoringRules.titleDirectorWeight} pts</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={scoringRules.titleDirectorWeight}
                  onChange={(e) => setScoringRules({ ...scoringRules, titleDirectorWeight: Number(e.target.value) })}
                  className="w-full accent-brand-red cursor-pointer"
                />
              </div>

              {/* Factor 3: Email Open */}
              <div className="bg-[#fafafa] border border-card-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-text-primary">📩 Email Open (per touch, max 4)</span>
                  <span className="text-xs font-mono font-bold text-brand-red">+{scoringRules.emailOpenWeight} pts</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  value={scoringRules.emailOpenWeight}
                  onChange={(e) => setScoringRules({ ...scoringRules, emailOpenWeight: Number(e.target.value) })}
                  className="w-full accent-brand-red cursor-pointer"
                />
              </div>

              {/* Factor 4: Email Reply */}
              <div className="bg-[#fafafa] border border-card-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-text-primary">💬 Inbound Email Reply Received</span>
                  <span className="text-xs font-mono font-bold text-brand-red">+{scoringRules.emailReplyWeight} pts</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={scoringRules.emailReplyWeight}
                  onChange={(e) => setScoringRules({ ...scoringRules, emailReplyWeight: Number(e.target.value) })}
                  className="w-full accent-brand-red cursor-pointer"
                />
              </div>

              {/* Factor 5: Meeting Booked */}
              <div className="bg-[#fafafa] border border-card-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-text-primary">📅 Meeting Booked / Demo Scheduled</span>
                  <span className="text-xs font-mono font-bold text-brand-red">+{scoringRules.meetingBookedWeight} pts</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  value={scoringRules.meetingBookedWeight}
                  onChange={(e) => setScoringRules({ ...scoringRules, meetingBookedWeight: Number(e.target.value) })}
                  className="w-full accent-brand-red cursor-pointer"
                />
              </div>

              {/* Factor 6: Direct Phone */}
              <div className="bg-[#fafafa] border border-card-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-text-primary">📞 Direct Phone Number Verified</span>
                  <span className="text-xs font-mono font-bold text-brand-red">+{scoringRules.phonePresentWeight} pts</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={scoringRules.phonePresentWeight}
                  onChange={(e) => setScoringRules({ ...scoringRules, phonePresentWeight: Number(e.target.value) })}
                  className="w-full accent-brand-red cursor-pointer"
                />
              </div>

              {/* Factor 7: Hot Threshold */}
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-red-700">🔥 "HOT" Priority Threshold</span>
                  <span className="text-xs font-mono font-bold text-red-700">&gt;= {scoringRules.hotThreshold} pts</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="90"
                  value={scoringRules.hotThreshold}
                  onChange={(e) => setScoringRules({ ...scoringRules, hotThreshold: Number(e.target.value) })}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>

              {/* Factor 8: Warm Threshold */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-amber-700">⚡ "WARM" Priority Threshold</span>
                  <span className="text-xs font-mono font-bold text-amber-700">&gt;= {scoringRules.warmThreshold} pts</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="50"
                  value={scoringRules.warmThreshold}
                  onChange={(e) => setScoringRules({ ...scoringRules, warmThreshold: Number(e.target.value) })}
                  className="w-full accent-amber-600 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
