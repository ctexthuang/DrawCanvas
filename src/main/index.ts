import { readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  nativeTheme,
  protocol,
  session,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron/main'
import { shell } from 'electron'
import type {
  CanvasDocument,
  ClearProviderApiKeyRequest,
  DeleteRecentCanvasProjectRequest,
  DesktopErrorCode,
  DesktopResult,
  ExportGeneratedAudioRequest,
  ExportGeneratedVideoRequest,
  ExportHistoryBatchRequest,
  GenerateAudioRequest,
  GenerateChatReplyRequest,
  GenerateImageRequest,
  GenerateStoryboardRequest,
  GenerateVideoRequest,
  GeneratedArtwork,
  ImportDroppedImagesRequest,
  LoadGeneratedImageRequest,
  LoadRecentCanvasProjectRequest,
  OptimizePromptRequest,
  ProviderConfig,
  ProviderConnectionTestResult,
  RemoveGeneratedVideoRequest,
  RemoveGeneratedAudioRequest,
  RemoveHistoryArtworkRequest,
  RemoveLibraryImageRequest,
  RemoveResourceRequest,
  SavePromptRequest,
  SaveProviderRequest,
  SaveWorkflowRequest,
  SetProviderEnabledRequest,
  TestProviderRequest,
  ThemeMode,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import {
  CANVAS_IPC_CHANNELS,
  GENERATION_IPC_CHANNELS,
  HISTORY_IPC_CHANNELS,
  LIBRARY_IPC_CHANNELS,
  RESOURCE_IPC_CHANNELS,
} from '../shared/contracts/ipc-channels'
import { isCanvasDocument } from '../shared/domain/canvas-document'
import { isImageGenerationSize } from '../shared/domain/models'
import { AppState, ProviderSecretUnavailableError } from './application/app-state'
import {
  ImageGenerationService,
  ImageGenerationServiceError,
  type ImageGenerationServiceErrorCode,
} from './application/image-generation-service'
import {
  PromptOptimizationService,
  PromptOptimizationServiceError,
  type PromptOptimizationServiceErrorCode,
} from './application/prompt-optimization-service'
import {
  VideoGenerationService,
  VideoGenerationServiceError,
} from './application/video-generation-service'
import {
  AudioGenerationService,
  AudioGenerationServiceError,
} from './application/audio-generation-service'
import {
  TextGenerationService,
  TextGenerationServiceError,
  type TextGenerationServiceErrorCode,
} from './application/text-generation-service'
import { AppDataMigrationError } from './infrastructure/app-data-layout'
import { ProviderRequestError, testOpenAiCompatibleProvider } from './infrastructure/provider-client'

const appState = new AppState()
const imageGenerationService = new ImageGenerationService(appState)
const promptOptimizationService = new PromptOptimizationService(appState)
const textGenerationService = new TextGenerationService(appState)
const videoGenerationService = new VideoGenerationService(appState)
const audioGenerationService = new AudioGenerationService(appState)
let mainWindow: BrowserWindow | null = null
const OPENAI_OFFICIAL_BASE_URL = 'https://api.openai.com/v1'
const PROVIDER_IDS = new Set([
  // 'apimart',
  'volcengine',
  'minimax',
  // 'comfly',
  'openai',
  'openai-sub2api',
])

protocol.registerSchemesAsPrivileged([{
  scheme: 'drawcanvas-media',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
}])

function success<T>(value: T): DesktopResult<T> {
  return { ok: true, value }
}

function failure<T>(code: DesktopErrorCode, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } }
}

function imageGenerationDesktopErrorCode(
  code: ImageGenerationServiceErrorCode,
): DesktopErrorCode {
  switch (code) {
    case 'UNSUPPORTED_PROVIDER': return 'UNSUPPORTED_PROVIDER'
    case 'PROVIDER_NETWORK':
    case 'PROVIDER_DNS':
    case 'PROVIDER_CONNECTION_REFUSED':
    case 'PROVIDER_CONNECTION_CLOSED':
    case 'PROVIDER_TLS':
    case 'PROVIDER_TIMEOUT':
    case 'PROVIDER_AUTHENTICATION':
    case 'PROVIDER_RATE_LIMIT':
    case 'PROVIDER_REMOTE':
    case 'PROVIDER_INVALID_RESPONSE':
      return code
    case 'MODEL_NOT_CONFIGURED':
    case 'PROVIDER_NOT_CONFIGURED':
    case 'PROVIDER_REQUEST':
      return 'PROVIDER_ERROR'
  }
}

