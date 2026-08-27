import type {
  ConfiguredProviderModel,
  ImageGenerationSize,
  ModelKind,
  ModelRoutes,
  ProviderAdapterId,
} from '../domain/models'

export type { ImageGenerationSize } from '../domain/models'

export type ThemeMode = 'light' | 'dark' | 'system'

export type DesktopErrorCode =
  | 'CANCELLED'
  | 'INVALID_INPUT'
  | 'INVALID_FILE'
  | 'NOT_FOUND'
  | 'IO_ERROR'
  | 'STORAGE_CONFLICT'
  | 'UNAUTHORIZED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_DNS'
  | 'PROVIDER_CONNECTION_REFUSED'
  | 'PROVIDER_CONNECTION_CLOSED'
  | 'PROVIDER_TLS'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_REMOTE'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'UPDATE_NETWORK'
  | 'UPDATE_TIMEOUT'
  | 'UPDATE_RATE_LIMIT'
  | 'UPDATE_REMOTE'
  | 'UPDATE_INVALID_RESPONSE'
  | 'UNSUPPORTED_PROVIDER'

export type DesktopError = Readonly<{
  code: DesktopErrorCode
  message: string
}>

export type DesktopResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: DesktopError }>

export type ProviderConnectionStatus = 'untested' | 'connected' | 'failed'

export type ProviderConfig = Readonly<{
  id: string
  name: string
  adapterId: ProviderAdapterId
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  connectionStatus: ProviderConnectionStatus
  lastTestedAt?: string
  lastSyncedAt?: string
  modelCount: number
}>

export type AppSettings = Readonly<{
  theme: ThemeMode
  accentColor: string
  storageDirectory: string
  favoriteImageIds: ReadonlyArray<string>
  models: ReadonlyArray<ConfiguredProviderModel>
  modelRoutes: ModelRoutes
  providers: ReadonlyArray<ProviderConfig>
}>

export type UpdateSettingsRequest = Readonly<{
  theme?: ThemeMode
  accentColor?: string
  favoriteImageIds?: ReadonlyArray<string>
  modelRoutes?: ModelRoutes
}>

export type CheckForUpdatesRequest = Readonly<{
  force: boolean
}>

type AppUpdateRelease = Readonly<{
  currentVersion: string
  latestVersion: string
  latestTag: string
  releaseName: string
  publishedAt?: string
  checkedAt: string
}>

export type AppUpdateCheck =
  | Readonly<AppUpdateRelease & { status: 'available' }>
  | Readonly<AppUpdateRelease & { status: 'up-to-date' }>
  | Readonly<{
      status: 'not-published'
      currentVersion: string
      checkedAt: string
    }>

export type CreateProviderRequest = Readonly<{
  name: string
  adapterId: ProviderAdapterId
  baseUrl: string
  apiKey?: string
}>

export type UpdateProviderRequest = Readonly<{
  id: string
  name: string
  adapterId: ProviderAdapterId
  baseUrl: string
  apiKey?: string
}>

export type TestProviderRequest = Readonly<{
  id: string
}>

export type DiscoverProviderModelsRequest = Readonly<{ id: string }>
export type RemoveProviderRequest = Readonly<{ id: string }>

export type ClearProviderApiKeyRequest = Readonly<{
  id: string
}>

export type SetProviderEnabledRequest = Readonly<{
  id: string
  enabled: boolean
}>

export type ProviderTestErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export type ProviderConnectionTestResult =
  | Readonly<{
      connected: true
      provider: ProviderConfig
      latencyMs: number
      message: string
    }>
  | Readonly<{
      connected: false
      provider: ProviderConfig
      latencyMs?: number
      error: Readonly<{
        code: ProviderTestErrorCode
        message: string
      }>
    }>

export type ProviderModelDiscoveryResult = Readonly<{
  provider: ProviderConfig
  models: ReadonlyArray<ConfiguredProviderModel>
  discoveredCount: number
  message: string
}>

export type AddProviderModelRequest = Readonly<{
  providerId: string
  remoteModelId: string
  displayName: string
  kind: ModelKind
}>

export type UpdateProviderModelRequest = Readonly<{
  key: string
  displayName: string
  kind: ModelKind
}>

export type SetProviderModelEnabledRequest = Readonly<{
  key: string
  enabled: boolean
}>

export type RemoveProviderModelRequest = Readonly<{ key: string }>

