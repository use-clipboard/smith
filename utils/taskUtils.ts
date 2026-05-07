import type { TaskStep, TaskStepEdge } from '@/types';

/**
 * Returns steps sorted in workflow execution order.
 * BFS topological walk from the start/root node, falling back to position_y
 * for any steps not reachable via edges.
 */
export function sortStepsByWorkflow(
  steps: TaskStep[],
  edges: Pick<TaskStepEdge, 'from_step_key' | 'to_step_key'>[],
): TaskStep[] {
  if (steps.length === 0) return steps;

  const byKey = new Map(steps.map(s => [s.step_key, s]));

  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  steps.forEach(s => { outgoing.set(s.step_key, []); inDegree.set(s.step_key, 0); });
  edges.forEach(e => {
    outgoing.get(e.from_step_key)?.push(e.to_step_key);
    inDegree.set(e.to_step_key, (inDegree.get(e.to_step_key) ?? 0) + 1);
  });

  const roots = steps
    .filter(s => (inDegree.get(s.step_key) ?? 0) === 0)
    .sort((a, b) => (a.step_type === 'start' ? -1 : b.step_type === 'start' ? 1 : a.position_y - b.position_y));

  const visited = new Set<string>();
  const sorted: TaskStep[] = [];
  const queue = roots.map(s => s.step_key);

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const step = byKey.get(key);
    if (step) sorted.push(step);
    (outgoing.get(key) ?? []).forEach(next => { if (!visited.has(next)) queue.push(next); });
  }

  steps
    .filter(s => !visited.has(s.step_key))
    .sort((a, b) => a.position_y - b.position_y)
    .forEach(s => sorted.push(s));

  return sorted;
}