function promptOptimizationDesktopErrorCode(
  code: PromptOptimizationServiceErrorCode,
): DesktopErrorCode {
  switch (code) {
    case 'UNSUPPORTED_PROVIDER': return 'UNSUPPORTED_PROVIDER'
    case 'PROVIDER_NETWORK': return 'PROVIDER_NETWORK'
    case 'PROVIDER_TIMEOUT': return 'PROVIDER_TIMEOUT'
    case 'PROVIDER_AUTHENTICATION': return 'PROVIDER_AUTHENTICATION'
    case 'PROVIDER_RATE_LIMIT': return 'PROVIDER_RATE_LIMIT'
    case 'PROVIDER_REMOTE': return 'PROVIDER_REMOTE'
    case 'PROVIDER_INVALID_RESPONSE': return 'PROVIDER_INVALID_RESPONSE'
    case 'MODEL_NOT_CONFIGURED':
    case 'PROVIDER_NOT_CONFIGURED':
      return 'PROVIDER_ERROR'
  }
}

function textGenerationDesktopErrorCode(code: TextGenerationServiceErrorCode): DesktopErrorCode {
  return promptOptimizationDesktopErrorCode(code)
}

function isTrustedFrameUrl(frameUrl: string): boolean {
  if (!frameUrl) return false
  try {
    const parsed = new URL(frameUrl)
    if (parsed.protocol === 'file:') {
      const rendererRoot = join(__dirname, '../renderer')
      const rendererRelativePath = relative(rendererRoot, fileURLToPath(parsed))
      return Boolean(
        rendererRelativePath &&
        !rendererRelativePath.startsWith('..') &&
        !isAbsolute(rendererRelativePath),
      )
    }
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    return Boolean(rendererUrl && parsed.origin === new URL(rendererUrl).origin)
  } catch {
    return false
  }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedFrameUrl(event.senderFrame?.url ?? '')
}

function trustedHandler<TArgs extends ReadonlyArray<unknown>, TResult>(
  handler: (...args: TArgs) => Promise<DesktopResult<TResult>>,
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<DesktopResult<TResult>> {
  return async (event, ...args) => {
    if (!isTrustedSender(event)) return failure('UNAUTHORIZED', '请求来源未通过验证')
    return handler(...args)
  }
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function normalizeBaseUrl(value: unknown, providerId: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    const isLoopbackRelay = providerId === 'openai-sub2api' &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (
      (url.protocol !== 'https:' && !isLoopbackRelay) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null
    const normalized = url.toString().replace(/\/+$/, '')
    return providerId !== 'openai' || normalized === OPENAI_OFFICIAL_BASE_URL
      ? normalized
      : null
  } catch {
    return null
  }
}

function isProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_IDS.has(value)
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === 'string' && item.length <= maxLength)
}

function isDefaultModelKeys(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 4 && entries.every(([kind, key]) =>
    (kind === 'image' || kind === 'video' || kind === 'chat' || kind === 'audio') &&
    typeof key === 'string' &&
    key.length <= 400,
  )
}

function normalizeApiKey(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const key = value.trim()
  return key.length > 0 && key.length <= 8192 ? key : null
}

function isGeneratedArtwork(value: unknown): value is GeneratedArtwork {
  if (!value || typeof value !== 'object') return false
  const artwork = value as Partial<GeneratedArtwork>
  return (
    typeof artwork.id === 'string' && artwork.id.length <= 128 &&
    typeof artwork.title === 'string' && artwork.title.length <= 200 &&
    typeof artwork.prompt === 'string' && artwork.prompt.length <= 10_000 &&
    typeof artwork.model === 'string' && artwork.model.length <= 200 &&
    typeof artwork.size === 'string' && artwork.size.length <= 50 &&
    typeof artwork.createdAt === 'string' && artwork.createdAt.length <= 100 &&
    typeof artwork.palette === 'string' && artwork.palette.length <= 500 &&
    Array.isArray(artwork.tags) && artwork.tags.length <= 20
  )
}

function isGenerateImageRequest(value: unknown): value is GenerateImageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<GenerateImageRequest>
  return (
    typeof request.prompt === 'string' &&
    request.prompt.trim().length > 0 &&
    request.prompt.length <= 20_000 &&
    (request.modelKey === undefined || (
      typeof request.modelKey === 'string' &&
      request.modelKey.length > 0 &&
      request.modelKey.length <= 400
    )) &&
    isImageGenerationSize(request.size) &&
    isImageReferenceFileNames(request.referenceImageFileNames, 16)
  )
}

function isOptimizePromptRequest(value: unknown): value is OptimizePromptRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<OptimizePromptRequest>
  return (
    typeof request.prompt === 'string' &&
    request.prompt.trim().length > 0 &&
    request.prompt.length <= 20_000 &&
    (request.modelKey === undefined || (
      typeof request.modelKey === 'string' &&
      request.modelKey.length > 0 &&
      request.modelKey.length <= 400
    ))
  )
}

function isGenerateChatReplyRequest(value: unknown): value is GenerateChatReplyRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<GenerateChatReplyRequest>
  return (
    Array.isArray(request.messages) &&
    request.messages.length > 0 &&
    request.messages.length <= 100 &&
    request.messages.every((message) =>
      Boolean(message) &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0 &&
      message.content.length <= 20_000
    ) &&
    (request.modelKey === undefined || (
      typeof request.modelKey === 'string' &&
      request.modelKey.length > 0 &&
      request.modelKey.length <= 400
    ))
  )
}