export type CanvasNodeType = 'prompt' | 'storyboard' | 'shot-list' | 'generator' | 'compositor' | 'image' | 'reference-folder' | 'note' | 'chat' | 'video' | 'audio'
export type CanvasGenerationStatus = 'queued' | 'generating' | 'succeeded' | 'failed'
export type CanvasWorkflowStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'skipped'
export type ImageGenerationCount = 1 | 2 | 3 | 4
export type VideoGenerationResolution = '720P' | '768P' | '1080P' | '2K'
export type VideoGenerationRatio = '16:9' | '9:16' | '1:1' | 'adaptive'

export type CanvasChatMessage = Readonly<{
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}>

export type StoryboardShot = Readonly<{
  id: string
  index: number
  title: string
  prompt: string
  durationSeconds: number
}>

export type CanvasNodeData = Readonly<{
  id: string
  type: CanvasNodeType
  title: string
  subtitle?: string
  x: number
  y: number
  width?: number
  height?: number
  color?: string
  modelKey?: string
  imageSize?: ImageGenerationSize
  generationCount?: ImageGenerationCount
  generationStatus?: CanvasGenerationStatus
  generationStartedAt?: string
  generationCompletedAt?: string
  generationError?: string
  generationBatchId?: string
  generationBatchIndex?: number
  imageFileName?: string
  imageFileNames?: ReadonlyArray<string>
  collapsed?: boolean
  workflowStatus?: CanvasWorkflowStatus
  workflowError?: string
  chatMessages?: ReadonlyArray<CanvasChatMessage>
  storyboardShotCount?: number
  storyboardShots?: ReadonlyArray<StoryboardShot>
  videoFileName?: string
  videoPromptId?: string
  videoDuration?: number
  videoResolution?: VideoGenerationResolution
  videoRatio?: VideoGenerationRatio
  audioFileName?: string
  audioVoiceId?: string
  audioSpeed?: number
  audioPitch?: number
  audioEmotion?: string
}>

export type CanvasConnection = Readonly<{
  id: string
  from: string
  to: string
}>

export type CanvasViewport = Readonly<{
  x: number
  y: number
  zoom: number
}>

export type CanvasDocument = Readonly<{
  version: 1
  id: string
  name: string
  nodes: ReadonlyArray<CanvasNodeData>
  connections: ReadonlyArray<CanvasConnection>
  viewport: CanvasViewport
  updatedAt: string
}>

export type RecentCanvasProject = Readonly<{
  id: string
  name: string
  updatedAt: string
  nodeCount: number
  colors: ReadonlyArray<string>
  location: 'autosave' | 'file'
}>

export type LoadRecentCanvasProjectRequest = Readonly<{
  id: string
}>

export type DeleteRecentCanvasProjectRequest = Readonly<{
  id: string
}>

export type StorageCategory =
  | 'projects'
  | 'history'
  | 'library'
  | 'resources'
  | 'settings'
  | 'database'
  | 'cache'
  | 'other'

export type StorageCategoryStats = Readonly<{
  bytes: number
  fileCount: number
}>

export type StorageStats = Readonly<{
  totalBytes: number
  totalFileCount: number
  categories: Readonly<Record<StorageCategory, StorageCategoryStats>>
}>

export type StorageMigrationResult = Readonly<{
  settings: AppSettings
  stats: StorageStats
  sourceDirectory: string
  targetDirectory: string
  migratedBytes: number
  migratedFileCount: number
  sourceCleanupPending: boolean
}>

export type GeneratedArtwork = Readonly<{
  id: string
  title: string
  prompt: string
  model: string
  size: string
  createdAt: string
  palette: string
  tags: ReadonlyArray<string>
  modelKey?: string
  imageFileName?: string
}>

export type GenerateImageRequest = Readonly<{
  prompt: string
  modelKey?: string
  size: ImageGenerationSize
  referenceImageFileNames?: ReadonlyArray<string>
}>

export type OptimizePromptRequest = Readonly<{
  prompt: string
  modelKey?: string
}>

export type OptimizedPromptResult = Readonly<{
  prompt: string
  modelKey: string
  modelName: string
}>

export type GenerateChatReplyRequest = Readonly<{
  messages: ReadonlyArray<Pick<CanvasChatMessage, 'role' | 'content'>>
  modelKey?: string
}>

