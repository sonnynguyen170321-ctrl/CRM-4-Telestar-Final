'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Users,
  Sparkles,
  ChevronRight,
  LayoutDashboard,
  Bot,
  Mail,
  Calendar,
  Layers,
  FileText,
  Sliders,
  Settings,
  ShieldAlert,
  Zap,
  Target,
  BarChart3,
  PhoneCall,
  RefreshCw,
  Building,
} from 'lucide-react';
import LeadDetailPanel from './LeadDetailPanel';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  title?: string | null;
  stage?: string;
  crmPriorityScore?: string;
}

interface CommandItem {
  id: string;
  name: string;
  category: 'Navigation' | 'Quick Actions' | 'AI Intelligence' | 'System';
  shortcut?: string;
  action: () => void;
  icon: React.ReactNode;
}

export default function CommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadResults, setLeadResults] = useState<Lead[]>([]);
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Setup Hotkey + custom event listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
        setQuery('');
        setActiveIndex(0);
        return;
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleOpen = () => {
      setIsOpen(true);
      setQuery('');
      setActiveIndex(0);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('telestar:open-command-palette', handleOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('telestar:open-command-palette', handleOpen);
    };
  }, []);

  // Autofocus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const commandItems: CommandItem[] = [
    // Navigation
    { id: 'go_dash', name: 'Dashboard & Overview', category: 'Navigation', shortcut: 'G D', icon: <LayoutDashboard className="w-4 h-4 text-rose-500" />, action: () => { router.push('/'); setIsOpen(false); } },
    { id: 'go_ai', name: 'AI Command Center', category: 'Navigation', shortcut: 'G A', icon: <Bot className="w-4 h-4 text-violet-500" />, action: () => { router.push('/ai'); setIsOpen(false); } },
    { id: 'go_leads', name: 'Leads Pipeline & Pool', category: 'Navigation', shortcut: 'G L', icon: <Users className="w-4 h-4 text-blue-500" />, action: () => { router.push('/leads'); setIsOpen(false); } },
    { id: 'go_opps', name: 'Opportunities Pipeline', category: 'Navigation', shortcut: 'G O', icon: <Target className="w-4 h-4 text-amber-500" />, action: () => { router.push('/opportunities'); setIsOpen(false); } },
    { id: 'go_meetings', name: 'Meetings & Demos', category: 'Navigation', shortcut: 'G M', icon: <Calendar className="w-4 h-4 text-emerald-500" />, action: () => { router.push('/meetings'); setIsOpen(false); } },
    { id: 'go_seq', name: 'Outreach Sequences', category: 'Navigation', shortcut: 'G S', icon: <Sparkles className="w-4 h-4 text-orange-500" />, action: () => { router.push('/sequences'); setIsOpen(false); } },
    { id: 'go_inbox', name: 'Unified Inbox & AI Copilot', category: 'Navigation', shortcut: 'G I', icon: <Mail className="w-4 h-4 text-indigo-500" />, action: () => { router.push('/inbox'); setIsOpen(false); } },
    { id: 'go_auto', name: 'Automation & Integrations Hub', category: 'Navigation', shortcut: 'G U', icon: <Sliders className="w-4 h-4 text-red-500" />, action: () => { router.push('/automation'); setIsOpen(false); } },
    { id: 'go_perf', name: 'Sequence Performance Analytics', category: 'Navigation', shortcut: 'G P', icon: <BarChart3 className="w-4 h-4 text-cyan-500" />, action: () => { router.push('/sequences/performance'); setIsOpen(false); } },
    { id: 'go_reports', name: 'Client Executive Reports', category: 'Navigation', shortcut: 'G R', icon: <FileText className="w-4 h-4 text-teal-500" />, action: () => { router.push('/client-reports'); setIsOpen(false); } },
    { id: 'go_settings', name: 'Account & Workspace Settings', category: 'Navigation', shortcut: 'G ,', icon: <Settings className="w-4 h-4 text-zinc-500" />, action: () => { router.push('/settings'); setIsOpen(false); } },

    // Quick Actions
    { id: 'act_brief', name: 'Generate Morning Briefing (AI)', category: 'AI Intelligence', shortcut: '⌘ B', icon: <Zap className="w-4 h-4 text-amber-500" />, action: () => { window.dispatchEvent(new CustomEvent('telestar:open-ai-assistant', { detail: { action: 'briefing' } })); setIsOpen(false); } },
    { id: 'act_recalc', name: 'Recalculate All Lead Scores', category: 'Quick Actions', shortcut: '⌘ R', icon: <RefreshCw className="w-4 h-4 text-rose-500" />, action: () => { router.push('/automation'); setIsOpen(false); } },
    { id: 'act_dialer', name: 'Launch Cloud Dialer', category: 'Quick Actions', shortcut: '⌘ D', icon: <PhoneCall className="w-4 h-4 text-emerald-500" />, action: () => { window.dispatchEvent(new CustomEvent('telestar:open-dialer')); setIsOpen(false); } },
    { id: 'act_webhook', name: 'Configure Outbound Webhooks', category: 'System', icon: <Layers className="w-4 h-4 text-violet-500" />, action: () => { router.push('/automation'); setIsOpen(false); } },
    { id: 'act_health', name: 'Audit Email Deliverability', category: 'System', icon: <ShieldAlert className="w-4 h-4 text-sky-500" />, action: () => { router.push('/email-health'); setIsOpen(false); } }
  ];

  // Search through commands
  const matchedCommands = commandItems.filter(item =>
    item.name.toLowerCase().includes(query.toLowerCase()) ||
    item.category.toLowerCase().includes(query.toLowerCase())
  );

  // Search through leads
  useEffect(() => {
    if (query.trim().length < 2) {
      setLeadResults([]);
      setIsSearchingLeads(false);
      return;
    }
    setIsSearchingLeads(true);
    const timer = setTimeout(() => {
      fetch(`/api/leads?search=${encodeURIComponent(query)}&limit=5`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          setLeadResults(Array.isArray(data) ? data.slice(0, 5) : []);
          setIsSearchingLeads(false);
        })
        .catch(() => {
          setLeadResults([]);
          setIsSearchingLeads(false);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const totalItems = matchedCommands.length + leadResults.length;

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(1, totalItems));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + Math.max(1, totalItems)) % Math.max(1, totalItems));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex < matchedCommands.length) {
        matchedCommands[activeIndex]?.action();
      } else {
        const leadIndex = activeIndex - matchedCommands.length;
        const lead = leadResults[leadIndex];
        if (lead) {
          setSelectedLeadId(lead.id);
          setIsOpen(false);
        }
      }
    }
  };

  if (!isOpen) {
    return (
      <>
        {selectedLeadId && (
          <LeadDetailPanel leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
        )}
      </>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-zinc-950/60 backdrop-blur-md z-50 transition-opacity animate-in fade-in duration-150"
        onClick={() => setIsOpen(false)}
      />

      {/* Palette Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 pointer-events-none">
        <div
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[80vh] transition-all transform animate-in zoom-in-95 duration-150"
          onKeyDown={handleKeyDown}
        >
          {/* Search Header */}
          <div className="flex items-center px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800 gap-3">
            <Search className="w-5 h-5 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent border-none outline-none text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 font-medium"
              placeholder="Type a command, jump to page, or search leads... (ESC to close)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
            />
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-0.5 text-xs font-semibold text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md">
                ESC
              </kbd>
            </div>
          </div>

          {/* Results List */}
          <div ref={listRef} className="overflow-y-auto p-2 space-y-4 max-h-[60vh] scrollbar-thin">
            {/* Matched Commands */}
            {matchedCommands.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 py-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Commands & Workspaces
                </div>
                {matchedCommands.map((cmd, idx) => {
                  const isSelected = activeIndex === idx;
                  return (
                    <button
                      key={cmd.id}
                      onClick={cmd.action}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
                        isSelected
                          ? 'bg-rose-500/10 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 font-medium'
                          : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/50 dark:border-zinc-700/50">
                          {cmd.icon}
                        </div>
                        <span className="text-sm font-medium">{cmd.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 font-normal">
                          {cmd.category}
                        </span>
                      </div>
                      {cmd.shortcut && (
                        <div className="flex items-center gap-1">
                          {cmd.shortcut.split(' ').map((key, i) => (
                            <kbd
                              key={i}
                              className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded"
                            >
                              {key}
                            </kbd>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Matched Leads */}
            {leadResults.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="px-3 py-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Matching Leads</span>
                  <span className="text-[11px] font-normal text-zinc-400">Jump directly to prospect</span>
                </div>
                {leadResults.map((lead, idx) => {
                  const globalIdx = matchedCommands.length + idx;
                  const isSelected = activeIndex === globalIdx;
                  return (
                    <button
                      key={lead.id}
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => setActiveIndex(globalIdx)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
                        isSelected
                          ? 'bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium'
                          : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-semibold text-xs flex items-center justify-center border border-blue-200 dark:border-blue-800">
                          {lead.firstName?.[0] || 'L'}
                        </div>
                        <div>
                          <div className="text-sm font-semibold flex items-center gap-2">
                            {lead.firstName} {lead.lastName}
                            {lead.crmPriorityScore === 'hot' && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-600 font-bold">
                                HOT
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                            <Building className="w-3 h-3" />
                            {lead.company} {lead.title ? `• ${lead.title}` : ''}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-400" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Empty State */}
            {matchedCommands.length === 0 && leadResults.length === 0 && !isSearchingLeads && (
              <div className="py-12 text-center text-zinc-400 space-y-2">
                <Search className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-1" />
                <p className="text-sm font-medium">No commands or leads found for &quot;{query}&quot;</p>
                <p className="text-xs text-zinc-400">Try searching for &quot;leads&quot;, &quot;briefing&quot;, &quot;webhooks&quot;, or a prospect name.</p>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900/80 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px]">
                  ↑↓
                </kbd>{' '}
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px]">
                  ↵
                </kbd>{' '}
                Select
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-medium text-zinc-500">Telestar Spotlight 2.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Lead Modal */}
      {selectedLeadId && (
        <LeadDetailPanel leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      )}
    </>
  );
}
