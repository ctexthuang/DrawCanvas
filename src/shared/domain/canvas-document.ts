import type {
  CanvasConnection,
  CanvasDocument,
  CanvasNodeData,
  CanvasNodeType,
  RecentCanvasProject,
} from '../contracts/desktop'

const canvasNodeTypes: ReadonlySet<CanvasNodeType> = new Set([
  'prompt',
  'generator',
  'image',
  'note',
  'chat',
  'video',
])

export function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!isRecord(value)) return false
  return (
    value.version === 1 &&
    isBoundedString(value.id, 128) &&
    isStringAtMost(value.name, 200) &&
    isBoundedString(value.updatedAt, 100) &&
    Array.isArray(value.nodes) &&
    value.nodes.length <= 500 &&
    value.nodes.every(isCanvasNode) &&
    Array.isArray(value.connections) &&
    value.connections.length <= 1000 &&
    value.connections.every(isCanvasConnection) &&
    isCanvasViewport(value.viewport)
  )
}

export function createRecentCanvasProject(
  document: CanvasDocument,
  location: RecentCanvasProject['location'],
): RecentCanvasProject {
  return {
    id: document.id,
    name: document.name.trim() || '未命名画布',
    updatedAt: document.updatedAt,
    nodeCount: document.nodes.length,
    colors: [...new Set(document.nodes
      .map((node) => node.color)
      .filter((color): color is string => Boolean(color && /^#[0-9a-f]{6}$/i.test(color))))]
      .slice(0, 3),
    location,
  }
}

function isCanvasNode(value: unknown): value is CanvasNodeData {
  if (!isRecord(value)) return false
  return (
    isBoundedString(value.id, 128) &&
    typeof value.type === 'string' &&
    canvasNodeTypes.has(value.type as CanvasNodeType) &&
    isStringAtMost(value.title, 500) &&
    (value.subtitle === undefined || isStringAtMost(value.subtitle, 20_000)) &&
    isFiniteCoordinate(value.x) &&
    isFiniteCoordinate(value.y) &&
    (value.width === undefined || isFiniteSize(value.width)) &&
    (value.height === undefined || isFiniteSize(value.height)) &&
    (value.color === undefined || (typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color))) &&
    (value.modelKey === undefined || isBoundedString(value.modelKey, 400)) &&
    (value.imageSize === undefined || value.imageSize === '1024x1024' || value.imageSize === '1536x1024' || value.imageSize === '1024x1536') &&
    (value.imageFileName === undefined || isBoundedString(value.imageFileName, 260))
  )
}

function isCanvasConnection(value: unknown): value is CanvasConnection {
  return isRecord(value) &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.from, 128) &&
    isBoundedString(value.to, 128)
}

function isCanvasViewport(value: unknown): boolean {
  return isRecord(value) &&
    isFiniteCoordinate(value.x) &&
    isFiniteCoordinate(value.y) &&
    typeof value.zoom === 'number' &&
    Number.isFinite(value.zoom) &&
    value.zoom >= 0.05 &&
    value.zoom <= 10
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isStringAtMost(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000
}

function isFiniteSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10_000
}