function isGenerateStoryboardRequest(value: unknown): value is GenerateStoryboardRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<GenerateStoryboardRequest>
  return (
    typeof request.theme === 'string' &&
    request.theme.trim().length > 0 &&
    request.theme.length <= 20_000 &&
    typeof request.shotCount === 'number' &&
    Number.isInteger(request.shotCount) &&
    request.shotCount >= 2 &&
    request.shotCount <= 12 &&
    (request.modelKey === undefined || (
      typeof request.modelKey === 'string' &&
      request.modelKey.length > 0 &&
      request.modelKey.length <= 400
    ))
  )
}

function isGenerateVideoRequest(value: unknown): value is GenerateVideoRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<GenerateVideoRequest>
  return (
    typeof request.prompt === 'string' &&
    request.prompt.trim().length > 0 &&
    request.prompt.length <= 20_000 &&
    (request.modelKey === undefined || (
      typeof request.modelKey === 'string' && request.modelKey.length > 0 && request.modelKey.length <= 400
    )) &&
    typeof request.duration === 'number' && Number.isInteger(request.duration) &&
    request.duration >= 4 && request.duration <= 15 &&
    (request.resolution === '720P' || request.resolution === '768P' || request.resolution === '1080P' || request.resolution === '2K') &&
    (request.ratio === '16:9' || request.ratio === '9:16' || request.ratio === '1:1' || request.ratio === 'adaptive') &&
    isImageReferenceFileNames(request.referenceImageFileNames, 12)
  )
}

function isGenerateAudioRequest(value: unknown): value is GenerateAudioRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<GenerateAudioRequest>
  return (
    typeof request.text === 'string' &&
    request.text.trim().length > 0 &&
    request.text.length < 10_000 &&
    (request.modelKey === undefined || (typeof request.modelKey === 'string' && request.modelKey.length > 0 && request.modelKey.length <= 400)) &&
    typeof request.voiceId === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]{0,199}$/.test(request.voiceId) &&
    typeof request.speed === 'number' && Number.isFinite(request.speed) && request.speed >= 0.5 && request.speed <= 2 &&
    typeof request.pitch === 'number' && Number.isInteger(request.pitch) && request.pitch >= -12 && request.pitch <= 12 &&
    typeof request.emotion === 'string' && request.emotion.length <= 50
  )
}

function isImageReferenceFileNames(value: unknown, maximum: number): boolean {
  return value === undefined || (
    Array.isArray(value) && value.length <= maximum && value.every((fileName) =>
      typeof fileName === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(fileName),
    )
  )
}

function isImportDroppedImagesRequest(value: unknown): value is ImportDroppedImagesRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<ImportDroppedImagesRequest>
  return (
    Array.isArray(request.paths) &&
    request.paths.length > 0 &&
    request.paths.length <= 50 &&
    request.paths.every((filePath) =>
      typeof filePath === 'string' &&
      filePath.length > 0 &&
      filePath.length <= 32_767 &&
      !filePath.includes('\0') &&
      isAbsolute(filePath) &&
      ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(filePath).toLowerCase()),
    )
  )
}

function isLoadGeneratedImageRequest(value: unknown): value is LoadGeneratedImageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<LoadGeneratedImageRequest>
  return typeof request.fileName === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(request.fileName)
}

function isResourceItemRequest(value: unknown): value is RemoveResourceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<RemoveResourceRequest>
  return typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 128
}

function isExportHistoryBatchRequest(value: unknown): value is ExportHistoryBatchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<ExportHistoryBatchRequest>
  return (request.media === 'images' || request.media === 'videos' || request.media === 'audios') &&
    isStringArray(request.ids, 200, 128) && request.ids.length > 0
}

function isSavePromptRequest(value: unknown): value is SavePromptRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<SavePromptRequest>
  return (
    (request.id === undefined || (typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 128)) &&
    typeof request.title === 'string' && request.title.trim().length > 0 && request.title.length <= 200 &&
    typeof request.category === 'string' && request.category.trim().length > 0 && request.category.length <= 100 &&
    typeof request.body === 'string' && request.body.trim().length > 0 && request.body.length <= 20_000
  )
}

function isSaveWorkflowRequest(value: unknown): value is SaveWorkflowRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<SaveWorkflowRequest>
  return (
    (request.id === undefined || (typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 128)) &&
    typeof request.title === 'string' && request.title.trim().length > 0 && request.title.length <= 200 &&
    typeof request.description === 'string' && request.description.length <= 1000 &&
    isHexColor(request.accent) &&
    isCanvasDocument(request.document)
  )
}

function safeExportFileName(value: string): string {
  const normalized = value.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 160)
  return normalized || 'Draw Canvas 生成视频'
}

