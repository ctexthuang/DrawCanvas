import type {
  AnalyzeImageLayersRequest,
  AnalyzedImageLayers,
  ImageLayerBounds,
  ImageLayerKind,
  ImageLayerSlice,
} from '../../shared/contracts/desktop'
import type { ProviderAdapterId } from '../../shared/domain/models'
import { analyzeImageLayersWithModel } from '../infrastructure/image-layer-analysis-client'
import {
  PromptOptimizationClientError,
  type PromptOptimizationClientProfile,
} from '../infrastructure/prompt-optimization-client'
import type { AppState } from './app-state'
import { isRetryableRemoteStatus, ModelRoutingError, runWithModelRoute } from './model-routing'

export type ImageLayerAnalysisServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_REMOTE'
  | 'PROVIDER_INVALID_RESPONSE'

export class ImageLayerAnalysisServiceError extends Error {
  constructor(
    readonly code: ImageLayerAnalysisServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ImageLayerAnalysisServiceError'
  }
}

const ALLOWED_KINDS: ReadonlySet<ImageLayerKind> = new Set([
  'icon',
  'avatar',
  'illustration',
  'photo',
  'product-image',
  'complex-decoration',
  'complex-chart',
  'logo',
  'other',
])
const MAX_LAYER_COUNT = 24
const MAX_LAYER_RESPONSE_ITEMS = 256
const MIN_LAYER_SIZE = 8

const ANALYSIS_INSTRUCTIONS = [
  '你是 Draw Canvas 的图片图层分析器。',
  '你只识别图片中可见、具有独立视觉意义、需要保留原始像素外观的可复用素材。',
  '不要因为多个素材的矩形包围框重叠就将它们合并；主体插画、周围徽章、图标、装饰气泡必须分别返回。',
  '当图中有一个主角与多个周边小图标时，主角图层只表示主角本身，不得把周边小图标视为主角的一部分。',
  '不要猜测被遮挡的内容，不要把普通文字、纯色背景、简单边框、布局容器或整个画布当作图层。',
  '只返回一个 JSON 对象，不要返回 Markdown、解释或额外文本。',
].join('')

export class ImageLayerAnalysisService {
  constructor(private readonly appState: AppState) {}

  async analyze(request: AnalyzeImageLayersRequest): Promise<AnalyzedImageLayers> {
    const prompt = buildAnalysisPrompt(request.image.width, request.image.height)
    try {
      return await runWithModelRoute(
        this.appState,
        'chat',
        request.modelKey,
        isRetryableAnalysisError,
        async ({ apiKey, model, provider }) => {
          const profile = providerProfile(provider.adapterId)
          if (!profile) {
            throw new ImageLayerAnalysisServiceError('UNSUPPORTED_PROVIDER', '该 API 服务尚未接入视觉对话能力')
          }
          const content = await analyzeImageLayersWithModel(
            provider.baseUrl,
            apiKey,
            model.remoteModelId,
            prompt,
            request.image,
            profile,
            ANALYSIS_INSTRUCTIONS,
          )
          return {
            layers: parseImageLayers(content, request),
            sourceWidth: request.sourceWidth,
            sourceHeight: request.sourceHeight,
            modelKey: model.key,
            modelName: model.displayName,
          }
        },
      )
    } catch (error) {
      if (error instanceof ModelRoutingError) {
        throw new ImageLayerAnalysisServiceError(error.code, error.message, { cause: error })
      }
      if (error instanceof PromptOptimizationClientError) {
        throw new ImageLayerAnalysisServiceError(mapProviderErrorCode(error.code), error.message, { cause: error })
      }
      throw error
    }
  }
}

function buildAnalysisPrompt(width: number, height: number): string {
  return [
    `分析所附的 ${width}x${height} 图片，找出适合独立裁切的可见图层。`,
    `所有 bounds 必须使用这张 ${width}x${height} 分析图片的像素坐标，不能使用百分比或归一化坐标。`,
    '坐标原点严格位于图片左上角，x 向右增大，y 向下增大；必须按素材实际最左、最上、最右、最下的可见像素计算紧致边界。',
    '允许的 kind：icon、avatar、illustration、photo、product-image、complex-decoration、complex-chart、logo、other。',
    '只保留无法用普通文字或简单 CSS 图形准确重建的像素素材。按钮背景、卡片、分割线、矩形、圆形和布局容器不应返回。',
    `最多返回 ${MAX_LAYER_COUNT} 个图层。避免返回同一素材的重复或整体/子项嵌套框；保留视觉阅读顺序。`,
    '每个 bounds 要尽可能贴合该素材的可见像素，只保留少量透明或背景边距。包围框内偶然出现的其他独立素材不属于当前图层。',
    '示例：一只拿画笔的猫周围有播放、图片、语音图标时，猫是一个 illustration，每个周边图标分别是独立 icon，不得返回包含全部内容的大框。',
    'name 使用简短明确的中文或英文名称。confidence 为 0 到 1。reason 用一句短语说明为什么它适合独立裁切。',
    '返回格式：{"layers":[{"name":"主体人物","kind":"photo","bounds":{"x":0,"y":0,"width":100,"height":100},"confidence":0.95,"reason":"独立前景主体"}]}',
  ].join('\n')
}

