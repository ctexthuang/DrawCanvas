import type { CanvasConnection, CanvasDocument, CanvasNodeData, CanvasNodeType } from '../../../shared/contracts/desktop'

export type CanvasPoint = Readonly<{ x: number; y: number }>

export type CanvasGraphSnapshot = Readonly<{
  nodes: ReadonlyArray<CanvasNodeData>
  connections: ReadonlyArray<CanvasConnection>
}>

export type DuplicateSelectionResult = Readonly<{
  document: CanvasDocument
  selectedIds: ReadonlySet<string>
}>

const defaultWidths: Readonly<Record<CanvasNodeType, number>> = {
  prompt: 272,
  generator: 272,
  image: 292,
  note: 272,
  chat: 272,
  video: 272,
}

const defaultHeights: Readonly<Record<CanvasNodeType, number>> = {
  prompt: 199,
  generator: 222,
  image: 293,
  note: 162,
  chat: 139,
  video: 144,
}

const allowedTargets: Readonly<Record<CanvasNodeType, ReadonlySet<CanvasNodeType>>> = {
  prompt: new Set(['generator', 'image', 'chat', 'video']),
  generator: new Set(['image']),
  image: new Set(['generator', 'video']),
  note: new Set(),
  chat: new Set(['generator', 'video']),
  video: new Set(['image']),
}

export function nodeDimensions(node: CanvasNodeData): Readonly<{ width: number; height: number }> {
  return {
    width: node.width ?? defaultWidths[node.type],
    height: node.height ?? defaultHeights[node.type],
  }
}

export function nodePortPoint(node: CanvasNodeData, side: 'input' | 'output'): CanvasPoint {
  const dimensions = nodeDimensions(node)
  return {
    x: node.x + (side === 'output' ? dimensions.width : 0),
    y: node.y + dimensions.height / 2,
  }
}

export function snapshotGraph(document: CanvasDocument): CanvasGraphSnapshot {
  return {
    nodes: document.nodes.map((node) => ({ ...node })),
    connections: document.connections.map((connection) => ({ ...connection })),
  }
}

export function restoreGraph(document: CanvasDocument, snapshot: CanvasGraphSnapshot): CanvasDocument {
  return touchDocument(document, {
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    connections: snapshot.connections.map((connection) => ({ ...connection })),
  })
}

export function canConnect(
  nodes: ReadonlyArray<CanvasNodeData>,
  connections: ReadonlyArray<CanvasConnection>,
  fromId: string,
  toId: string,
): Readonly<{ ok: boolean; reason?: string }> {
  if (fromId === toId) return { ok: false, reason: '节点不能连接到自身' }
  const from = nodes.find((node) => node.id === fromId)
  const to = nodes.find((node) => node.id === toId)
  if (!from || !to) return { ok: false, reason: '连接节点不存在' }
  if (!allowedTargets[from.type].has(to.type)) return { ok: false, reason: `${from.title} 不能连接到 ${to.title}` }
  if (connections.some((connection) => connection.from === fromId && connection.to === toId)) {
    return { ok: false, reason: '这两个节点已经连接' }
  }
  if (hasDirectedPath(connections, toId, fromId)) return { ok: false, reason: '连接会形成循环' }
  return { ok: true }
}

export function sanitizeConnections(
  nodes: ReadonlyArray<CanvasNodeData>,
  connections: ReadonlyArray<CanvasConnection>,
): ReadonlyArray<CanvasConnection> {
  const accepted: CanvasConnection[] = []
  for (const connection of connections) {
    if (canConnect(nodes, accepted, connection.from, connection.to).ok) accepted.push(connection)
  }
  return accepted
}

export function removeSelection(document: CanvasDocument, selectedIds: ReadonlySet<string>): CanvasDocument {
  return touchDocument(document, {
    nodes: document.nodes.filter((node) => !selectedIds.has(node.id)),
    connections: document.connections.filter((connection) => !selectedIds.has(connection.from) && !selectedIds.has(connection.to)),
  })
}

