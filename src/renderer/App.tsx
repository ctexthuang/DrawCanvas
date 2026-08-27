import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type {
  AddProviderModelRequest,
  AppSettings,
  AppUpdateCheck,
  CanvasDocument,
  CreateProviderRequest,
  GenerateAudioRequest,
  GenerateChatReplyRequest,
  GenerateImageRequest,
  GenerateStoryboardRequest,
  GenerateVideoRequest,
  GeneratedArtwork,
  GeneratedAudioAsset,
  GeneratedVideoAsset,
  OptimizePromptRequest,
  ProviderConnectionTestResult,
  RecentCanvasProject,
  ResourceCatalog,
  SavePromptRequest,
  SaveWorkflowRequest,
  StorageStats,
  ThemeMode,
  UpdateProviderModelRequest,
  UpdateProviderRequest,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import {
  createRecentCanvasProject,
  recoverInterruptedGenerationTasks,
} from '../shared/domain/canvas-document'
import {
  createProviderModelKey,
  primaryModelKey,
  type ModelKind,
  type ModelRoutes,
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
import { UpdateDialog } from './features/settings/UpdateDialog'
import { artworks as seedArtworks, prompts as seedPrompts, workflows as seedWorkflows } from './domain/catalog'

const fallbackSettings: AppSettings = {
  theme: 'light',
  accentColor: '#ff5f77',
  storageDirectory: 'Draw Canvas Data',
  favoriteImageIds: [],
  models: [],
  modelRoutes: {},
  providers: [],
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
  const [updateCheck, setUpdateCheck] = useState<AppUpdateCheck | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const rootStyle = useMemo(() => ({ '--accent': settings.accentColor } as CSSProperties), [settings.accentColor])
  const effectiveTheme = settings.theme === 'system' ? systemTheme : settings.theme
  const libraryArtworks = useMemo(
    () => [...generatedArtworks, ...libraryCatalog.filter((artwork) => !generatedArtworks.some((generated) => generated.id === artwork.id))],
    [generatedArtworks, libraryCatalog],
  )
  const imageModels = useMemo(() => settings.models
    .filter((model) => model.kind === 'image' && model.enabled && model.available)
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])
  const videoModels = useMemo(() => settings.models
    .filter((model) => model.kind === 'video' && model.enabled && model.available)
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])
  const chatModels = useMemo(() => settings.models
    .filter((model) => model.kind === 'chat' && model.enabled && model.available)
    .filter((model) => settings.providers.some((provider) => provider.id === model.providerId && provider.enabled))
    .map((model) => ({ key: model.key, label: model.displayName })), [settings])
  const audioModels = useMemo(() => settings.models
    .filter((model) => model.kind === 'audio' && model.enabled && model.available)
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
    let cancelled = false
    async function checkOnStartup(): Promise<void> {
      if (!window.desktop) return
      let result = await window.desktop.updates.check({ force: false })
      if (
        !result.ok &&
        (result.error.code === 'UPDATE_NETWORK' || result.error.code === 'UPDATE_TIMEOUT')
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500))
        if (cancelled) return
        result = await window.desktop.updates.check({ force: true })
      }
      if (cancelled) return
      if (!result.ok) {
        setUpdateError(result.error.message)
        return
      }
      setUpdateError(null)
      setUpdateCheck(result.value)
      if (result.value.status === 'available') setUpdateDialogOpen(true)
    }
    void checkOnStartup()
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

    const defaultImageModelKey = primaryModelKey(settings.modelRoutes, 'image') ?? ''
    const defaultImageModelName = settings.models.find(
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

  async function createProvider(request: CreateProviderRequest): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        providers: [...current.providers, {
          id: crypto.randomUUID(),
          name: request.name,
          adapterId: request.adapterId,
          baseUrl: request.baseUrl,
          enabled: true,
          hasApiKey: Boolean(request.apiKey),
          connectionStatus: 'untested',
          modelCount: 0,
        }],
      }))
      notify('API 服务已新增（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.createProvider(request)
    if (!result.ok) {
      notify(result.error.message)
      return false
    }
    setSettings(result.value)
    notify('API 服务已新增')
    return true
  }

  async function updateProvider(request: UpdateProviderRequest): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((provider) => provider.id === request.id
          ? { ...provider, name: request.name, adapterId: request.adapterId, baseUrl: request.baseUrl, hasApiKey: Boolean(request.apiKey || provider.hasApiKey), connectionStatus: 'untested' }
          : provider),
      }))
      notify('API 服务已修改（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.updateProvider(request)
    if (!result.ok) { notify(result.error.message); return false }
    setSettings(result.value)
    notify('API 服务已修改')
    return true
  }

  async function removeProvider(id: string): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => {
        const removedKeys = new Set(current.models.filter((model) => model.providerId === id).map((model) => model.key))
        return {
          ...current,
          providers: current.providers.filter((provider) => provider.id !== id),
          models: current.models.filter((model) => model.providerId !== id),
          modelRoutes: removeModelKeysFromRoutes(current.modelRoutes, removedKeys),
        }
      })
      notify('API 服务已删除（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.removeProvider({ id })
    if (!result.ok) { notify(result.error.message); return false }
    setSettings(result.value)
    notify('API 服务及其模型已删除')
    return true
  }

  async function testProvider(id: string): Promise<ProviderConnectionTestResult | null> {
    if (!window.desktop) {
      const provider = settings.providers.find((item) => item.id === id)
      if (!provider) return null
      const result: ProviderConnectionTestResult = {
        connected: false,
        provider: { ...provider, connectionStatus: 'failed' },
        error: { code: 'NETWORK', message: '连接测试需要在 Electron 桌面端运行' },
      }
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((item) => item.id === id ? result.provider : item),
      }))
      notify(result.error.message)
      return result
    }
    const response = await window.desktop.models.testProvider({ id })
    if (!response.ok) {
      notify(response.error.message)
      return null
    }
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === id ? response.value.provider : provider),
    }))
    notify(response.value.connected ? response.value.message : response.value.error.message)
    return response.value
  }

  async function discoverProviderModels(id: string): Promise<boolean> {
    if (!window.desktop) { notify('获取模型需要在 Electron 桌面端运行'); return false }
    const response = await window.desktop.models.discoverProviderModels({ id })
    if (!response.ok) { notify(response.error.message); return false }
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === id ? response.value.provider : provider),
      models: [...current.models.filter((model) => model.providerId !== id), ...response.value.models],
    }))
    notify(response.value.message)
    return true
  }

  async function clearProviderApiKey(id: string): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        providers: current.providers.map((provider) => provider.id === id
          ? { ...provider, hasApiKey: false, connectionStatus: 'untested' }
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

  async function addModel(request: AddProviderModelRequest): Promise<boolean> {
    if (!window.desktop) {
      const key = createProviderModelKey(request.providerId, request.remoteModelId)
      setSettings((current) => current.models.some((model) => model.key === key) ? current : ({
        ...current,
        models: [...current.models, { ...request, key, description: '手动添加的模型', source: 'manual', enabled: true, available: true }],
        providers: current.providers.map((provider) => provider.id === request.providerId ? { ...provider, modelCount: provider.modelCount + 1 } : provider),
      }))
      notify('模型已添加（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.addModel(request)
    if (!result.ok) { notify(result.error.message); return false }
    setSettings(result.value)
    notify('模型已添加')
    return true
  }

  async function updateModel(request: UpdateProviderModelRequest): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({ ...current, models: current.models.map((model) => model.key === request.key ? { ...model, displayName: request.displayName, kind: request.kind } : model) }))
      notify('模型已修改（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.updateModel(request)
    if (!result.ok) { notify(result.error.message); return false }
    setSettings(result.value)
    notify('模型已修改')
    return true
  }

  async function removeModel(key: string): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => {
        const model = current.models.find((item) => item.key === key)
        return {
          ...current,
          models: current.models.filter((item) => item.key !== key),
          modelRoutes: removeModelKeysFromRoutes(current.modelRoutes, new Set([key])),
          providers: current.providers.map((provider) => provider.id === model?.providerId ? { ...provider, modelCount: Math.max(0, provider.modelCount - 1) } : provider),
        }
      })
      notify('模型已删除（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.removeModel({ key })
    if (!result.ok) { notify(result.error.message); return false }
    setSettings(result.value)
    notify('模型已删除')
    return true
  }

  async function setModelEnabled(key: string, enabled: boolean): Promise<boolean> {
    if (!window.desktop) {
      setSettings((current) => ({
        ...current,
        models: current.models.map((model) => model.key === key ? { ...model, enabled } : model),
        modelRoutes: enabled ? current.modelRoutes : removeModelKeysFromRoutes(current.modelRoutes, new Set([key])),
      }))
      notify(enabled ? '模型已启用（浏览器预览）' : '模型已停用（浏览器预览）')
      return true
    }
    const result = await window.desktop.models.setModelEnabled({ key, enabled })
    if (!result.ok) { notify(result.error.message); return false }
    setSettings(result.value)
    notify(enabled ? '模型已启用' : '模型已停用')
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

  async function checkForUpdates(): Promise<void> {
    if (!window.desktop) {
      notify('请在 Electron 桌面端检查更新')
      return
    }
    setUpdateChecking(true)
    setUpdateError(null)
    try {
      const result = await window.desktop.updates.check({ force: true })
      if (!result.ok) {
        setUpdateError(result.error.message)
        notify(result.error.message)
        return
      }
      setUpdateCheck(result.value)
      if (result.value.status === 'available') {
        setUpdateDialogOpen(true)
      } else if (result.value.status === 'up-to-date') {
        notify(`当前 v${result.value.currentVersion} 已是最新版本`)
      } else {
        notify('GitHub 暂无正式 Release')
      }
    } finally {
      setUpdateChecking(false)
    }
  }

  async function openLatestRelease(): Promise<void> {
    if (!window.desktop) {
      notify('请在 Electron 桌面端打开 GitHub Release')
      return
    }
    const result = await window.desktop.updates.openLatestRelease()
    if (!result.ok) {
      notify(result.error.message)
      return
    }
    setUpdateDialogOpen(false)
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
        return <ModelSettingsPage onAddModel={addModel} onClearProviderApiKey={clearProviderApiKey} onCreateProvider={createProvider} onDiscoverProviderModels={discoverProviderModels} onModelRoutesChange={(modelRoutes) => void updateSettings({ modelRoutes })} onRemoveModel={removeModel} onRemoveProvider={removeProvider} onSetModelEnabled={setModelEnabled} onSetProviderEnabled={setProviderEnabled} onTestProvider={testProvider} onUpdateModel={updateModel} onUpdateProvider={updateProvider} settings={settings}/>
      case 'settings':
        return <SystemSettingsPage changingDirectory={storageChanging} onAccentChange={(color) => void updateSettings({ accentColor: color })} onCheckForUpdates={() => void checkForUpdates()} onChooseDirectory={() => void chooseStorageDirectory()} onOpenDirectory={() => void openStorageDirectory()} onOpenLatestRelease={() => void openLatestRelease()} onThemeChange={(theme: ThemeMode) => void updateSettings({ theme })} settings={settings} stats={stats} updateCheck={updateCheck} updateChecking={updateChecking} updateError={updateError} />
      case 'canvas':
        return <InfiniteCanvas audioModels={audioModels} chatModels={chatModels} defaultAudioModelKey={primaryModelKey(settings.modelRoutes, 'audio') ?? ''} defaultChatModelKey={primaryModelKey(settings.modelRoutes, 'chat') ?? ''} defaultImageModelKey={primaryModelKey(settings.modelRoutes, 'image') ?? ''} defaultVideoModelKey={primaryModelKey(settings.modelRoutes, 'video') ?? ''} document={canvasDocument} imageModels={imageModels} notify={notify} onChange={(nextDocument) => setCanvasDocument((currentDocument) => currentDocument.id === nextDocument.id ? nextDocument : currentDocument)} onClose={() => setPage('home')} onGenerateAudio={generateCanvasAudio} onGenerateChatReply={generateCanvasChatReply} onGenerateImage={generateCanvasImage} onGenerateStoryboard={generateCanvasStoryboard} onGenerateVideo={generateCanvasVideo} onImportDroppedImages={importDroppedCanvasReferenceImages} onImportImages={importCanvasReferenceImages} onLoadImage={loadGeneratedImage} onOpen={() => void openCanvasFile()} onOptimizePrompt={optimizeCanvasPrompt} onSave={() => void saveCanvasFile()} videoModels={videoModels} />
    }
  }

  return (
    <div className={`app-root theme-${effectiveTheme}`} style={rootStyle}>
      <AppShell activePage={page} generationHistoryCount={generatedArtworks.length + generatedVideos.length + generatedAudios.length} onNavigate={setPage} onNewCanvas={() => void newCanvas()}>{renderPage()}</AppShell>
      {updateDialogOpen && updateCheck?.status === 'available' && (
        <UpdateDialog onClose={() => setUpdateDialogOpen(false)} onOpenRelease={() => void openLatestRelease()} update={updateCheck}/>
      )}
      {toast && <div className="toast" role="status"><span />{toast}</div>}
    </div>
  )
}

function removeModelKeysFromRoutes(routes: ModelRoutes, removedKeys: ReadonlySet<string>): ModelRoutes {
  return Object.fromEntries(
    (['image', 'video', 'chat', 'audio'] as const).flatMap((kind: ModelKind) => {
      const modelKeys = routes[kind]?.modelKeys.filter((key) => !removedKeys.has(key)) ?? []
      return modelKeys.length ? [[kind, { modelKeys }]] : []
    }),
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
