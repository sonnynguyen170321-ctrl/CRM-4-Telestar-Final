import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ArrowUpRight } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  stage: 'meeting_booked' | 'won' | 'lost' | string;
  assignedTo: {
    id: string;
    firstName: string;
    lastName: string;
  };
  campaign: {
    id: string;
    name: string;
    client: {
      name: string;
    };
  };
  activities: {
    createdAt: string;
  }[];
}

interface MeetingsBoardProps {
  onSelectLead: (id: string) => void;
}

export default function MeetingsBoard({ onSelectLead }: MeetingsBoardProps) {
  const { showToast } = useToast();
  const [meetings, setMeetings] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterStage, setFilterStage] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/team/meetings');
      if (res.ok) {
        const data = await res.json();
        setMeetings(data);
      }
    } catch {
      showToast('Failed to load meetings data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const handleUpdateStage = async (leadId: string, newStage: 'won' | 'lost' | 'sequence_active') => {
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        showToast(
          `Lead outcome updated to ${
            newStage === 'won' ? 'Won' : newStage === 'lost' ? 'Lost' : 'Active'
          }`,
          'success'
        );
        fetchMeetings(); // Refresh the list
      } else {
        showToast('Failed to update lead outcome', 'error');
      }
    } catch {
      showToast('Error updating lead outcome', 'error');
    }
  };

  // KPI calculations
  const totalBooked = meetings.length;
  const wonCount = meetings.filter((m) => m.stage === 'won').length;
  const lostCount = meetings.filter((m) => m.stage === 'lost').length;
  const winRate = totalBooked > 0 ? Math.round((wonCount / totalBooked) * 100) : 0;

  // Filter & Search logic
  const filteredMeetings = meetings.filter((m) => {
    const matchesStage =
      filterStage === 'all' ||
      (filterStage === 'scheduled' && m.stage === 'meeting_booked') ||
      (filterStage === 'won' && m.stage === 'won') ||
      (filterStage === 'lost' && m.stage === 'lost');

    const fullName = `${m.firstName} ${m.lastName} ${m.company} ${m.assignedTo?.firstName} ${m.assignedTo?.lastName}`.toLowerCase();
    const matchesSearch = fullName.includes(searchQuery.toLowerCase());

    return matchesStage && matchesSearch;
  });

  return (
    <div className="space-y-5">
      {/* Executive Metrics Bar — Clean borderless data layout */}
      <div className="grid grid-cols-4 gap-4 p-5 bg-card-bg border border-card-border rounded-xl shadow-xs">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-text-muted">Total Booked</span>
          <span className="font-display font-extrabold text-2xl text-text-primary mt-1">{totalBooked}</span>
        </div>

        <div className="flex flex-col border-l border-card-border/60 pl-4">
          <span className="text-xs font-semibold text-text-muted">Won / Closed</span>
          <span className="font-display font-extrabold text-2xl text-emerald-600 mt-1">{wonCount}</span>
        </div>

        <div className="flex flex-col border-l border-card-border/60 pl-4">
          <span className="text-xs font-semibold text-text-muted">Lost / No-Show</span>
          <span className="font-display font-extrabold text-2xl text-rose-600 mt-1">{lostCount}</span>
        </div>

        <div className="flex flex-col border-l border-card-border/60 pl-4">
          <span className="text-xs font-semibold text-text-muted">Win Rate</span>
          <span className="font-display font-extrabold text-2xl text-amber-600 mt-1">{winRate}%</span>
        </div>
      </div>

      {/* Filter Header — Integrated control toolbar without card-in-card wrapper */}
      <div className="flex flex-row items-center justify-between gap-4 py-1">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-card-bg border border-card-border rounded-lg px-3.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red placeholder-text-muted w-64 font-medium transition-colors"
          />
          <nav className="flex items-center gap-1 bg-gray-100/70 p-1 rounded-lg border border-card-border/40">
            {['all', 'scheduled', 'won', 'lost'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStage(st)}
                className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-all ${
                  filterStage === st
                    ? 'bg-white text-text-primary shadow-xs border border-card-border/60'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {st === 'scheduled' ? 'Scheduled' : st}
              </button>
            ))}
          </nav>
        </div>

        <button
          onClick={fetchMeetings}
          className="flex items-center gap-1.5 bg-card-bg border border-card-border hover:bg-gray-50 rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary transition-all active:scale-98"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Board</span>
        </button>
      </div>

      {/* Table Listing — Generous row height & clear typographic contrast */}
      {loading && meetings.length === 0 ? (
        <div className="flex items-center justify-center py-20 bg-card-bg border border-card-border rounded-xl">
          <div className="w-6 h-6 border-2 border-brand-red/30 border-t-brand-red rounded-full animate-spin" />
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="bg-card-bg border border-card-border p-12 rounded-xl text-center text-xs text-text-muted font-medium">
          No booked meetings matched the selected filters.
        </div>
      ) : (
        <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-card-border bg-gray-50/70 text-xs font-bold text-text-muted uppercase tracking-wider">
                  <th className="py-3.5 px-5">Lead / Company</th>
                  <th className="py-3.5 px-5">Campaign</th>
                  <th className="py-3.5 px-5">Booked By (SDR)</th>
                  <th className="py-3.5 px-5">Booking Date</th>
                  <th className="py-3.5 px-5">Outcome Status</th>
                  <th className="py-3.5 px-5 text-right">Log Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/60">
                {filteredMeetings.map((m) => {
                  const bookingDate = m.activities?.[0]?.createdAt
                    ? new Date(m.activities[0].createdAt).toLocaleString([], {
                        month: 'numeric',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'N/A';

                  return (
                    <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3.5 px-5">
                        <button
                          onClick={() => onSelectLead(m.id)}
                          className="flex items-center gap-1.5 font-bold text-text-primary hover:text-brand-red text-left group"
                        >
                          <span>{m.firstName} {m.lastName}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted" />
                        </button>
                        <p className="text-xs text-text-muted mt-0.5">{m.company}</p>
                      </td>
                      <td className="py-3.5 px-5">
                        <p className="font-semibold text-text-primary">{m.campaign?.name}</p>
                        <p className="text-xs text-text-muted mt-0.5">{m.campaign?.client?.name}</p>
                      </td>
                      <td className="py-3.5 px-5 font-medium text-text-primary">
                        {m.assignedTo?.firstName} {m.assignedTo?.lastName}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs text-text-secondary">{bookingDate}</td>
                      <td className="py-3.5 px-5">
                        {m.stage === 'won' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                            Won
                          </span>
                        ) : m.stage === 'lost' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/80">
                            Lost
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/80">
                            Scheduled
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        {m.stage === 'meeting_booked' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleUpdateStage(m.id, 'won')}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1 rounded-md text-xs transition-colors shadow-2xs"
                            >
                              Won / Closed
                            </button>
                            <button
                              onClick={() => handleUpdateStage(m.id, 'lost')}
                              className="bg-gray-100 hover:bg-rose-50 hover:text-rose-700 text-text-secondary font-semibold px-3 py-1 rounded-md text-xs border border-card-border transition-colors"
                            >
                              Lost
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleUpdateStage(m.id, 'sequence_active')}
                            className="bg-white border border-card-border hover:bg-gray-50 text-text-secondary font-semibold px-3 py-1 rounded-md text-xs transition-colors"
                          >
                            Reschedule
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
