'use client';

import { Plus, Trash2, FolderPlus } from 'lucide-react';
import type { AudienceGroup, AudienceNode, AudienceRule, RuleOperator, FieldOption } from '@/types/campaigns';
import { isGroup } from '@/types/campaigns';
import { AUDIENCE_FIELDS, FIELD_BY_ID, OPERATOR_LABELS } from '@/lib/campaigns/fields';
import { emptyRule, emptyGroup, defaultValue } from './builderUtils';

// Field groups for the <optgroup> in the field picker.
const FIELD_GROUP_ORDER = ['Client', 'Compliance', 'Companies House', 'Tasks', 'Billing', 'Engagement'] as const;

interface Props {
  value: AudienceGroup;
  onChange: (next: AudienceGroup) => void;
  /** Dynamic options merged into select fields (e.g. account managers). */
  dynamicOptions?: Record<string, FieldOption[]>;
  depth?: number;
}

export default function AudienceBuilder({ value, onChange, dynamicOptions = {}, depth = 0 }: Props) {
  function update(node: AudienceGroup) { onChange(node); }

  function setChild(index: number, next: AudienceNode) {
    update({ ...value, children: value.children.map((c, i) => (i === index ? next : c)) });
  }
  function removeChild(index: number) {
    update({ ...value, children: value.children.filter((_, i) => i !== index) });
  }
  function addRule() { update({ ...value, children: [...value.children, emptyRule()] }); }
  function addGroup() { update({ ...value, children: [...value.children, emptyGroup(value.combinator === 'and' ? 'or' : 'and')] }); }

  return (
    <div className={`rounded-xl ${depth > 0 ? 'border border-[var(--border)] bg-black/[0.015] p-3' : ''}`}>
      {/* Group header: AND/OR + NOT */}
      <div className="flex items-center gap-2 mb-2.5">
        <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs font-semibold">
          {(['and', 'or'] as const).map(c => (
            <button
              key={c}
              onClick={() => update({ ...value, combinator: c })}
              className={`px-2.5 py-1 ${value.combinator === c ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}
            >
              {c === 'and' ? 'Match ALL' : 'Match ANY'}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
          <input type="checkbox" checked={!!value.negate} onChange={e => update({ ...value, negate: e.target.checked })} className="accent-[var(--accent)]" />
          NOT (exclude matches)
        </label>
      </div>

      {value.children.length === 0 && (
        <div className="text-xs text-[var(--text-secondary)] italic px-1 py-2">No conditions yet — this matches every client.</div>
      )}

      <div className="space-y-2">
        {value.children.map((child, i) => (
          <div key={child.id} className="flex items-start gap-2">
            {i > 0 && (
              <span className="mt-2 text-[10px] font-bold uppercase text-[var(--text-muted)] w-9 shrink-0 text-right">
                {value.combinator === 'and' ? 'and' : 'or'}
              </span>
            )}
            {i === 0 && <span className="w-9 shrink-0" />}
            <div className="flex-1 min-w-0">
              {isGroup(child) ? (
                <AudienceBuilder value={child} onChange={n => setChild(i, n)} dynamicOptions={dynamicOptions} depth={depth + 1} />
              ) : (
                <RuleRow rule={child} onChange={n => setChild(i, n)} dynamicOptions={dynamicOptions} />
              )}
            </div>
            <button onClick={() => removeChild(i)} className="mt-1.5 p-1 text-[var(--text-muted)] hover:text-red-600" aria-label="Remove condition">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3 pl-9">
        <button onClick={addRule} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline">
          <Plus size={13} /> Add condition
        </button>
        {depth < 2 && (
          <button onClick={addGroup} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <FolderPlus size={13} /> Add group
          </button>
        )}
      </div>
    </div>
  );
}

function RuleRow({ rule, onChange, dynamicOptions }: { rule: AudienceRule; onChange: (r: AudienceRule) => void; dynamicOptions: Record<string, FieldOption[]> }) {
  const field = FIELD_BY_ID[rule.field] ?? AUDIENCE_FIELDS[0];

  function changeField(fieldId: string) {
    const f = FIELD_BY_ID[fieldId];
    const operator = f?.operators[0] ?? 'eq';
    onChange({ ...rule, field: fieldId, operator, value: defaultValue(fieldId, operator) });
  }
  function changeOperator(op: RuleOperator) {
    onChange({ ...rule, operator: op, value: defaultValue(rule.field, op) });
  }

  const options = [...(field.options ?? []), ...(dynamicOptions[field.id] ?? [])];
  const noValue = ['is_true', 'is_false', 'is_empty', 'is_not_empty'].includes(rule.operator);
  const selectClass = 'text-[13px] rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 focus:outline-none focus:border-[var(--accent)]';

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-[var(--border)] bg-white">
      <select value={rule.field} onChange={e => changeField(e.target.value)} className={`${selectClass} min-w-[180px]`}>
        {FIELD_GROUP_ORDER.map(g => {
          const inGroup = AUDIENCE_FIELDS.filter(f => f.group === g);
          if (inGroup.length === 0) return null;
          return (
            <optgroup key={g} label={g}>
              {inGroup.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </optgroup>
          );
        })}
      </select>

      <select value={rule.operator} onChange={e => changeOperator(e.target.value as RuleOperator)} className={selectClass}>
        {field.operators.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op] ?? op}</option>)}
      </select>

      {!noValue && (
        field.type === 'select' ? (
          <select
            value={String(rule.value ?? '')}
            onChange={e => onChange({ ...rule, value: e.target.value })}
            className={`${selectClass} min-w-[140px]`}
          >
            {options.length === 0 && <option value="">—</option>}
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (field.type === 'number' || rule.operator === 'within_days') ? (
          <input
            type="number"
            value={Number(rule.value ?? 0)}
            onChange={e => onChange({ ...rule, value: e.target.value === '' ? 0 : Number(e.target.value) })}
            className={`${selectClass} w-24`}
          />
        ) : (
          <input
            type="text"
            value={String(rule.value ?? '')}
            onChange={e => onChange({ ...rule, value: e.target.value })}
            placeholder="value"
            className={`${selectClass} min-w-[140px]`}
          />
        )
      )}

      {field.hint && <span className="text-[11px] text-[var(--text-muted)] basis-full">{field.hint}</span>}
    </div>
  );
}
