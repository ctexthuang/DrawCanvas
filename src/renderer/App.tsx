import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type {
  AppSettings,
  CanvasDocument,
  GeneratedArtwork,
  ProviderConfig,
  ProviderConnectionTestResult,
  ResourceCatalog,
  SaveProviderRequest,
  StorageStats,
  TestProviderRequest,
  ThemeMode,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import { DEFAULT_CHAT_MODEL_KEY, DEFAULT_IMAGE_MODEL_KEY } from '../shared/domain/models'
import { AppShell, type AppPage } from './components/AppShell'
import { createInitialCanvas, InfiniteCanvas } from './features/canvas/InfiniteCanvas'
import { GalleryPage } from './features/gallery/GalleryPage'
import { HistoryPage } from './features/history/HistoryPage'
import { HomePage } from './features/home/HomePage'
import { ResourcesPage } from './features/resources/ResourcesPage'
import { ModelSettingsPage } from './features/settings/ModelSettingsPage'
import { SystemSettingsPage } from './features/settings/SystemSettingsPage'
import { artworks as seedArtworks, prompts as seedPrompts, workflows as seedWorkflows } from './domain/catalog'

const fallbackProviders: ReadonlyArray<ProviderConfig> = [
  createFallbackProvider('apimart', 'https://api.apimart.ai/v1', false),
  createFallbackProvider('volcengine', 'https://ark.cn-beijing.volces.com/api/v3', true),
  createFallbackProvider('minimax', 'https://api.minimaxi.com/v1', true),
  createFallbackProvider('comfly', 'https://api.comfly.chat/v1', false),
  createFallbackProvider('openai-relay', 'https://api.openai.com/v1', true),
]

function createFallbackProvider(id: string, baseUrl: string, enabled: boolean): ProviderConfig {
  return {
    id,
    baseUrl,
    enabled,
    hasApiKey: false,
    connectionStatus: 'untested',
    availableModelIds: [],
  }
}

const fallbackSettings: AppSettings = {
  theme: 'light',
  accentColor: '#ff5f77',
  storageDirectory: 'Draw Canvas Data',
  favoriteImageIds: ['1', '2', '4', '6', '8'],
  enabledModelKeys: [DEFAULT_IMAGE_MODEL_KEY, DEFAULT_CHAT_MODEL_KEY],
  defaultModelKeys: { image: DEFAULT_IMAGE_MODEL_KEY, chat: DEFAULT_CHAT_MODEL_KEY },
  providers: fallbackProviders,
}

const fallbackStats: StorageStats = {
  totalBytes: 0,
  totalFileCount: 0,
  categories: {
    projects: { bytes: 0, fileCount: 0 },
    history: { bytes: 0, fileCount: 0 },
    library: { bytes: 0, fileCount: 0 },
    resources: { bytes: 0, fileCount: 0 },
    settings: { bytes: 0, fileCount: 0 },
    database: { bytes: 0, fileCount: 0 },
    cache: { bytes: 0, fileCount: 0 },
    other: { bytes: 0, fileCount: 0 },
  },
}

const fallbackResources: ResourceCatalog = { prompts: seedPrompts, workflows: seedWorkflows }

export function App() {
  const [page, setPage] = useState<AppPage>('home')
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const [stats, setStats] = useState<StorageStats>(fallbackStats)
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument>(() => loadBrowserAutosave() ?? createInitialCanvas())
  const [generatedArtworks, setGeneratedArtworks] = useState<ReadonlyArray<GeneratedArtwork>>(loadBrowserHistory)
  const [libraryCatalog, setLibraryCatalog] = useState<ReadonlyArray<GeneratedArtwork>>(seedArtworks)
  const [resourceCatalog, setResourceCatalog] = useState<ResourceCatalog>(fallbackResources)
  const [storageChanging, setStorageChanging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const rootStyle = useMemo(() => ({ '--accent': settings.accentColor } as CSSProperties), [settings.accentColor])
  const effectiveTheme = settings.theme === 'system' ? systemTheme : settings.theme
  const libraryArtworks = useMemo(
    () => [...generatedArtworks, ...libraryCatalog.filter((artwork) => !generatedArtworks.some((generated) => generated.id === artwork.id))],
    [generatedArtworks, libraryCatalog],
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'dark' : 'light')
    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDesktopState(): Promise<void> {
      if (!window.desktop) return
      const [settingsResult, statsResult, canvasResult, historyResult, libraryResult, resourcesResult] = await Promise.all([
        window.desktop.settings.load(),
        window.desktop.storage.stats(),
        window.desktop.canvas.loadAutosave(),
        window.desktop.history.load(),
        window.desktop.library.load(),
        window.desktop.resources.load(),
      ])
      if (cancelled) return
      if (settingsResult.ok) setSettings(settingsResult.value)
      if (statsResult.ok) setStats(statsResult.value)
      if (canvasResult.ok && canvasResult.value) setCanvasDocument(canvasResult.value)
      if (historyResult.ok) setGeneratedArtworks(historyResult.value)
      if (libraryResult.ok) setLibraryCatalog(libraryResult.value)
      if (resourcesResult.ok) setResourceCatalog(resourcesResult.value)
    }
    void loadDesktopState()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (window.desktop) void window.desktop.canvas.saveAutosave(canvasDocument)
      else localStorage.setItem('draw-canvas-autosave', JSON.stringify(canvasDocument))
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [canvasDocument])

  useEffect(() => {
    if (!window.desktop) localStorage.setItem('draw-canvas-generation-history', JSON.stringify(generatedArtworks))
  }, [generatedArtworks])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [toast])

  async function updateSettings(patch: UpdateSettingsRequest): Promise<void> {
    setSettings((current) => ({ ...current, ...patch }))
    if (!window.desktop) return
    const result = await window.desktop.settings.update(patch)
    if (result.ok) setSettings(result.value)
    else notify(result.error.message)
  }

  function notify(message: string): void {
    setToast(message)
  }

  function newCanvas(prompt?: string): void {
    setCanvasDocument(createInitialCanvas('未命名画布', prompt))
    setPage('canvas')
  }

  async function openCanvasFile(): Promise<void> {
    if (!window.desktop) {
      notify('文件选择功能需要在 Electron 桌面端使用')
      setPage('canvas')
      return
    }
    const result = await window.desktop.canvas.openFile()
    if (result.ok) {
      setCanvasDocument(result.value)
      setPage('canvas')
      notify('项目已打开')
    } else if (result.error.code !== 'CANCELLED') notify(result.error.message)
  }

  async function saveCanvasFile(): Promise<void> {
    if (!window.desktop) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(canvasDocument, null, 2)], { type: 'application/json' }))
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${canvasDocument.name}.drawcanvas`
      link.click()
      URL.revokeObjectURL(url)
      notify('项目文件已导出')
      return
    }
    const result = await window.desktop.canvas.saveFile(canvasDocument)
    if (result.ok) notify(`已保存到 ${result.value}`)
    else if (result.error.code !== 'CANCELLED') notify(result.error.message)
  }

  function toggleFavorite(id: string): void {
    const next = settings.favoriteImageIds.includes(id)
      ? settings.favoriteImageIds.filter((favoriteId) => favoriteId !== id)
      : [...settings.favoriteImageIds, id]
    void updateSettings({ favoriteImageIds: next })
  }

  async function recordGeneratedArtwork(artwork: GeneratedArtwork): Promise<void> {
    setGeneratedArtworks((current) => [artwork, ...current.filter((item) => item.id !== artwork.id)])
    if (!window.desktop) return
    const result = await window.desktop.history.record(artwork)
    if (result.ok) setGeneratedArtworks(result.value)
    else notify(result.error.message)
  }

  async function saveProvider(request: SaveProviderRequest): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((provider) => provider.id === request.id
          ? {
              ...provider,
              baseUrl: request.baseUrl,
              hasApiKey: Boolean(request.apiKey || provider.hasApiKey),
              connectionStatus: 'untested',
              availableModelIds: [],
            }
          : provider),
      }))
      notify('服务商配置已保存（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.saveProvider(request)
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setSettings((current) => ({ ...current, providers: current.providers.map((provider) => provider.id === result.value.id ? result.value : provider) }))
    notify('服务商配置已安全保存')
    return true
  }

  async function testProvider(request: TestProviderRequest): Promise<ProviderConnectionTestResult | null> {
    if (!window.desktop) {
      const provider = settings.providers.find((item) => item.id === request.id)
      if (!provider) return null
      const result: ProviderConnectionTestResult = {
        connected: false,
        provider: { ...provider, baseUrl: request.baseUrl, connectionStatus: 'failed' },
        error: { code: 'NETWORK', message: '连接测试需要在 Electron 桌面端运行' },
      }
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((item) => item.id === request.id ? result.provider : item),
      }))
      notify(result.error.message)
      return result
    }
    const response = await window.desktop.models.testProvider(request)
    if (!response.ok) {
      notify(response.error.message)
      return null
    }
    const savedProvider = settings.providers.find((provider) => provider.id === request.id)
    if (request.apiKey === undefined && savedProvider?.baseUrl === request.baseUrl) {
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === response.value.provider.id ? response.value.provider : provider),
      }))
    }
    notify(response.value.connected ? response.value.message : response.value.error.message)
    return response.value
  }

  async function clearProviderApiKey(id: string): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((provider) => provider.id === id
          ? { ...provider, hasApiKey: false, connectionStatus: 'untested', availableModelIds: [] }
          : provider),
      }))
      notify('API Key 已清除（浏览器预览）')
      return true
    }
    const response = await window.desktop.models.clearApiKey({ id })
    if (!response.ok) {
      notify(response.error.message)
      return false
    }
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === id ? response.value : provider),
    }))
    notify('API Key 已从本机安全存储中清除')
    return true
  }

  async function setProviderEnabled(id: string, enabled: boolean): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((provider) => provider.id === id
          ? { ...provider, enabled }
          : provider),
      }))
      notify(enabled ? '服务商已启用（浏览器预览）' : '服务商已停用（浏览器预览）')
      return true
    }
    const response = await window.desktop.models.setProviderEnabled({ id, enabled })
    if (!response.ok) {
      notify(response.error.message)
      return false
    }
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === id ? response.value : provider),
    }))
    notify(enabled ? '服务商已启用' : '服务商已停用')
    return true
  }

  async function chooseStorageDirectory(): Promise<void> {
    if (!window.desktop) {
      notify('目录选择功能需要在 Electron 桌面端使用')
      return
    }
    setStorageChanging(true)
    try {
      const result = await window.desktop.storage.changeDirectory()
      if (!result.ok) {
        if (result.error.code !== 'CANCELLED') notify(result.error.message)
        return
      }
      setSettings(result.value.settings)
      setStats(result.value.stats)
      const migrated = `${formatBytes(result.value.migratedBytes)} · ${result.value.migratedFileCount} 个文件`
      notify(result.value.sourceCleanupPending
        ? `数据已迁移（${migrated}），旧目录有文件未能清理`
        : `数据已迁移（${migrated}）`)
    } finally {
      setStorageChanging(false)
    }
  }

  async function openStorageDirectory(): Promise<void> {
    if (!window.desktop) {
      notify('请在 Electron 桌面端打开数据目录')
      return
    }
    const result = await window.desktop.storage.openDirectory()
    if (!result.ok) notify(result.error.message)
  }

  function renderPage() {
    switch (page) {
      case 'home':
        return <HomePage onNewCanvas={() => newCanvas()} onOpenFile={() => void openCanvasFile()} />
      case 'history':
        return <HistoryPage artworks={libraryArtworks} notify={notify} />
      case 'gallery':
        return <GalleryPage artworks={libraryArtworks} favoriteIds={settings.favoriteImageIds} onFavorite={toggleFavorite} />
      case 'resources':
        return <ResourcesPage notify={notify} onRunWorkflow={(id) => { newCanvas(); notify(`工作流 ${id} 已载入画布`) }} onUsePrompt={(prompt) => newCanvas(prompt)} prompts={resourceCatalog.prompts} workflows={resourceCatalog.workflows} />
      case 'models':
        return <ModelSettingsPage defaultModelKeys={settings.defaultModelKeys} enabledModelKeys={settings.enabledModelKeys} onClearProviderApiKey={clearProviderApiKey} onModelConfigChange={(enabledModelKeys, defaultModelKeys) => void updateSettings({ enabledModelKeys, defaultModelKeys })} onSaveProvider={saveProvider} onSetProviderEnabled={setProviderEnabled} onTestProvider={testProvider} providers={settings.providers} />
      case 'settings':
        return <SystemSettingsPage changingDirectory={storageChanging} onAccentChange={(color) => void updateSettings({ accentColor: color })} onChooseDirectory={() => void chooseStorageDirectory()} onOpenDirectory={() => void openStorageDirectory()} onThemeChange={(theme: ThemeMode) => void updateSettings({ theme })} settings={settings} stats={stats} />
      case 'canvas':
        return <InfiniteCanvas document={canvasDocument} notify={notify} onChange={setCanvasDocument} onClose={() => setPage('home')} onGenerated={(artwork) => void recordGeneratedArtwork(artwork)} onOpen={() => void openCanvasFile()} onSave={() => void saveCanvasFile()} />
    }
  }

  return (
    <div className={`app-root theme-${effectiveTheme}`} style={rootStyle}>
      <AppShell activePage={page} onNavigate={setPage}>{renderPage()}</AppShell>
      {toast && <div className="toast" role="status"><span />{toast}</div>}
    </div>
  )
}

function loadBrowserAutosave(): CanvasDocument | null {
  try {
    const value = localStorage.getItem('draw-canvas-autosave')
    return value ? JSON.parse(value) as CanvasDocument : null
  } catch {
    return null
  }
}

function loadBrowserHistory(): ReadonlyArray<GeneratedArtwork> {
  try {
    const value = localStorage.getItem('draw-canvas-generation-history')
    return value ? JSON.parse(value) as ReadonlyArray<GeneratedArtwork> : []
  } catch {
    return []
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
