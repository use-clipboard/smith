'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader2, Sparkles, CheckCircle2, PenLine, LayoutTemplate } from 'lucide-react';
import { TaskViewFlowChart } from './TaskFlowChart';
import type { TemplateStepData, TemplateEdgeData, TemplateData } from './TemplateBuilder';
import type { TaskStep, TaskStepEdge } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AITemplate {
  name: string;
  description: string;
  category: string;
  recurrence_type: string;
  estimated_duration_days: number;
  steps: TemplateStepData[];
  edges: TemplateEdgeData[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;       // raw (may contain <template_json>)
  hasTemplate?: boolean;
}

interface Props {
  teamMembers: { id: string; full_name: string | null; email: string }[];
  existingTemplate?: TemplateData | null; // set when editing an existing template
  onOpenInEditor: (data: TemplateData) => void;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripTemplateJson(text: string): string {
  return text.replace(/<template_json>[\s\S]*?<\/template_json>/g, '').trim();
}

function extractTemplateJson(text: string): AITemplate | null {
  const match = text.match(/<template_json>([\s\S]*?)<\/template_json>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); }
  catch { return null; }
}

function toViewSteps(steps: TemplateStepData[]): TaskStep[] {
  return steps.map(s => ({
    id: s.step_key,
    task_id: '',
    template_step_id: null,
    step_key: s.step_key,
    title: s.title,
    description: s.description ?? null,
    assignee_id: null,
    is_client_step: s.assignee_role === 'client',
    status: 'not_started' as const,
    tool_module_id: s.tool_module_id ?? null,
    tool_output_id: null,
    email_reminder_enabled: s.email_reminder_enabled,
    email_reminder_config: s.email_reminder_config,
    email_reminder_subject: null,
    email_reminder_message: null,
    client_instructions: s.client_instructions ?? null,
    client_can_upload: s.client_can_upload ?? false,
    due_date: null,
    completed_at: null,
    position_x: s.position_x,
    position_y: s.position_y,
    step_type: s.step_type ?? 'regular',
    start_trigger_config: s.start_trigger_config ?? null,
    end_config: s.end_config ?? null,
    created_at: '',
    updated_at: '',
    assignee: null,
  }));
}

function toViewEdges(edges: TemplateEdgeData[]): TaskStepEdge[] {
  return edges.map((e, i) => ({
    id: `e-${i}`,
    task_id: '',
    from_step_key: e.from_step_key,
    to_step_key: e.to_step_key,
    label: e.label ?? null,
    condition_type: e.condition_type ?? null,
    condition_config: null,
    source_handle: e.source_handle ?? null,
    target_handle: e.target_handle ?? null,
  }));
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const displayText = stripTemplateJson(msg.content);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center mt-0.5">
          <Sparkles className="h-3.5 w-3.5 text-[var(--text-primary)]" />
        </div>
      )}
      <div className={`max-w-[85%] space-y-1.5 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {displayText && (
          <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-gray-100 text-gray-800 rounded-tl-sm'
          }`}>
            {displayText}
          </div>
        )}
        {msg.hasTemplate && (
          <div className="flex items-center gap-1.5 text-[11px] text-green-600 font-medium px-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Template updated — see preview →
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const NEW_TEMPLATE_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm here to help you build a workflow template. What kind of process would you like to create? For example: a VAT return, payroll run, year-end accounts, or something completely custom?",
};

function makeEditMessage(data: TemplateData): ChatMessage {
  const templateJson = JSON.stringify({
    name: data.name,
    description: data.description ?? '',
    category: data.category,
    recurrence_type: data.recurrence_type ?? 'one_off',
    estimated_duration_days: data.estimated_duration_days ?? 14,
    steps: data.steps,
    edges: data.edges,
  }, null, 2);
  return {
    role: 'assistant',
    content: `I've loaded your "${data.name}" template. Here's what it looks like right now:\n\n<template_json>\n${templateJson}\n</template_json>\n\nWhat would you like to change? I can add or remove steps, adjust reminders, change the order, add client-facing actions, tool integrations, automated chasers — just tell me in plain English.`,
    hasTemplate: true,
  };
}

export default function AITemplateBuilder({ existingTemplate, onOpenInEditor, onClose }: Props) {
  const initialMessage = existingTemplate ? makeEditMessage(existingTemplate) : NEW_TEMPLATE_MESSAGE;

  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [template, setTemplate] = useState<AITemplate | null>(
    existingTemplate ? {
      name: existingTemplate.name,
      description: existingTemplate.description ?? '',
      category: existingTemplate.category,
      recurrence_type: existingTemplate.recurrence_type ?? 'one_off',
      estimated_duration_days: existingTemplate.estimated_duration_days ?? 14,
      steps: existingTemplate.steps,
      edges: existingTemplate.edges,
    } : null
  );
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    setError(null);

    // Build API message list (strip template_json from assistant messages to keep context clean)
    const apiMessages = nextMessages.map(m => ({
      role: m.role,
      content: m.role === 'assistant' ? m.content : m.content,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = '';
    let latestTemplate: AITemplate | null = template;

    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '' };
    setMessages(prev => [...prev, assistantPlaceholder]);

    try {
      const res = await fetch('/api/tasks/templates/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? 'Request failed');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        // Try to extract template JSON as it streams
        const parsed = extractTemplateJson(accumulated);
        if (parsed) latestTemplate = parsed;

        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: accumulated,
            hasTemplate: !!parsed,
          };
          return updated;
        });
      }

      // Final parse after stream ends
      const finalParsed = extractTemplateJson(accumulated);
      if (finalParsed) {
        latestTemplate = finalParsed;
        setTemplate(finalParsed);
      } else if (latestTemplate !== template) {
        setTemplate(latestTemplate);
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: accumulated,
          hasTemplate: !!finalParsed || !!latestTemplate,
        };
        return updated;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setMessages(prev => prev.slice(0, -1)); // remove empty assistant message
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, template]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleOpenInEditor() {
    if (!template) return;
    onOpenInEditor({
      name: template.name,
      description: template.description,
      is_firm_wide: true,
      category: template.category,
      recurrence_type: (template.recurrence_type as never) || null,
      estimated_duration_days: template.estimated_duration_days ?? null,
      steps: template.steps,
      edges: template.edges,
    });
  }

  const viewSteps = template ? toViewSteps(template.steps) : [];
  const viewEdges = template ? toViewEdges(template.edges) : [];

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 bg-indigo-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-indigo-200" />
            <div>
              <h2 className="text-base font-bold">{existingTemplate ? 'AI Template Editor' : 'AI Template Builder'}</h2>
              <p className="text-indigo-200 text-xs mt-0.5">
                {existingTemplate
                  ? `Editing "${existingTemplate.name}" — describe your changes in plain English`
                  : 'Describe your workflow and I\'ll build the template for you'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {template && (
              <button
                onClick={handleOpenInEditor}
                className="flex items-center gap-2 bg-white text-indigo-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                <PenLine className="h-4 w-4" />
                {existingTemplate ? 'Apply Changes' : 'Open in Editor'}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-indigo-500 transition-colors ml-2">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Chat panel */}
          <div className="w-[420px] flex-shrink-0 flex flex-col border-r border-gray-200 bg-white">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} />
              ))}
              {isStreaming && messages[messages.length - 1]?.content === '' && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center mt-0.5">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--text-primary)]" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 p-3 flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your workflow…"
                rows={2}
                disabled={isStreaming}
                className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none disabled:opacity-50 leading-snug"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isStreaming || !input.trim()}
                className="flex-shrink-0 w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Preview panel */}
          <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
            {template ? (
              <>
                {/* Template meta bar */}
                <div className="border-b border-gray-200 bg-white px-5 py-3 flex items-center gap-4 flex-shrink-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
                    {template.description && (
                      <p className="text-xs text-gray-500 truncate">{template.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-xs text-gray-500">
                    <span className="capitalize bg-gray-100 px-2 py-0.5 rounded">{template.category?.replace(/_/g, ' ')}</span>
                    {template.recurrence_type && (
                      <span className="capitalize bg-gray-100 px-2 py-0.5 rounded">{template.recurrence_type?.replace(/-/g, ' ')}</span>
                    )}
                    <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">{template.steps.length} steps</span>
                  </div>
                </div>

                {/* Flowchart */}
                <div className="flex-1 min-h-0">
                  <TaskViewFlowChart
                    steps={viewSteps}
                    edges={viewEdges}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <LayoutTemplate className="h-8 w-8 text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Your template will appear here</p>
                  <p className="text-xs text-gray-400 mt-1">Chat with the assistant to build your workflow</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
