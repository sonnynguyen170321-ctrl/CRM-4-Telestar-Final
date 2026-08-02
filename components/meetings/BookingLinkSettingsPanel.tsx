'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Loader2, ExternalLink, Star, StarOff } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

interface BookingLink {
  id: string;
  name: string;
  url: string;
  provider: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  timezone: string;
  durationMins: number;
  instructions?: string | null;
  qualificationNotes?: string | null;
  isDefault: boolean;
  isActive: boolean;
  client: { id: string; name: string };
  campaign?: { id: string; name: string } | null;
}

interface ClientOption {
  id: string;
  name: string;
}

interface CampaignOption {
  id: string;
  name: string;
  clientId: string;
}

const PROVIDERS = [
  { value: 'calendly', label: 'Calendly' },
  { value: 'google_calendar', label: 'Google Calendar' },
  { value: 'hubspot', label: 'HubSpot' },
  { value: 'microsoft_bookings', label: 'Microsoft Bookings' },
  { value: 'salesloft', label: 'SalesLoft' },
  { value: 'other', label: 'Other' },
];

export default function BookingLinkSettingsPanel() {
  const { showToast } = useToast();
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formClientId, setFormClientId] = useState('');
  const [formCampaignId, setFormCampaignId] = useState('');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formProvider, setFormProvider] = useState('other');
  const [formOwnerName, setFormOwnerName] = useState('');
  const [formOwnerEmail, setFormOwnerEmail] = useState('');
  const [formTimezone, setFormTimezone] = useState('UTC');
  const [formDuration, setFormDuration] = useState(30);
  const [formInstructions, setFormInstructions] = useState('');
  const [formQualNotes, setFormQualNotes] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [linksRes, campaignsRes] = await Promise.all([
        fetch('/api/booking-links?activeOnly=false'),
        fetch('/api/campaigns'),
      ]);
      if (linksRes.ok) setLinks(await linksRes.json());
      if (campaignsRes.ok) {
        const campData = await campaignsRes.json();
        const allCampaigns = Array.isArray(campData) ? campData : (campData.campaigns || []);
        setCampaigns(allCampaigns);
        // Extract unique clients
        const clientMap = new Map<string, ClientOption>();
        allCampaigns.forEach((c: any) => {
          if (c.client) clientMap.set(c.client.id, { id: c.client.id, name: c.client.name });
          else if (c.clientId) clientMap.set(c.clientId, { id: c.clientId, name: c.clientName || c.clientId });
        });
        setClients(Array.from(clientMap.values()));
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormClientId('');
    setFormCampaignId('');
    setFormName('');
    setFormUrl('');
    setFormProvider('other');
    setFormOwnerName('');
    setFormOwnerEmail('');
    setFormTimezone('UTC');
    setFormDuration(30);
    setFormInstructions('');
    setFormQualNotes('');
    setFormIsDefault(false);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(link: BookingLink) {
    setEditingId(link.id);
    setFormClientId(link.client.id);
    setFormCampaignId(link.campaign?.id || '');
    setFormName(link.name);
    setFormUrl(link.url);
    setFormProvider(link.provider);
    setFormOwnerName(link.ownerName || '');
    setFormOwnerEmail(link.ownerEmail || '');
    setFormTimezone(link.timezone);
    setFormDuration(link.durationMins);
    setFormInstructions(link.instructions || '');
    setFormQualNotes(link.qualificationNotes || '');
    setFormIsDefault(link.isDefault);
    setShowForm(true);
  }

  async function handleSave() {
    if (!formName || !formUrl) {
      showToast('Name and URL are required', 'error');
      return;
    }
    if (!editingId && !formClientId) {
      showToast('Client is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: formName,
        url: formUrl,
        provider: formProvider,
        ownerName: formOwnerName || null,
        ownerEmail: formOwnerEmail || null,
        timezone: formTimezone,
        durationMins: formDuration,
        instructions: formInstructions || null,
        qualificationNotes: formQualNotes || null,
        isDefault: formIsDefault,
      };

      if (!editingId) {
        payload.clientId = formClientId;
        payload.campaignId = formCampaignId || null;
      } else {
        payload.campaignId = formCampaignId || null;
      }

      const url = editingId ? `/api/booking-links/${editingId}` : '/api/booking-links';
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await readApiError(res, 'Failed to save booking link');
        showToast(msg, 'error');
        return;
      }

      showToast(editingId ? 'Booking link updated' : 'Booking link created', 'success');
      resetForm();
      fetchAll();
    } catch {
      showToast('Failed to save booking link', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this booking link?')) return;
    try {
      const res = await fetch(`/api/booking-links/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('Failed to deactivate link', 'error');
        return;
      }
      showToast('Booking link deactivated', 'success');
      fetchAll();
    } catch {
      showToast('Failed to deactivate link', 'error');
    }
  }

  const filteredCampaigns = formClientId
    ? campaigns.filter(c => (c as any).clientId === formClientId || (c as any).client?.id === formClientId)
    : campaigns;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="type-section text-text-primary">Booking Links</h3>
          <p className="text-sm text-muted mt-0.5">
            Manage booking links for clients and campaigns. SDRs see the correct link for each lead.
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-brand-red hover:bg-brand-red/90 text-white shadow-md transition-all"
        >
          <Plus size={14} /> Add Link
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-surface border border-card-border rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-white">{editingId ? 'Edit' : 'New'} Booking Link</h4>
          <div className="grid grid-cols-2 gap-3">
            {!editingId && (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Client *</label>
                <select
                  value={formClientId}
                  onChange={e => { setFormClientId(e.target.value); setFormCampaignId(''); }}
                  className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50"
                >
                  <option value="">Select client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Campaign (optional)</label>
              <select
                value={formCampaignId}
                onChange={e => setFormCampaignId(e.target.value)}
                className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50"
              >
                <option value="">Client-level (all campaigns)</option>
                {filteredCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Link Name *</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. John's Calendly" className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Provider</label>
              <select value={formProvider} onChange={e => setFormProvider(e.target.value)} className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50">
                {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">URL *</label>
            <input type="url" value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://calendly.com/..." className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Owner Name</label>
              <input type="text" value={formOwnerName} onChange={e => setFormOwnerName(e.target.value)} className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Owner Email</label>
              <input type="email" value={formOwnerEmail} onChange={e => setFormOwnerEmail(e.target.value)} className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Duration</label>
              <select value={formDuration} onChange={e => setFormDuration(Number(e.target.value))} className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50">
                {[15, 30, 45, 60, 90, 120].map(d => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Instructions (optional)</label>
            <textarea value={formInstructions} onChange={e => setFormInstructions(e.target.value)} rows={2} placeholder="SDR instructions for this booking link..." className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Qualification Notes (optional)</label>
            <textarea value={formQualNotes} onChange={e => setFormQualNotes(e.target.value)} rows={2} placeholder="Qualification criteria..." className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-red/50 resize-none" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={formIsDefault} onChange={e => setFormIsDefault(e.target.checked)} className="w-4 h-4 rounded border-card-border bg-card-bg text-brand-red focus:ring-brand-red/50" />
            <span className="text-sm text-white">Set as default for this client/campaign</span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={resetForm} className="px-3 py-2 text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand-red hover:bg-brand-red/90 text-white shadow-md transition-all disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading…
        </div>
      ) : links.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm">
          No booking links yet. Create one to get started.
        </div>
      ) : (
        <div className="border border-card-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface/50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Client</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Campaign</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Provider</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Duration</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-muted">Default</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {links.map(link => (
                <tr key={link.id} className={`hover:bg-surface/30 transition-colors ${!link.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{link.name}</span>
                      <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{link.client.name}</td>
                  <td className="px-4 py-3 text-muted">{link.campaign?.name || '—'}</td>
                  <td className="px-4 py-3 text-muted capitalize">{link.provider.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-muted">{link.durationMins}m</td>
                  <td className="px-4 py-3 text-center">
                    {link.isDefault ? (
                      <Star size={14} className="text-amber-400 mx-auto" />
                    ) : (
                      <StarOff size={14} className="text-muted/30 mx-auto" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(link)} className="p-1.5 text-muted hover:text-white rounded-md hover:bg-surface transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(link.id)} className="p-1.5 text-muted hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