export function duplicateSelection(
  document: CanvasDocument,
  selectedIds: ReadonlySet<string>,
  target?: CanvasPoint,
): DuplicateSelectionResult {
  const sourceNodes = document.nodes.filter((node) => selectedIds.has(node.id))
  if (sourceNodes.length === 0) return { document, selectedIds: new Set() }

  const bounds = graphBounds(sourceNodes)
  const offset = target
    ? { x: target.x - bounds.x - bounds.width / 2, y: target.y - bounds.y - bounds.height / 2 }
    : { x: 36, y: 36 }
  const idMap = new Map<string, string>()
  const duplicatedNodes = sourceNodes.map((node) => {
    const id = `${node.type}-${crypto.randomUUID()}`
    idMap.set(node.id, id)
    return { ...node, id, x: Math.round(node.x + offset.x), y: Math.round(node.y + offset.y) }
  })
  const duplicatedConnections = document.connections.flatMap((connection) => {
    const from = idMap.get(connection.from)
    const to = idMap.get(connection.to)
    return from && to ? [{ id: `connection-${crypto.randomUUID()}`, from, to }] : []
  })
  return {
    document: touchDocument(document, {
      nodes: [...document.nodes, ...duplicatedNodes],
      connections: [...document.connections, ...duplicatedConnections],
    }),
    selectedIds: new Set(duplicatedNodes.map((node) => node.id)),
  }
}

export function connectedSelection(document: CanvasDocument, selectedIds: ReadonlySet<string>): ReadonlySet<string> {
  if (selectedIds.size !== 1) return selectedIds
  const firstId = [...selectedIds][0]
  if (!firstId) return selectedIds
  const result = new Set([firstId])
  const queue = [firstId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const connection of document.connections) {
      const neighbor = connection.from === current ? connection.to : connection.to === current ? connection.from : null
      if (neighbor && !result.has(neighbor)) {
        result.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return result
}

export function arrangeSelection(document: CanvasDocument, selectedIds: ReadonlySet<string>): CanvasDocument {
  const arrangedIds = connectedSelection(document, selectedIds)
  if (arrangedIds.size === 0) return document
  const nodes = document.nodes.filter((node) => arrangedIds.has(node.id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const connections = document.connections.filter((connection) => arrangedIds.has(connection.from) && arrangedIds.has(connection.to))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  for (const connection of connections) incoming.set(connection.to, (incoming.get(connection.to) ?? 0) + 1)
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)
  const depths = new Map(nodes.map((node) => [node.id, 0]))
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const connection of connections.filter((item) => item.from === current)) {
      depths.set(connection.to, Math.max(depths.get(connection.to) ?? 0, (depths.get(current) ?? 0) + 1))
      incoming.set(connection.to, (incoming.get(connection.to) ?? 1) - 1)
      if (incoming.get(connection.to) === 0) queue.push(connection.to)
    }
  }
  const columns = new Map<number, CanvasNodeData[]>()
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0
    columns.set(depth, [...(columns.get(depth) ?? []), node])
  }
  const bounds = graphBounds(nodes)
  const positions = new Map<string, CanvasPoint>()
  let columnX = bounds.x
  for (const [depth, column] of [...columns.entries()].sort(([a], [b]) => a - b)) {
    let columnY = bounds.y
    let widest = 0
    for (const node of column.sort((a, b) => a.y - b.y)) {
      const dimensions = nodeDimensions(node)
      positions.set(node.id, { x: Math.round(columnX), y: Math.round(columnY) })
      columnY += dimensions.height + 56
      widest = Math.max(widest, dimensions.width)
    }
    columnX += widest + 180
  }
  return touchDocument(document, {
    nodes: document.nodes.map((node) => {
      const position = positions.get(node.id)
      return position ? { ...node, ...position } : node
    }),
  })
}

export function graphBounds(nodes: ReadonlyArray<CanvasNodeData>): Readonly<{ x: number; y: number; width: number; height: number }> {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + nodeDimensions(node).width))
  const maxY = Math.max(...nodes.map((node) => node.y + nodeDimensions(node).height))
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function hasDirectedPath(connections: ReadonlyArray<CanvasConnection>, startId: string, targetId: string): boolean {
  const visited = new Set<string>()
  const stack = [startId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || visited.has(current)) continue
    if (current === targetId) return true
    visited.add(current)
    for (const connection of connections) if (connection.from === current) stack.push(connection.to)
  }
  return false
}

function touchDocument(document: CanvasDocument, patch: Partial<CanvasDocument>): CanvasDocument {
  return { ...document, ...patch, updatedAt: new Date().toISOString() }
}
