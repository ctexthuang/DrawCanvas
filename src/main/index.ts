import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron/main'
import { shell } from 'electron'
import type {
  CanvasDocument,
  ClearProviderApiKeyRequest,
  DesktopErrorCode,
  DesktopResult,
  GeneratedArtwork,
  ProviderConfig,
  ProviderConnectionTestResult,
  SaveProviderRequest,
  SetProviderEnabledRequest,
  TestProviderRequest,
  ThemeMode,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import { AppState, ProviderSecretUnavailableError } from './application/app-state'
import { AppDataMigrationError } from './infrastructure/app-data-layout'
import { ProviderRequestError, testOpenAiCompatibleProvider } from './infrastructure/provider-client'

const appState = new AppState()
let mainWindow: BrowserWindow | null = null
const PROVIDER_IDS = new Set([
  // 'apimart',
  'volcengine',
  'minimax',
  // 'comfly',
  'openai-relay',
])

function success<T>(value: T): DesktopResult<T> {
  return { ok: true, value }
}

function failure<T>(code: DesktopErrorCode, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } }
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

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null
    return url.toString().replace(/\/+$/, '')
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

function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<CanvasDocument>
  return (
    document.version === 1 &&
    typeof document.id === 'string' &&
    typeof document.name === 'string' &&
    Array.isArray(document.nodes) &&
    document.nodes.length <= 500 &&
    Array.isArray(document.connections) &&
    document.connections.length <= 1000 &&
    Boolean(document.viewport)
  )
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
      const baseUrl = normalizeBaseUrl(request.baseUrl)
      if (!baseUrl) return failure('INVALID_INPUT', '接口地址必须是有效的 HTTPS 地址')
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
      const baseUrl = normalizeBaseUrl(request.baseUrl)
      if (!baseUrl) return failure('INVALID_INPUT', '接口地址必须是有效的 HTTPS 地址')
      const draftApiKey = normalizeApiKey(request.apiKey)
      if (draftApiKey === null) return failure('INVALID_INPUT', 'API Key 格式无效')

      try {
        const savedProvider = await appState.getProvider(request.id)
        const apiKey = draftApiKey ?? await appState.loadProviderApiKey(request.id)
        if (!apiKey) return failure('INVALID_INPUT', '请先输入或保存 API Key')
        const canPersist = draftApiKey === undefined && savedProvider.baseUrl === baseUrl
        const testedAt = new Date().toISOString()
        try {
          const result = await testOpenAiCompatibleProvider(baseUrl, apiKey)
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
    'history:load',
    trustedHandler(async () => {
      try {
        return success(await appState.loadHistory())
      } catch {
        return failure('IO_ERROR', '无法读取生成历史')
      }
    }),
  )

  ipcMain.handle(
    'history:record',
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
    'library:load',
    trustedHandler(async () => {
      try {
        return success(await appState.loadLibrary())
      } catch {
        return failure('IO_ERROR', '无法读取图片库')
      }
    }),
  )

  ipcMain.handle(
    'resources:load',
    trustedHandler(async () => {
      try {
        return success(await appState.loadResources())
      } catch {
        return failure('IO_ERROR', '无法读取资源数据')
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
    trustedHandler(async () => success(await appState.loadAutosave())),
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
        return isCanvasDocument(value)
          ? success(value)
          : failure('INVALID_FILE', '不是有效的 Draw Canvas 项目')
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

app.whenReady().then(async () => {
  try {
    applyNativeTheme((await appState.loadSettings()).theme)
  } catch {
    applyNativeTheme('light')
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
