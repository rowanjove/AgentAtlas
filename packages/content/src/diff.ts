import { ContentBundle } from '@agent-atlas/shared';

export interface BundleDiff {
  addedNodeIds: string[];
  removedNodeIds: string[];
  updatedNodes: Array<{
    nodeId: string;
    oldRevision: number;
    newRevision: number;
    majorUpdate: boolean;
  }>;
}

export function diffContentBundles(prev: ContentBundle, next: ContentBundle): BundleDiff {
  const prevMap = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextMap = new Map(next.nodes.map((n) => [n.id, n]));

  const addedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];
  const updatedNodes: BundleDiff['updatedNodes'] = [];

  for (const [id, node] of nextMap) {
    const old = prevMap.get(id);
    if (!old) {
      addedNodeIds.push(id);
    } else if (
      old.body !== node.body ||
      old.revision !== node.revision ||
      old.title !== node.title ||
      old.summary !== node.summary ||
      old.majorUpdate !== node.majorUpdate ||
      JSON.stringify(old.objectives) !== JSON.stringify(node.objectives) ||
      JSON.stringify(old.requires) !== JSON.stringify(node.requires)
    ) {
      updatedNodes.push({
        nodeId: id,
        oldRevision: old.revision,
        newRevision: node.revision,
        majorUpdate: Boolean(node.majorUpdate),
      });
    }
  }

  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removedNodeIds.push(id);
  }

  return { addedNodeIds, removedNodeIds, updatedNodes };
}
