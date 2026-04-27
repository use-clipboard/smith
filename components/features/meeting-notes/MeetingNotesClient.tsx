'use client';

/**
 * MeetingNotesClient — AI-powered meeting transcription and minutes tool.
 *
 * Entry modes:
 *   • record  — live microphone transcription via Web Speech API
 *   • screen  — screen capture (Google Meet / Zoom / Teams) + mic transcription
 *               + direct-to-Drive video upload via resumable upload session
 *   • manual  — user describes what was discussed; Claude turns it into minutes
 *
 * Meeting origins: recorded | virtual | in_person | phone
 * Pre-fill: consumePendingClient('/meeting-notes') on mount.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Square, Loader2, CheckCircle2,
  Users2, MapPin, Calendar, Clock, ExternalLink, Save,
  AlertCircle, RefreshCw, X, Plus, Trash2,
  FileText, Zap, ListChecks, Vote, BookText, PenLine,
  Phone, Video, PersonStanding, MonitorSpeaker, Monitor,
  Upload, Film,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient } from '@/lib/pendingClient';

// ── Web Speech API types ──────────────────────────────────────────────────────

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: Event) => void) | null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase         = 'setup' | 'recording' | 'uploading' | 'processing' | 'review' | 'saved';
type EntryMode     = 'record' | 'screen' | 'manual';
type MeetingOrigin = 'recorded' | 'virtual' | 'in_person' | 'phone';

interface CalendarHint {
  id: string; title: string; start: string; end: string;
  location?: string; meetLink?: string;
  attendees?: { email: string; name?: string }[];
}
interface ActionItem { action: string; owner: string; deadline: string; }
interface MeetingNotesResult {
  summary: string; keyPoints: string[]; actionItems: ActionItem[];
  decisions: string[]; formalMinutes: string; nextMeeting: string;
}
// ── Origin config ─────────────────────────────────────────────────────────────

const ORIGIN_OPTIONS: { value: MeetingOrigin; label: string; icon: React.ReactNode; hint: string }[] = [
  { value: 'recorded',  label: 'Recorded',   icon: <Mic size={14} />,            hint: 'Record via microphone with live transcription' },
  { value: 'virtual',   label: 'Virtual',    icon: <Video size={14} />,          hint: 'Video call — screen record + mic transcription' },
  { value: 'in_person', label: 'In Person',  icon: <PersonStanding size={14} />, hint: 'Face-to-face — describe what was discussed' },
  { value: 'phone',     label: 'Phone Call', icon: <Phone size={14} />,          hint: 'Phone call — describe what was discussed' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(secs: number) {
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function formatDateDisplay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Tab pill ──────────────────────────────────────────────────────────────────

function TabPill({ label, icon, active, onClick }: {
  label: string; icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-[var(--accent)] text-white'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
      }`}>
      {icon}{label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MeetingNotesClient() {
  const [phase,         setPhase]         = useState<Phase>('setup');
  const [entryMode,     setEntryMode]     = useState<EntryMode>('record');
  const [meetingOrigin, setMeetingOrigin] = useState<MeetingOrigin>('recorded');

  // Meeting metadata
  const [meetingTitle,   setMeetingTitle]   = useState('');
  const [meetingDate,    setMeetingDate]    = useState(new Date().toISOString().split('T')[0]);
  const [meetingTime,    setMeetingTime]    = useState(new Date().toTimeString().slice(0, 5));
  const [location,       setLocation]       = useState('');
  const [attendees,      setAttendees]      = useState<string[]>([]);
  const [attendeeInput,  setAttendeeInput]  = useState('');

  // Client
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);

  // Calendar hint
  const [calendarHint,  setCalendarHint]  = useState<CalendarHint | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);

  // Microphone recording (all modes)
  const [isRecording,   setIsRecording]   = useState(false);
  const [transcript,    setTranscript]    = useState('');
  const [interim,       setInterim]       = useState('');
  const [duration,      setDuration]      = useState(0);
  const [micError,      setMicError]      = useState<string | null>(null);
  const [speechSupport, setSpeechSupport] = useState(true);

  // Screen recording (virtual mode)
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [screenError,       setScreenError]       = useState<string | null>(null);
  const [recordingSize,     setRecordingSize]      = useState(0);   // bytes accumulated
  const [supplementalNotes, setSupplementalNotes] = useState('');  // other-party notes

  // Drive video upload
  const [uploadProgress,  setUploadProgress]  = useState<number | null>(null); // 0–100 or null
  const [driveVideoUrl,   setDriveVideoUrl]   = useState<string | null>(null);
  const [driveVideoError, setDriveVideoError] = useState<string | null>(null);

  // Manual entry
  const [manualDescription, setManualDescription] = useState('');

  // Review
  const [notes,      setNotes]      = useState<MeetingNotesResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [procError,  setProcError]  = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<'summary' | 'actions' | 'decisions' | 'minutes'>('summary');

  // Editable review fields
  const [editSummary,   setEditSummary]   = useState('');
  const [editKeyPoints, setEditKeyPoints] = useState<string[]>([]);
  const [editActions,   setEditActions]   = useState<ActionItem[]>([]);
  const [editDecisions, setEditDecisions] = useState<string[]>([]);
  const [editMinutes,   setEditMinutes]   = useState('');
  const [editNext,      setEditNext]      = useState('');

  // Drive (PDF notes)
  const [driveEnabled, setDriveEnabled] = useState(false);

  // Save
  const [saving,           setSaving]           = useState(false);
  const [saveError,        setSaveError]        = useState<string | null>(null);
  const [driveUrl,         setDriveUrl]         = useState<string | null>(null);
  const [addToTimeline,    setAddToTimeline]    = useState(true);
  const [timelineSaved,    setTimelineSaved]    = useState(false);

  // Refs
  const recogRef         = useRef<SpeechRecognitionInstance | null>(null);
  const timerRef         = useRef<NodeJS.Timeout | null>(null);
  const transcriptRef    = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunks  = useRef<Blob[]>([]);
  const screenStreamRef  = useRef<MediaStream | null>(null);

  // ── Pending client (Quick Launch) ──────────────────────────────────────────

  useEffect(() => {
    const pending = consumePendingClient('/meeting-notes');
    if (pending) setSelectedClient({ id: pending.id, name: pending.name, client_ref: null, business_type: null, vat_number: null, status: 'active' });

    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/meeting-notes') return;
      const p = consumePendingClient('/meeting-notes');
      if (p) setSelectedClient({ id: p.id, name: p.name, client_ref: null, business_type: null, vat_number: null, status: 'active' });
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

  // ── Origin → entryMode sync ────────────────────────────────────────────────

  useEffect(() => {
    if (meetingOrigin === 'recorded') setEntryMode('record');
    else if (meetingOrigin === 'virtual') setEntryMode('screen');
    else setEntryMode('manual');
  }, [meetingOrigin]);

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    setSpeechSupport(!!SR);
  }, []);

  useEffect(() => {
    fetch('/api/google-drive/status')
      .then(r => r.ok ? r.json() : { connected: false })
      .then(d => { if (d.connected) setDriveEnabled(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/calendar/reminders')
      .then(r => r.ok ? r.json() : { events: [] })
      .then(d => {
        const now = Date.now();
        const current = (d.events ?? []).find((e: { start: string; end: string }) => {
          const start = new Date(e.start).getTime();
          const end   = new Date(e.end).getTime();
          return (start <= now && end >= now) || (start > now && start - now < 30 * 60 * 1000);
        });
        if (current) setCalendarHint(current as CalendarHint);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (recogRef.current) recogRef.current.abort();
      if (timerRef.current) clearInterval(timerRef.current);
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function applyCalendarHint(hint: CalendarHint) {
    setMeetingTitle(hint.title);
    setMeetingDate(hint.start.split('T')[0]);
    setMeetingTime(formatTime(hint.start));
    if (hint.location) setLocation(hint.location);
    if (hint.attendees?.length) setAttendees(hint.attendees.map(a => a.name ?? a.email).filter(Boolean));
    if (hint.meetLink) { setMeetingOrigin('virtual'); setLocation(hint.location || hint.meetLink); }
    setHintDismissed(true);
  }

  function addAttendee() {
    const val = attendeeInput.trim();
    if (val && !attendees.includes(val)) setAttendees(prev => [...prev, val]);
    setAttendeeInput('');
  }

  // ── Start microphone speech recognition ───────────────────────────────────

  function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recog = new SR();
    recog.continuous = true; recog.interimResults = true; recog.lang = 'en-GB';

    recog.onresult = (e: SpeechRecognitionEvent) => {
      let interimText = '', newFinal = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) newFinal += text + ' ';
        else interimText += text;
      }
      if (newFinal) { transcriptRef.current += newFinal; setTranscript(transcriptRef.current); }
      setInterim(interimText);
    };
    recog.onend = () => {
      if (recogRef.current === recog) try { recog.start(); } catch { /* ignore */ }
    };
    recog.onerror = (e: Event) => {
      const err = (e as unknown as { error: string }).error;
      if (err !== 'no-speech') console.warn('[SpeechRecognition]', err);
    };
    recogRef.current = recog;
    recog.start();
  }

  function stopSpeechRecognition() {
    if (recogRef.current) {
      recogRef.current.onend = null;
      recogRef.current.abort();
      recogRef.current = null;
    }
    setInterim('');
  }

  // ── Mic-only recording ─────────────────────────────────────────────────────

  const startMicRecording = useCallback(async () => {
    setMicError(null);
    setTranscript(''); setInterim(''); setDuration(0); transcriptRef.current = '';
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) {
      const blocked = (err as Error).name === 'NotAllowedError' || (err as Error).name === 'PermissionDeniedError';
      setMicError(blocked
        ? 'Microphone access was blocked. Click the padlock in your browser address bar to allow access, or check Settings → Preferences → Device Permissions.'
        : 'Could not access your microphone. Please check your device settings.');
      return;
    }
    if (!speechSupport) { setMicError('Speech recognition not supported. Use Chrome or Edge.'); return; }
    startSpeechRecognition();
    setIsRecording(true);
    setPhase('recording');
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, [speechSupport]);

  // ── Screen recording ───────────────────────────────────────────────────────

  const startScreenRecording = useCallback(async () => {
    setScreenError(null); setMicError(null);
    setTranscript(''); setInterim(''); setDuration(0);
    setRecordingSize(0); setDriveVideoUrl(null); setDriveVideoError(null);
    transcriptRef.current = ''; recordingChunks.current = [];

    // 1. Screen capture (user picks their meeting tab + checks "Share tab audio")
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1280, height: 720, frameRate: 15 },
        audio: true,
      });
    } catch (err) {
      const blocked = (err as Error).name === 'NotAllowedError';
      setScreenError(blocked
        ? 'Screen share permission was denied. Click the padlock in your browser address bar, or check Settings → Preferences → Device Permissions.'
        : 'Screen share was cancelled.');
      return;
    }
    screenStreamRef.current = displayStream;

    // 2. Mic for transcription (separate stream — SpeechRecognition always uses mic)
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      if (speechSupport) startSpeechRecognition();
    } catch {
      // Mic unavailable — screen recording still works; transcript will be empty
      console.warn('[MeetingNotes] Mic not available for transcription');
    }

    // 3. MediaRecorder on the display stream
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4';

    const recorder = new MediaRecorder(displayStream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordingChunks.current.push(e.data);
        setRecordingSize(prev => prev + e.data.size);
      }
    };

    // When the user stops screen share via the browser's own stop button
    displayStream.getVideoTracks()[0].onended = () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      stopSpeechRecognition();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setIsRecording(false); setIsScreenRecording(false);
    };

    recorder.start(2000); // collect data every 2s
    setIsRecording(true); setIsScreenRecording(true);
    setPhase('recording');
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, [speechSupport]);

  const stopRecording = useCallback(() => {
    stopSpeechRecognition();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsRecording(false); setIsScreenRecording(false);
  }, []);

  // ── Upload recording to Drive ──────────────────────────────────────────────

  async function uploadRecordingToDrive(): Promise<string | null> {
    if (recordingChunks.current.length === 0) return null;

    const mimeType = mediaRecorderRef.current?.mimeType ?? 'video/webm';
    const blob = new Blob(recordingChunks.current, { type: mimeType });
    const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const safeName = (meetingTitle || 'Meeting').replace(/[^a-zA-Z0-9 ._-]/g, '_');
    const filename = `Recording - ${safeName} - ${meetingDate}.${ext}`;

    setUploadProgress(0);
    setPhase('uploading');

    try {
      // Get a resumable upload session URL from our server
      const sessionRes = await fetch('/api/meeting-notes/drive-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, mimeType, fileSize: blob.size }),
      });
      const sessionData = await sessionRes.json() as { uploadUrl?: string; error?: string };
      if (!sessionRes.ok || !sessionData.uploadUrl) {
        throw new Error(sessionData.error ?? 'Could not get Drive upload URL');
      }

      // Upload blob directly to Google Drive (browser → Drive, bypasses Next.js)
      const fileData = await new Promise<{ id?: string; webViewLink?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try { resolve(JSON.parse(xhr.responseText) as { id?: string; webViewLink?: string }); }
            catch { resolve({}); }
          } else {
            reject(new Error(`Upload failed: HTTP ${xhr.status}`));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Upload network error')));
        xhr.open('PUT', sessionData.uploadUrl!);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.send(blob);
      });

      const videoUrl = fileData.webViewLink ?? null;
      setDriveVideoUrl(videoUrl);
      setUploadProgress(100);
      return videoUrl;
    } catch (err) {
      console.error('[screen-upload]', err);
      setDriveVideoError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress(null);
      return null;
    }
  }

  // ── Summarise ──────────────────────────────────────────────────────────────

  async function handleSummarise(skipUpload = false) {
    // For screen recordings, upload the video first (unless already done)
    let videoUrl = driveVideoUrl;
    if (isScreenRecording || (entryMode === 'screen' && recordingChunks.current.length > 0 && !driveVideoUrl && !skipUpload && driveEnabled)) {
      videoUrl = await uploadRecordingToDrive();
    }

    setPhase('processing');
    setProcessing(true); setProcError(null);

    // Build the transcript content
    let content = '';
    if (entryMode === 'manual') {
      content = manualDescription;
    } else {
      content = transcriptRef.current || transcript;
      if (supplementalNotes.trim()) {
        content += content ? `\n\n--- Additional notes ---\n${supplementalNotes}` : supplementalNotes;
      }
    }

    try {
      const res = await fetch('/api/meeting-notes/summarise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingTitle:  meetingTitle || 'Untitled Meeting',
          meetingDate, meetingTime,
          location:     location || undefined,
          attendees,
          clientName:   selectedClient?.name || undefined,
          duration:     duration > 0 ? formatDuration(duration) : undefined,
          transcript:   content,
          meetingOrigin,
          entryMode:    entryMode === 'screen' ? 'record' : entryMode,
        }),
      });

      const data = await res.json() as { result?: MeetingNotesResult; error?: string };
      if (!res.ok || !data.result) throw new Error(data.error ?? 'Summarisation failed');

      const r = data.result;
      setNotes(r);
      setEditSummary(r.summary); setEditKeyPoints(r.keyPoints);
      setEditActions(r.actionItems); setEditDecisions(r.decisions);
      setEditMinutes(r.formalMinutes); setEditNext(r.nextMeeting ?? '');
      // Carry the video URL into review phase
      if (videoUrl) setDriveVideoUrl(videoUrl);
      setPhase('review');
    } catch (err) {
      setProcError(err instanceof Error ? err.message : 'Summarisation failed.');
      setPhase(entryMode === 'manual' ? 'setup' : 'recording');
    } finally {
      setProcessing(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setSaveError(null); setTimelineSaved(false);
    try {
      const payload = {
        title: meetingTitle || 'Untitled Meeting',
        meetingDate, meetingTime,
        durationSeconds: duration || undefined,
        location: location || undefined,
        attendees,
        clientName: selectedClient?.name || undefined,
        summary: editSummary, keyPoints: editKeyPoints,
        actionItems: editActions, decisions: editDecisions,
        formalMinutes: editMinutes, nextMeeting: editNext,
      };

      // Download PDF
      const pdfRes = await fetch('/api/meeting-notes/download-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!pdfRes.ok) {
        const err = await pdfRes.json() as { error?: string };
        throw new Error(err.error ?? 'Failed to generate PDF');
      }
      const blob = await pdfRes.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const safeName = (meetingTitle || 'Meeting Notes').replace(/[^a-zA-Z0-9 ._-]/g, '_');
      a.href = url; a.download = `Meeting Notes - ${safeName} - ${meetingDate}.pdf`;
      a.click(); URL.revokeObjectURL(url);

      // Save to client timeline (if opted in and a client is linked)
      if (addToTimeline && selectedClient?.id) {
        const tlRes = await fetch('/api/meeting-notes/save-timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId:      selectedClient.id,
            title:         meetingTitle || 'Untitled Meeting',
            meetingDate,   meetingTime,
            location:      location || undefined,
            attendees,     meetingOrigin,
            summary:       editSummary,
            keyPoints:     editKeyPoints,
            actionItems:   editActions,
            decisions:     editDecisions,
            formalMinutes: editMinutes,
            nextMeeting:   editNext,
          }),
        });
        if (tlRes.ok) {
          setTimelineSaved(true);
        } else {
          const tlErr = await tlRes.json() as { error?: string };
          setSaveError(`PDF downloaded but timeline save failed: ${tlErr.error ?? 'unknown error'}`);
        }
      }

      setPhase('saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to generate PDF.');
    } finally { setSaving(false); }
  }

  function handleNewMeeting() {
    stopRecording();
    setPhase('setup'); setMeetingTitle('');
    setMeetingDate(new Date().toISOString().split('T')[0]);
    setMeetingTime(new Date().toTimeString().slice(0, 5));
    setLocation(''); setAttendees([]); setAttendeeInput('');
    setSelectedClient(null);
    setTranscript(''); setInterim(''); setDuration(0);
    setManualDescription(''); setSupplementalNotes('');
    setRecordingSize(0); setDriveVideoUrl(null); setDriveVideoError(null);
    setUploadProgress(null); recordingChunks.current = [];
    setNotes(null); setEditSummary(''); setEditKeyPoints([]);
    setEditActions([]); setEditDecisions([]); setEditMinutes(''); setEditNext('');
    setDriveUrl(null); setSaveError(null); setProcError(null);
    transcriptRef.current = '';
  }

  // ══ SAVED ════════════════════════════════════════════════════════════════════

  if (phase === 'saved') {
    return (
      <ToolLayout title="Meeting Notes">
        <div className="max-w-xl mx-auto py-16 flex flex-col items-center text-center gap-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Meeting notes saved</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {meetingTitle || 'Untitled Meeting'} · {new Date(meetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="w-full glass-solid rounded-xl border border-[var(--border)] p-4 space-y-3 text-left">
            {selectedClient && (
              <div className="flex items-center gap-2 text-sm">
                <Users2 size={14} className="text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">Client:</span>
                <span className="font-medium text-[var(--text-primary)]">{selectedClient.name}</span>
              </div>
            )}
            {driveUrl && (
              <a href={driveUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 text-sm text-[var(--accent)] hover:underline font-medium">
                <FileText size={14} className="text-green-600" />View notes PDF in Google Drive <ExternalLink size={12} />
              </a>
            )}
            {driveVideoUrl && (
              <a href={driveVideoUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 text-sm text-[var(--accent)] hover:underline font-medium">
                <Film size={14} className="text-indigo-600" />View meeting recording in Google Drive <ExternalLink size={12} />
              </a>
            )}
            {selectedClient && <p className="text-xs text-[var(--text-muted)]">A timeline entry has been added to the {selectedClient.name} client record.</p>}
          </div>
          <button onClick={handleNewMeeting} className="btn-primary flex items-center gap-2">
            <Plus size={16} />Start New Meeting
          </button>
        </div>
      </ToolLayout>
    );
  }

  // ══ UPLOADING ════════════════════════════════════════════════════════════════

  if (phase === 'uploading') {
    return (
      <ToolLayout title="Meeting Notes">
        <div className="max-w-xl mx-auto py-16 flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center">
            <Upload size={28} className="text-indigo-600" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Uploading recording to Google Drive…</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {recordingSize > 0 && `File size: ${formatBytes(recordingSize)}`}
            </p>
          </div>
          {uploadProgress !== null && (
            <div className="w-full max-w-sm space-y-2">
              <div className="h-3 bg-[var(--border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-sm text-center font-medium text-[var(--text-secondary)]">{uploadProgress}%</p>
            </div>
          )}
          {driveVideoError && (
            <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 space-y-2">
              <p className="font-medium flex items-center gap-2"><AlertCircle size={14} />Recording upload failed</p>
              <p>{driveVideoError}</p>
              <button onClick={() => void handleSummarise(true)}
                className="text-xs underline text-amber-600">Continue to summary without recording</button>
            </div>
          )}
        </div>
      </ToolLayout>
    );
  }

  // ══ PROCESSING ═══════════════════════════════════════════════════════════════

  if (phase === 'processing') {
    return (
      <ToolLayout title="Meeting Notes">
        <div className="max-w-xl mx-auto py-16 flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-[var(--accent-light)] flex items-center justify-center">
            <Loader2 size={28} className="text-[var(--accent)] animate-spin" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Generating minutes…</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Claude is writing your summary, action items, and formal minutes.</p>
          </div>
        </div>
      </ToolLayout>
    );
  }

  // ══ REVIEW ═══════════════════════════════════════════════════════════════════

  if (phase === 'review' && notes) {
    const originOption = ORIGIN_OPTIONS.find(o => o.value === meetingOrigin);
    const originalContent = entryMode === 'manual' ? manualDescription : (transcript + (supplementalNotes ? `\n\n${supplementalNotes}` : ''));

    return (
      <ToolLayout title="Meeting Notes">
        <div className="space-y-6 pb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{meetingTitle || 'Untitled Meeting'}</h2>
              <p className="text-sm text-[var(--text-muted)] mt-0.5 flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1"><Calendar size={12} />{formatDateDisplay(meetingDate)}</span>
                {meetingTime && <span className="flex items-center gap-1"><Clock size={12} />{meetingTime}</span>}
                {duration > 0 && <span className="flex items-center gap-1"><Mic size={12} />{formatDuration(duration)}</span>}
                {originOption && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-nav-hover)] rounded text-xs">
                    {originOption.icon}{originOption.label}
                  </span>
                )}
                {driveVideoUrl && (
                  <a href={driveVideoUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-xs hover:bg-indigo-100 transition-colors">
                    <Film size={11} />Recording saved <ExternalLink size={10} />
                  </a>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPhase('setup')} className="btn-ghost text-sm flex items-center gap-1.5">
                <RefreshCw size={14} />Back
              </button>
              <button onClick={() => void handleSummarise(true)} className="btn-ghost text-sm flex items-center gap-1.5">
                <Zap size={14} />Re-analyse
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-2 space-y-4">
              {/* Meta */}
              <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-3">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Meeting Details</p>
                {selectedClient && <div className="flex items-center gap-2 text-sm"><Users2 size={13} className="text-[var(--text-muted)]" /><span className="font-medium">{selectedClient.name}</span></div>}
                {location && <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><MapPin size={13} className="text-[var(--text-muted)]" />{location}</div>}
                {attendees.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Attendees</p>
                    <div className="flex flex-wrap gap-1">
                      {attendees.map((a, i) => <span key={i} className="px-2 py-0.5 bg-[var(--accent-light)] text-[var(--accent)] rounded text-xs font-medium">{a}</span>)}
                    </div>
                  </div>
                )}
              </div>

              {/* Original content */}
              <div className="glass-solid rounded-xl border border-[var(--border)] p-4">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  {entryMode === 'manual' ? 'Original Description' : 'Transcript'}
                </p>
                <div className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto">
                  {originalContent || <span className="text-[var(--text-muted)] italic">No content</span>}
                </div>
              </div>

              {/* Save */}
              <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-3">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Download</p>

                {/* Add to timeline option — only shown when a client is linked */}
                {selectedClient && (
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={addToTimeline}
                      onChange={e => setAddToTimeline(e.target.checked)}
                      className="w-4 h-4 rounded accent-[var(--accent)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      Add to <span className="font-medium">{selectedClient.name}</span>&apos;s timeline
                    </span>
                  </label>
                )}

                {saveError && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle size={12} />{saveError}
                  </p>
                )}
                {timelineSaved && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 size={12} />Saved to {selectedClient?.name}&apos;s timeline
                  </p>
                )}

                <button onClick={() => void handleSave()} disabled={saving}
                  className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? 'Saving…' : 'Download Meeting Notes PDF'}
                </button>
              </div>
            </div>

            {/* AI Notes */}
            <div className="xl:col-span-3 space-y-4">
              <div className="flex gap-1 flex-wrap">
                <TabPill label="Summary"                             icon={<FileText  size={13} />} active={activeTab === 'summary'}   onClick={() => setActiveTab('summary')} />
                <TabPill label={`Actions (${editActions.length})`}  icon={<ListChecks size={13} />} active={activeTab === 'actions'}   onClick={() => setActiveTab('actions')} />
                <TabPill label={`Decisions (${editDecisions.length})`} icon={<Vote size={13} />}   active={activeTab === 'decisions'} onClick={() => setActiveTab('decisions')} />
                <TabPill label="Minutes"                             icon={<BookText  size={13} />} active={activeTab === 'minutes'}   onClick={() => setActiveTab('minutes')} />
              </div>

              {activeTab === 'summary' && (
                <div className="space-y-4">
                  <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-2">
                    <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Executive Summary</label>
                    <textarea value={editSummary} onChange={e => setEditSummary(e.target.value)} rows={5} className="input-base w-full resize-none text-sm leading-relaxed" />
                  </div>
                  <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Key Discussion Points</label>
                      <button onClick={() => setEditKeyPoints(prev => [...prev, ''])} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"><Plus size={12} />Add</button>
                    </div>
                    {editKeyPoints.map((pt, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="mt-2 text-xs text-[var(--text-muted)] w-5 shrink-0 text-right">{i + 1}.</span>
                        <input value={pt} onChange={e => setEditKeyPoints(prev => prev.map((p, j) => j === i ? e.target.value : p))} className="input-base flex-1 text-sm" />
                        <button onClick={() => setEditKeyPoints(prev => prev.filter((_, j) => j !== i))} className="mt-2 p-0.5 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                  {editNext && (
                    <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-2">
                      <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Next Meeting</label>
                      <input value={editNext} onChange={e => setEditNext(e.target.value)} className="input-base w-full text-sm" />
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'actions' && (
                <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Action Items</label>
                    <button onClick={() => setEditActions(prev => [...prev, { action: '', owner: '', deadline: '' }])} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"><Plus size={12} />Add</button>
                  </div>
                  {editActions.length === 0 && <p className="text-sm text-[var(--text-muted)] italic">No action items identified.</p>}
                  {editActions.map((item, i) => (
                    <div key={i} className="border border-[var(--border)] rounded-lg p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-2.5 text-xs font-bold text-[var(--accent)] w-5 shrink-0">{i + 1}</span>
                        <div className="flex-1 space-y-2">
                          <input value={item.action} onChange={e => setEditActions(prev => prev.map((a, j) => j === i ? { ...a, action: e.target.value } : a))} placeholder="Action" className="input-base w-full text-sm" />
                          <div className="grid grid-cols-2 gap-2">
                            <input value={item.owner} onChange={e => setEditActions(prev => prev.map((a, j) => j === i ? { ...a, owner: e.target.value } : a))} placeholder="Owner" className="input-base text-sm" />
                            <input value={item.deadline} onChange={e => setEditActions(prev => prev.map((a, j) => j === i ? { ...a, deadline: e.target.value } : a))} placeholder="Deadline" className="input-base text-sm" />
                          </div>
                        </div>
                        <button onClick={() => setEditActions(prev => prev.filter((_, j) => j !== i))} className="mt-2 p-0.5 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'decisions' && (
                <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Decisions Made</label>
                    <button onClick={() => setEditDecisions(prev => [...prev, ''])} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"><Plus size={12} />Add</button>
                  </div>
                  {editDecisions.length === 0 && <p className="text-sm text-[var(--text-muted)] italic">No formal decisions identified.</p>}
                  {editDecisions.map((d, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="mt-2 text-[var(--accent)] shrink-0">▸</span>
                      <input value={d} onChange={e => setEditDecisions(prev => prev.map((x, j) => j === i ? e.target.value : x))} className="input-base flex-1 text-sm" />
                      <button onClick={() => setEditDecisions(prev => prev.filter((_, j) => j !== i))} className="mt-2 p-0.5 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'minutes' && (
                <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-2">
                  <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Formal Minutes (UK Professional Format)</label>
                  <textarea value={editMinutes} onChange={e => setEditMinutes(e.target.value)} rows={20} className="input-base w-full resize-none text-sm leading-relaxed font-mono" spellCheck />
                </div>
              )}
            </div>
          </div>
        </div>
      </ToolLayout>
    );
  }

  // ══ SETUP + RECORDING ════════════════════════════════════════════════════════

  const isManualMode  = entryMode === 'manual';
  const isScreenMode  = entryMode === 'screen';
  const canSummarise  = isManualMode
    ? manualDescription.trim().length > 20
    : isScreenMode
    ? recordingChunks.current.length > 0 || transcript.trim().length > 0
    : transcript.trim().length > 0 || phase === 'recording';

  return (
    <ToolLayout title="Meeting Notes">
      <div className="max-w-4xl space-y-5 pb-8">

        {/* Calendar hint */}
        {!hintDismissed && calendarHint && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Calendar size={16} className="text-blue-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Meeting detected on your calendar</p>
                <p className="text-sm text-blue-700 mt-0.5">
                  <strong>{calendarHint.title}</strong> · {formatTime(calendarHint.start)}–{formatTime(calendarHint.end)}
                  {calendarHint.location && ` · ${calendarHint.location}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => applyCalendarHint(calendarHint)} className="text-xs font-medium px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Use this meeting</button>
              <button onClick={() => setHintDismissed(true)} className="p-1 text-blue-500 hover:text-blue-700"><X size={14} /></button>
            </div>
          </div>
        )}

        {procError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-sm text-red-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <div><p className="font-medium">Failed</p><p>{procError}</p></div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── Left: meeting details ─── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="glass-solid rounded-xl border border-[var(--border)] p-5 space-y-4">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Meeting Details</p>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Title</label>
                <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="e.g. Year End Review — Acme Ltd" className="input-base w-full text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Date</label>
                  <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} className="input-base w-full text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Time</label>
                  <input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)} className="input-base w-full text-sm" />
                </div>
              </div>

              {/* Meeting Type */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Meeting Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {ORIGIN_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setMeetingOrigin(opt.value)} title={opt.hint}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        meetingOrigin === opt.value
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                      }`}>
                      {opt.icon}{opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1 flex items-center gap-1">
                  <MapPin size={11} />Location
                </label>
                <input value={location} onChange={e => setLocation(e.target.value)}
                  placeholder={meetingOrigin === 'virtual' ? 'e.g. Google Meet, Zoom…' : meetingOrigin === 'phone' ? 'e.g. +44 7700 900000' : 'e.g. Office, Meeting Room 1'}
                  className="input-base w-full text-sm" />
              </div>

              {/* Client */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Client (optional)</label>
                <ClientSelector value={selectedClient} onSelect={setSelectedClient} />
              </div>

              {/* Attendees */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1 flex items-center gap-1"><Users2 size={11} />Attendees</label>
                <div className="flex gap-2">
                  <input value={attendeeInput} onChange={e => setAttendeeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAttendee(); } }}
                    placeholder="Name or email, press Enter" className="input-base flex-1 text-sm" />
                  <button onClick={addAttendee} disabled={!attendeeInput.trim()} className="btn-ghost px-3 text-sm disabled:opacity-40"><Plus size={14} /></button>
                </div>
                {attendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {attendees.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded-full text-xs text-[var(--accent)] font-medium">
                        {a}<button onClick={() => setAttendees(prev => prev.filter((_, j) => j !== i))} className="hover:text-red-500"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: entry area ─── */}
          <div className="lg:col-span-3 space-y-4">

            {/* ── VIRTUAL / SCREEN RECORDING ─── */}
            {isScreenMode && (
              <>
                {/* Explainer */}
                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-start gap-3">
                  <Monitor size={16} className="text-indigo-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-indigo-800 space-y-1">
                    <p className="font-semibold">How to record your Google Meet</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs text-indigo-700">
                      <li>Click <strong>Start Screen Share</strong> below</li>
                      <li>In Chrome's picker, select the <strong>Chrome Tab</strong> tab and choose your Google Meet tab</li>
                      <li>Make sure <strong>"Share tab audio"</strong> is checked at the bottom of the picker</li>
                      <li>Click <strong>Share</strong> — recording begins immediately</li>
                      <li>Your microphone will also transcribe your own voice live</li>
                      <li>When finished, click <strong>Stop Recording</strong></li>
                    </ol>
                    <p className="text-xs text-indigo-600 mt-1">The recording will be automatically uploaded to Google Drive{!driveEnabled ? ' (connect Drive in Settings first)' : ''}.</p>
                  </div>
                </div>

                {/* Screen recording controls */}
                <div className="glass-solid rounded-xl border border-[var(--border)] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Screen Recording</p>
                    {isScreenRecording && (
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                          <Film size={11} />{formatBytes(recordingSize)}
                        </span>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                        </span>
                        <span className="text-sm font-mono font-medium text-red-600">{formatDuration(duration)}</span>
                      </div>
                    )}
                  </div>

                  {screenError && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />{screenError}
                    </div>
                  )}

                  {!driveEnabled && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />
                      Google Drive is not connected. The recording will not be saved automatically. Connect Drive in Settings → Integrations.
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    {!isScreenRecording ? (
                      <button onClick={() => void startScreenRecording()}
                        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-sm">
                        <Monitor size={16} />Start Screen Share
                      </button>
                    ) : (
                      <button onClick={() => { stopRecording(); }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-colors shadow-sm">
                        <Square size={14} className="fill-white" />Stop Recording
                      </button>
                    )}
                    {!isScreenRecording && recordingChunks.current.length > 0 && (
                      <button onClick={() => void handleSummarise()}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium rounded-xl transition-colors shadow-sm">
                        <Zap size={16} />
                        {driveEnabled ? 'Upload & Generate Minutes' : 'Generate Minutes'}
                      </button>
                    )}
                  </div>

                  {/* Mic transcription status */}
                  {isScreenRecording && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <Mic size={11} className="text-green-500" />
                      Microphone transcription active — your voice is being captured
                    </div>
                  )}
                </div>

                {/* Live transcript during screen recording */}
                {(isScreenRecording || transcript) && (
                  <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-2">
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Your voice (live transcript)</p>
                    <div className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {transcript || <span className="text-[var(--text-muted)] italic">Listening for your voice…</span>}
                      {interim && <span className="text-[var(--text-muted)] italic"> {interim}</span>}
                    </div>
                  </div>
                )}

                {/* Supplemental notes — shown after recording stops */}
                {!isScreenRecording && recordingChunks.current.length > 0 && (
                  <div className="glass-solid rounded-xl border border-[var(--border)] p-4 space-y-2">
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Additional Notes (optional)</label>
                    <p className="text-xs text-[var(--text-muted)]">
                      Add key points from the other party, decisions made, or anything your microphone may have missed.
                    </p>
                    <textarea
                      value={supplementalNotes}
                      onChange={e => setSupplementalNotes(e.target.value)}
                      rows={5}
                      placeholder="e.g. Client confirmed the £120k turnover figure. Agreed to fee increase from Jan 2027. They will send the missing invoices by Friday…"
                      className="input-base w-full resize-none text-sm leading-relaxed"
                    />
                  </div>
                )}
              </>
            )}

            {/* ── MIC-ONLY RECORDING ─── */}
            {!isManualMode && !isScreenMode && (
              <>
                {!speechSupport && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-sm text-amber-700">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    Live transcription requires Chrome or Edge.
                    <button onClick={() => setMeetingOrigin('in_person')} className="underline font-medium ml-1">Switch to manual entry</button>
                  </div>
                )}
                <div className="glass-solid rounded-xl border border-[var(--border)] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Recording</p>
                    {isRecording && (
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                        </span>
                        <span className="text-sm font-mono font-medium text-red-600">{formatDuration(duration)}</span>
                      </div>
                    )}
                  </div>
                  {micError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-start gap-1.5">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />{micError}
                    </div>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    {!isRecording ? (
                      <button onClick={() => void startMicRecording()} disabled={!speechSupport}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 shadow-sm">
                        <Mic size={16} />Start Recording
                      </button>
                    ) : (
                      <>
                        <button onClick={stopRecording}
                          className="flex items-center gap-2 px-4 py-2.5 border border-red-300 text-red-600 hover:bg-red-50 font-medium rounded-xl transition-colors">
                          <Square size={14} className="fill-red-600" />Pause
                        </button>
                        <button onClick={() => void handleSummarise()}
                          className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium rounded-xl transition-colors shadow-sm">
                          <MicOff size={16} />Stop & Summarise
                        </button>
                      </>
                    )}
                    {!isRecording && canSummarise && (
                      <button onClick={() => void handleSummarise()} disabled={processing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium rounded-xl transition-colors shadow-sm disabled:opacity-50">
                        {processing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}Summarise
                      </button>
                    )}
                  </div>
                  <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <MonitorSpeaker size={12} />Tip: for remote calls, play audio through speakers near your mic for best results.
                  </p>
                </div>
                <div className="glass-solid rounded-xl border border-[var(--border)] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Live Transcript</p>
                    {transcript && <button onClick={() => { setTranscript(''); transcriptRef.current = ''; setInterim(''); }} className="text-xs text-[var(--text-muted)] hover:text-red-500 flex items-center gap-1"><Trash2 size={11} />Clear</button>}
                  </div>
                  <textarea
                    value={transcript + (interim ? ` ${interim}` : '')}
                    onChange={e => { setTranscript(e.target.value); transcriptRef.current = e.target.value; setInterim(''); }}
                    placeholder={isRecording ? 'Listening… speech will appear here in real time.' : 'Transcript will appear once you start recording. You can also type manually.'}
                    rows={12} className="input-base w-full resize-none text-sm leading-relaxed"
                  />
                  {canSummarise && !isRecording && (
                    <div className="flex justify-end">
                      <button onClick={() => void handleSummarise()} disabled={processing}
                        className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                        {processing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}Summarise with AI
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── MANUAL ENTRY ─── */}
            {isManualMode && (
              <div className="glass-solid rounded-xl border border-[var(--border)] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                    <PenLine size={16} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Describe the Meeting</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Write what was discussed — topics, decisions, actions agreed. Claude will turn this into full professional minutes.</p>
                  </div>
                </div>
                <textarea
                  value={manualDescription}
                  onChange={e => setManualDescription(e.target.value)}
                  rows={14}
                  placeholder={
                    meetingOrigin === 'phone'
                      ? `e.g. Called ${selectedClient?.name || 'the client'} to discuss their year end accounts. Confirmed turnover of £120k. Agreed to submit accounts by 31 January. Client mentioned a new van purchase (£18,000) to capitalise. Action: obtain van invoice and finance agreement.`
                      : `e.g. Met with ${selectedClient?.name || 'the client'} at their office. Reviewed draft accounts. Discussed outstanding HMRC enquiry — client to provide correspondence by end of month. Agreed fee increase from £1,500 to £1,800 from next year.`
                  }
                  className="input-base w-full resize-none text-sm leading-relaxed"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[var(--text-muted)]">{manualDescription.trim().split(/\s+/).filter(Boolean).length} words</p>
                  <button onClick={() => void handleSummarise()} disabled={!canSummarise || processing}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50">
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}Generate Notes with AI
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