function parseImageLayers(
  content: string,
  request: AnalyzeImageLayersRequest,
): ReadonlyArray<ImageLayerSlice> {
  const jsonText = extractJsonObject(content)
  let payload: unknown
  try {
    payload = JSON.parse(jsonText) as unknown
  } catch {
    throw new ImageLayerAnalysisServiceError('PROVIDER_INVALID_RESPONSE', '视觉模型返回的图层 JSON 无法解析，请重试')
  }
  if (!isRecord(payload) || !Array.isArray(payload.layers)) {
    throw new ImageLayerAnalysisServiceError('PROVIDER_INVALID_RESPONSE', '视觉模型返回结果缺少 layers 数组')
  }

  const scaleX = request.sourceWidth / request.image.width
  const scaleY = request.sourceHeight / request.image.height
  const layers: ImageLayerSlice[] = []
  for (const [index, value] of payload.layers.slice(0, MAX_LAYER_RESPONSE_ITEMS).entries()) {
    if (layers.length >= MAX_LAYER_COUNT) break
    if (!isRecord(value) || !isRecord(value.bounds)) continue
    const kind = typeof value.kind === 'string' && ALLOWED_KINDS.has(value.kind as ImageLayerKind)
      ? value.kind as ImageLayerKind
      : 'other'
    const analysisBounds = normalizeBounds(value.bounds, request.image.width, request.image.height)
    if (!analysisBounds) continue
    const bounds = scaleBounds(analysisBounds, scaleX, scaleY, request.sourceWidth, request.sourceHeight)
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : ''
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? clamp(value.confidence, 0, 1)
      : undefined
    const reason = typeof value.reason === 'string' ? value.reason.trim().slice(0, 300) : ''
    layers.push({
      id: `layer-${crypto.randomUUID()}`,
      name: name || `图层 ${index + 1}`,
      kind,
      bounds,
      ...(confidence === undefined ? {} : { confidence }),
      ...(reason ? { reason } : {}),
    })
  }
  return layers
}

function extractJsonObject(content: string): string {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new ImageLayerAnalysisServiceError('PROVIDER_INVALID_RESPONSE', '视觉模型没有返回图层 JSON')
  }
  return cleaned.slice(start, end + 1)
}

function normalizeBounds(
  value: Readonly<Record<string, unknown>>,
  maximumWidth: number,
  maximumHeight: number,
): ImageLayerBounds | null {
  const x = finiteNumber(value.x)
  const y = finiteNumber(value.y)
  const width = finiteNumber(value.width)
  const height = finiteNumber(value.height)
  if (x === null || y === null || width === null || height === null) return null
  const left = Math.round(clamp(Math.min(x, x + width), 0, maximumWidth))
  const top = Math.round(clamp(Math.min(y, y + height), 0, maximumHeight))
  const right = Math.round(clamp(Math.max(x, x + width), 0, maximumWidth))
  const bottom = Math.round(clamp(Math.max(y, y + height), 0, maximumHeight))
  if (right - left < MIN_LAYER_SIZE || bottom - top < MIN_LAYER_SIZE) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function scaleBounds(
  bounds: ImageLayerBounds,
  scaleX: number,
  scaleY: number,
  maximumWidth: number,
  maximumHeight: number,
): ImageLayerBounds {
  const x = clamp(Math.round(bounds.x * scaleX), 0, maximumWidth - 1)
  const y = clamp(Math.round(bounds.y * scaleY), 0, maximumHeight - 1)
  const right = clamp(Math.round((bounds.x + bounds.width) * scaleX), x + 1, maximumWidth)
  const bottom = clamp(Math.round((bounds.y + bounds.height) * scaleY), y + 1, maximumHeight)
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function mapProviderErrorCode(
  code: PromptOptimizationClientError['code'],
): ImageLayerAnalysisServiceErrorCode {
  switch (code) {
    case 'NETWORK': return 'PROVIDER_NETWORK'
    case 'TIMEOUT': return 'PROVIDER_TIMEOUT'
    case 'AUTHENTICATION': return 'PROVIDER_AUTHENTICATION'
    case 'RATE_LIMIT': return 'PROVIDER_RATE_LIMIT'
    case 'REMOTE': return 'PROVIDER_REMOTE'
    case 'INVALID_RESPONSE': return 'PROVIDER_INVALID_RESPONSE'
  }
}

function providerProfile(adapterId: ProviderAdapterId): PromptOptimizationClientProfile | null {
  switch (adapterId) {
    case 'openai': return 'openai-responses'
    case 'openai-sub2api': return 'sub2api-compatible'
    case 'apimart': return 'apimart'
    case 'volcengine':
    case 'minimax':
      return 'chat-completions'
    default:
      return null
  }
}

function isRetryableAnalysisError(error: unknown): boolean {
  if (error instanceof ImageLayerAnalysisServiceError) {
    return error.code === 'UNSUPPORTED_PROVIDER' || error.code === 'PROVIDER_INVALID_RESPONSE'
  }
  return error instanceof PromptOptimizationClientError && (
    error.code === 'NETWORK' ||
    error.code === 'TIMEOUT' ||
    error.code === 'RATE_LIMIT' ||
    error.code === 'INVALID_RESPONSE' ||
    (error.code === 'REMOTE' && (
      isRetryableRemoteStatus(error.httpStatus) ||
      error.httpStatus === 400 ||
      error.httpStatus === 404 ||
      error.httpStatus === 415 ||
      error.httpStatus === 422
    ))
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