export type GeneratedChatReply = Readonly<{
  content: string
  modelKey: string
  modelName: string
}>

export type GenerateStoryboardRequest = Readonly<{
  theme: string
  shotCount: number
  modelKey?: string
}>

export type GeneratedStoryboard = Readonly<{
  shots: ReadonlyArray<StoryboardShot>
  modelKey: string
  modelName: string
}>

export type GeneratedImageResult = Readonly<{
  artwork: GeneratedArtwork
}>

export type LoadGeneratedImageRequest = Readonly<{
  fileName: string
}>

export type LoadedGeneratedImage = Readonly<{
  dataUrl: string
}>

export type GeneratedVideoAsset = Readonly<{
  id: string
  title: string
  prompt: string
  model: string
  modelKey: string
  duration: number
  resolution: VideoGenerationResolution
  ratio: VideoGenerationRatio
  createdAt: string
  videoFileName: string
  referenceImageFileNames: ReadonlyArray<string>
}>

export type GenerateVideoRequest = Readonly<{
  prompt: string
  modelKey?: string
  duration: number
  resolution: VideoGenerationResolution
  ratio: VideoGenerationRatio
  referenceImageFileNames?: ReadonlyArray<string>
}>

export type GeneratedVideoResult = Readonly<{
  video: GeneratedVideoAsset
}>

export type GeneratedAudioAsset = Readonly<{
  id: string
  title: string
  text: string
  model: string
  modelKey: string
  voiceId: string
  speed: number
  pitch: number
  emotion: string
  durationMs: number
  createdAt: string
  audioFileName: string
}>

export type GenerateAudioRequest = Readonly<{
  text: string
  modelKey?: string
  voiceId: string
  speed: number
  pitch: number
  emotion: string
}>

export type GeneratedAudioResult = Readonly<{
  audio: GeneratedAudioAsset
}>

export type RemoveLibraryImageRequest = Readonly<{
  id: string
}>

export type ImportDroppedImagesRequest = Readonly<{
  paths: ReadonlyArray<string>
}>

export type RemoveHistoryArtworkRequest = Readonly<{
  id: string
}>

export type RemoveGeneratedVideoRequest = Readonly<{
  id: string
}>

export type ExportGeneratedVideoRequest = Readonly<{
  id: string
}>

export type RemoveGeneratedAudioRequest = Readonly<{
  id: string
}>

export type ExportGeneratedAudioRequest = Readonly<{
  id: string
}>

export type ExportHistoryBatchRequest = Readonly<{
  media: 'images' | 'videos' | 'audios'
  ids: ReadonlyArray<string>
}>

export type ExportHistoryBatchResult = Readonly<{
  exportedCount: number
  directory: string
}>

export type PromptAsset = Readonly<{
  id: string
  title: string
  category: string
  body: string
}>

export type SavePromptRequest = Readonly<{
  id?: string
  title: string
  category: string
  body: string
}>

export type WorkflowAsset = Readonly<{
  id: string
  title: string
  description: string
  nodes: number
  accent: string
  document?: CanvasDocument
}>

export type SaveWorkflowRequest = Readonly<{
  id?: string
  title: string
  description: string
  accent: string
  document: CanvasDocument
}>

export type RemoveResourceRequest = Readonly<{
  id: string
}>

export type ResourceCatalog = Readonly<{
  prompts: ReadonlyArray<PromptAsset>
  workflows: ReadonlyArray<WorkflowAsset>
}>

