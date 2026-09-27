export type GraphItem = { id: string; title: string; type: string; status: string }
export type GraphDependency = { predecessorId: string; dependentId: string }

export function getDownstreamItemIds(startId: string, dependencies: GraphDependency[]) {
  const result = new Set([startId])
  const queue = [startId]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of dependencies.filter((item) => item.predecessorId === current)) {
      if (!result.has(edge.dependentId)) { result.add(edge.dependentId); queue.push(edge.dependentId) }
    }
  }
  return result
}

export function toReactFlowGraph(items: GraphItem[], dependencies: GraphDependency[], affectedItemId?: string) {
  const affected = affectedItemId ? getDownstreamItemIds(affectedItemId, dependencies) : new Set<string>()
  return {
    nodes: items.map((item, index) => ({ id: item.id, data: { label: item.title, type: item.type, status: item.status, affected: affected.has(item.id) }, position: { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 150 } })),
    edges: dependencies.map((edge) => ({ id: `${edge.predecessorId}-${edge.dependentId}`, source: edge.predecessorId, target: edge.dependentId, animated: affected.has(edge.predecessorId) && affected.has(edge.dependentId) })),
    affectedItemIds: [...affected],
  }
}
