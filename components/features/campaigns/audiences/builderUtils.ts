import type { AudienceGroup, AudienceRule, RuleOperator } from '@/types/campaigns';
import { AUDIENCE_FIELDS, FIELD_BY_ID } from '@/lib/campaigns/fields';

export function uid(): string {
  try { return crypto.randomUUID(); } catch { return `id_${Math.random().toString(36).slice(2)}`; }
}

export function emptyGroup(combinator: 'and' | 'or' = 'and'): AudienceGroup {
  return { id: uid(), kind: 'group', combinator, negate: false, children: [] };
}

/** Sensible default value for a field+operator pair. */
export function defaultValue(fieldId: string, operator: RuleOperator): AudienceRule['value'] {
  const f = FIELD_BY_ID[fieldId];
  if (!f) return '';
  if (operator === 'is_true' || operator === 'is_false' || operator === 'is_empty' || operator === 'is_not_empty') return null;
  if (f.type === 'number' || operator === 'within_days') return 30;
  if (f.type === 'select') return f.options?.[0]?.value ?? '';
  return '';
}

export function emptyRule(fieldId = AUDIENCE_FIELDS[0].id): AudienceRule {
  const f = FIELD_BY_ID[fieldId] ?? AUDIENCE_FIELDS[0];
  const operator = f.operators[0];
  return { id: uid(), kind: 'rule', field: f.id, operator, value: defaultValue(f.id, operator) };
}

/** True when a group has no usable conditions (matches everyone). */
export function isEmptyDefinition(group: AudienceGroup | null | undefined): boolean {
  if (!group || !group.children || group.children.length === 0) return true;
  return false;
}
