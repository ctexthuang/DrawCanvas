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

export type GroupImageSelectionResult =
  | Readonly<{
      ok: true
      document: CanvasDocument
      folderId: string
      imageCount: number
    }>
  | Readonly<{
      ok: false
      reason: string
    }>

const defaultWidths: Readonly<Record<CanvasNodeType, number>> = {
  prompt: 272,
  storyboard: 360,
  'shot-list': 380,
  generator: 272,
  compositor: 292,
  image: 292,
  'reference-folder': 328,
  note: 272,
  chat: 272,
  video: 310,
  audio: 310,
}

const defaultHeights: Readonly<Record<CanvasNodeType, number>> = {
  prompt: 199,
  storyboard: 500,
  'shot-list': 500,
  generator: 222,
  compositor: 260,
  image: 293,
  'reference-folder': 372,
  note: 162,
  chat: 400,
  video: 438,
  audio: 370,
}

const allowedTargets: Readonly<Record<CanvasNodeType, ReadonlySet<CanvasNodeType>>> = {
  prompt: new Set(['generator', 'compositor', 'image', 'chat', 'video', 'audio', 'storyboard']),
  storyboard: new Set(['shot-list']),
  'shot-list': new Set(['generator', 'video', 'audio']),
  generator: new Set(['image']),
  compositor: new Set(['image']),
  image: new Set(['generator', 'compositor', 'reference-folder', 'video']),
  'reference-folder': new Set(['generator', 'compositor', 'video']),
  note: new Set(),
  chat: new Set(['prompt', 'generator', 'audio', 'storyboard']),
  video: new Set(['image']),
  audio: new Set(),
}

export function nodeDimensions(node: CanvasNodeData): Readonly<{ width: number; height: number }> {
  return {
    width: node.width ?? defaultWidths[node.type],
    height: node.height ?? (node.type === 'reference-folder' && node.collapsed
      ? 98
      : defaultHeights[node.type]),
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
  if (from.type === 'image' && !from.imageFileName) {
    return { ok: false, reason: '图片生成或导入完成后才能作为参考图连接' }
  }
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
    return {
      ...node,
      id,
      generationBatchId: undefined,
      generationBatchIndex: undefined,
      x: Math.round(node.x + offset.x),
      y: Math.round(node.y + offset.y),
    }
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

export function groupImageSelection(
  document: CanvasDocument,
  selectedIds: ReadonlySet<string>,
): GroupImageSelectionResult {
  const selectedNodes = document.nodes.filter((node) => selectedIds.has(node.id))
  if (selectedNodes.length < 2) {
    return { ok: false, reason: '请先选中至少 2 张图片' }
  }
  if (selectedNodes.some((node) => node.type !== 'image')) {
    return { ok: false, reason: '只能将图片节点组成参考图文件夹' }
  }
  if (selectedNodes.some((node) => !node.imageFileName)) {
    return { ok: false, reason: '请等待图片生成或导入完成后再组成文件夹' }
  }

  const imageFileNames = [...new Set(selectedNodes.flatMap((node) =>
    node.imageFileName ? [node.imageFileName] : [],
  ))]
  if (imageFileNames.length < 2) {
    return { ok: false, reason: '至少需要 2 张不同的图片才能组成文件夹' }
  }
  if (imageFileNames.length > 50) {
    return { ok: false, reason: '一个参考图文件夹最多包含 50 张图片' }
  }

  const selectedImageIds = new Set(selectedNodes.map((node) => node.id))
  const targetIds = [...new Set(document.connections.flatMap((connection) => {
    if (!selectedImageIds.has(connection.from)) return []
    const target = document.nodes.find((node) => node.id === connection.to)
    return target && (target.type === 'generator' || target.type === 'compositor' || target.type === 'video')
      ? [target.id]
      : []
  }))]
  const bounds = graphBounds(selectedNodes)
  const folderId = `reference-folder-${crypto.randomUUID()}`
  const folderWidth = defaultWidths['reference-folder']
  const folderHeight = defaultHeights['reference-folder']
  const folder: CanvasNodeData = {
    id: folderId,
    type: 'reference-folder',
    title: `参考图文件夹 ${document.nodes.filter((node) => node.type === 'reference-folder').length + 1}`,
    subtitle: `${imageFileNames.length} 张参考图`,
    imageFileNames,
    x: Math.round(bounds.x + (bounds.width - folderWidth) / 2),
    y: Math.round(bounds.y + (bounds.height - folderHeight) / 2),
    color: '#38bdf8',
  }
  const remainingConnections = document.connections.filter((connection) =>
    !selectedImageIds.has(connection.from) && !selectedImageIds.has(connection.to),
  )
  const replacementConnections = targetIds.map((targetId) => ({
    id: `connection-${crypto.randomUUID()}`,
    from: folderId,
    to: targetId,
  }))

  return {
    ok: true,
    document: touchDocument(document, {
      nodes: [...document.nodes.filter((node) => !selectedImageIds.has(node.id)), folder],
      connections: [...remainingConnections, ...replacementConnections],
    }),
    folderId,
    imageCount: imageFileNames.length,
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
