'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, MessageSquare, Sparkles, Paperclip, FileText, Image } from 'lucide-react';

interface Attachment {
  name: string;
  mimeType: string;
  base64: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

export default function AskSmithBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setAttachments(prev => [...prev, ...files].slice(0, 5));
    e.target.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }

  async function sendMessage() {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;

    const encodedAttachments: Attachment[] = await Promise.all(
      attachments.map(async f => {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        return { name: f.name, mimeType: f.type || 'application/octet-stream', base64 };
      })
    );

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      attachments: encodedAttachments.length > 0 ? encodedAttachments : undefined,
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setAttachments([]);
    setIsStreaming(true);
    setMessages(m => [...m, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok || !res.body) throw new Error('Failed to get response');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages(m => {
          const updated = [...m];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } catch {
      setMessages(m => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  return (
    <>
      {/* Chat drawer */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[560px] flex flex-col rounded-2xl overflow-hidden shadow-dropdown border border-[var(--border-card)] bg-[var(--bg-card-solid)] animate-slide-up">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--accent)]">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-white" />
              <span className="text-sm font-semibold text-white">Ask Smith</span>
              <span className="text-xs text-indigo-200 bg-white/10 px-2 py-0.5 rounded-full">AI Assistant</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] flex items-center justify-center mb-3">
                  <MessageSquare size={22} className="text-[var(--accent)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">How can I help you?</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[240px]">
                  Ask about UK accounting, bookkeeping, tax, or how to use SMITH.
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed
                  ${msg.role === 'user'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-nav-hover)] text-[var(--text-primary)] border border-[var(--border)]'
                  }`}>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {msg.attachments.map((a, ai) => (
                        <span key={ai} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">
                          {a.mimeType.startsWith('image/') ? <Image size={10} /> : <FileText size={10} />}
                          {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">
                    {msg.content}
                    {isStreaming && i === messages.length - 1 && msg.role === 'assistant' && (
                      <span className="inline-block w-1 h-3.5 bg-[var(--accent)] rounded-sm ml-0.5 animate-pulse align-text-bottom" />
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-[var(--border)]">
            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {attachments.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded text-xs text-[var(--accent)] font-medium">
                    {f.type.startsWith('image/') ? <Image size={10} /> : <FileText size={10} />}
                    <span className="max-w-[120px] truncate">{f.name}</span>
                    <button type="button" onClick={() => removeAttachment(i)} className="p-0.5 hover:opacity-70">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              {/* Attach button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || attachments.length >= 5}
                title="Attach a file"
                className="h-[38px] w-[38px] shrink-0 flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors disabled:opacity-40"
              >
                <Paperclip size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                onChange={handleFileChange}
                className="hidden"
              />

              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question…"
                rows={1}
                disabled={isStreaming}
                className="flex-1 input-base resize-none min-h-[38px] max-h-[120px] py-2 text-sm"
                style={{ height: 'auto' }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
                }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={(!input.trim() && attachments.length === 0) || isStreaming}
                className="btn-primary h-[38px] px-3 shrink-0"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-dropdown transition-all duration-200
          ${open
            ? 'bg-[var(--text-primary)] text-[var(--bg-page)] scale-95'
            : 'bg-[#1A1A2E] dark:bg-white text-white dark:text-[#0F0F1A] hover:scale-105 hover:shadow-accent-glow'
          }`}
        title="Ask Smith"
        aria-label="Open Ask Smith chat"
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </>
  );
}
