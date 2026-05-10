'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, AlertTriangle, CalendarPlus } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function HolidayRequestModal({ isOpen, onClose, onSaved }: Props) {
  const [startDate, setStartDate] = useState('');
  const [startHalf, setStartHalf] = useState<'full' | 'morning' | 'afternoon'>('full');
  const [endDate, setEndDate] = useState('');
  const [endHalf, setEndHalf] = useState<'full' | 'morning' | 'afternoon'>('full');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().slice(0, 10);
      setStartDate(today); setStartHalf('full');
      setEndDate(today); setEndHalf('full');
      setReason('');
      setError(null);
    }
  }, [isOpen]);

  // When user changes start date, auto-bump end date if it's now before start.
  useEffect(() => {
    if (startDate && endDate && endDate < startDate) setEndDate(startDate);
  }, [startDate, endDate]);

  const sameDay = startDate && startDate === endDate;
  const totalDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const dayMs = 24 * 60 * 60 * 1000;
    const a = new Date(startDate + 'T12:00:00Z').getTime();
    const b = new Date(endDate + 'T12:00:00Z').getTime();
    const inclusive = Math.round((b - a) / dayMs) + 1;
    if (inclusive <= 0) return 0;
    if (inclusive === 1) return startHalf === 'full' ? 1 : 0.5;
    let total = inclusive;
    if (startHalf !== 'full') total -= 0.5;
    if (endHalf !== 'full')   total -= 0.5;
    return total;
  }, [startDate, endDate, startHalf, endHalf]);

  if (!isOpen) return null;

  async function handleSubmit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/hr/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate, start_half: startHalf,
          end_date: endDate, end_half: sameDay ? startHalf : endHalf,
          reason: reason.trim() || null,
          source: 'request',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Submit failed');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Submit failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={!busy ? onClose : undefined} />
      <div className="relative glass-solid rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 border border-[var(--border)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex items-center justify-center">
              <CalendarPlus size={18} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-base font-semibold">Request holiday</h2>
          </div>
          {!busy && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"><X size={16} /></button>}
        </div>

        <div className="space-y-4">
          {/* Start */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-base text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{sameDay ? 'Length' : 'Start half'}</label>
              <select value={startHalf} onChange={e => setStartHalf(e.target.value as 'full' | 'morning' | 'afternoon')} className="input-base text-sm w-full">
                <option value="full">{sameDay ? 'Full day' : 'Full day from start'}</option>
                <option value="morning">{sameDay ? 'Morning only' : 'Start in the morning'}</option>
                <option value="afternoon">{sameDay ? 'Afternoon only' : 'Start in the afternoon'}</option>
              </select>
            </div>
          </div>

          {/* End — only meaningful if multi-day */}
          {!sameDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} className="input-base text-sm w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End half</label>
                <select value={endHalf} onChange={e => setEndHalf(e.target.value as 'full' | 'morning' | 'afternoon')} className="input-base text-sm w-full">
                  <option value="full">Full last day</option>
                  <option value="morning">End in the morning</option>
                  <option value="afternoon">End in the afternoon</option>
                </select>
              </div>
            </div>
          )}

          {sameDay && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} className="input-base text-sm w-full" />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave the same as start date for a single day.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="e.g. Family wedding" className="input-base text-sm w-full" />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--accent-light)] text-xs text-[var(--accent)]">
            <span>Total</span>
            <span className="font-bold">{totalDays} day{totalDays === 1 ? '' : 's'}</span>
          </div>

          {error && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}</div>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
            <button onClick={() => void handleSubmit()} disabled={busy || totalDays <= 0} className="btn-primary disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
              Submit request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
