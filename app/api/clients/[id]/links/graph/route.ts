import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export interface GraphNode {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  status: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  link_type: string;
  notes: string | null;
}

// GET /api/clients/[id]/links/graph
// Returns the full connected component reachable from this client
// via client_links (within the same firm), traversed in both directions.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: rootClient } = await supabase
    .from('clients')
    .select('id, name, client_ref, business_type, status')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!rootClient) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  // BFS across client_links until no new nodes are discovered.
  const visited = new Set<string>([rootClient.id]);
  const frontier = new Set<string>([rootClient.id]);
  const edges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();

  // Cap iterations defensively in case of pathological data
  const MAX_ITERATIONS = 50;
  let iterations = 0;

  while (frontier.size > 0 && iterations < MAX_ITERATIONS) {
    iterations += 1;
    const ids = Array.from(frontier);
    frontier.clear();

    const { data: hopLinks, error } = await supabase
      .from('client_links')
      .select('id, client_id, linked_client_id, link_type, notes')
      .eq('firm_id', ctx.firmId)
      .or(
        `client_id.in.(${ids.join(',')}),linked_client_id.in.(${ids.join(',')})`
      );
    if (error) {
      console.error('GET /links/graph traversal', error);
      return NextResponse.json({ error: 'Failed to load graph' }, { status: 500 });
    }

    for (const l of hopLinks ?? []) {
      if (!seenEdgeIds.has(l.id)) {
        seenEdgeIds.add(l.id);
        edges.push({
          id: l.id,
          source: l.client_id,
          target: l.linked_client_id,
          link_type: l.link_type,
          notes: l.notes,
        });
      }
      for (const otherId of [l.client_id, l.linked_client_id]) {
        if (!visited.has(otherId)) {
          visited.add(otherId);
          frontier.add(otherId);
        }
      }
    }
  }

  // Fetch metadata for every discovered node
  const nodeIds = Array.from(visited);
  const { data: nodeRows } = await supabase
    .from('clients')
    .select('id, name, client_ref, business_type, status')
    .in('id', nodeIds)
    .eq('firm_id', ctx.firmId);

  const nodes: GraphNode[] = (nodeRows ?? []).map(n => ({
    id: n.id,
    name: n.name,
    client_ref: n.client_ref,
    business_type: n.business_type,
    status: n.status,
  }));

  return NextResponse.json({ rootId: rootClient.id, nodes, edges });
}
