import type { ModelKind } from '../domain/models'

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
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  connectionStatus: ProviderConnectionStatus
  lastTestedAt?: string
  availableModelIds: ReadonlyArray<string>
}>

export type AppSettings = Readonly<{
  theme: ThemeMode
  accentColor: string
  storageDirectory: string
  favoriteImageIds: ReadonlyArray<string>
  enabledModelKeys: ReadonlyArray<string>
  defaultModelKeys: Readonly<Partial<Record<ModelKind, string>>>
  providers: ReadonlyArray<ProviderConfig>
}>

export type UpdateSettingsRequest = Readonly<{
  theme?: ThemeMode
  accentColor?: string
  favoriteImageIds?: ReadonlyArray<string>
  enabledModelKeys?: ReadonlyArray<string>
  defaultModelKeys?: Readonly<Partial<Record<ModelKind, string>>>
}>

export type SaveProviderRequest = Readonly<{
  id: string
  baseUrl: string
  apiKey?: string
}>

export type TestProviderRequest = Readonly<{
  id: string
  baseUrl: string
  apiKey?: string
}>

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
      availableModelIds: ReadonlyArray<string>
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

export type CanvasNodeType = 'prompt' | 'generator' | 'image' | 'note' | 'chat' | 'video'

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
  imageFileName?: string
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

export type ImageGenerationSize = '1024x1024' | '1536x1024' | '1024x1536'

export type GenerateImageRequest = Readonly<{
  prompt: string
  modelKey?: string
  size: ImageGenerationSize
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

export type RemoveLibraryImageRequest = Readonly<{
  id: string
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
  models: Readonly<{
    saveProvider: (request: SaveProviderRequest) => Promise<DesktopResult<ProviderConfig>>
    testProvider: (request: TestProviderRequest) => Promise<DesktopResult<ProviderConnectionTestResult>>
    clearApiKey: (request: ClearProviderApiKeyRequest) => Promise<DesktopResult<ProviderConfig>>
    setProviderEnabled: (request: SetProviderEnabledRequest) => Promise<DesktopResult<ProviderConfig>>
  }>
  history: Readonly<{
    load: () => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
    record: (artwork: GeneratedArtwork) => Promise<DesktopResult<ReadonlyArray<GeneratedArtwork>>>
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
