import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type {
  AppSettings,
  CanvasDocument,
  GenerateAudioRequest,
  GenerateChatReplyRequest,
  GenerateImageRequest,
  GenerateStoryboardRequest,
  GenerateVideoRequest,
  GeneratedArtwork,
  GeneratedAudioAsset,
  GeneratedVideoAsset,
  OptimizePromptRequest,
  ProviderConfig,
  ProviderConnectionTestResult,
  RecentCanvasProject,
  ResourceCatalog,
  SavePromptRequest,
  SaveProviderRequest,
  SaveWorkflowRequest,
  StorageStats,
  TestProviderRequest,
  ThemeMode,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import {
  createRecentCanvasProject,
  recoverInterruptedGenerationTasks,
} from '../shared/domain/canvas-document'
import {
  BUILTIN_PROVIDER_MODELS,
  DEFAULT_CHAT_MODEL_KEY,
  DEFAULT_IMAGE_MODEL_KEY,
} from '../shared/domain/models'
import { AppShell, type AppPage } from './components/AppShell'
import {
  createInitialCanvas,
  InfiniteCanvas,
  type CanvasImageGenerationOutcome,
  type CanvasAudioGenerationOutcome,
  type CanvasChatGenerationOutcome,
  type CanvasPromptOptimizationOutcome,
  type CanvasStoryboardGenerationOutcome,
  type CanvasVideoGenerationOutcome,
} from './features/canvas/InfiniteCanvas'
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
  createFallbackProvider('openai', 'https://api.openai.com/v1', true),
  createFallbackProvider('openai-sub2api', '', false),
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
  favoriteImageIds: [],
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
  const [initialCanvasState] = useState(() => {
    const browserAutosave = window.desktop ? null : loadBrowserAutosave()
    const autosave = browserAutosave
      ? recoverInterruptedGenerationTasks(browserAutosave)
      : null
    return {
      document: autosave ?? createInitialCanvas(),
      isActive: Boolean(autosave),
    }
  })
  const [page, setPage] = useState<AppPage>('home')
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const [stats, setStats] = useState<StorageStats>(fallbackStats)
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument>(initialCanvasState.document)
  const [canvasIsActive, setCanvasIsActive] = useState(initialCanvasState.isActive)
  const [recentProjects, setRecentProjects] = useState<ReadonlyArray<RecentCanvasProject>>(() =>
    initialCanvasState.isActive
      ? [createRecentCanvasProject(initialCanvasState.document, 'autosave')]
      : [],
  )
  const [generatedArtworks, setGeneratedArtworks] = useState<ReadonlyArray<GeneratedArtwork>>(loadBrowserHistory)
  const [generatedVideos, setGeneratedVideos] = useState<ReadonlyArray<GeneratedVideoAsset>>([])
  const [generatedAudios, setGeneratedAudios] = useState<ReadonlyArray<GeneratedAudioAsset>>([])
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
  const imageModels = useMemo(() => BUILTIN_PROVIDER_MODELS
    .filter((model) => model.kind === 'image' && settings.enabledModelKeys.includes(model.key))
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])
  const videoModels = useMemo(() => BUILTIN_PROVIDER_MODELS
    .filter((model) => model.kind === 'video' && settings.enabledModelKeys.includes(model.key))
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])
  const chatModels = useMemo(() => BUILTIN_PROVIDER_MODELS
    .filter((model) => model.kind === 'chat' && settings.enabledModelKeys.includes(model.key))
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])
  const audioModels = useMemo(() => BUILTIN_PROVIDER_MODELS
    .filter((model) => model.kind === 'audio' && settings.enabledModelKeys.includes(model.key))
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])

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
      const [settingsResult, statsResult, canvasResult, recentResult, historyResult, videoHistoryResult, audioHistoryResult, libraryResult, resourcesResult] = await Promise.all([
        window.desktop.settings.load(),
        window.desktop.storage.stats(),
        window.desktop.canvas.loadAutosave(),
        window.desktop.canvas.listRecent(),
        window.desktop.history.load(),
        window.desktop.history.loadVideos(),
        window.desktop.history.loadAudios(),
        window.desktop.library.load(),
        window.desktop.resources.load(),
      ])
      if (cancelled) return
      if (settingsResult.ok) setSettings(settingsResult.value)
      if (statsResult.ok) setStats(statsResult.value)
      if (canvasResult.ok) {
        if (canvasResult.value) setCanvasDocument(recoverInterruptedGenerationTasks(canvasResult.value))
        setCanvasIsActive(Boolean(canvasResult.value))
      }
      if (recentResult.ok) setRecentProjects(recentResult.value)
      if (historyResult.ok) setGeneratedArtworks(historyResult.value)
      if (videoHistoryResult.ok) setGeneratedVideos(videoHistoryResult.value)
      if (audioHistoryResult.ok) setGeneratedAudios(audioHistoryResult.value)
      if (libraryResult.ok) setLibraryCatalog(libraryResult.value)
      if (resourcesResult.ok) setResourceCatalog(resourcesResult.value)
    }
    void loadDesktopState()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!canvasIsActive) return
    const timeout = window.setTimeout(() => {
      setRecentProjects((current) => upsertRecentProject(
        current,
        createRecentCanvasProject(
          canvasDocument,
          current.find((project) => project.id === canvasDocument.id)?.location ?? 'autosave',
        ),
      ))
      if (window.desktop) {
        void window.desktop.canvas.saveAutosave(canvasDocument)
      } else {
        localStorage.setItem('draw-canvas-autosave', JSON.stringify(canvasDocument))
      }
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [canvasDocument, canvasIsActive])

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

  const notify = useCallback((message: string): void => {
    setToast(message)
  }, [])

  async function newCanvas(prompt?: string): Promise<void> {
    let knownProjects = recentProjects
    if (canvasIsActive && window.desktop) {
      const saveResult = await window.desktop.canvas.saveAutosave(canvasDocument)
      if (!saveResult.ok) {
        notify(`无法保留当前画布：${saveResult.error.message}`)
        return
      }
      const recentResult = await window.desktop.canvas.listRecent()
      if (recentResult.ok) {
        knownProjects = recentResult.value
        setRecentProjects(recentResult.value)
      }
    } else if (canvasIsActive) {
      localStorage.setItem('draw-canvas-autosave', JSON.stringify(canvasDocument))
    }

    const defaultImageModelKey = settings.defaultModelKeys.image ?? DEFAULT_IMAGE_MODEL_KEY
    const defaultImageModelName = BUILTIN_PROVIDER_MODELS.find(
      (model) => model.key === defaultImageModelKey,
    )?.displayName ?? '默认图片模型'
    setCanvasDocument(createInitialCanvas(
      nextUntitledCanvasName(knownProjects, canvasIsActive ? canvasDocument.name : undefined),
      prompt,
      defaultImageModelKey,
      defaultImageModelName,
    ))
    setCanvasIsActive(true)
    setPage('canvas')
  }

  async function openCanvasFile(): Promise<void> {
    if (!window.desktop) {
      notify('文件选择功能需要在 Electron 桌面端使用')
      setCanvasIsActive(true)
      setPage('canvas')
      return
    }
    const result = await window.desktop.canvas.openFile()
    if (result.ok) {
      setCanvasDocument(recoverInterruptedGenerationTasks(result.value))
      setCanvasIsActive(true)
      setPage('canvas')
      notify('项目已打开')
      await refreshRecentProjects()
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
    if (result.ok) {
      notify(`已保存到 ${result.value}`)
      await refreshRecentProjects()
    }
    else if (result.error.code !== 'CANCELLED') notify(result.error.message)
  }

  async function openRecentProject(id: string): Promise<void> {
    if (!window.desktop) {
      if (canvasIsActive && canvasDocument.id === id) setPage('canvas')
      else notify('该最近项目只存在于桌面端数据目录')
      return
    }
    const result = await window.desktop.canvas.loadRecent({ id })
    if (!result.ok) {
      notify(result.error.message)
      await refreshRecentProjects()
      return
    }
    setCanvasDocument(recoverInterruptedGenerationTasks(result.value))
    setCanvasIsActive(true)
    setPage('canvas')
    notify('最近项目已恢复')
    await refreshRecentProjects()
  }

  async function deleteRecentProject(project: RecentCanvasProject): Promise<void> {
    const message = project.location === 'autosave'
      ? `确定删除“${project.name}”吗？自动保存的画布数据会被删除，此操作不可撤销。`
      : `确定删除“${project.name}”吗？Draw Canvas 数据目录中的项目文件会被删除；外部项目文件只会从最近列表移除。`
    if (!window.confirm(message)) return

    if (!window.desktop) {
      if (canvasDocument.id === project.id) {
        localStorage.removeItem('draw-canvas-autosave')
        setCanvasIsActive(false)
      }
      setRecentProjects((current) => current.filter((item) => item.id !== project.id))
      notify('最近项目已删除')
      return
    }

    const result = await window.desktop.canvas.deleteRecent({ id: project.id })
    if (!result.ok) {
      notify(result.error.message)
      return
    }
    if (canvasDocument.id === project.id) setCanvasIsActive(false)
    setRecentProjects(result.value)
    notify('最近项目已删除')
  }

  async function refreshRecentProjects(): Promise<void> {
    if (!window.desktop) return
    const result = await window.desktop.canvas.listRecent()
    if (result.ok) setRecentProjects(result.value)
  }

  function toggleFavorite(id: string): void {
    const next = settings.favoriteImageIds.includes(id)
      ? settings.favoriteImageIds.filter((favoriteId) => favoriteId !== id)
      : [...settings.favoriteImageIds, id]
    void updateSettings({ favoriteImageIds: next })
  }

  async function importLibraryImages(): Promise<void> {
    if (!window.desktop) {
      notify('本地图片导入需要在 Electron 桌面端使用')
      return
    }
    const previousCount = libraryCatalog.length
    const result = await window.desktop.library.importImages()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') notify(result.error.message)
      return
    }
    setLibraryCatalog(result.value)
    notify(`已导入 ${Math.max(0, result.value.length - previousCount)} 张图片`)
    void refreshStorageStats()
  }

  async function removeLibraryImage(id: string): Promise<void> {
    if (!window.desktop) return
    const result = await window.desktop.library.remove({ id })
    if (!result.ok) {
      notify(result.error.message)
      return
    }
    setLibraryCatalog(result.value)
    if (settings.favoriteImageIds.includes(id)) {
      await updateSettings({ favoriteImageIds: settings.favoriteImageIds.filter((item) => item !== id) })
    }
    notify('图片已从本地资源库删除')
    void refreshStorageStats()
  }

  async function removeHistoryArtwork(id: string): Promise<boolean> {
    if (!window.desktop) {
      setGeneratedArtworks((current) => current.filter((artwork) => artwork.id !== id))
      setSettings((current) => ({
        ...current,
        favoriteImageIds: current.favoriteImageIds.filter((favoriteId) => favoriteId !== id),
      }))
      notify('生成记录已删除（浏览器预览）')
      return true
    }
    const result = await window.desktop.history.remove({ id })
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setGeneratedArtworks(result.value)
    setSettings((current) => ({
      ...current,
      favoriteImageIds: current.favoriteImageIds.filter((favoriteId) => favoriteId !== id),
    }))
    notify('生成记录和本地图片已删除')
    void refreshStorageStats()
    return true
  }

  async function removeHistoryVideo(id: string): Promise<boolean> {
    if (!window.desktop) return false
    const result = await window.desktop.history.removeVideo({ id })
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setGeneratedVideos(result.value)
    notify('视频生成记录已删除')
    void refreshStorageStats()
    return true
  }

  async function exportHistoryVideo(id: string): Promise<boolean> {
    if (!window.desktop) {
      notify('视频导出需要在 Electron 桌面端运行')
      return false
    }
    const result = await window.desktop.history.exportVideo({ id })
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') notify(result.error.message)
      return false
    }
    notify('视频已导出')
    return true
  }

  async function removeHistoryAudio(id: string): Promise<boolean> {
    if (!window.desktop) return false
    const result = await window.desktop.history.removeAudio({ id })
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setGeneratedAudios(result.value)
    notify('语音生成记录已删除')
    void refreshStorageStats()
    return true
  }

  async function exportHistoryAudio(id: string): Promise<boolean> {
    if (!window.desktop) {
      notify('语音导出需要在 Electron 桌面端运行')
      return false
    }
    const result = await window.desktop.history.exportAudio({ id })
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') notify(result.error.message)
      return false
    }
    notify('语音已导出')
    return true
  }

  async function exportHistoryBatch(media: 'images' | 'videos' | 'audios', ids: ReadonlyArray<string>): Promise<boolean> {
    if (!window.desktop) {
      notify('批量导出需要在 Electron 桌面端运行')
      return false
    }
    const result = await window.desktop.history.exportBatch({ media, ids })
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') notify(result.error.message)
      return false
    }
    notify(`已导出 ${result.value.exportedCount} 个文件`)
    return true
  }

  async function savePrompt(request: SavePromptRequest): Promise<boolean> {
    if (!window.desktop) {
      const prompt = { ...request, id: request.id ?? crypto.randomUUID() }
      setResourceCatalog((current) => ({
        ...current,
        prompts: [prompt, ...current.prompts.filter((item) => item.id !== prompt.id)],
      }))
      notify('提示词已保存（浏览器预览）')
      return true
    }
    const result = await window.desktop.resources.savePrompt(request)
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setResourceCatalog(result.value)
    notify('提示词已保存')
    void refreshStorageStats()
    return true
  }

  async function deletePrompt(id: string): Promise<boolean> {
    if (!window.desktop) {
      setResourceCatalog((current) => ({ ...current, prompts: current.prompts.filter((item) => item.id !== id) }))
      return true
    }
    const result = await window.desktop.resources.removePrompt({ id })
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setResourceCatalog(result.value)
    notify('提示词已删除')
    void refreshStorageStats()
    return true
  }

  async function saveWorkflow(request: SaveWorkflowRequest): Promise<boolean> {
    if (!window.desktop) {
      const workflow = {
        id: request.id ?? crypto.randomUUID(),
        title: request.title,
        description: request.description,
        accent: request.accent,
        nodes: request.document.nodes.length,
        document: request.document,
      }
      setResourceCatalog((current) => ({
        ...current,
        workflows: [workflow, ...current.workflows.filter((item) => item.id !== workflow.id)],
      }))
      notify('工作流已保存（浏览器预览）')
      return true
    }
    const result = await window.desktop.resources.saveWorkflow(request)
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setResourceCatalog(result.value)
    notify('当前画布已保存为工作流')
    void refreshStorageStats()
    return true
  }

  async function deleteWorkflow(id: string): Promise<boolean> {
    if (!window.desktop) {
      setResourceCatalog((current) => ({ ...current, workflows: current.workflows.filter((item) => item.id !== id) }))
      return true
    }
    const result = await window.desktop.resources.removeWorkflow({ id })
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setResourceCatalog(result.value)
    notify('工作流已删除')
    void refreshStorageStats()
    return true
  }

  function runWorkflow(id: string): void {
    const workflow = resourceCatalog.workflows.find((item) => item.id === id)
    if (!workflow?.document) {
      notify('工作流没有可恢复的画布数据')
      return
    }
    const recoveredDocument = recoverInterruptedGenerationTasks(workflow.document)
    setCanvasDocument({
      ...recoveredDocument,
      id: crypto.randomUUID(),
      name: workflow.title,
      nodes: recoveredDocument.nodes.map((node) => ({ ...node })),
      connections: recoveredDocument.connections.map((connection) => ({ ...connection })),
      viewport: { ...recoveredDocument.viewport },
      updatedAt: new Date().toISOString(),
    })
    setCanvasIsActive(true)
    setPage('canvas')
    notify(`工作流“${workflow.title}”已恢复到新画布`)
  }

  async function refreshStorageStats(): Promise<void> {
    if (!window.desktop) return
    const result = await window.desktop.storage.stats()
    if (result.ok) setStats(result.value)
  }

  const generateCanvasImage = useCallback(async (request: GenerateImageRequest): Promise<CanvasImageGenerationOutcome> => {
    if (!window.desktop) {
      return { ok: false, error: '真实图片生成需要在 Electron 桌面端运行' }
    }
    const result = await window.desktop.generation.generateImage(request)
    if (!result.ok) {
      return { ok: false, error: result.error.message }
    }
    setGeneratedArtworks((current) => [
      result.value.artwork,
      ...current.filter((item) => item.id !== result.value.artwork.id),
    ])
    void window.desktop.storage.stats().then((statsResult) => {
      if (statsResult.ok) setStats(statsResult.value)
    })
    return { ok: true, value: result.value }
  }, [])

  const generateCanvasVideo = useCallback(async (request: GenerateVideoRequest): Promise<CanvasVideoGenerationOutcome> => {
    if (!window.desktop) {
      return { ok: false, error: '真实视频生成需要在 Electron 桌面端运行' }
    }
    const result = await window.desktop.generation.generateVideo(request)
    if (!result.ok) return { ok: false, error: result.error.message }
    setGeneratedVideos((current) => [
      result.value.video,
      ...current.filter((video) => video.id !== result.value.video.id),
    ])
    void window.desktop.storage.stats().then((statsResult) => {
      if (statsResult.ok) setStats(statsResult.value)
    })
    return { ok: true, value: result.value }
  }, [])

  const generateCanvasAudio = useCallback(async (request: GenerateAudioRequest): Promise<CanvasAudioGenerationOutcome> => {
    if (!window.desktop) return { ok: false, error: '真实语音生成需要在 Electron 桌面端运行' }
    const result = await window.desktop.generation.generateAudio(request)
    if (!result.ok) return { ok: false, error: result.error.message }
    setGeneratedAudios((current) => [
      result.value.audio,
      ...current.filter((audio) => audio.id !== result.value.audio.id),
    ])
    void window.desktop.storage.stats().then((statsResult) => {
      if (statsResult.ok) setStats(statsResult.value)
    })
    return { ok: true, value: result.value }
  }, [])

  const optimizeCanvasPrompt = useCallback(async (request: OptimizePromptRequest): Promise<CanvasPromptOptimizationOutcome> => {
    if (!window.desktop) {
      return { ok: false, error: '提示词优化需要在 Electron 桌面端运行' }
    }
    const result = await window.desktop.generation.optimizePrompt(request)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  }, [])

  const generateCanvasChatReply = useCallback(async (request: GenerateChatReplyRequest): Promise<CanvasChatGenerationOutcome> => {
    if (!window.desktop) return { ok: false, error: 'AI 对话需要在 Electron 桌面端运行' }
    const result = await window.desktop.generation.generateChatReply(request)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  }, [])

  const generateCanvasStoryboard = useCallback(async (request: GenerateStoryboardRequest): Promise<CanvasStoryboardGenerationOutcome> => {
    if (!window.desktop) return { ok: false, error: '分镜生成需要在 Electron 桌面端运行' }
    const result = await window.desktop.generation.generateStoryboard(request)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  }, [])

  const importCanvasReferenceImages = useCallback(async (): Promise<ReadonlyArray<GeneratedArtwork>> => {
    if (!window.desktop) {
      notify('本地参考图导入需要在 Electron 桌面端运行')
      return []
    }
    const previousIds = new Set(libraryCatalog.map((artwork) => artwork.id))
    const result = await window.desktop.library.importImages()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') notify(result.error.message)
      return []
    }
    const imported = result.value.filter((artwork) => !previousIds.has(artwork.id))
    setLibraryCatalog(result.value)
    if (imported.length > 0) notify(`已向画布导入 ${imported.length} 张本地参考图`)
    void refreshStorageStats()
    return imported
  }, [libraryCatalog, notify])

  const importDroppedCanvasReferenceImages = useCallback(async (
    files: ReadonlyArray<File>,
  ): Promise<ReadonlyArray<GeneratedArtwork>> => {
    if (!window.desktop) {
      notify('拖入本地参考图需要在 Electron 桌面端运行')
      return []
    }
    const previousIds = new Set(libraryCatalog.map((artwork) => artwork.id))
    const result = await window.desktop.library.importDroppedImages(files)
    if (!result.ok) {
      notify(result.error.message)
      return []
    }
    const imported = result.value.filter((artwork) => !previousIds.has(artwork.id))
    setLibraryCatalog(result.value)
    if (imported.length > 0) notify(`已拖入 ${imported.length} 张本地参考图`)
    void refreshStorageStats()
    return imported
  }, [libraryCatalog, notify])

  const loadGeneratedImage = useCallback(async (fileName: string): Promise<string | null> => {
    if (!window.desktop) return null
    const result = await window.desktop.generation.loadImage({ fileName })
    return result.ok ? result.value.dataUrl : null
  }, [])

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
      await refreshRecentProjects()
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
        return <HomePage onDeleteRecentProject={(project) => void deleteRecentProject(project)} onNewCanvas={() => void newCanvas()} onOpenFile={() => void openCanvasFile()} onOpenRecentProject={(id) => void openRecentProject(id)} recentProjects={recentProjects} />
      case 'history':
        return <HistoryPage artworks={generatedArtworks} audios={generatedAudios} loadImage={loadGeneratedImage} notify={notify} onExportAudio={exportHistoryAudio} onExportBatch={exportHistoryBatch} onExportVideo={exportHistoryVideo} onNewCanvas={() => void newCanvas()} onRemove={removeHistoryArtwork} onRemoveAudio={removeHistoryAudio} onRemoveVideo={removeHistoryVideo} videos={generatedVideos} />
      case 'gallery':
        return <GalleryPage artworks={libraryArtworks} favoriteIds={settings.favoriteImageIds} importedImageIds={libraryCatalog.map((artwork) => artwork.id)} loadImage={loadGeneratedImage} onFavorite={toggleFavorite} onImport={() => void importLibraryImages()} onRemove={(id) => void removeLibraryImage(id)} />
      case 'resources':
        return <ResourcesPage currentCanvas={canvasIsActive ? canvasDocument : null} notify={notify} onDeletePrompt={deletePrompt} onDeleteWorkflow={deleteWorkflow} onRunWorkflow={runWorkflow} onSavePrompt={savePrompt} onSaveWorkflow={saveWorkflow} onUsePrompt={(prompt) => void newCanvas(prompt)} prompts={resourceCatalog.prompts} workflows={resourceCatalog.workflows} />
      case 'models':
        return <ModelSettingsPage defaultModelKeys={settings.defaultModelKeys} enabledModelKeys={settings.enabledModelKeys} onClearProviderApiKey={clearProviderApiKey} onModelConfigChange={(enabledModelKeys, defaultModelKeys) => void updateSettings({ enabledModelKeys, defaultModelKeys })} onSaveProvider={saveProvider} onSetProviderEnabled={setProviderEnabled} onTestProvider={testProvider} providers={settings.providers} />
      case 'settings':
        return <SystemSettingsPage changingDirectory={storageChanging} onAccentChange={(color) => void updateSettings({ accentColor: color })} onChooseDirectory={() => void chooseStorageDirectory()} onOpenDirectory={() => void openStorageDirectory()} onThemeChange={(theme: ThemeMode) => void updateSettings({ theme })} settings={settings} stats={stats} />
      case 'canvas':
        return <InfiniteCanvas audioModels={audioModels} chatModels={chatModels} defaultAudioModelKey={settings.defaultModelKeys.audio ?? audioModels[0]?.key ?? ''} defaultChatModelKey={settings.defaultModelKeys.chat ?? chatModels[0]?.key ?? ''} defaultImageModelKey={settings.defaultModelKeys.image ?? DEFAULT_IMAGE_MODEL_KEY} defaultVideoModelKey={settings.defaultModelKeys.video ?? videoModels[0]?.key ?? ''} document={canvasDocument} imageModels={imageModels} notify={notify} onChange={(nextDocument) => setCanvasDocument((currentDocument) => currentDocument.id === nextDocument.id ? nextDocument : currentDocument)} onClose={() => setPage('home')} onGenerateAudio={generateCanvasAudio} onGenerateChatReply={generateCanvasChatReply} onGenerateImage={generateCanvasImage} onGenerateStoryboard={generateCanvasStoryboard} onGenerateVideo={generateCanvasVideo} onImportDroppedImages={importDroppedCanvasReferenceImages} onImportImages={importCanvasReferenceImages} onLoadImage={loadGeneratedImage} onOpen={() => void openCanvasFile()} onOptimizePrompt={optimizeCanvasPrompt} onSave={() => void saveCanvasFile()} videoModels={videoModels} />
    }
  }

  return (
    <div className={`app-root theme-${effectiveTheme}`} style={rootStyle}>
      <AppShell activePage={page} generationHistoryCount={generatedArtworks.length + generatedVideos.length + generatedAudios.length} onNavigate={setPage} onNewCanvas={() => void newCanvas()}>{renderPage()}</AppShell>
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

function upsertRecentProject(
  projects: ReadonlyArray<RecentCanvasProject>,
  project: RecentCanvasProject,
): ReadonlyArray<RecentCanvasProject> {
  const existing = projects.find((item) => item.id === project.id)
  const mergedProject = existing && Date.parse(existing.updatedAt) > Date.parse(project.updatedAt)
    ? { ...project, updatedAt: existing.updatedAt }
    : project
  return [mergedProject, ...projects.filter((item) => item.id !== project.id)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 50)
}

function nextUntitledCanvasName(
  projects: ReadonlyArray<RecentCanvasProject>,
  currentCanvasName?: string,
): string {
  const names = new Set(projects.map((project) => project.name.trim()))
  if (currentCanvasName?.trim()) names.add(currentCanvasName.trim())
  if (!names.has('未命名画布')) return '未命名画布'
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = `未命名画布 ${index}`
    if (!names.has(candidate)) return candidate
  }
  return `未命名画布 ${Date.now()}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
