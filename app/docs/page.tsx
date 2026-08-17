'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Code,
  Key,
  Copy,
  Check,
  Download,
  PhoneCall,
  Sparkles,
  Database,
  ExternalLink,
} from 'lucide-react';

interface EndpointDoc {
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  title: string;
  category: 'VOIP & Calling' | 'Lead Generation' | 'Enrichment' | 'API Keys';
  description: string;
  sampleBody?: string;
  sampleResponse: string;
}

const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'calls-log',
    method: 'POST',
    path: '/api/v1/calls',
    title: 'Log VOIP Call Activity',
    category: 'VOIP & Calling',
    description:
      'Log completed or in-progress phone calls from dialers (Aircall, Twilio, JustCall). Automatically records call duration, audio recording link, and updates lead stage.',
    sampleBody: JSON.stringify(
      {
        email: 'sonnynguyen170321@gmail.com',
        phone: '+1 (555) 234-5678',
        direction: 'outbound',
        durationSeconds: 145,
        outcome: 'meeting_booked',
        recordingUrl: 'https://recordings.aircall.io/rec_891238.mp3',
        notes: 'Prospect confirmed 30-min product walkthrough for next Thursday at 2 PM EST.',
      },
      null,
      2
    ),
    sampleResponse: JSON.stringify(
      {
        success: true,
        activityId: 'cma123984129',
        leadId: 'cml89234120',
        leadName: 'Sonny Nguyen',
        updatedStage: 'meeting_booked',
        message: 'Call activity logged successfully.',
      },
      null,
      2
    ),
  },
  {
    id: 'leads-create',
    method: 'POST',
    path: '/api/v1/leads',
    title: 'Ingest Research Lead',
    category: 'Lead Generation',
    description:
      'Ingest newly discovered prospect records from Clay, Apollo, or ZoomInfo. Automatically deduplicates by email address.',
    sampleBody: JSON.stringify(
      {
        firstName: 'Sarah',
        lastName: 'Chen',
        company: 'Vanguard Cyber AI',
        email: 'sarah.chen@vanguardai.io',
        phone: '+1 (415) 890-1234',
        title: 'Director of Security Operations',
        linkedinUrl: 'https://linkedin.com/in/sarahchen-secops',
        notes: 'Discovered via Clay ICP search: High growth Series A B2B cybersecurity.',
      },
      null,
      2
    ),
    sampleResponse: JSON.stringify(
      {
        action: 'created',
        lead: {
          id: 'cml98234710',
          firstName: 'Sarah',
          lastName: 'Chen',
          company: 'Vanguard Cyber AI',
          email: 'sarah.chen@vanguardai.io',
          stage: 'new',
          score: 85,
        },
        message: 'Lead ingested successfully into CRM.',
      },
      null,
      2
    ),
  },
  {
    id: 'leads-search',
    method: 'GET',
    path: '/api/v1/leads?q=Vanguard&limit=10',
    title: 'Search & Query Leads',
    category: 'Lead Generation',
    description: 'Search prospects by name, company, or email for VOIP caller screen pops.',
    sampleResponse: JSON.stringify(
      {
        count: 1,
        leads: [
          {
            id: 'cml98234710',
            firstName: 'Sarah',
            lastName: 'Chen',
            company: 'Vanguard Cyber AI',
            email: 'sarah.chen@vanguardai.io',
            phone: '+1 (415) 890-1234',
            stage: 'new',
          },
        ],
      },
      null,
      2
    ),
  },
  {
    id: 'enrich-lead',
    method: 'POST',
    path: '/api/v1/enrich',
    title: 'Push Firmographic Intelligence',
    category: 'Enrichment',
    description: 'Sync deep company tech stack, employee count, and AI research summary into lead profile.',
    sampleBody: JSON.stringify(
      {
        email: 'sarah.chen@vanguardai.io',
        companyData: {
          industry: 'Cybersecurity',
          employeeCount: '50-100',
          techStack: ['AWS', 'Datadog', 'Kubernetes'],
        },
        researchSummary: 'Recently closed $12M Series A lead by Andreessen Horowitz. Expanding SDR team.',
      },
      null,
      2
    ),
    sampleResponse: JSON.stringify(
      {
        success: true,
        leadId: 'cml98234710',
        message: 'Lead intelligence updated successfully.',
      },
      null,
      2
    ),
  },
];

