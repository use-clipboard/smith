'use client';

/**
 * MtdItHelpModal — plain-English guidance for the MTD IT module: what it is,
 * how to get an HMRC agent account, connect/authorise, discover, map, and file.
 * Pure content — no data fetching.
 */

import { useState } from 'react';
import {
  X, BookOpen, ShieldCheck, Search, Check, Send, AlertTriangle, Landmark, ChevronRight,
} from 'lucide-react';

interface Section { id: string; title: string; icon: typeof BookOpen; body: React.ReactNode }

const SECTIONS: Section[] = [
  {
    id: 'what', title: 'What is MTD IT?', icon: BookOpen,
    body: (
      <>
        <p><strong>Making Tax Digital for Income Tax (MTD IT)</strong> requires self-employed people and landlords above the income threshold to keep digital records and send HMRC a <strong>cumulative (year-to-date) quarterly update</strong> for each business, plus a final declaration after the tax year.</p>
        <p>This module lets the firm prepare those quarterly figures, get the client to approve them, and submit them to HMRC — for many clients from one place.</p>
        <p className="text-slate-500">The big-picture flow: <strong>Connect once → add NINOs → discover &amp; map each client&apos;s HMRC businesses → prepare a quarter → client approves → submit to HMRC.</strong></p>
      </>
    ),
  },
  {
    id: 'agent', title: 'Getting an HMRC agent account', icon: Landmark,
    body: (
      <>
        <p>To file <em>on behalf of clients</em> you need an <strong>Agent Services Account (ASA)</strong> from HMRC, and each client must have authorised your firm (a copied-across 64-8 authorisation, or a digital handshake invitation they accept).</p>
        <p><strong>For sandbox testing</strong>, create test users on HMRC&apos;s developer site (Developer Hub → <em>Create a test user</em>):</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>An <strong>Agent</strong> test user (gives a Government Gateway ID + password + ARN).</li>
          <li>An <strong>Individual</strong> test user with the <strong>Making Tax Digital Income Tax</strong> enrolment (gives a NINO + UTR).</li>
        </ul>
        <p className="text-amber-700"><AlertTriangle size={12} className="inline -mt-0.5 mr-1" />Use the <strong>Agent</strong> (or Individual) test user to log in — <strong>not</strong> an Organisation user. An Organisation is a business filing its own taxes and isn&apos;t authorised to act as an agent.</p>
      </>
    ),
  },
  {
    id: 'connect', title: 'Connecting & authorising', icon: ShieldCheck,
    body: (
      <>
        <p>On <strong>HMRC setup</strong>, click <strong>Connect HMRC agent</strong> and log in on HMRC&apos;s screen with your agent gateway credentials, then grant access. This is a <strong>one-time</strong> step — a single connection covers every client you&apos;re authorised for.</p>
        <p>Each client also needs their <strong>National Insurance number</strong> recorded (and ideally their UTR). Add these in the HMRC setup grid (inline or via CSV import: <code>client_ref, nino, utr</code>).</p>
        <p className="text-slate-500">A client only files if HMRC has authorised your firm for them. If discovery says <em>&ldquo;Not authorised at HMRC&rdquo;</em>, that authorisation isn&apos;t in place yet (see Troubleshooting).</p>
      </>
    ),
  },
  {
    id: 'discover', title: 'Discovering businesses', icon: Search,
    body: (
      <>
        <p><strong>Discovery</strong> asks HMRC which income sources a client actually has (self-employment, UK property, foreign property). It&apos;s the authoritative list of what must be filed.</p>
        <p>Run it <strong>per client</strong> — from the dashboard (expand a client → <em>Discover &amp; map</em>) or on the HMRC setup screen (each row&apos;s <em>Discover</em> button). You can also <em>Discover shown</em> to sweep a filtered batch.</p>
        <p className="text-amber-700"><AlertTriangle size={12} className="inline -mt-0.5 mr-1" />HMRC rate-limits bulk requests — discover in small batches rather than all clients at once, or you&apos;ll hit a quota error.</p>
      </>
    ),
  },
  {
    id: 'map', title: 'Mapping & income streams', icon: Check,
    body: (
      <>
        <p><strong>Mapping</strong> links each HMRC business to a trade/property record in SMITH. We do this automatically: discovery matches by name, then creates the income source if it doesn&apos;t exist, and sets the client&apos;s <strong>income streams</strong> from what HMRC returned — so you don&apos;t set streams by hand.</p>
        <p>The dashboard&apos;s <strong>HMRC</strong> column shows progress: <span className="text-rose-700 font-medium">Not discovered</span> → <span className="text-amber-700 font-medium">Unmapped</span> → <span className="text-green-700 font-medium">Ready</span> (all sources linked).</p>
        <p className="text-slate-500">Auto-created sources get generic names (HMRC often gives no trading name/address) — rename or add the address later; the HMRC link stays intact. Anything HMRC didn&apos;t return is <em>flagged for review</em>, never deleted.</p>
      </>
    ),
  },
  {
    id: 'submit', title: 'Preparing & submitting', icon: Send,
    body: (
      <>
        <p>Open a client&apos;s quarter, add/import the income &amp; expense entries, and review. Send the figures to the client for <strong>approval</strong>; once approved, the <strong>Submit to HMRC</strong> button appears.</p>
        <p>Submission files the <strong>year-to-date cumulative</strong> figures for each self-employment and UK property source (foreign property is coming). Figures are recomputed server-side from the approved entries, so what&apos;s filed matches what was approved. A receipt is recorded and the quarter is marked <strong>submitted</strong>.</p>
      </>
    ),
  },
  {
    id: 'trouble', title: 'Troubleshooting', icon: AlertTriangle,
    body: (
      <>
        <p><strong>&ldquo;Not authorised at HMRC&rdquo;</strong> — the connected login isn&apos;t allowed to see that client&apos;s data. Check you logged in as an <strong>Agent</strong> (not Organisation), that the client&apos;s NINO is correct, and that your firm is authorised for them. For sandbox, the simplest test is to log in as the <strong>Individual</strong> test user and discover their own NINO.</p>
        <p><strong>&ldquo;Throttled / exceeded your quota&rdquo;</strong> — too many HMRC calls at once. Discover in smaller batches and wait a minute for the limit to reset.</p>
        <p><strong>&ldquo;Missing NINO&rdquo;</strong> — add the client&apos;s National Insurance number on the HMRC setup grid first.</p>
      </>
    ),
  },
];

export default function MtdItHelpModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const section = SECTIONS.find(s => s.id === active) ?? SECTIONS[0];

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2"><BookOpen size={15} className="text-indigo-600" /> MTD IT — help &amp; guidance</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700"><X size={14} /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Section nav */}
          <nav className="w-56 shrink-0 border-r border-gray-100 p-2 overflow-y-auto">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const on = s.id === active;
              return (
                <button key={s.id} onClick={() => setActive(s.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${on ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <Icon size={14} className="shrink-0" />
                  <span className="flex-1 min-w-0">{s.title}</span>
                  {on && <ChevronRight size={13} />}
                </button>
              );
            })}
          </nav>

          {/* Body */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-3 inline-flex items-center gap-2">
              <section.icon size={16} className="text-indigo-600" /> {section.title}
            </h3>
            <div className="text-sm text-slate-700 space-y-3 leading-relaxed [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
              {section.body}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="btn-primary text-sm">Got it</button>
        </div>
      </div>
    </div>
  );
}
