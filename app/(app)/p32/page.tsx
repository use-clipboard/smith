'use client';
import { useState, useRef, useCallback } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveToDriveButton from '@/components/ui/SaveToDriveButton';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import { Receipt, Copy } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';

type AppState = 'idle' | 'loading' | 'success' | 'error';

export default function P32Page() {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/p32', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [emailBody, setEmailBody] = useState('');
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleClientSelect = useCallback((c: SelectedClient | null) => {
    setSelectedClient(c);
    if (c) {
      if (c.name) setClientName(c.name);
      if (c.client_ref) setClientCode(c.client_ref);
    }
  }, []);

  const handleProcess = useCallback(async () => {
    if (!documentFile) return;
    setAppState('loading'); setError(null); setProgress(0);
    const est = 10000; let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(99, (elapsed / est) * 100)); }, 100);
    try {
      const files = [{ name: documentFile.name, mimeType: documentFile.type || 'application/pdf', base64: await fileToBase64(documentFile) }];
      const res = await fetch('/api/p32', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, clientId: selectedClient?.id ?? null, clientCode: selectedClient?.client_ref ?? null, saveToDrive: true }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      if (progressRef.current) clearInterval(progressRef.current);
      setProgress(100);
      setEmailBody(data.emailBody || 'Could not generate email. Please check the document.');
      setAppState('success');
    } catch (err) {
      if (progressRef.current) clearInterval(progressRef.current);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setAppState('error'); setProgress(0);
    }
  }, [documentFile, selectedClient?.id]);

  async function handleCopy() {
    await navigator.clipboard.writeText(emailBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (appState === 'loading') {
    const processingFiles: ProgressFile[] = documentFile ? [{ name: documentFile.name, status: 'processing' }] : [];
    return (
      <ProcessingView
        progress={progress}
        fileCount={1}
        files={processingFiles}
        steps={['Reading payroll document', 'Extracting payment data', 'Drafting email summary']}
      />
    );
  }
  if (appState === 'error') return <ToolLayout title="P32 Summary" icon={Receipt} iconColor="#CA8A04"><ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} /></ToolLayout>;

  return (
    <ToolLayout title="P32 Summary" description="Generate a client-ready email body from a P32 payroll document." icon={Receipt} iconColor="#CA8A04">
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-solid rounded-xl p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Client</p>
                <div className="flex items-center gap-2 mb-3">
                  <ClientSelector value={selectedClient} onSelect={handleClientSelect} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Client Name</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      placeholder="e.g. John Smith"
                      className="input-base w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Client Code</label>
                    <input
                      type="text"
                      value={clientCode}
                      onChange={e => setClientCode(e.target.value.toUpperCase())}
                      placeholder="e.g. JS001"
                      className="input-base w-full text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
            <FileUpload title="P32 Document" onFileChange={setDocumentFile} accept="application/pdf,image/*" helpText="Upload a single P32 Employer's Payment Record." existingFiles={documentFile ? [documentFile] : []} />
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={!documentFile} className="btn-primary">
              <Receipt size={15} />
              Generate Email
            </button>
          </div>
        </div>
      )}
      {appState === 'success' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Generated Email</h3>
            <div className="flex items-center gap-2">
              <SaveToDriveButton files={documentFile ? [documentFile] : []} feature="p32_summary" clientId={selectedClient?.id} initialClientCode={selectedClient?.client_ref ?? ''} />
              <button onClick={handleCopy} className="btn-primary">
                <Copy size={14} />
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Summary</button>
            </div>
          </div>
          <div className="glass-solid rounded-xl p-5">
            <textarea
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              rows={20}
              className="input-base font-mono resize-y"
            />
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