export default function ApiDocsPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointDoc>(ENDPOINTS[0]);
  const [activeLang, setActiveLang] = useState<'curl' | 'node' | 'python'>('curl');
  const [copied, setCopied] = useState(false);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateSnippet = () => {
    const isPost = selectedEndpoint.method === 'POST';
    const bodyStr = selectedEndpoint.sampleBody || '{}';

    if (activeLang === 'curl') {
      if (isPost) {
        return `curl -X POST "https://crm.telestar.cloud${selectedEndpoint.path}" \\
  -H "Authorization: Bearer tl_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${bodyStr.replace(/\n/g, '\n  ')}'`;
      }
      return `curl -X GET "https://crm.telestar.cloud${selectedEndpoint.path}" \\
  -H "Authorization: Bearer tl_live_YOUR_API_KEY"`;
    }

    if (activeLang === 'node') {
      if (isPost) {
        return `const response = await fetch("https://crm.telestar.cloud${selectedEndpoint.path}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer tl_live_YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${bodyStr.replace(/\n/g, '\n  ')})
});
const data = await response.json();
console.log(data);`;
      }
      return `const response = await fetch("https://crm.telestar.cloud${selectedEndpoint.path}", {
  headers: {
    "Authorization": "Bearer tl_live_YOUR_API_KEY"
  }
});
const data = await response.json();
console.log(data);`;
    }

    // Python
    if (isPost) {
      return `import requests

url = "https://crm.telestar.cloud${selectedEndpoint.path}"
headers = {
    "Authorization": "Bearer tl_live_YOUR_API_KEY",
    "Content-Type": "application/json"
}
payload = ${bodyStr.replace(/true/g, 'True').replace(/false/g, 'False').replace(/null/g, 'None')}

response = requests.post(url, json=payload, headers=headers)
print(response.json())`;
    }
    return `import requests

url = "https://crm.telestar.cloud${selectedEndpoint.path}"
headers = {
    "Authorization": "Bearer tl_live_YOUR_API_KEY"
}

response = requests.get(url, headers=headers)
print(response.json())`;
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] font-sans antialiased">
      {/* Header */}
      <header className="border-b border-[#30363d] bg-[#161b22]/90 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Code className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white flex items-center gap-2">
              Telestar CRM Developer Platform
              <span className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                OpenAPI 3.1
              </span>
            </h1>
            <p className="text-xs text-neutral-400">Public REST API for VOIP, Leadgen & Automated Workflows</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-[#30363d] hover:border-neutral-500 bg-[#21262d] text-neutral-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            OpenAPI Spec (.json)
          </a>

          <Link
            href="/settings?tab=developer"
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-black transition-colors"
          >
            <Key className="w-3.5 h-3.5" />
            Get API Key
          </Link>
        </div>
      </header>

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-8">
        {/* Sidebar Nav */}
        <aside className="col-span-12 md:col-span-4 space-y-6">
          {/* Auth Card */}
          <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/70 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              <Key className="w-3.5 h-3.5 text-emerald-400" />
              Authentication
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Authenticate all API requests by passing your API Key in the HTTP Bearer header:
            </p>
            <div className="p-2.5 bg-[#0d1117] border border-[#30363d] rounded font-mono text-[11px] text-emerald-400 select-all">
              Authorization: Bearer tl_live_...
            </div>
          </div>

          {/* Endpoints List */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider px-2">
              Available Endpoints
            </div>
            <div className="space-y-1">
              {ENDPOINTS.map((ep) => {
                const isActive = selectedEndpoint.id === ep.id;
                return (
                  <button
                    key={ep.id}
                    onClick={() => setSelectedEndpoint(ep)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isActive
                        ? 'border-emerald-500/50 bg-emerald-500/5 text-white'
                        : 'border-transparent hover:border-[#30363d] hover:bg-[#161b22]/50 text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">{ep.title}</span>
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          ep.method === 'POST'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {ep.method}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-neutral-400 truncate">{ep.path}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Integration Cards */}
          <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/40 space-y-3">
            <div className="text-xs font-semibold text-neutral-300">Supported Tool Ecosystem</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-neutral-400">
              <div className="flex items-center gap-1.5 p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
                Aircall / Twilio
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                Clay / Apollo
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                ZoomInfo
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                Zapier / n8n
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="col-span-12 md:col-span-8 space-y-6">
          {/* Header Description */}
          <div className="p-6 rounded-2xl border border-[#30363d] bg-[#161b22]/70 space-y-3">
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                  selectedEndpoint.method === 'POST'
                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                }`}
              >
                {selectedEndpoint.method}
              </span>
              <span className="font-mono text-sm text-neutral-200">{selectedEndpoint.path}</span>
            </div>
            <h2 className="text-xl font-bold text-white">{selectedEndpoint.title}</h2>
            <p className="text-xs text-neutral-400 leading-relaxed">{selectedEndpoint.description}</p>
          </div>

          {/* Code Generator & Snippet */}
          <div className="rounded-2xl border border-[#30363d] bg-[#161b22] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#0d1117]">
              <div className="flex items-center gap-2">
                {(['curl', 'node', 'python'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setActiveLang(lang)}
                    className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                      activeLang === lang
                        ? 'bg-[#21262d] text-white font-semibold border border-neutral-600'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {lang === 'curl' ? 'cURL' : lang === 'node' ? 'Node.js' : 'Python'}
                  </button>
                ))}
              </div>

              <button
                onClick={() => handleCopyCode(generateSnippet())}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-neutral-200 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy Code'}
              </button>
            </div>

            <pre className="p-4 text-xs font-mono text-emerald-400 bg-[#0d1117] overflow-x-auto leading-relaxed">
              <code>{generateSnippet()}</code>
            </pre>
          </div>

          {/* Sample JSON Response */}
          <div className="rounded-2xl border border-[#30363d] bg-[#161b22] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#30363d] bg-[#0d1117] flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-300">Sample 200 OK Response</span>
              <span className="text-[10px] font-mono text-emerald-400">application/json</span>
            </div>
            <pre className="p-4 text-xs font-mono text-neutral-300 bg-[#0d1117] overflow-x-auto leading-relaxed">
              <code>{selectedEndpoint.sampleResponse}</code>
            </pre>
          </div>
        </main>
      </div>
    </div>
  );
}
