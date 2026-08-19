'use client';

import React, { useState } from 'react';

export default function TypographyLab() {
  const [sampleText, setSampleText] = useState('Telestar Revenue Delivery Operating System — 100% Verified');

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-12 font-sans">
      {/* Header */}
      <div className="border-b border-gray-200 pb-6">
        <span className="type-micro uppercase tracking-wider text-red-600 font-bold">Design System</span>
        <h1 className="type-page-title text-gray-900 mt-2 font-brand">Telestar Typography Lab</h1>
        <p className="type-body text-gray-600 mt-2">
          Living reference for the Telestar font architecture: Montserrat (operating voice) + Futura (brand identity) + JetBrains Mono (technical code).
        </p>
      </div>

      {/* 1. Font Family Split */}
      <section className="space-y-6">
        <h2 className="type-section text-gray-900 border-b pb-2">1. Dual-Voice Font Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Futura Brand Voice */}
          <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
            <span className="px-2.5 py-1 text-xs font-bold uppercase rounded bg-red-100 text-red-700">Brand Identity Voice</span>
            <h3 className="font-brand text-2xl font-bold text-gray-900">Futura</h3>
            <p className="type-meta text-gray-600">
              Reserved for top-level brand titles, major route titles (H1), hero KPIs, and brand wordmarks.
            </p>
            <div className="p-4 bg-white rounded-lg border border-gray-200 font-brand">
              <div className="text-3xl font-bold text-gray-900">TELESTAR REVENUE OS</div>
              <div className="text-xl font-medium text-gray-700 mt-1">Campaign Delivery Pacing: 104.2%</div>
            </div>
          </div>

          {/* Montserrat Operating Voice */}
          <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
            <span className="px-2.5 py-1 text-xs font-bold uppercase rounded bg-blue-100 text-blue-700">Operating Voice</span>
            <h3 className="font-sans text-2xl font-bold text-gray-900">Montserrat</h3>
            <p className="type-meta text-gray-600">
              Used for all application UI chrome, tables, form inputs, buttons, body paragraphs, and AI explanations.
            </p>
            <div className="p-4 bg-white rounded-lg border border-gray-200 font-sans space-y-2">
              <p className="text-sm font-semibold text-gray-900">SDR Queue Prioritization</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Contact responded to outbound sequence step 2 with positive intent. SLA timer active: 1h 45m remaining.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Type Scale Tiers */}
      <section className="space-y-6">
        <h2 className="type-section text-gray-900 border-b pb-2">2. Standardized Type Scale</h2>
        <div className="space-y-4 bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex flex-col md:flex-row md:items-baseline justify-between border-b pb-3 gap-2">
            <span className="text-xs font-mono text-gray-400 w-36">page-title (28px)</span>
            <span className="type-page-title text-gray-900 flex-1">Executive Mission Control</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-baseline justify-between border-b pb-3 gap-2">
            <span className="text-xs font-mono text-gray-400 w-36">section (20px)</span>
            <span className="type-section text-gray-900 flex-1">Lead Supply & Matching Allocation</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-baseline justify-between border-b pb-3 gap-2">
            <span className="text-xs font-mono text-gray-400 w-36">subsection (16px)</span>
            <span className="type-subsection text-gray-900 flex-1">Qualified Contact Requirements</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-baseline justify-between border-b pb-3 gap-2">
            <span className="text-xs font-mono text-gray-400 w-36">body (14px)</span>
            <span className="type-body text-gray-700 flex-1">
              Review and approve proposed stage mutation from inbound email response before dispatching SDR follow-up task.
            </span>
          </div>
          <div className="flex flex-col md:flex-row md:items-baseline justify-between border-b pb-3 gap-2">
            <span className="text-xs font-mono text-gray-400 w-36">meta (13px)</span>
            <span className="type-meta text-gray-500 flex-1">Last synced 2 minutes ago • Sequence active</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2">
            <span className="text-xs font-mono text-gray-400 w-36">micro (11.5px)</span>
            <span className="type-micro uppercase text-gray-500 flex-1">RECOVERING • PROVEN RELATIONSHIP</span>
          </div>
        </div>
      </section>

      {/* 3. Tabular Numerals */}
      <section className="space-y-6">
        <h2 className="type-section text-gray-900 border-b pb-2">3. Tabular Numerals for High-Density Financial & CRM Data</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Metrics Table (Tabular Nums)</h4>
            <div className="font-mono text-sm space-y-2 tabular-nums">
              <div className="flex justify-between border-b py-1"><span>Delivered Meetings:</span><span className="font-bold">00,042 / 00,040</span></div>
              <div className="flex justify-between border-b py-1"><span>Pacing Delta:</span><span className="text-emerald-600 font-bold">+105.0%</span></div>
              <div className="flex justify-between border-b py-1"><span>Attributed Revenue:</span><span className="font-bold">$142,500.00</span></div>
              <div className="flex justify-between py-1"><span>Average SLA Response:</span><span className="font-bold">00:44:12</span></div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">SDR Leaderboard Alignment</h4>
            <div className="font-sans text-sm space-y-2 tabular-nums">
              <div className="flex justify-between items-center border-b py-1.5">
                <span className="font-medium">1. Alex Morgan (Enterprise)</span>
                <span className="font-bold text-gray-900">18 meetings (120%)</span>
              </div>
              <div className="flex justify-between items-center border-b py-1.5">
                <span className="font-medium">2. Taylor Swift (FinTech)</span>
                <span className="font-bold text-gray-900">15 meetings (100%)</span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="font-medium">3. Jordan Lee (Healthcare)</span>
                <span className="font-bold text-gray-900">11 meetings (073%)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. International & Vietnamese Glyphs */}
      <section className="space-y-6">
        <h2 className="type-section text-gray-900 border-b pb-2">4. International & Vietnamese Diacritics Verification</h2>
        <div className="p-6 bg-white rounded-xl border border-gray-200 space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg border">
            <span className="text-xs font-bold text-gray-500 uppercase">Vietnamese Diacritics (Tiếng Việt):</span>
            <p className="text-base text-gray-900 mt-2 font-sans leading-relaxed">
              Hệ thống vận hành doanh thu Telestar CRM: Tối ưu hoá quy trình tìm kiếm khách hàng tiềm năng, đồng bộ chiến dịch đa kênh và gia tăng tỷ lệ chốt cuộc hẹn thành công cho đội ngũ SDR.
            </p>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg border">
            <span className="text-xs font-bold text-gray-500 uppercase">Multilingual Glyphs:</span>
            <p className="text-sm text-gray-800 mt-2 font-sans space-y-1">
              <span>Français: Rapport d&apos;activité commerciale et prévisions des ventes 2026.</span><br />
              <span>Deutsch: Qualitätsüberprüfung von Kundendaten und Kampagnenfortschritt.</span><br />
              <span>Español: Optimización del flujo de trabajo y entrega garantizada de reuniones.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Sandbox */}
      <section className="space-y-4 bg-gray-50 p-6 rounded-xl border border-gray-200">
        <h2 className="type-section text-gray-900">5. Interactive Typography Tester</h2>
        <input
          type="text"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm font-sans"
          placeholder="Type any phrase to test font rendering..."
        />
        <div className="space-y-4 pt-4">
          <div>
            <span className="text-xs font-mono text-gray-500">Futura (Brand):</span>
            <p className="font-brand text-2xl font-bold text-gray-900 mt-1">{sampleText}</p>
          </div>
          <div>
            <span className="text-xs font-mono text-gray-500">Montserrat (Operating):</span>
            <p className="font-sans text-base text-gray-800 mt-1">{sampleText}</p>
          </div>
          <div>
            <span className="text-xs font-mono text-gray-500">JetBrains Mono (Technical):</span>
            <p className="font-mono text-sm text-gray-700 mt-1">{sampleText}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
