import type {
  CanvasConnection,
  CanvasDocument,
  CanvasNodeData,
  CanvasNodeType,
  RecentCanvasProject,
} from '../contracts/desktop'
import { isImageGenerationSize } from './models'

const canvasNodeTypes: ReadonlySet<CanvasNodeType> = new Set([
  'prompt',
  'storyboard',
  'shot-list',
  'generator',
  'compositor',
  'image',
  'layer-split',
  'reference-folder',
  'note',
  'chat',
  'video',
  'audio',
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

export function recoverInterruptedGenerationTasks(
  document: CanvasDocument,
  completedAt = new Date().toISOString(),
): CanvasDocument {
  const migratedDocument = splitLegacyStoryboardResults(document, completedAt)
  const hasInterruptedTask = migratedDocument.nodes.some((node) =>
    node.generationStatus === 'queued' || node.generationStatus === 'generating' || node.workflowStatus === 'running',
  )
  if (!hasInterruptedTask) return migratedDocument
  return {
    ...migratedDocument,
    nodes: migratedDocument.nodes.map((node) => ({
      ...node,
      ...(node.generationStatus === 'queued' || node.generationStatus === 'generating'
        ? {
            generationStatus: 'failed' as const,
            generationCompletedAt: completedAt,
            generationError: '应用关闭后生成任务已中断，请重新生成',
          }
        : {}),
      ...(node.workflowStatus === 'running'
        ? { workflowStatus: 'failed' as const, workflowError: '应用关闭后工作流执行已中断，请重试' }
        : {}),
    })),
    updatedAt: completedAt,
  }
}

function splitLegacyStoryboardResults(document: CanvasDocument, updatedAt: string): CanvasDocument {
  const availableNodeSlots = Math.max(0, 500 - document.nodes.length)
  const availableConnectionSlots = Math.max(0, 1000 - document.connections.length)
  const migrationLimit = Math.min(availableNodeSlots, availableConnectionSlots)
  if (migrationLimit === 0) return document

  const legacyNodes = document.nodes
    .filter((node) => node.type === 'storyboard' && (node.storyboardShots?.length ?? 0) > 0)
    .slice(0, migrationLimit)
  if (legacyNodes.length === 0) return document

  const occupiedIds = new Set(document.nodes.map((node) => node.id))
  const resultIdBySourceId = new Map<string, string>()
  let resultNumber = document.nodes.filter((node) => node.type === 'shot-list').length
  for (const node of legacyNodes) {
    const baseId = `shot-list-${node.id}`.slice(0, 116)
    let resultId = baseId
    let suffix = 2
    while (occupiedIds.has(resultId)) {
      resultId = `${baseId.slice(0, 120 - String(suffix).length)}-${suffix}`
      suffix += 1
    }
    occupiedIds.add(resultId)
    resultIdBySourceId.set(node.id, resultId)
  }

  const nodes = document.nodes.flatMap((node): ReadonlyArray<CanvasNodeData> => {
    const resultId = resultIdBySourceId.get(node.id)
    if (!resultId || !node.storyboardShots) return [node]
    resultNumber += 1
    return [
      { ...node, storyboardShots: undefined },
      {
        id: resultId,
        type: 'shot-list',
        title: `分镜节点 ${resultNumber}`,
        subtitle: node.subtitle,
        storyboardShots: node.storyboardShots,
        x: node.x + (node.width ?? 360) + 92,
        y: node.y,
        width: node.width,
        height: node.height,
        color: '#fbbf24',
      },
    ]
  })
  const connections = document.connections.map((connection) => ({
    ...connection,
    from: resultIdBySourceId.get(connection.from) ?? connection.from,
  }))
  const resultConnections = [...resultIdBySourceId].map(([sourceId, resultId]) => ({
    id: `connection-${resultId}`.slice(0, 128),
    from: sourceId,
    to: resultId,
  }))
  return { ...document, nodes, connections: [...connections, ...resultConnections], updatedAt }
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
    (value.imageSize === undefined || isImageGenerationSize(value.imageSize)) &&
    (value.generationCount === undefined || value.generationCount === 1 || value.generationCount === 2 || value.generationCount === 3 || value.generationCount === 4) &&
    (value.generationStatus === undefined || value.generationStatus === 'queued' || value.generationStatus === 'generating' || value.generationStatus === 'succeeded' || value.generationStatus === 'failed') &&
    (value.generationStartedAt === undefined || isBoundedString(value.generationStartedAt, 100)) &&
    (value.generationCompletedAt === undefined || isBoundedString(value.generationCompletedAt, 100)) &&
    (value.generationError === undefined || isStringAtMost(value.generationError, 1000)) &&
    (value.generationBatchId === undefined || isBoundedString(value.generationBatchId, 128)) &&
    (value.generationBatchIndex === undefined || (
      typeof value.generationBatchIndex === 'number' &&
      Number.isInteger(value.generationBatchIndex) &&
      value.generationBatchIndex >= 0 &&
      value.generationBatchIndex < 500
    )) &&
    (value.imageFileName === undefined || isBoundedString(value.imageFileName, 260)) &&
    (value.imageFileNames === undefined || (
      Array.isArray(value.imageFileNames) &&
      value.imageFileNames.length <= 50 &&
      value.imageFileNames.every((fileName) => isBoundedString(fileName, 260))
    )) &&
    isImageLayerState(value) &&
    (value.imageLayerError === undefined || isStringAtMost(value.imageLayerError, 1000)) &&
    (value.collapsed === undefined || typeof value.collapsed === 'boolean') &&
    (value.workflowStatus === undefined || value.workflowStatus === 'idle' || value.workflowStatus === 'running' || value.workflowStatus === 'succeeded' || value.workflowStatus === 'failed' || value.workflowStatus === 'skipped') &&
    (value.workflowError === undefined || isStringAtMost(value.workflowError, 1000)) &&
    (value.chatMessages === undefined || (
      Array.isArray(value.chatMessages) &&
      value.chatMessages.length <= 100 &&
      value.chatMessages.every(isCanvasChatMessage)
    )) &&
    (value.storyboardShotCount === undefined || (
      typeof value.storyboardShotCount === 'number' &&
      Number.isInteger(value.storyboardShotCount) &&
      value.storyboardShotCount >= 2 &&
      value.storyboardShotCount <= 12
    )) &&
    (value.storyboardShots === undefined || (
      Array.isArray(value.storyboardShots) &&
      value.storyboardShots.length <= 12 &&
      value.storyboardShots.every(isStoryboardShot)
    )) &&
    (value.videoFileName === undefined || isBoundedString(value.videoFileName, 260)) &&
    (value.videoPromptId === undefined || isBoundedString(value.videoPromptId, 400)) &&
    (value.videoDuration === undefined || (
      typeof value.videoDuration === 'number' &&
      Number.isInteger(value.videoDuration) &&
      value.videoDuration >= 4 &&
      value.videoDuration <= 15
    )) &&
    (value.videoResolution === undefined || value.videoResolution === '720P' || value.videoResolution === '768P' || value.videoResolution === '1080P' || value.videoResolution === '2K') &&
    (value.videoRatio === undefined || value.videoRatio === '16:9' || value.videoRatio === '9:16' || value.videoRatio === '1:1' || value.videoRatio === 'adaptive')
    && (value.audioFileName === undefined || isBoundedString(value.audioFileName, 260))
    && (value.audioVoiceId === undefined || isBoundedString(value.audioVoiceId, 200))
    && (value.audioSpeed === undefined || (typeof value.audioSpeed === 'number' && Number.isFinite(value.audioSpeed) && value.audioSpeed >= 0.5 && value.audioSpeed <= 2))
    && (value.audioPitch === undefined || (typeof value.audioPitch === 'number' && Number.isInteger(value.audioPitch) && value.audioPitch >= -12 && value.audioPitch <= 12))
    && (value.audioEmotion === undefined || isStringAtMost(value.audioEmotion, 50))
  )
}

function isCanvasChatMessage(value: unknown): boolean {
  return isRecord(value) &&
    isBoundedString(value.id, 128) &&
    (value.role === 'user' || value.role === 'assistant') &&
    isBoundedString(value.content, 20_000) &&
    isBoundedString(value.createdAt, 100)
}

function isStoryboardShot(value: unknown): boolean {
  return isRecord(value) &&
    isBoundedString(value.id, 128) &&
    typeof value.index === 'number' &&
    Number.isInteger(value.index) &&
    value.index >= 1 &&
    value.index <= 12 &&
    isStringAtMost(value.title, 200) &&
    isStringAtMost(value.prompt, 10_000) &&
    typeof value.durationSeconds === 'number' &&
    Number.isInteger(value.durationSeconds) &&
    value.durationSeconds >= 1 &&
    value.durationSeconds <= 60
}

function isImageLayer(value: unknown, sourceWidth: unknown, sourceHeight: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.bounds)) return false
  const maximumWidth = isImageLayerDimension(sourceWidth) ? sourceWidth : 100_000
  const maximumHeight = isImageLayerDimension(sourceHeight) ? sourceHeight : 100_000
  return (
    isBoundedString(value.id, 128) &&
    isStringAtMost(value.name, 120) &&
    (
      value.kind === 'icon' ||
      value.kind === 'avatar' ||
      value.kind === 'illustration' ||
      value.kind === 'photo' ||
      value.kind === 'product-image' ||
      value.kind === 'complex-decoration' ||
      value.kind === 'complex-chart' ||
      value.kind === 'logo' ||
      value.kind === 'other'
    ) &&
    isImageLayerCoordinate(value.bounds.x, maximumWidth) &&
    isImageLayerCoordinate(value.bounds.y, maximumHeight) &&
    isImageLayerSize(value.bounds.width, maximumWidth) &&
    isImageLayerSize(value.bounds.height, maximumHeight) &&
    value.bounds.x + value.bounds.width <= maximumWidth &&
    value.bounds.y + value.bounds.height <= maximumHeight &&
    (value.confidence === undefined || (
      typeof value.confidence === 'number' &&
      Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1
    )) &&
    (value.reason === undefined || isStringAtMost(value.reason, 300))
  )
}

function isImageLayerState(value: Readonly<Record<string, unknown>>): boolean {
  const hasLayerState = value.imageLayerSourceFileName !== undefined ||
    value.imageLayerSourceWidth !== undefined ||
    value.imageLayerSourceHeight !== undefined ||
    value.imageLayers !== undefined
  if (!hasLayerState) return true
  if (
    !isBoundedString(value.imageLayerSourceFileName, 260) ||
    !isImageLayerDimension(value.imageLayerSourceWidth) ||
    !isImageLayerDimension(value.imageLayerSourceHeight)
  ) return false
  return value.imageLayers === undefined || (
    Array.isArray(value.imageLayers) &&
    value.imageLayers.length <= 32 &&
    value.imageLayers.every((layer) => isImageLayer(
      layer,
      value.imageLayerSourceWidth,
      value.imageLayerSourceHeight,
    ))
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

function isImageLayerDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000
}

function isImageLayerCoordinate(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum
}

function isImageLayerSize(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maximum
}