function registerIpc(): void {
  ipcMain.handle(
    'settings:load',
    trustedHandler(async () => {
      try {
        return success(await appState.loadSettings())
      } catch {
        return failure('IO_ERROR', '无法读取设置')
      }
    }),
  )

  ipcMain.handle(
    'settings:update',
    trustedHandler(async (request: UpdateSettingsRequest) => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return failure('INVALID_INPUT', '设置内容无效')
      }
      if (
        request.theme !== undefined &&
        request.theme !== 'light' &&
        request.theme !== 'dark' &&
        request.theme !== 'system'
      ) {
        return failure('INVALID_INPUT', '主题设置无效')
      }
      if (request.accentColor !== undefined && !isHexColor(request.accentColor)) {
        return failure('INVALID_INPUT', '强调色格式无效')
      }
      if (
        request.favoriteImageIds !== undefined &&
        !isStringArray(request.favoriteImageIds, 500, 200)
      ) return failure('INVALID_INPUT', '收藏列表无效')
      if (
        request.enabledModelKeys !== undefined &&
        !isStringArray(request.enabledModelKeys, 500, 400)
      ) return failure('INVALID_INPUT', '模型选择无效')
      if (
        request.defaultModelKeys !== undefined &&
        !isDefaultModelKeys(request.defaultModelKeys)
      ) return failure('INVALID_INPUT', '默认模型设置无效')
      try {
        const settings = await appState.updateSettings(request)
        if (request.theme !== undefined) applyNativeTheme(request.theme)
        return success(settings)
      } catch {
        return failure('IO_ERROR', '无法保存设置')
      }
    }),
  )

  ipcMain.handle(
    'models:save-provider',
    trustedHandler(async (request: SaveProviderRequest) => {
      if (!request || !isProviderId(request.id)) {
        return failure('INVALID_INPUT', '服务商配置无效')
      }
      const baseUrl = normalizeBaseUrl(request.baseUrl, request.id)
      if (!baseUrl) return failure('INVALID_INPUT', '接口地址无效；中转站仅允许 HTTPS 或本机 HTTP 地址')
      const apiKey = normalizeApiKey(request.apiKey)
      if (apiKey === null) return failure('INVALID_INPUT', 'API Key 格式无效')
      try {
        return success(await appState.saveProvider({ id: request.id, baseUrl, ...(apiKey ? { apiKey } : {}) }))
      } catch (error) {
        return error instanceof ProviderSecretUnavailableError
          ? failure('ENCRYPTION_UNAVAILABLE', error.message)
          : failure('IO_ERROR', '无法保存服务商配置')
      }
    }),
  )

  ipcMain.handle(
    'models:test-provider',
    trustedHandler(async (request: TestProviderRequest) => {
      if (!request || !isProviderId(request.id)) {
        return failure('INVALID_INPUT', '服务商配置无效')
      }
      const baseUrl = normalizeBaseUrl(request.baseUrl, request.id)
      if (!baseUrl) return failure('INVALID_INPUT', '接口地址无效；中转站仅允许 HTTPS 或本机 HTTP 地址')
      const draftApiKey = normalizeApiKey(request.apiKey)
      if (draftApiKey === null) return failure('INVALID_INPUT', 'API Key 格式无效')

      try {
        const savedProvider = await appState.getProvider(request.id)
        const apiKey = draftApiKey ?? await appState.loadProviderApiKey(request.id)
        if (!apiKey) return failure('INVALID_INPUT', '请先输入或保存 API Key')
        const canPersist = draftApiKey === undefined && savedProvider.baseUrl === baseUrl
        const testedAt = new Date().toISOString()
        try {
          const result = await testOpenAiCompatibleProvider(
            baseUrl,
            apiKey,
            request.id === 'openai-sub2api' ? 'sub2api' : 'openai',
          )
          const provider = canPersist
            ? await appState.markProviderTest(
                request.id,
                'connected',
                testedAt,
                result.availableModelIds,
              )
            : createTransientProvider(
                savedProvider,
                baseUrl,
                Boolean(draftApiKey),
                'connected',
                testedAt,
                result.availableModelIds,
              )
          const value: ProviderConnectionTestResult = {
            connected: true,
            provider,
            latencyMs: result.latencyMs,
            availableModelIds: result.availableModelIds,
            message: result.message,
          }
          return success(value)
        } catch (error) {
          if (!(error instanceof ProviderRequestError)) throw error
          const provider = canPersist
            ? await appState.markProviderTest(request.id, 'failed', testedAt, [])
            : createTransientProvider(
                savedProvider,
                baseUrl,
                Boolean(draftApiKey),
                'failed',
                testedAt,
                [],
              )
          const value: ProviderConnectionTestResult = {
            connected: false,
            provider,
            ...(error.latencyMs ? { latencyMs: error.latencyMs } : {}),
            error: { code: error.code, message: error.message },
          }
          return success(value)
        }
      } catch {
        return failure('IO_ERROR', '无法读取或更新服务商配置')
      }
    }),
  )

  ipcMain.handle(
    'models:clear-api-key',
    trustedHandler(async (request: ClearProviderApiKeyRequest) => {
      if (!request || !isProviderId(request.id)) {
        return failure('INVALID_INPUT', '服务商配置无效')
      }
      try {
        return success(await appState.clearProviderApiKey(request.id))
      } catch {
        return failure('IO_ERROR', '无法清除 API Key')
      }
    }),
  )

  ipcMain.handle(
    'models:set-provider-enabled',
    trustedHandler(async (request: SetProviderEnabledRequest) => {
      if (!request || !isProviderId(request.id) || typeof request.enabled !== 'boolean') {
        return failure('INVALID_INPUT', '服务商开关设置无效')
      }
      try {
        return success(await appState.setProviderEnabled(request.id, request.enabled))
      } catch {
        return failure('IO_ERROR', '无法更新服务商开关')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.load,
    trustedHandler(async () => {
      try {
        return success(await appState.loadHistory())
      } catch {
        return failure('IO_ERROR', '无法读取生成历史')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.loadVideos,
    trustedHandler(async () => {
      try {
        return success(await appState.loadVideoHistory())
      } catch {
        return failure('IO_ERROR', '无法读取视频生成历史')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.loadAudios,
    trustedHandler(async () => {
      try {
        return success(await appState.loadAudioHistory())
      } catch {
        return failure('IO_ERROR', '无法读取语音生成历史')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.record,
    trustedHandler(async (artwork: GeneratedArtwork) => {
      if (!isGeneratedArtwork(artwork)) return failure('INVALID_INPUT', '生成记录无效')
      try {
        return success(await appState.recordArtwork(artwork))
      } catch {
        return failure('IO_ERROR', '无法保存生成记录')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.remove,
    trustedHandler(async (request: RemoveHistoryArtworkRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '生成记录标识无效')
      try {
        return success(await appState.removeHistoryArtwork(request))
      } catch {
        return failure('IO_ERROR', '无法删除生成记录')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.removeVideo,
    trustedHandler(async (request: RemoveGeneratedVideoRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '视频记录标识无效')
      try {
        return success(await appState.removeGeneratedVideo(request))
      } catch {
        return failure('IO_ERROR', '无法删除视频生成记录')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.exportVideo,
    trustedHandler(async (request: ExportGeneratedVideoRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '视频记录标识无效')
      try {
        const video = await appState.getGeneratedVideo(request.id)
        if (!video) return failure('NOT_FOUND', '视频生成记录不存在')
        const extension = extname(video.videoFileName).slice(1).toLowerCase()
        const options: SaveDialogOptions = {
          title: '导出生成视频',
          defaultPath: `${safeExportFileName(video.title)}.${extension}`,
          filters: [{ name: '视频文件', extensions: [extension] }],
        }
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return failure('CANCELLED', '已取消导出')
        await appState.exportGeneratedVideo(video.id, result.filePath)
        return success(null)
      } catch {
        return failure('IO_ERROR', '无法导出生成视频')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.removeAudio,
    trustedHandler(async (request: RemoveGeneratedAudioRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '语音记录标识无效')
      try {
        return success(await appState.removeGeneratedAudio(request))
      } catch {
        return failure('IO_ERROR', '无法删除语音生成记录')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.exportAudio,
    trustedHandler(async (request: ExportGeneratedAudioRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '语音记录标识无效')
      try {
        const audio = await appState.getGeneratedAudio(request.id)
        if (!audio) return failure('NOT_FOUND', '语音生成记录不存在')
        const options: SaveDialogOptions = {
          title: '导出生成语音',
          defaultPath: `${safeExportFileName(audio.title)}.mp3`,
          filters: [{ name: 'MP3 音频', extensions: ['mp3'] }],
        }
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return failure('CANCELLED', '已取消导出')
        await appState.exportGeneratedAudio(audio.id, result.filePath)
        return success(null)
      } catch {
        return failure('IO_ERROR', '无法导出生成语音')
      }
    }),
  )

  ipcMain.handle(
    HISTORY_IPC_CHANNELS.exportBatch,
    trustedHandler(async (request: ExportHistoryBatchRequest) => {
      if (!isExportHistoryBatchRequest(request)) return failure('INVALID_INPUT', '批量导出内容无效')
      const options: OpenDialogOptions = {
        title: '选择批量导出目录',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: await appState.getStorageDirectory(),
        buttonLabel: '导出到这里',
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return failure('CANCELLED', '已取消批量导出')
      try {
        const exportedCount = await appState.exportHistoryBatch(request, result.filePaths[0])
        return success({ exportedCount, directory: result.filePaths[0] })
      } catch {
        return failure('IO_ERROR', '批量导出失败，请检查目标目录权限和本地文件')
      }
    }),
  )

  ipcMain.handle(
    LIBRARY_IPC_CHANNELS.load,
    trustedHandler(async () => {
      try {
        return success(await appState.loadLibrary())
      } catch {
        return failure('IO_ERROR', '无法读取图片库')
      }
    }),
  )

  ipcMain.handle(
    LIBRARY_IPC_CHANNELS.importImages,
    trustedHandler(async () => {
      const options: OpenDialogOptions = {
        title: '导入本地图片',
        defaultPath: app.getPath('pictures'),
        buttonLabel: '导入图片',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) {
        return failure('CANCELLED', '已取消导入图片')
      }
      if (result.filePaths.length > 50) return failure('INVALID_INPUT', '每次最多导入 50 张图片')
      try {
        return success(await appState.importLibraryImages(result.filePaths))
      } catch {
        return failure('INVALID_FILE', '图片格式无效、文件过大或无法读取')
      }
    }),
  )

  ipcMain.handle(
    LIBRARY_IPC_CHANNELS.importDroppedImages,
    trustedHandler(async (request: ImportDroppedImagesRequest) => {
      if (!isImportDroppedImagesRequest(request)) {
        return failure('INVALID_INPUT', '拖入的图片文件无效或数量超过 50 张')
      }
      try {
        return success(await appState.importLibraryImages(request.paths))
      } catch {
        return failure('INVALID_FILE', '图片格式无效、文件过大或无法读取')
      }
    }),
  )

  ipcMain.handle(
    LIBRARY_IPC_CHANNELS.remove,
    trustedHandler(async (request: RemoveLibraryImageRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '图片资源标识无效')
      try {
        return success(await appState.removeLibraryImage(request))
      } catch {
        return failure('IO_ERROR', '无法删除图片资源')
      }
    }),
  )

  ipcMain.handle(
    RESOURCE_IPC_CHANNELS.load,
    trustedHandler(async () => {
      try {
        return success(await appState.loadResources())
      } catch {
        return failure('IO_ERROR', '无法读取资源数据')
      }
    }),
  )

  ipcMain.handle(
    RESOURCE_IPC_CHANNELS.savePrompt,
    trustedHandler(async (request: SavePromptRequest) => {
      if (!isSavePromptRequest(request)) return failure('INVALID_INPUT', '提示词内容无效')
      try {
        return success(await appState.savePrompt(request))
      } catch {
        return failure('IO_ERROR', '无法保存提示词')
      }
    }),
  )

  ipcMain.handle(
    RESOURCE_IPC_CHANNELS.removePrompt,
    trustedHandler(async (request: RemoveResourceRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '提示词标识无效')
      try {
        return success(await appState.removePrompt(request))
      } catch {
        return failure('IO_ERROR', '无法删除提示词')
      }
    }),
  )

  ipcMain.handle(
    RESOURCE_IPC_CHANNELS.saveWorkflow,
    trustedHandler(async (request: SaveWorkflowRequest) => {
      if (!isSaveWorkflowRequest(request)) return failure('INVALID_INPUT', '工作流内容无效')
      try {
        return success(await appState.saveWorkflow(request))
      } catch {
        return failure('IO_ERROR', '无法保存工作流')
      }
    }),
  )

  ipcMain.handle(
    RESOURCE_IPC_CHANNELS.removeWorkflow,
    trustedHandler(async (request: RemoveResourceRequest) => {
      if (!isResourceItemRequest(request)) return failure('INVALID_INPUT', '工作流标识无效')
      try {
        return success(await appState.removeWorkflow(request))
      } catch {
        return failure('IO_ERROR', '无法删除工作流')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.generateImage,
    trustedHandler(async (request: GenerateImageRequest) => {
      if (!isGenerateImageRequest(request)) {
        return failure('INVALID_INPUT', '请输入有效提示词并选择支持的图片尺寸')
      }
      try {
        return success(await imageGenerationService.generate({
          ...request,
          prompt: request.prompt.trim(),
        }))
      } catch (error) {
        if (error instanceof ImageGenerationServiceError) {
          return failure(
            imageGenerationDesktopErrorCode(error.code),
            error.message,
          )
        }
        return failure('IO_ERROR', '生成结果保存失败，请检查数据目录')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.loadImage,
    trustedHandler(async (request: LoadGeneratedImageRequest) => {
      if (!isLoadGeneratedImageRequest(request)) return failure('INVALID_INPUT', '图片资源引用无效')
      try {
        return success(await imageGenerationService.loadImage(request.fileName))
      } catch {
        return failure('NOT_FOUND', '本地图片资源不存在或无法读取')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.optimizePrompt,
    trustedHandler(async (request: OptimizePromptRequest) => {
      if (!isOptimizePromptRequest(request)) {
        return failure('INVALID_INPUT', '请先输入需要优化的创意提示词')
      }
      try {
        return success(await promptOptimizationService.optimize({
          ...request,
          prompt: request.prompt.trim(),
        }))
      } catch (error) {
        if (error instanceof PromptOptimizationServiceError) {
          return failure(
            promptOptimizationDesktopErrorCode(error.code),
            error.message,
          )
        }
        return failure('PROVIDER_ERROR', '提示词优化失败，请稍后重试')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.generateChatReply,
    trustedHandler(async (request: GenerateChatReplyRequest) => {
      if (!isGenerateChatReplyRequest(request)) {
        return failure('INVALID_INPUT', '对话消息为空或格式无效')
      }
      try {
        return success(await textGenerationService.chat({
          ...request,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content.trim(),
          })),
        }))
      } catch (error) {
        if (error instanceof TextGenerationServiceError) {
          return failure(textGenerationDesktopErrorCode(error.code), error.message)
        }
        return failure('PROVIDER_ERROR', 'AI 对话失败，请稍后重试')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.generateStoryboard,
    trustedHandler(async (request: GenerateStoryboardRequest) => {
      if (!isGenerateStoryboardRequest(request)) {
        return failure('INVALID_INPUT', '请输入主题并选择 2～12 个分镜')
      }
      try {
        return success(await textGenerationService.storyboard({
          ...request,
          theme: request.theme.trim(),
        }))
      } catch (error) {
        if (error instanceof TextGenerationServiceError) {
          return failure(textGenerationDesktopErrorCode(error.code), error.message)
        }
        return failure('PROVIDER_ERROR', '分镜生成失败，请稍后重试')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.generateVideo,
    trustedHandler(async (request: GenerateVideoRequest) => {
      if (!isGenerateVideoRequest(request)) {
        return failure('INVALID_INPUT', '请输入有效的视频提示词、时长、清晰度和画面比例')
      }
      try {
        return success(await videoGenerationService.generate({
          ...request,
          prompt: request.prompt.trim(),
        }))
      } catch (error) {
        if (error instanceof VideoGenerationServiceError) {
          return failure(
            error.code === 'UNSUPPORTED_PROVIDER' ? 'UNSUPPORTED_PROVIDER' : 'PROVIDER_ERROR',
            error.message,
          )
        }
        return failure('IO_ERROR', '生成视频保存失败，请检查数据目录')
      }
    }),
  )

  ipcMain.handle(
    GENERATION_IPC_CHANNELS.generateAudio,
    trustedHandler(async (request: GenerateAudioRequest) => {
      if (!isGenerateAudioRequest(request)) {
        return failure('INVALID_INPUT', '请输入少于 10000 字的文本并选择有效音色参数')
      }
      try {
        return success(await audioGenerationService.generate({
          ...request,
          text: request.text.trim(),
          voiceId: request.voiceId.trim(),
        }))
      } catch (error) {
        if (error instanceof AudioGenerationServiceError) {
          return failure(
            error.code === 'UNSUPPORTED_PROVIDER' ? 'UNSUPPORTED_PROVIDER' : 'PROVIDER_ERROR',
            error.message,
          )
        }
        return failure('IO_ERROR', '生成语音保存失败，请检查数据目录')
      }
    }),
  )

  ipcMain.handle(
    'storage:change-directory',
    trustedHandler(async () => {
      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择 Draw Canvas 数据目录',
        defaultPath: await appState.getStorageDirectory(),
        buttonLabel: '迁移到这里',
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) {
        return failure('CANCELLED', '已取消选择目录')
      }
      try {
        return success(await appState.migrateStorageDirectory(result.filePaths[0]))
      } catch (error) {
        if (error instanceof AppDataMigrationError) {
          return failure(
            error.code === 'TARGET_CONFLICT' ? 'STORAGE_CONFLICT' : 'IO_ERROR',
            error.message,
          )
        }
        return failure('IO_ERROR', '迁移数据失败，原目录未发生改变')
      }
    }),
  )

  ipcMain.handle(
    'storage:open-directory',
    trustedHandler(async () => {
      const directory = await appState.getStorageDirectory()
      const error = await shell.openPath(directory)
      return error ? failure('IO_ERROR', '无法打开目录') : success(null)
    }),
  )

  ipcMain.handle(
    'storage:stats',
    trustedHandler(async () => {
      try {
        return success(await appState.storageStats())
      } catch {
        return failure('IO_ERROR', '无法统计数据目录')
      }
    }),
  )

  ipcMain.handle(
    'canvas:load-autosave',
    trustedHandler(async () => {
      try {
        const document = await appState.loadAutosave()
        return !document || isCanvasDocument(document)
          ? success(document)
          : failure('INVALID_FILE', '自动保存项目数据无效')
      } catch {
        return failure('IO_ERROR', '无法读取自动保存项目')
      }
    }),
  )

  ipcMain.handle(
    CANVAS_IPC_CHANNELS.listRecent,
    trustedHandler(async () => {
      try {
        return success(await appState.listRecentProjects())
      } catch {
        return failure('IO_ERROR', '无法读取最近项目')
      }
    }),
  )

  ipcMain.handle(
    CANVAS_IPC_CHANNELS.loadRecent,
    trustedHandler(async (request: LoadRecentCanvasProjectRequest) => {
      if (!request || typeof request.id !== 'string' || request.id.length === 0 || request.id.length > 128) {
        return failure('INVALID_INPUT', '最近项目标识无效')
      }
      try {
        const document = await appState.loadRecentProject(request.id)
        return document && isCanvasDocument(document)
          ? success(document)
          : failure('NOT_FOUND', '最近项目不存在或已被移动')
      } catch {
        return failure('IO_ERROR', '无法打开最近项目')
      }
    }),
  )

  ipcMain.handle(
    CANVAS_IPC_CHANNELS.deleteRecent,
    trustedHandler(async (request: DeleteRecentCanvasProjectRequest) => {
      if (!request || typeof request.id !== 'string' || request.id.length === 0 || request.id.length > 128) {
        return failure('INVALID_INPUT', '最近项目标识无效')
      }
      try {
        return success(await appState.deleteRecentProject(request.id))
      } catch {
        return failure('IO_ERROR', '无法删除最近项目')
      }
    }),
  )

  ipcMain.handle(
    'canvas:save-autosave',
    trustedHandler(async (document: CanvasDocument) => {
      if (!isCanvasDocument(document)) return failure('INVALID_INPUT', '画布数据无效')
      try {
        await appState.saveAutosave(document)
        return success(null)
      } catch {
        return failure('IO_ERROR', '自动保存失败')
      }
    }),
  )

  ipcMain.handle(
    'canvas:open-file',
    trustedHandler(async () => {
      const options: OpenDialogOptions = {
        title: '打开 Draw Canvas 项目',
        properties: ['openFile'],
        defaultPath: await appState.getProjectsDirectory(),
        filters: [{ name: 'Draw Canvas 项目', extensions: ['drawcanvas', 'json'] }],
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return failure('CANCELLED', '已取消打开文件')
      try {
        const value: unknown = JSON.parse(await readFile(result.filePaths[0], 'utf8'))
        if (!isCanvasDocument(value)) return failure('INVALID_FILE', '不是有效的 Draw Canvas 项目')
        await appState.recordRecentProject(value, result.filePaths[0], new Date().toISOString()).catch(() => undefined)
        return success(value)
      } catch {
        return failure('INVALID_FILE', '无法读取项目文件')
      }
    }),
  )

  ipcMain.handle(
    'canvas:save-file',
    trustedHandler(async (document: CanvasDocument) => {
      if (!isCanvasDocument(document)) return failure('INVALID_INPUT', '画布数据无效')
      const options: SaveDialogOptions = {
        title: '保存 Draw Canvas 项目',
        defaultPath: join(
          await appState.getProjectsDirectory(),
          `${document.name || 'Untitled'}.drawcanvas`,
        ),
        filters: [{ name: 'Draw Canvas 项目', extensions: ['drawcanvas'] }],
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return failure('CANCELLED', '已取消保存')
      try {
        await writeFile(result.filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await appState.recordRecentProject(document, result.filePath).catch(() => undefined)
        return success(result.filePath)
      } catch {
        return failure('IO_ERROR', '无法保存项目文件')
      }
    }),
  )
}

function createTransientProvider(
  provider: ProviderConfig,
  baseUrl: string,
  _hasDraftApiKey: boolean,
  connectionStatus: ProviderConfig['connectionStatus'],
  lastTestedAt: string,
  availableModelIds: ReadonlyArray<string>,
): ProviderConfig {
  return {
    ...provider,
    baseUrl,
    hasApiKey: provider.hasApiKey,
    connectionStatus,
    lastTestedAt,
    availableModelIds,
  }
}

function createWindow(): void {
  const windowBackground = getWindowBackground()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: 'Draw Canvas',
    backgroundColor: windowBackground,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedFrameUrl(navigationUrl)) event.preventDefault()
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) void mainWindow.loadURL(rendererUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function applyNativeTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme
  mainWindow?.setBackgroundColor(getWindowBackground())
}

function getWindowBackground(): string {
  return nativeTheme.shouldUseDarkColors
    ? '#1c1e21'
    : '#f3f4f6'
}

async function registerMediaProtocol(): Promise<void> {
  await protocol.handle('drawcanvas-media', async (request) => {
    try {
      const url = new URL(request.url)
      const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (
        url.search ||
        url.hash ||
        !(
          (url.host === 'video' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm)$/i.test(fileName)) ||
          (url.host === 'audio' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp3$/i.test(fileName))
        )
      ) return new Response(null, { status: 404 })
      const filePath = url.host === 'audio'
        ? await appState.resolveStoredAudioPath(fileName)
        : await appState.resolveStoredVideoPath(fileName)
      return net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true,
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

app.whenReady().then(async () => {
  try {
    applyNativeTheme((await appState.loadSettings()).theme)
  } catch {
    applyNativeTheme('light')
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  await registerMediaProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