export type DesktopApi = Readonly<{
  settings: Readonly<{
    load: () => Promise<DesktopResult<AppSettings>>
    update: (request: UpdateSettingsRequest) => Promise<DesktopResult<AppSettings>>
  }>
  updates: Readonly<{
    check: (request: CheckForUpdatesRequest) => Promise<DesktopResult<AppUpdateCheck>>
    openLatestRelease: () => Promise<DesktopResult<null>>
  }>
  models: Readonly<{
    createProvider: (request: CreateProviderRequest) => Promise<DesktopResult<AppSettings>>
    updateProvider: (request: UpdateProviderRequest) => Promise<DesktopResult<AppSettings>>
    removeProvider: (request: RemoveProviderRequest) => Promise<DesktopResult<AppSettings>>
    testProvider: (request: TestProviderRequest) => Promise<DesktopResult<ProviderConnectionTestResult>>
    discoverProviderModels: (
      request: DiscoverProviderModelsRequest,
    ) => Promise<DesktopResult<ProviderModelDiscoveryResult>>
    clearApiKey: (request: ClearProviderApiKeyRequest) => Promise<DesktopResult<ProviderConfig>>
    setProviderEnabled: (request: SetProviderEnabledRequest) => Promise<DesktopResult<ProviderConfig>>
    addModel: (request: AddProviderModelRequest) => Promise<DesktopResult<AppSettings>>
    updateModel: (request: UpdateProviderModelRequest) => Promise<DesktopResult<AppSettings>>
    removeModel: (request: RemoveProviderModelRequest) => Promise<DesktopResult<AppSettings>>
    setModelEnabled: (request: SetProviderModelEnabledRequest) => Promise<DesktopResult<AppSettings>>
  }>
  history: Readonly<{
    load: () => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
    loadVideos: () => Promise<DesktopResult<ReadonlyArray<GeneratedVideoAsset>>>
    loadAudios: () => Promise<DesktopResult<ReadonlyArray<GeneratedAudioAsset>>>
    record: (artwork: GeneratedArtwork) => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
    remove: (request: RemoveHistoryArtworkRequest) => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
    removeVideo: (request: RemoveGeneratedVideoRequest) => Promise<DesktopResult<ReadonlyArray<GeneratedVideoAsset>>>
    exportVideo: (request: ExportGeneratedVideoRequest) => Promise<DesktopResult<null>>
    removeAudio: (request: RemoveGeneratedAudioRequest) => Promise<DesktopResult<ReadonlyArray<GeneratedAudioAsset>>>
    exportAudio: (request: ExportGeneratedAudioRequest) => Promise<DesktopResult<null>>
    exportBatch: (request: ExportHistoryBatchRequest) => Promise<DesktopResult<ExportHistoryBatchResult>>
  }>
  library: Readonly<{
    load: () => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
    importImages: () => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
    remove: (request: RemoveLibraryImageRequest) => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
  }>
  resources: Readonly<{
    load: () => Promise<DesktopResult<ResourceCatalog>>
    savePrompt: (request: SavePromptRequest) => Promise<DesktopResult<ResourceCatalog>>
    removePrompt: (request: RemoveResourceRequest) => Promise<DesktopResult<ResourceCatalog>>
    saveWorkflow: (request: SaveWorkflowRequest) => Promise<DesktopResult<ResourceCatalog>>
    removeWorkflow: (request: RemoveResourceRequest) => Promise<DesktopResult<ResourceCatalog>>
  }>
  generation: Readonly<{
    generateImage: (request: GenerateImageRequest) => Promise<DesktopResult<GeneratedImageResult>>
    generateVideo: (request: GenerateVideoRequest) => Promise<DesktopResult<GeneratedVideoResult>>
    generateAudio: (request: GenerateAudioRequest) => Promise<DesktopResult<GeneratedAudioResult>>
    optimizePrompt: (request: OptimizePromptRequest) => Promise<DesktopResult<OptimizedPromptResult>>
    generateChatReply: (request: GenerateChatReplyRequest) => Promise<DesktopResult<GeneratedChatReply>>
    generateStoryboard: (request: GenerateStoryboardRequest) => Promise<DesktopResult<GeneratedStoryboard>>
    loadImage: (request: LoadGeneratedImageRequest) => Promise<DesktopResult<LoadedGeneratedImage>>
  }>
  storage: Readonly<{
    changeDirectory: () => Promise<DesktopResult<StorageMigrationResult>>
    openDirectory: () => Promise<DesktopResult<null>>
    stats: () => Promise<DesktopResult<StorageStats>>
  }>
  canvas: Readonly<{
    loadAutosave: () => Promise<DesktopResult<CanvasDocument | null>>
    saveAutosave: (document: CanvasDocument) => Promise<DesktopResult<null>>
    listRecent: () => Promise<DesktopResult<ReadonlyArray<RecentCanvasProject>>>
    loadRecent: (request: LoadRecentCanvasProjectRequest) => Promise<DesktopResult<CanvasDocument>>
    deleteRecent: (request: DeleteRecentCanvasProjectRequest) => Promise<DesktopResult<ReadonlyArray<RecentCanvasProject>>>
    openFile: () => Promise<DesktopResult<CanvasDocument>>
    saveFile: (document: CanvasDocument) => Promise<DesktopResult<string>>
  }>
}>
