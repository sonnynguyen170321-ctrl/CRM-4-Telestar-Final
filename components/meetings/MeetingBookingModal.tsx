'use client';

import React, { useState, useEffect } from 'react';
import { X, Copy, ExternalLink, Calendar, Loader2, Send } from 'lucide-react';
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
}

interface MeetingBookingModalProps {
  leadId: string;
  leadName: string;
  clientId: string;
  campaignId: string;
  onClose: () => void;
  onMeetingCreated?: () => void;
}

export default function MeetingBookingModal({
  leadId,
  leadName,
  clientId,
  campaignId,
  onClose,
  onMeetingCreated,
}: MeetingBookingModalProps) {
  const { showToast } = useToast();
  const [bookingLinks, setBookingLinks] = useState<BookingLink[]>([]);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [mode, setMode] = useState<'link_sent' | 'scheduled'>('scheduled');
  const [loading, setLoading] = useState(false);
  const [linksLoading, setLinksLoading] = useState(true);

  // Scheduling fields
  const [scheduledAt, setScheduledAt] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [title, setTitle] = useState('');
  const [durationMins, setDurationMins] = useState(30);

  useEffect(() => {
    fetchBookingLinks();
  }, [clientId, campaignId]);

  async function fetchBookingLinks() {
    setLinksLoading(true);
    try {
      const res = await fetch(`/api/booking-links?clientId=${clientId}&campaignId=${campaignId}`);
      if (res.ok) {
        const links = await res.json();
        setBookingLinks(links);
        if (links.length > 0) {
          setSelectedLinkId(links[0].id);
          setDurationMins(links[0].durationMins || 30);
        }
      }
    } catch (err) {
      console.error('Failed to load booking links:', err);
    } finally {
      setLinksLoading(false);
    }
  }

  const selectedLink = bookingLinks.find(l => l.id === selectedLinkId);

  async function copyLink() {
    if (selectedLink) {
      await navigator.clipboard.writeText(selectedLink.url);
      showToast('Booking link copied to clipboard', 'success');
    }
  }

  async function openLink() {
    if (selectedLink) {
      window.open(selectedLink.url, '_blank');
    }
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const payload: Record<string, any> = {
        leadId,
        bookingLinkId: selectedLinkId,
        status: mode,
      };

      if (title) payload.title = title;
      if (mode === 'scheduled') {
        if (!scheduledAt) {
          showToast('Please select a date and time', 'error');
          setLoading(false);
          return;
        }
        payload.scheduledAt = new Date(scheduledAt).toISOString();
        payload.durationMins = durationMins;
        if (meetingUrl) payload.meetingUrl = meetingUrl;
      }

      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await readApiError(res, 'Failed to schedule meeting');
        showToast(msg, 'error');
        return;
      }

      showToast(
        mode === 'link_sent'
          ? 'Booking link sent recorded'
          : 'Meeting scheduled successfully',
        'success'
      );
      onMeetingCreated?.();
      onClose();
    } catch (err) {
      showToast('Failed to create meeting', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card-bg border border-card-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-card-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Book Meeting</h2>
            <p className="text-sm text-text-muted mt-0.5">{leadName}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Booking Link Selection */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Booking Link</label>
            {linksLoading ? (
              <div className="flex items-center gap-2 text-text-muted text-sm py-2">
                <Loader2 size={14} className="animate-spin" /> Loading links…
              </div>
            ) : bookingLinks.length === 0 ? (
              <p className="text-sm text-text-muted py-2">No booking links configured for this client/campaign.</p>
            ) : (
              <>
                <select
                  value={selectedLinkId || ''}
                  onChange={e => {
                    setSelectedLinkId(e.target.value);
                    const link = bookingLinks.find(l => l.id === e.target.value);
                    if (link) setDurationMins(link.durationMins || 30);
                  }}
                  className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none"
                >
                  {bookingLinks.map(link => (
                    <option key={link.id} value={link.id}>
                      {link.name} ({link.provider.replace('_', ' ')}) — {link.durationMins}min
                    </option>
                  ))}
                </select>

                {/* Link actions */}
                {selectedLink && (
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={copyLink}
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded-md hover:bg-blue-500/10"
                    >
                      <Copy size={12} /> Copy Link
                    </button>
                    <button
                      onClick={openLink}
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded-md hover:bg-blue-500/10"
                    >
                      <ExternalLink size={12} /> Open Link
                    </button>
                  </div>
                )}

                {/* Instructions */}
                {selectedLink?.instructions && (
                  <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300">
                    <span className="font-semibold">Instructions:</span> {selectedLink.instructions}
                  </div>
                )}

                {/* Qualification notes */}
                {selectedLink?.qualificationNotes && (
                  <div className="mt-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-300">
                    <span className="font-semibold">Qualification:</span> {selectedLink.qualificationNotes}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mode toggle */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Action</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('link_sent')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                  mode === 'link_sent'
                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                    : 'bg-card-bg border-card-border text-text-muted hover:text-text-primary hover:border-card-border-hover'
                }`}
              >
                <Send size={14} /> Mark Link Sent
              </button>
              <button
                onClick={() => setMode('scheduled')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                  mode === 'scheduled'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    : 'bg-card-bg border-card-border text-text-muted hover:text-text-primary hover:border-card-border-hover'
                }`}
              >
                <Calendar size={14} /> Schedule Meeting
              </button>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Meeting Title <span className="text-text-muted/60">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={`Meeting with ${leadName}`}
              className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none"
            />
          </div>

          {/* Scheduling fields (only for 'scheduled' mode) */}
          {mode === 'scheduled' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Date & Time *</label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Duration (min)</label>
                  <select
                    value={durationMins}
                    onChange={e => setDurationMins(Number(e.target.value))}
                    className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none"
                  >
                    {[15, 30, 45, 60, 90, 120].map(d => (
                      <option key={d} value={d}>{d} minutes</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Meeting URL <span className="text-text-muted/60">(optional)</span>
                </label>
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={e => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/..."
                  className="w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-brand-red/50 focus:border-brand-red/50 outline-none"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-card-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 bg-brand-red hover:bg-brand-red/90 text-white shadow-md"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {mode === 'link_sent' ? 'Record Link Sent' : 'Schedule Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}
