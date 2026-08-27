import { createHash, randomUUID } from 'node:crypto'
import { copyFile, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { app, safeStorage } from 'electron/main'
import type {
  AddProviderModelRequest,
  AppSettings,
  CanvasDocument,
  CreateProviderRequest,
  ExportHistoryBatchRequest,
  GeneratedAudioAsset,
  GeneratedArtwork,
  GeneratedVideoAsset,
  ImageGenerationSize,
  LoadedGeneratedImage,
  ProviderConfig,
  ProviderConnectionStatus,
  RecentCanvasProject,
  RemoveHistoryArtworkRequest,
  RemoveLibraryImageRequest,
  RemoveResourceRequest,
  ResourceCatalog,
  SavePromptRequest,
  RemoveProviderModelRequest,
  RemoveProviderRequest,
  SaveWorkflowRequest,
  StorageMigrationResult,
  StorageStats,
  SetProviderModelEnabledRequest,
  ThemeMode,
  UpdateProviderModelRequest,
  UpdateProviderRequest,
  UpdateSettingsRequest,
  VideoGenerationRatio,
  VideoGenerationResolution,
} from '../../shared/contracts/desktop'
import { createRecentCanvasProject, isCanvasDocument } from '../../shared/domain/canvas-document'
import {
  BUILTIN_PROVIDER_MODELS,
  createConfiguredModel,
  createProviderModelKey,
  DEFAULT_CHAT_MODEL_KEY,
  DEFAULT_IMAGE_MODEL_KEY,
  findBuiltinModelByKey,
  findBuiltinModelsByRemoteId,
  inferModelKind,
  type ConfiguredProviderModel,
  type ModelKind,
  type ModelRoutes,
  type ProviderAdapterId,
} from '../../shared/domain/models'
import {
  legacySeedArtworks,
  legacySeedPrompts,
  legacySeedWorkflows,
} from '../../shared/domain/seed-content'
import {
  collectStorageStats,
  createAppDataPaths,
  ensureAppDataLayout,
  migrateAppDataDirectory,
  readAppDataLocation,
  removeManagedAppData,
  type AppDataPaths,
  writeAppDataLocation,
} from '../infrastructure/app-data-layout'
import { JsonFileStore, readJsonFile, writeJsonFile } from '../infrastructure/json-store'
import type { GeneratedImageMediaType } from '../infrastructure/image-generation-client'

const MAX_STORED_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_REFERENCE_IMAGE_BYTES = 45 * 1024 * 1024
const MAX_STORED_VIDEO_BYTES = 300 * 1024 * 1024
const MAX_STORED_AUDIO_BYTES = 50 * 1024 * 1024
const MAX_LIBRARY_IMPORT_COUNT = 50
const MAX_CANVAS_PROJECT_BYTES = 20 * 1024 * 1024
const MAX_RECENT_PROJECTS = 50

type SaveGeneratedImageRequest = Readonly<{
  bytes: Uint8Array
  mediaType: GeneratedImageMediaType
  prompt: string
  modelKey: string
  modelName: string
  size: ImageGenerationSize
}>

export type StoredImageInput = Readonly<{
  fileName: string
  bytes: Uint8Array
  mediaType: GeneratedImageMediaType
}>

type SaveGeneratedVideoRequest = Readonly<{
  bytes: Uint8Array
  mediaType: 'video/mp4' | 'video/webm'
  prompt: string
  modelKey: string
  modelName: string
  duration: number
  resolution: VideoGenerationResolution
  ratio: VideoGenerationRatio
  referenceImageFileNames: ReadonlyArray<string>
}>

export type SaveGeneratedAudioRequest = Readonly<{
  bytes: Uint8Array
  mediaType: 'audio/mpeg'
  text: string
  modelKey: string
  modelName: string
  voiceId: string
  speed: number
  pitch: number
  emotion: string
  durationMs: number
}>

type StoredProvider = Readonly<{
  id: string
  name?: string
  adapterId?: ProviderAdapterId
  baseUrl: string
  enabled?: boolean
  encryptedApiKey?: string
  connectionStatus?: ProviderConnectionStatus
  lastTestedAt?: string
  lastSyncedAt?: string
  availableModelIds?: ReadonlyArray<string>
  connected?: boolean
}>

type StoredPreferencesDocument = Readonly<{
  schemaVersion?: number
  theme?: ThemeMode
  accentColor?: string
  storageDirectory?: string
  favoriteImageIds?: ReadonlyArray<string>
  // Version 0 kept model data in this document. These fields are migration-only.
  selectedModelIds?: ReadonlyArray<string>
  providers?: ReadonlyArray<StoredProvider>
}>

type PreferencesDocument = Readonly<{
  schemaVersion: 3
  theme: ThemeMode
  accentColor: string
  storageDirectory: string
  favoriteImageIds: ReadonlyArray<string>
}>

type StoredModelConfigDocument = Readonly<{
  schemaVersion?: number
  selectedModelIds?: ReadonlyArray<string>
  enabledModelKeys?: ReadonlyArray<string>
  defaultModelKeys?: Readonly<Partial<Record<ModelKind, string>>>
  providers?: ReadonlyArray<StoredProvider>
  models?: ReadonlyArray<ConfiguredProviderModel>
  modelRoutes?: ModelRoutes
}>

type ModelConfigDocument = Readonly<{
  schemaVersion: 6
  providers: ReadonlyArray<StoredProvider>
  models: ReadonlyArray<ConfiguredProviderModel>
  modelRoutes: ModelRoutes
}>

type StoredRecentCanvasProject = Readonly<Omit<RecentCanvasProject, 'location'> & {
  relativePath?: string
  externalPath?: string
}>

type StoredRecentProjectsDocument = Readonly<{
  schemaVersion: 1
  projects: ReadonlyArray<StoredRecentCanvasProject>
}>

const DEFAULT_ACCENT = '#ff5f77'
const LEGACY_DEFAULT_MODELS = [
  'doubao-seedream-5-0-pro',
  'gemini-2.5-flash-image-preview-official',
  'gemini-3-pro-image-preview-official',
  'gpt-image-2',
]

function defaultProviders(): ReadonlyArray<StoredProvider> {
  return [
    createDefaultProvider('volcengine', '火山引擎', 'volcengine', 'https://ark.cn-beijing.volces.com/api/v3', true),
    createDefaultProvider('minimax', 'MiniMax', 'minimax', 'https://api.minimaxi.com/v1', true),
    createDefaultProvider('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', true),
    createDefaultProvider('openai-sub2api', 'OpenAI 中转', 'openai-sub2api', '', false),
  ]
}

function createDefaultProvider(
  id: string,
  name: string,
  adapterId: ProviderAdapterId,
  baseUrl: string,
  enabled: boolean,
): StoredProvider {
  return {
    id,
    name,
    adapterId,
    baseUrl,
    enabled,
    connectionStatus: 'untested',
  }
}

export class ProviderSecretUnavailableError extends Error {
  constructor() {
    super('当前系统安全存储不可用，未保存 API Key')
    this.name = 'ProviderSecretUnavailableError'
  }
}

export class AppState {
  private activePaths: AppDataPaths | null = null
  private readonly preferencesStore = new JsonFileStore<StoredPreferencesDocument>(() => this.settingsPath)
  private readonly modelConfigStore = new JsonFileStore<StoredModelConfigDocument>(() => this.modelConfigPath)
  private readonly autosaveStore = new JsonFileStore<CanvasDocument>(() => this.autosavePath)
  private readonly recentProjectsStore = new JsonFileStore<StoredRecentProjectsDocument>(() => this.recentProjectsPath)
  private readonly historyStore = new JsonFileStore<ReadonlyArray<GeneratedArtwork>>(() => this.historyPath)
  private readonly videoHistoryStore = new JsonFileStore<ReadonlyArray<GeneratedVideoAsset>>(() => this.paths.videoGenerationHistory)
  private readonly audioHistoryStore = new JsonFileStore<ReadonlyArray<GeneratedAudioAsset>>(() => this.paths.audioGenerationHistory)
  private readonly libraryStore = new JsonFileStore<ReadonlyArray<GeneratedArtwork>>(() => this.paths.libraryCatalog)
  private readonly promptsStore = new JsonFileStore<ResourceCatalog['prompts']>(() => this.paths.prompts)
  private readonly workflowsStore = new JsonFileStore<ResourceCatalog['workflows']>(() => this.paths.workflows)
  private initialization: Promise<void> | null = null
  private migration: Promise<StorageMigrationResult> | null = null
  private activeOperations = 0
  private readonly idleResolvers = new Set<() => void>()

  private get paths(): AppDataPaths {
    if (!this.activePaths) throw new Error('App data directory is not initialized')
    return this.activePaths
  }

  private get settingsPath(): string {
    return this.paths.preferences
  }

  private get modelConfigPath(): string {
    return this.paths.modelConfig
  }

  private get autosavePath(): string {
    return this.paths.autosave
  }

  private get recentProjectsPath(): string {
    return this.paths.recentProjects
  }

  private get historyPath(): string {
    return this.paths.generationHistory
  }

  async loadSettings(): Promise<AppSettings> {
    return this.withStorageOperation(() => this.loadSettingsUnsafe())
  }

  async updateSettings(request: UpdateSettingsRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      const hasPreferencesPatch =
        request.theme !== undefined ||
        request.accentColor !== undefined ||
        request.favoriteImageIds !== undefined

      if (hasPreferencesPatch) {
        await this.preferencesStore.update((value) => {
          const current = this.normalizePreferences(value)
          return {
            ...current,
            ...(request.theme !== undefined ? { theme: request.theme } : {}),
            ...(request.accentColor !== undefined ? { accentColor: request.accentColor } : {}),
            ...(request.favoriteImageIds !== undefined
              ? { favoriteImageIds: [...request.favoriteImageIds] }
              : {}),
          }
        })
      }

      if (request.modelRoutes !== undefined) {
        await this.modelConfigStore.update((value) => {
          const current = this.normalizeModelConfig(value)
          return {
            ...current,
            modelRoutes: normalizeModelRoutes(request.modelRoutes, current.models),
          }
        })
      }

      return this.loadSettingsUnsafe()
    })
  }

  async createProvider(request: CreateProviderRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      const encryptedApiKey = request.apiKey === undefined
        ? undefined
        : await encryptProviderApiKey(request.apiKey)
      const id = randomUUID()
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const provider: StoredProvider = {
          id,
          name: request.name,
          adapterId: request.adapterId,
          baseUrl: request.baseUrl,
          enabled: true,
          ...(encryptedApiKey ? { encryptedApiKey } : {}),
          connectionStatus: 'untested',
        }
        return { ...current, providers: [...current.providers, provider] }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async updateProvider(request: UpdateProviderRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      const encryptedApiKey = request.apiKey === undefined
        ? undefined
        : await encryptProviderApiKey(request.apiKey)
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = findProvider(current, request.id)
        const credentialsChanged = request.apiKey !== undefined
        const endpointChanged = existing.baseUrl !== request.baseUrl || existing.adapterId !== request.adapterId
        const provider: StoredProvider = {
          id: request.id,
          name: request.name,
          adapterId: request.adapterId,
          baseUrl: request.baseUrl,
          enabled: existing.enabled ?? true,
          ...(encryptedApiKey || existing.encryptedApiKey
            ? { encryptedApiKey: encryptedApiKey ?? existing.encryptedApiKey }
            : {}),
          connectionStatus:
            credentialsChanged || endpointChanged ? 'untested' : existing.connectionStatus ?? 'untested',
          ...(!credentialsChanged && !endpointChanged && existing.lastTestedAt
            ? { lastTestedAt: existing.lastTestedAt }
            : {}),
          ...(!endpointChanged && existing.lastSyncedAt ? { lastSyncedAt: existing.lastSyncedAt } : {}),
        }
        return {
          ...current,
          providers: replaceProvider(current.providers, provider),
          models: endpointChanged
            ? current.models.map((model) => model.providerId === request.id
              ? { ...model, available: model.source === 'manual' }
              : model)
            : current.models,
        }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async removeProvider(request: RemoveProviderRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        findProvider(current, request.id)
        const removedModelKeys = new Set(current.models
          .filter((model) => model.providerId === request.id)
          .map((model) => model.key))
        return {
          ...current,
          providers: current.providers.filter((provider) => provider.id !== request.id),
          models: current.models.filter((model) => model.providerId !== request.id),
          modelRoutes: removeModelKeysFromRoutes(current.modelRoutes, removedModelKeys),
        }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async clearProviderApiKey(id: string): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      const storedModelConfig = await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = findProvider(current, id)
        const provider: StoredProvider = {
          ...existing,
          encryptedApiKey: undefined,
          connectionStatus: 'untested',
          lastTestedAt: undefined,
        }
        return { ...current, providers: replaceProvider(current.providers, provider) }
      })
      const modelConfig = this.normalizeModelConfig(storedModelConfig)
      return this.toPublicProvider(findProvider(modelConfig, id), modelConfig.models)
    })
  }

  async setProviderEnabled(id: string, enabled: boolean): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      const storedModelConfig = await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = findProvider(current, id)
        return {
          ...current,
          providers: replaceProvider(current.providers, { ...existing, enabled }),
        }
      })
      const modelConfig = this.normalizeModelConfig(storedModelConfig)
      return this.toPublicProvider(findProvider(modelConfig, id), modelConfig.models)
    })
  }

  async loadProviderApiKey(id: string): Promise<string | null> {
    return this.withStorageOperation(async () => {
      const modelConfig = this.normalizeModelConfig(await this.modelConfigStore.read())
      const provider = findProvider(modelConfig, id)
      if (!provider.encryptedApiKey) return null
      const encrypted = Buffer.from(provider.encryptedApiKey, 'base64')

      try {
        const decrypted = await safeStorage.decryptStringAsync(encrypted)
        if (decrypted.shouldReEncrypt) {
          const replacement = await safeStorage.encryptStringAsync(decrypted.result)
          await this.replaceEncryptedApiKey(id, replacement.toString('base64'))
        }
        return decrypted.result
      } catch (error) {
        // Version 0 keys were encrypted with the synchronous safeStorage API.
        if (!safeStorage.isEncryptionAvailable()) throw error
        return safeStorage.decryptString(encrypted)
      }
    })
  }

  async getProvider(id: string): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      const config = this.normalizeModelConfig(await this.modelConfigStore.read())
      return this.toPublicProvider(findProvider(config, id), config.models)
    })
  }

  async markProviderTest(
    id: string,
    connectionStatus: Extract<ProviderConnectionStatus, 'connected' | 'failed'>,
    testedAt: string,
  ): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      const storedModelConfig = await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = findProvider(current, id)
        const provider: StoredProvider = {
          ...existing,
          connectionStatus,
          lastTestedAt: testedAt,
        }
        return { ...current, providers: replaceProvider(current.providers, provider) }
      })
      const modelConfig = this.normalizeModelConfig(storedModelConfig)
      return this.toPublicProvider(findProvider(modelConfig, id), modelConfig.models)
    })
  }

  async syncProviderModels(
    id: string,
    remoteModelIds: ReadonlyArray<string>,
    syncedAt: string,
  ): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const provider = findProvider(current, id)
        const discoveredIds = uniqueStrings(remoteModelIds, 500)
        const discoveredSet = new Set(discoveredIds)
        const existingByRemoteId = new Map(current.models
          .filter((model) => model.providerId === id)
          .map((model) => [model.remoteModelId, model]))
        const retained = current.models
          .filter((model) => model.providerId !== id)
        const providerModels = current.models
          .filter((model) => model.providerId === id)
          .filter((model) => !discoveredSet.has(model.remoteModelId))
          .map((model) => model.source === 'manual' ? model : { ...model, available: false })
        const discovered = discoveredIds.map((remoteModelId) => {
          const existing = existingByRemoteId.get(remoteModelId)
          if (existing) return { ...existing, available: true }
          return createDiscoveredModel(provider, remoteModelId)
        })
        return {
          ...current,
          providers: replaceProvider(current.providers, { ...provider, lastSyncedAt: syncedAt }),
          models: [...retained, ...providerModels, ...discovered],
        }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async addProviderModel(request: AddProviderModelRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        findProvider(current, request.providerId)
        const key = createProviderModelKey(request.providerId, request.remoteModelId)
        if (current.models.some((model) => model.key === key)) throw new Error('Model already exists')
        const model: ConfiguredProviderModel = {
          key,
          providerId: request.providerId,
          remoteModelId: request.remoteModelId,
          displayName: request.displayName,
          kind: request.kind,
          description: '手动添加的模型',
          source: 'manual',
          enabled: true,
          available: true,
        }
        return { ...current, models: [...current.models, model] }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async updateProviderModel(request: UpdateProviderModelRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        if (!current.models.some((model) => model.key === request.key)) throw new Error('Model not found')
        const models = current.models.map((model) => model.key === request.key
          ? { ...model, displayName: request.displayName, kind: request.kind }
          : model)
        return { ...current, models, modelRoutes: normalizeModelRoutes(current.modelRoutes, models) }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async setProviderModelEnabled(request: SetProviderModelEnabledRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        if (!current.models.some((model) => model.key === request.key)) throw new Error('Model not found')
        const models = current.models.map((model) => model.key === request.key
          ? { ...model, enabled: request.enabled }
          : model)
        return {
          ...current,
          models,
          modelRoutes: request.enabled
            ? current.modelRoutes
            : removeModelKeysFromRoutes(current.modelRoutes, new Set([request.key])),
        }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async removeProviderModel(request: RemoveProviderModelRequest): Promise<AppSettings> {
    return this.withStorageOperation(async () => {
      await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        if (!current.models.some((model) => model.key === request.key)) throw new Error('Model not found')
        return {
          ...current,
          models: current.models.filter((model) => model.key !== request.key),
          modelRoutes: removeModelKeysFromRoutes(current.modelRoutes, new Set([request.key])),
        }
      })
      return this.loadSettingsUnsafe()
    })
  }

  async loadAutosave(): Promise<CanvasDocument | null> {
    return this.withStorageOperation(() => this.autosaveStore.read())
  }

  async saveAutosave(document: CanvasDocument): Promise<void> {
    await this.withStorageOperation(async () => {
      const previousAutosave = await this.autosaveStore.read()
      if (
        previousAutosave &&
        isCanvasDocument(previousAutosave) &&
        previousAutosave.id !== document.id
      ) {
        const archivedProjectPath = this.archivedAutosavePath(previousAutosave.id)
        await writeJsonFile(archivedProjectPath, previousAutosave)
        await this.recordRecentProjectUnsafe(previousAutosave, archivedProjectPath)
      }
      await this.autosaveStore.write(document)
      await this.recordRecentProjectUnsafe(document)
    })
  }

  async listRecentProjects(): Promise<ReadonlyArray<RecentCanvasProject>> {
    return this.withStorageOperation(() => this.listRecentProjectsUnsafe())
  }

  async loadRecentProject(id: string): Promise<CanvasDocument | null> {
    return this.withStorageOperation(async () => {
      await this.listRecentProjectsUnsafe()
      const autosave = await this.autosaveStore.read()
      if (autosave && isCanvasDocument(autosave) && autosave.id === id) {
        await this.recordRecentProjectUnsafe(autosave, undefined, new Date().toISOString())
        return autosave
      }

      const stored = normalizeRecentProjectsDocument(await this.recentProjectsStore.read())
      const project = stored.projects.find((item) => item.id === id)
      const projectPath = project ? this.resolveRecentProjectPath(project) : null
      if (!projectPath) return null
      const document = await readCanvasProjectFile(projectPath)
      if (document?.id === id) {
        await this.recordRecentProjectUnsafe(document, projectPath, new Date().toISOString())
        return document
      }
      await this.recentProjectsStore.write({
        schemaVersion: 1,
        projects: stored.projects.filter((item) => item.id !== id),
      })
      return null
    })
  }

  async deleteRecentProject(id: string): Promise<ReadonlyArray<RecentCanvasProject>> {
    return this.withStorageOperation(async () => {
      const [storedValue, autosave] = await Promise.all([
        this.recentProjectsStore.read(),
        this.autosaveStore.read(),
      ])
      const stored = normalizeRecentProjectsDocument(storedValue)
      const project = stored.projects.find((item) => item.id === id)

      if (autosave && isCanvasDocument(autosave) && autosave.id === id) {
        await this.autosaveStore.remove()
      }

      if (project?.relativePath) {
        const managedProjectPath = this.resolveRecentProjectPath(project)
        const managedDocument = managedProjectPath
          ? await readCanvasProjectFile(managedProjectPath)
          : null
        if (managedProjectPath && managedDocument?.id === id) await unlink(managedProjectPath)
      }

      await this.recentProjectsStore.write({
        schemaVersion: 1,
        projects: stored.projects.filter((item) => item.id !== id),
      })
      return this.listRecentProjectsUnsafe()
    })
  }

  async recordRecentProject(document: CanvasDocument, filePath: string, accessedAt = document.updatedAt): Promise<void> {
    await this.withStorageOperation(() => this.recordRecentProjectUnsafe(document, filePath, accessedAt))
  }

  async loadHistory(): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(async () => (await this.historyStore.read()) ?? [])
  }

  async loadVideoHistory(): Promise<ReadonlyArray<GeneratedVideoAsset>> {
    return this.withStorageOperation(async () => (await this.videoHistoryStore.read()) ?? [])
  }

  async loadAudioHistory(): Promise<ReadonlyArray<GeneratedAudioAsset>> {
    return this.withStorageOperation(async () => (await this.audioHistoryStore.read()) ?? [])
  }

  async recordArtwork(artwork: GeneratedArtwork): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(() => this.historyStore.update((value) => {
      const current = value ?? []
      return [artwork, ...current.filter((item) => item.id !== artwork.id)].slice(0, 200)
    }))
  }

  async removeHistoryArtwork(request: RemoveHistoryArtworkRequest): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(async () => {
      let removedArtwork: GeneratedArtwork | undefined
      const next = await this.historyStore.update((value) => {
        const current = value ?? []
        removedArtwork = current.find((item) => item.id === request.id)
        return removedArtwork ? current.filter((item) => item.id !== request.id) : current
      })
      if (!removedArtwork) return next

      await this.preferencesStore.update((value) => {
        const current = this.normalizePreferences(value)
        return {
          ...current,
          favoriteImageIds: current.favoriteImageIds.filter((id) => id !== request.id),
        }
      })

      const imageFileName = removedArtwork.imageFileName
      if (imageFileName && isGeneratedImageFileName(imageFileName)) {
        const library = (await this.libraryStore.read()) ?? []
        const isStillReferenced = library.some((artwork) => artwork.imageFileName === imageFileName) ||
          await this.isImageReferencedByCanvasUnsafe(imageFileName)
        if (!isStillReferenced) {
          await unlink(join(this.paths.imagesDirectory, imageFileName)).catch(() => undefined)
        }
      }
      return next
    })
  }

  async getGeneratedVideo(id: string): Promise<GeneratedVideoAsset | null> {
    return this.withStorageOperation(async () => {
      const videos = (await this.videoHistoryStore.read()) ?? []
      return videos.find((video) => video.id === id) ?? null
    })
  }

  async exportGeneratedVideo(id: string, targetPath: string): Promise<void> {
    await this.withStorageOperation(async () => {
      if (!isAbsolute(targetPath)) throw new Error('Invalid video export path')
      const videos = (await this.videoHistoryStore.read()) ?? []
      const video = videos.find((item) => item.id === id)
      if (!video || !isGeneratedVideoFileName(video.videoFileName)) {
        throw new Error('Generated video not found')
      }
      await copyFile(join(this.paths.videosDirectory, video.videoFileName), targetPath)
    })
  }

  async removeGeneratedVideo(request: Readonly<{ id: string }>): Promise<ReadonlyArray<GeneratedVideoAsset>> {
    return this.withStorageOperation(async () => {
      let removedVideo: GeneratedVideoAsset | undefined
      const next = await this.videoHistoryStore.update((value) => {
        const current = value ?? []
        removedVideo = current.find((item) => item.id === request.id)
        return removedVideo ? current.filter((item) => item.id !== request.id) : current
      })
      if (!removedVideo || !isGeneratedVideoFileName(removedVideo.videoFileName)) return next
      if (!(await this.isVideoReferencedByCanvasUnsafe(removedVideo.videoFileName))) {
        await unlink(join(this.paths.videosDirectory, removedVideo.videoFileName)).catch(() => undefined)
      }
      return next
    })
  }

  async getGeneratedAudio(id: string): Promise<GeneratedAudioAsset | null> {
    return this.withStorageOperation(async () => {
      const audios = (await this.audioHistoryStore.read()) ?? []
      return audios.find((audio) => audio.id === id) ?? null
    })
  }

  async exportGeneratedAudio(id: string, targetPath: string): Promise<void> {
    await this.withStorageOperation(async () => {
      if (!isAbsolute(targetPath)) throw new Error('Invalid audio export path')
      const audios = (await this.audioHistoryStore.read()) ?? []
      const audio = audios.find((item) => item.id === id)
      if (!audio || !isGeneratedAudioFileName(audio.audioFileName)) {
        throw new Error('Generated audio not found')
      }
      await copyFile(join(this.paths.audiosDirectory, audio.audioFileName), targetPath)
    })
  }

  async removeGeneratedAudio(request: Readonly<{ id: string }>): Promise<ReadonlyArray<GeneratedAudioAsset>> {
    return this.withStorageOperation(async () => {
      let removedAudio: GeneratedAudioAsset | undefined
      const next = await this.audioHistoryStore.update((value) => {
        const current = value ?? []
        removedAudio = current.find((item) => item.id === request.id)
        return removedAudio ? current.filter((item) => item.id !== request.id) : current
      })
      if (!removedAudio || !isGeneratedAudioFileName(removedAudio.audioFileName)) return next
      if (!(await this.isAudioReferencedByCanvasUnsafe(removedAudio.audioFileName))) {
        await unlink(join(this.paths.audiosDirectory, removedAudio.audioFileName)).catch(() => undefined)
      }
      return next
    })
  }

  async exportHistoryBatch(request: ExportHistoryBatchRequest, targetDirectory: string): Promise<number> {
    return this.withStorageOperation(async () => {
      if (!isAbsolute(targetDirectory) || request.ids.length === 0 || request.ids.length > 200) {
        throw new Error('Invalid batch export request')
      }
      const selectedIds = new Set(request.ids)
      const files: ReadonlyArray<Readonly<{ sourcePath: string; targetName: string }>> = request.media === 'images'
        ? ((await this.historyStore.read()) ?? []).flatMap((artwork) =>
            selectedIds.has(artwork.id) && artwork.imageFileName && isGeneratedImageFileName(artwork.imageFileName)
              ? [{
                  sourcePath: join(this.paths.imagesDirectory, artwork.imageFileName),
                  targetName: batchExportFileName(artwork.title, artwork.id, extname(artwork.imageFileName)),
                }]
              : [],
          )
        : request.media === 'videos'
          ? ((await this.videoHistoryStore.read()) ?? []).flatMap((video) =>
              selectedIds.has(video.id) && isGeneratedVideoFileName(video.videoFileName)
                ? [{
                    sourcePath: join(this.paths.videosDirectory, video.videoFileName),
                    targetName: batchExportFileName(video.title, video.id, extname(video.videoFileName)),
                  }]
                : [],
            )
          : ((await this.audioHistoryStore.read()) ?? []).flatMap((audio) =>
              selectedIds.has(audio.id) && isGeneratedAudioFileName(audio.audioFileName)
                ? [{
                    sourcePath: join(this.paths.audiosDirectory, audio.audioFileName),
                    targetName: batchExportFileName(audio.title, audio.id, '.mp3'),
                  }]
                : [],
            )
      let exportedCount = 0
      for (const file of files) {
        await copyFile(file.sourcePath, join(targetDirectory, file.targetName))
        exportedCount += 1
      }
      return exportedCount
    })
  }

  async saveGeneratedImage(request: SaveGeneratedImageRequest): Promise<GeneratedArtwork> {
    return this.withStorageOperation(async () => {
      const id = randomUUID()
      const imageFileName = `${id}.${extensionForMediaType(request.mediaType)}`
      const imagePath = join(this.paths.imagesDirectory, imageFileName)
      const artwork: GeneratedArtwork = {
        id,
        title: `${request.modelName} 生成结果`,
        prompt: request.prompt,
        model: request.modelName,
        modelKey: request.modelKey,
        size: request.size.replace('x', ' × '),
        createdAt: new Date().toISOString(),
        palette: 'linear-gradient(145deg, #29344d 0%, #7552be 48%, #f06b82 100%)',
        tags: ['画布生成', '文生图'],
        imageFileName,
      }

      await writeFile(imagePath, request.bytes, { flag: 'wx' })
      try {
        await this.historyStore.update((value) => {
          const current = value ?? []
          return [artwork, ...current.filter((item) => item.id !== artwork.id)].slice(0, 200)
        })
      } catch (error) {
        await unlink(imagePath).catch(() => undefined)
        throw error
      }
      return artwork
    })
  }

  async loadGeneratedImage(fileName: string): Promise<LoadedGeneratedImage> {
    return this.withStorageOperation(async () => {
      if (!isGeneratedImageFileName(fileName)) throw new Error('Invalid generated image file name')
      const imagePath = join(this.paths.imagesDirectory, fileName)
      const fileStats = await stat(imagePath)
      if (!fileStats.isFile() || fileStats.size > MAX_STORED_IMAGE_BYTES) {
        throw new Error('Generated image is invalid or too large')
      }
      const bytes = await readFile(imagePath)
      const mediaType = mediaTypeForFileName(fileName)
      return { dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` }
    })
  }

  async loadStoredImages(fileNames: ReadonlyArray<string>): Promise<ReadonlyArray<StoredImageInput>> {
    return this.withStorageOperation(async () => {
      const uniqueFileNames = [...new Set(fileNames)]
      if (uniqueFileNames.length > 16 || uniqueFileNames.some((fileName) => !isGeneratedImageFileName(fileName))) {
        throw new Error('Invalid stored image references')
      }
      const storedFiles = await Promise.all(uniqueFileNames.map(async (fileName) => {
        const imagePath = join(this.paths.imagesDirectory, fileName)
        const fileStats = await stat(imagePath)
        if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_STORED_IMAGE_BYTES) {
          throw new Error('Stored image reference is invalid')
        }
        return { fileName, imagePath, size: fileStats.size }
      }))
      if (storedFiles.reduce((total, file) => total + file.size, 0) > MAX_REFERENCE_IMAGE_BYTES) {
        throw new Error('Stored image references are too large')
      }
      return Promise.all(storedFiles.map(async ({ fileName, imagePath }): Promise<StoredImageInput> => {
        return {
          fileName,
          bytes: await readFile(imagePath),
          mediaType: mediaTypeForFileName(fileName),
        }
      }))
    })
  }

  async saveGeneratedVideo(request: SaveGeneratedVideoRequest): Promise<GeneratedVideoAsset> {
    return this.withStorageOperation(async () => {
      if (request.bytes.byteLength === 0 || request.bytes.byteLength > MAX_STORED_VIDEO_BYTES) {
        throw new Error('Generated video is invalid or too large')
      }
      const id = randomUUID()
      const extension = request.mediaType === 'video/webm' ? 'webm' : 'mp4'
      const videoFileName = `${id}.${extension}`
      const videoPath = join(this.paths.videosDirectory, videoFileName)
      const video: GeneratedVideoAsset = {
        id,
        title: `${request.modelName} 生成视频`,
        prompt: request.prompt,
        model: request.modelName,
        modelKey: request.modelKey,
        duration: request.duration,
        resolution: request.resolution,
        ratio: request.ratio,
        createdAt: new Date().toISOString(),
        videoFileName,
        referenceImageFileNames: [...request.referenceImageFileNames],
      }
      await writeFile(videoPath, request.bytes, { flag: 'wx' })
      try {
        await this.videoHistoryStore.update((value) => [
          video,
          ...(value ?? []).filter((item) => item.id !== video.id),
        ].slice(0, 200))
      } catch (error) {
        await unlink(videoPath).catch(() => undefined)
        throw error
      }
      return video
    })
  }

  async saveGeneratedAudio(request: SaveGeneratedAudioRequest): Promise<GeneratedAudioAsset> {
    return this.withStorageOperation(async () => {
      if (request.bytes.byteLength === 0 || request.bytes.byteLength > MAX_STORED_AUDIO_BYTES) {
        throw new Error('Generated audio is invalid or too large')
      }
      const id = randomUUID()
      const audioFileName = `${id}.mp3`
      const audioPath = join(this.paths.audiosDirectory, audioFileName)
      const audio: GeneratedAudioAsset = {
        id,
        title: `${request.modelName} 生成语音`,
        text: request.text,
        model: request.modelName,
        modelKey: request.modelKey,
        voiceId: request.voiceId,
        speed: request.speed,
        pitch: request.pitch,
        emotion: request.emotion,
        durationMs: request.durationMs,
        createdAt: new Date().toISOString(),
        audioFileName,
      }
      await writeFile(audioPath, request.bytes, { flag: 'wx' })
      try {
        await this.audioHistoryStore.update((value) => [
          audio,
          ...(value ?? []).filter((item) => item.id !== audio.id),
        ].slice(0, 200))
      } catch (error) {
        await unlink(audioPath).catch(() => undefined)
        throw error
      }
      return audio
    })
  }

  async resolveStoredAudioPath(fileName: string): Promise<string> {
    return this.withStorageOperation(async () => {
      if (!isGeneratedAudioFileName(fileName)) throw new Error('Invalid generated audio file name')
      const audioPath = join(this.paths.audiosDirectory, fileName)
      const fileStats = await stat(audioPath)
      if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_STORED_AUDIO_BYTES) {
        throw new Error('Generated audio is invalid or too large')
      }
      return audioPath
    })
  }

  async resolveStoredVideoPath(fileName: string): Promise<string> {
    return this.withStorageOperation(async () => {
      if (!isGeneratedVideoFileName(fileName)) throw new Error('Invalid generated video file name')
      const videoPath = join(this.paths.videosDirectory, fileName)
      const fileStats = await stat(videoPath)
      if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_STORED_VIDEO_BYTES) {
        throw new Error('Generated video is invalid or too large')
      }
      return videoPath
    })
  }

  async loadLibrary(): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(async () => (await this.libraryStore.read()) ?? [])
  }

  async importLibraryImages(sourcePaths: ReadonlyArray<string>): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(async () => {
      if (sourcePaths.length === 0 || sourcePaths.length > MAX_LIBRARY_IMPORT_COUNT) {
        throw new Error('Invalid library import count')
      }
      const current = (await this.libraryStore.read()) ?? []
      const imported: GeneratedArtwork[] = []
      const writtenPaths: string[] = []
      try {
        for (const sourcePath of sourcePaths) {
          const fileStats = await stat(sourcePath)
          if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_STORED_IMAGE_BYTES) {
            throw new Error('Library image is invalid or too large')
          }
          const bytes = await readFile(sourcePath)
          const extension = detectLibraryImageExtension(bytes)
          if (!extension) throw new Error('Unsupported library image')
          const id = randomUUID()
          const imageFileName = `${id}.${extension}`
          const imagePath = join(this.paths.imagesDirectory, imageFileName)
          await writeFile(imagePath, bytes, { flag: 'wx' })
          writtenPaths.push(imagePath)
          const rawTitle = basename(sourcePath, extname(sourcePath)).trim()
          imported.push({
            id,
            title: rawTitle.slice(0, 200) || '本地图片',
            prompt: '',
            model: '本地导入',
            size: '原始尺寸',
            createdAt: new Date().toISOString(),
            palette: 'linear-gradient(145deg, #2e3445 0%, #7552be 52%, #f06b82 100%)',
            tags: ['本地导入'],
            imageFileName,
          })
        }
        return await this.libraryStore.write([...imported.reverse(), ...current].slice(0, 1000))
      } catch (error) {
        await Promise.all(writtenPaths.map((filePath) => unlink(filePath).catch(() => undefined)))
        throw error
      }
    })
  }

  async removeLibraryImage(request: RemoveLibraryImageRequest): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(async () => {
      const current = (await this.libraryStore.read()) ?? []
      const artwork = current.find((item) => item.id === request.id)
      if (!artwork) return current
      const next = current.filter((item) => item.id !== request.id)
      await this.libraryStore.write(next)
      if (artwork.imageFileName && isGeneratedImageFileName(artwork.imageFileName)) {
        const history = (await this.historyStore.read()) ?? []
        const isStillReferenced = history.some((item) => item.imageFileName === artwork.imageFileName) ||
          await this.isImageReferencedByCanvasUnsafe(artwork.imageFileName)
        if (!isStillReferenced) {
          await unlink(join(this.paths.imagesDirectory, artwork.imageFileName)).catch(() => undefined)
        }
      }
      return next
    })
  }

  async loadResources(): Promise<ResourceCatalog> {
    return this.withStorageOperation(() => this.loadResourcesUnsafe())
  }

  async savePrompt(request: SavePromptRequest): Promise<ResourceCatalog> {
    return this.withStorageOperation(async () => {
      const prompt = {
        id: request.id ?? randomUUID(),
        title: request.title.trim(),
        category: request.category.trim(),
        body: request.body.trim(),
      }
      await this.promptsStore.update((value) => [
        prompt,
        ...(value ?? []).filter((item) => item.id !== prompt.id),
      ].slice(0, 1000))
      return this.loadResourcesUnsafe()
    })
  }

  async removePrompt(request: RemoveResourceRequest): Promise<ResourceCatalog> {
    return this.withStorageOperation(async () => {
      await this.promptsStore.update((value) => (value ?? []).filter((item) => item.id !== request.id))
      return this.loadResourcesUnsafe()
    })
  }

  async saveWorkflow(request: SaveWorkflowRequest): Promise<ResourceCatalog> {
    return this.withStorageOperation(async () => {
      const workflow = {
        id: request.id ?? randomUUID(),
        title: request.title.trim(),
        description: request.description.trim(),
        nodes: request.document.nodes.length,
        accent: request.accent,
        document: request.document,
      }
      await this.workflowsStore.update((value) => [
        workflow,
        ...(value ?? []).filter((item) => item.id !== workflow.id),
      ].slice(0, 500))
      return this.loadResourcesUnsafe()
    })
  }

  async removeWorkflow(request: RemoveResourceRequest): Promise<ResourceCatalog> {
    return this.withStorageOperation(async () => {
      await this.workflowsStore.update((value) => (value ?? []).filter((item) => item.id !== request.id))
      return this.loadResourcesUnsafe()
    })
  }

  async storageStats(): Promise<StorageStats> {
    return this.withStorageOperation(() => collectStorageStats(this.paths.root))
  }

  async migrateStorageDirectory(targetDirectory: string): Promise<StorageMigrationResult> {
    if (this.migration) return this.migration
    const migration = this.performStorageMigration(targetDirectory)
    this.migration = migration
    void migration.finally(() => {
      if (this.migration === migration) this.migration = null
    }).catch(() => undefined)
    return migration
  }

  async getStorageDirectory(): Promise<string> {
    return this.withStorageOperation(async () => this.paths.root)
  }

  async getProjectsDirectory(): Promise<string> {
    return this.withStorageOperation(async () => this.paths.projectsDirectory)
  }

  private async recordRecentProjectUnsafe(document: CanvasDocument, filePath?: string, accessedAt = document.updatedAt): Promise<void> {
    const current = normalizeRecentProjectsDocument(await this.recentProjectsStore.read())
    const existing = current.projects.find((project) => project.id === document.id)
    const summary = {
      ...createRecentCanvasProject(document, filePath || existing?.relativePath || existing?.externalPath ? 'file' : 'autosave'),
      updatedAt: latestTimestamp(existing?.updatedAt, accessedAt),
    }
    const fileReference = filePath
      ? this.createProjectFileReference(filePath)
      : existing
        ? pickProjectFileReference(existing)
        : {}
    const project = toStoredRecentProject(summary, fileReference)
    const projects = [
      project,
      ...current.projects.filter((item) => item.id !== document.id),
    ].slice(0, MAX_RECENT_PROJECTS)
    await this.recentProjectsStore.write({ schemaVersion: 1, projects })
  }

  private async listRecentProjectsUnsafe(): Promise<ReadonlyArray<RecentCanvasProject>> {
    const stored = normalizeRecentProjectsDocument(await this.recentProjectsStore.read())
    const projectsById = new Map(stored.projects.map((project) => [project.id, project]))
    for (const discovered of await this.discoverManagedProjectsUnsafe()) {
      if (!projectsById.has(discovered.id)) projectsById.set(discovered.id, discovered)
    }

    const autosave = await this.autosaveStore.read()
    if (autosave && isCanvasDocument(autosave)) {
      const existing = projectsById.get(autosave.id)
      projectsById.set(autosave.id, toStoredRecentProject(
        {
          ...createRecentCanvasProject(autosave, existing ? 'file' : 'autosave'),
          updatedAt: latestTimestamp(existing?.updatedAt, autosave.updatedAt),
        },
        existing ? pickProjectFileReference(existing) : {},
      ))
    }

    const available: StoredRecentCanvasProject[] = []
    const recent: RecentCanvasProject[] = []
    for (const project of projectsById.values()) {
      const projectPath = this.resolveRecentProjectPath(project)
      const hasProjectFile = projectPath ? await isReadableProjectFile(projectPath) : false
      const hasAutosave = Boolean(autosave && isCanvasDocument(autosave) && autosave.id === project.id)
      if (!hasProjectFile && !hasAutosave) continue
      const availableProject: StoredRecentCanvasProject = hasProjectFile
        ? project
        : removeProjectFileReference(project)
      available.push(availableProject)
      recent.push({
        id: availableProject.id,
        name: availableProject.name,
        updatedAt: availableProject.updatedAt,
        nodeCount: availableProject.nodeCount,
        colors: availableProject.colors,
        location: hasProjectFile ? 'file' : 'autosave',
      })
    }
    available.sort(compareRecentProjects)
    recent.sort(compareRecentProjects)
    const nextDocument: StoredRecentProjectsDocument = {
      schemaVersion: 1,
      projects: available.slice(0, MAX_RECENT_PROJECTS),
    }
    if (!documentsEqual(stored, nextDocument)) await this.recentProjectsStore.write(nextDocument)
    return recent.slice(0, MAX_RECENT_PROJECTS)
  }

  private async discoverManagedProjectsUnsafe(): Promise<ReadonlyArray<StoredRecentCanvasProject>> {
    const entries = await readdir(this.paths.projectsDirectory, { withFileTypes: true })
    const projects: StoredRecentCanvasProject[] = []
    for (const entry of entries.slice(0, 200)) {
      if (
        !entry.isFile() ||
        entry.name === 'autosave.drawcanvas.json' ||
        entry.name === 'recent-projects.json' ||
        !isSupportedProjectPath(entry.name)
      ) continue
      const document = await readCanvasProjectFile(join(this.paths.projectsDirectory, entry.name))
      if (!document) continue
      projects.push(toStoredRecentProject(
        createRecentCanvasProject(document, 'file'),
        { relativePath: entry.name },
      ))
    }
    return projects
  }

  private createProjectFileReference(filePath: string): Pick<StoredRecentCanvasProject, 'relativePath' | 'externalPath'> {
    const absolutePath = resolve(filePath)
    const managedRelativePath = relative(this.paths.projectsDirectory, absolutePath)
    if (
      managedRelativePath &&
      !managedRelativePath.startsWith('..') &&
      !isAbsolute(managedRelativePath)
    ) return { relativePath: managedRelativePath }
    return { externalPath: absolutePath }
  }

  private archivedAutosavePath(documentId: string): string {
    const identifier = createHash('sha256').update(documentId).digest('hex')
    return join(this.paths.projectsDirectory, `autosave-${identifier}.drawcanvas`)
  }

  private async isImageReferencedByCanvasUnsafe(fileName: string): Promise<boolean> {
    const referencesImage = (document: CanvasDocument | null | undefined): boolean => Boolean(
      document?.nodes.some((node) =>
        node.imageFileName === fileName || node.imageFileNames?.includes(fileName),
      ),
    )
    const autosave = await this.autosaveStore.read()
    if (referencesImage(autosave)) return true
    const workflows = (await this.workflowsStore.read()) ?? []
    if (workflows.some((workflow) => referencesImage(workflow.document))) return true
    const entries = await readdir(this.paths.projectsDirectory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.drawcanvas')) continue
      const document = await readCanvasProjectFile(join(this.paths.projectsDirectory, entry.name))
      if (referencesImage(document)) return true
    }
    return false
  }

  private async isVideoReferencedByCanvasUnsafe(fileName: string): Promise<boolean> {
    const referencesVideo = (document: CanvasDocument | null | undefined): boolean => Boolean(
      document?.nodes.some((node) => node.videoFileName === fileName),
    )
    const autosave = await this.autosaveStore.read()
    if (referencesVideo(autosave)) return true
    const workflows = (await this.workflowsStore.read()) ?? []
    if (workflows.some((workflow) => referencesVideo(workflow.document))) return true
    const entries = await readdir(this.paths.projectsDirectory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.drawcanvas')) continue
      const document = await readCanvasProjectFile(join(this.paths.projectsDirectory, entry.name))
      if (referencesVideo(document)) return true
    }
    return false
  }

  private async isAudioReferencedByCanvasUnsafe(fileName: string): Promise<boolean> {
    const referencesAudio = (document: CanvasDocument | null | undefined): boolean => Boolean(
      document?.nodes.some((node) => node.audioFileName === fileName),
    )
    const autosave = await this.autosaveStore.read()
    if (referencesAudio(autosave)) return true
    const workflows = (await this.workflowsStore.read()) ?? []
    if (workflows.some((workflow) => referencesAudio(workflow.document))) return true
    const entries = await readdir(this.paths.projectsDirectory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.drawcanvas')) continue
      const document = await readCanvasProjectFile(join(this.paths.projectsDirectory, entry.name))
      if (referencesAudio(document)) return true
    }
    return false
  }

  private resolveRecentProjectPath(project: StoredRecentCanvasProject): string | null {
    if (project.relativePath) {
      if (isAbsolute(project.relativePath) || project.relativePath.startsWith('..')) return null
      const projectPath = resolve(this.paths.projectsDirectory, project.relativePath)
      const managedRelativePath = relative(this.paths.projectsDirectory, projectPath)
      if (!managedRelativePath || managedRelativePath.startsWith('..') || isAbsolute(managedRelativePath)) return null
      return isSupportedProjectPath(projectPath) ? projectPath : null
    }
    if (!project.externalPath || !isAbsolute(project.externalPath)) return null
    return isSupportedProjectPath(project.externalPath) ? resolve(project.externalPath) : null
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialization) return this.initialization
    const initialization = this.initializeDocuments()
    this.initialization = initialization
    void initialization.catch(() => {
      if (this.initialization === initialization) this.initialization = null
    })
    return initialization
  }

  private async initializeDocuments(): Promise<void> {
    const userDataDirectory = app.getPath('userData')
    const legacyPreferencesPath = join(userDataDirectory, 'draw-canvas-settings.json')
    const legacyModelConfigPath = join(userDataDirectory, 'model-config.json')
    const legacyAutosavePath = join(userDataDirectory, 'canvas-autosave.drawcanvas.json')
    const legacyHistoryPath = join(userDataDirectory, 'generation-history.json')
    const legacyPreferences = await readJsonFile<StoredPreferencesDocument>(legacyPreferencesPath)
    const locatedDirectory = await readAppDataLocation(userDataDirectory)
    const oldDefaultDirectory = join(userDataDirectory, 'Draw Canvas Data')
    const legacyDirectory = typeof legacyPreferences?.storageDirectory === 'string'
      ? resolve(legacyPreferences.storageDirectory)
      : null
    const hasCustomLegacyDirectory = Boolean(
      legacyDirectory && legacyDirectory !== resolve(oldDefaultDirectory),
    )
    const storageDirectory = locatedDirectory ?? (
      hasCustomLegacyDirectory && legacyDirectory
        ? legacyDirectory
        : await this.resolveDefaultStorageDirectory()
    )
    this.activePaths = createAppDataPaths(storageDirectory)
    await ensureAppDataLayout(this.paths)

    const [storedPreferences, storedModelConfig, autosave, history, library, prompts, workflows] = await Promise.all([
      this.preferencesStore.read(),
      this.modelConfigStore.read(),
      this.autosaveStore.read(),
      this.historyStore.read(),
      this.libraryStore.read(),
      this.promptsStore.read(),
      this.workflowsStore.read(),
    ])
    const importedPreferences = storedPreferences ?? legacyPreferences
    const legacyModelConfig = await readJsonFile<StoredModelConfigDocument>(legacyModelConfigPath)
    const preferences = this.normalizePreferences(importedPreferences)
    const modelConfig = this.normalizeModelConfig(
      storedModelConfig ?? legacyModelConfig ?? {
        schemaVersion: 1,
        selectedModelIds: importedPreferences?.selectedModelIds ?? LEGACY_DEFAULT_MODELS,
        providers: importedPreferences?.providers ?? defaultProviders(),
      },
    )

    if (!documentsEqual(storedModelConfig, modelConfig)) {
      await this.modelConfigStore.write(modelConfig)
    }
    if (!documentsEqual(storedPreferences, preferences)) {
      // Model data is written first so migration never drops the only copy of a key.
      await this.preferencesStore.write(preferences)
    }
    if (!autosave) {
      const legacyAutosave = await readJsonFile<CanvasDocument>(legacyAutosavePath)
      if (legacyAutosave) await this.autosaveStore.write(legacyAutosave)
    }
    if (!history) {
      const legacyHistory = await readJsonFile<ReadonlyArray<GeneratedArtwork>>(legacyHistoryPath)
      await this.historyStore.write(legacyHistory ?? [])
    }
    const normalizedLibrary = removeExactLegacyItems(library ?? [], legacySeedArtworks)
    const normalizedPrompts = removeExactLegacyItems(prompts ?? [], legacySeedPrompts)
    const normalizedWorkflows = removeExactLegacyItems(workflows ?? [], legacySeedWorkflows)
    if (!documentsEqual(library, normalizedLibrary)) await this.libraryStore.write(normalizedLibrary)
    if (!documentsEqual(prompts, normalizedPrompts)) await this.promptsStore.write(normalizedPrompts)
    if (!documentsEqual(workflows, normalizedWorkflows)) await this.workflowsStore.write(normalizedWorkflows)

    await writeAppDataLocation(userDataDirectory, this.paths.root)
    await Promise.all([
      unlink(legacyPreferencesPath).catch(() => undefined),
      unlink(legacyModelConfigPath).catch(() => undefined),
      unlink(legacyAutosavePath).catch(() => undefined),
      unlink(legacyHistoryPath).catch(() => undefined),
    ])
  }

  private async resolveDefaultStorageDirectory(): Promise<string> {
    const fallbackDirectory = join(app.getPath('userData'), 'Draw Canvas Data')
    if (process.platform !== 'win32') return fallbackDirectory

    const installDirectory = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
    const preferredDirectory = join(installDirectory, 'Draw Canvas Data')
    try {
      await ensureAppDataLayout(createAppDataPaths(preferredDirectory))
      return preferredDirectory
    } catch {
      await ensureAppDataLayout(createAppDataPaths(fallbackDirectory))
      return fallbackDirectory
    }
  }

  private async performStorageMigration(targetDirectory: string): Promise<StorageMigrationResult> {
    await this.ensureInitialized()
    await this.waitForIdleOperations()
    await Promise.all(this.stores.map((store) => store.drain()))

    const sourceDirectory = this.paths.root
    const requestedTarget = resolve(targetDirectory)
    if (sourceDirectory === requestedTarget) {
      return {
        settings: await this.loadSettingsUnsafe(),
        stats: await collectStorageStats(sourceDirectory),
        sourceDirectory,
        targetDirectory: sourceDirectory,
        migratedBytes: 0,
        migratedFileCount: 0,
        sourceCleanupPending: false,
      }
    }

    const summary = await migrateAppDataDirectory(sourceDirectory, requestedTarget)
    const sourcePaths = this.paths
    let settings: AppSettings
    let stats: StorageStats
    try {
      this.activePaths = createAppDataPaths(summary.targetDirectory)
      this.stores.forEach((store) => store.resetCache())
      await ensureAppDataLayout(this.paths)
      await this.preferencesStore.update((value) => this.normalizePreferences(value))
      ;[settings, stats] = await Promise.all([
        this.loadSettingsUnsafe(),
        collectStorageStats(this.paths.root),
      ])
      await writeAppDataLocation(app.getPath('userData'), summary.targetDirectory)
    } catch (error) {
      this.activePaths = sourcePaths
      this.stores.forEach((store) => store.resetCache())
      await writeAppDataLocation(app.getPath('userData'), sourceDirectory).catch(() => undefined)
      await removeManagedAppData(summary.targetDirectory)
      throw error
    }

    const sourceCleanupPending = await removeManagedAppData(summary.sourceDirectory)
    return {
      ...summary,
      settings,
      stats,
      sourceCleanupPending,
    }
  }

  private async loadSettingsUnsafe(): Promise<AppSettings> {
    const [preferencesValue, modelConfigValue] = await Promise.all([
      this.preferencesStore.read(),
      this.modelConfigStore.read(),
    ])
    return this.toPublicSettings(
      this.normalizePreferences(preferencesValue),
      this.normalizeModelConfig(modelConfigValue),
    )
  }

  private async loadResourcesUnsafe(): Promise<ResourceCatalog> {
    const [prompts, workflows] = await Promise.all([
      this.promptsStore.read(),
      this.workflowsStore.read(),
    ])
    return {
      prompts: prompts ?? [],
      workflows: workflows ?? [],
    }
  }

  private get stores(): ReadonlyArray<JsonFileStore<unknown>> {
    return [
      this.preferencesStore,
      this.modelConfigStore,
      this.autosaveStore,
      this.recentProjectsStore,
      this.historyStore,
      this.videoHistoryStore,
      this.audioHistoryStore,
      this.libraryStore,
      this.promptsStore,
      this.workflowsStore,
    ]
  }

  private async withStorageOperation<TResult>(task: () => Promise<TResult>): Promise<TResult> {
    await this.ensureInitialized()
    while (this.migration) {
      await this.migration.catch(() => undefined)
    }
    this.activeOperations += 1
    try {
      return await task()
    } finally {
      this.activeOperations -= 1
      if (this.activeOperations === 0) {
        this.idleResolvers.forEach((resolveIdle) => resolveIdle())
        this.idleResolvers.clear()
      }
    }
  }

  private async waitForIdleOperations(): Promise<void> {
    if (this.activeOperations === 0) return
    await new Promise<void>((resolveIdle) => this.idleResolvers.add(resolveIdle))
  }

  private normalizePreferences(value: StoredPreferencesDocument | null): PreferencesDocument {
    const storedAccentColor =
      typeof value?.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.accentColor)
        ? value.accentColor.toLowerCase()
        : null
    const shouldMigrateLegacyAccent =
      (value?.schemaVersion ?? 0) < 2 &&
      (storedAccentColor === '#aaff00' || storedAccentColor === '#17181b')
    return {
      schemaVersion: 3,
      theme: value?.theme === 'dark' || value?.theme === 'system' ? value.theme : 'light',
      accentColor: storedAccentColor && !shouldMigrateLegacyAccent
        ? storedAccentColor
        : DEFAULT_ACCENT,
      storageDirectory: this.paths.root,
      favoriteImageIds: uniqueStrings(value?.favoriteImageIds ?? [], 500)
        .filter((id) => !legacySeedArtworks.some((artwork) => artwork.id === id)),
    }
  }

  private normalizeModelConfig(value: StoredModelConfigDocument | null): ModelConfigDocument {
    const storedProviders = Array.isArray(value?.providers) ? value.providers : []
    const legacyOpenAiProvider = storedProviders.find((provider) => provider?.id === 'openai-relay')
    const legacyOpenAiTarget = getLegacyOpenAiTarget(legacyOpenAiProvider)
    if ((value?.schemaVersion ?? 0) >= 6) {
      const providers = normalizeStoredProviders(storedProviders)
      const models = normalizeConfiguredModels(value?.models, providers)
      return {
        schemaVersion: 6,
        providers,
        models,
        modelRoutes: normalizeModelRoutes(value?.modelRoutes, models),
      }
    }

    const providers = migrateLegacyProviders(storedProviders, legacyOpenAiProvider, legacyOpenAiTarget)
    const storedEnabledModelKeys = (value?.schemaVersion ?? 0) >= 2
      ? validModelKeys(value?.enabledModelKeys ?? [], legacyOpenAiTarget)
      : migrateLegacyModelIds(value?.selectedModelIds ?? LEGACY_DEFAULT_MODELS, legacyOpenAiTarget)
    const migratedDefaultChatKey = migrateModelKey('openai-relay:gpt-5.6-sol', legacyOpenAiTarget) ?? DEFAULT_CHAT_MODEL_KEY
    const migratedDefaultImageKey = migrateModelKey('openai-relay:gpt-image-2', legacyOpenAiTarget) ?? DEFAULT_IMAGE_MODEL_KEY
    const enabledModelKeys = (value?.schemaVersion ?? 0) < 3 && !storedEnabledModelKeys.includes(migratedDefaultChatKey)
      ? [...storedEnabledModelKeys, migratedDefaultChatKey]
      : storedEnabledModelKeys
    const storedDefaultModelKeys = (value?.schemaVersion ?? 0) >= 2
      ? value?.defaultModelKeys
      : { image: migratedDefaultImageKey }
    const defaultModelKeys = normalizeDefaultModelKeys(
      (value?.schemaVersion ?? 0) < 3
        ? { ...storedDefaultModelKeys, chat: migratedDefaultChatKey }
        : storedDefaultModelKeys,
      enabledModelKeys,
      legacyOpenAiTarget,
    )
    const providerIds = new Set(providers.map((provider) => provider.id))
    const builtinModels = BUILTIN_PROVIDER_MODELS
      .filter((model) => providerIds.has(model.providerId))
      .map((model): ConfiguredProviderModel => ({
        ...createConfiguredModel(model),
        enabled: enabledModelKeys.includes(model.key),
      }))
    const builtinKeys = new Set(builtinModels.map((model) => model.key))
    const discoveredModels = providers.flatMap((provider) =>
      uniqueStrings(provider.availableModelIds ?? [], 500).flatMap((remoteModelId) => {
        const key = createProviderModelKey(provider.id, remoteModelId)
        return builtinKeys.has(key)
          ? []
          : [{ ...createDiscoveredModel(provider, remoteModelId), enabled: enabledModelKeys.includes(key) }]
      }))
    const models = [...builtinModels, ...discoveredModels]
    const legacyRoutes: ModelRoutes = Object.fromEntries(
      (['image', 'video', 'chat', 'audio'] as const).flatMap((kind) => {
        const key = defaultModelKeys[kind]
        return key ? [[kind, { modelKeys: [key] }]] : []
      }),
    )
    return {
      schemaVersion: 6,
      providers: providers.map(({ availableModelIds: _availableModelIds, ...provider }) => provider),
      models,
      modelRoutes: normalizeModelRoutes(legacyRoutes, models),
    }
  }

  private toPublicSettings(
    preferences: PreferencesDocument,
    modelConfig: ModelConfigDocument,
  ): AppSettings {
    return {
      theme: preferences.theme,
      accentColor: preferences.accentColor,
      storageDirectory: preferences.storageDirectory,
      favoriteImageIds: preferences.favoriteImageIds,
      models: modelConfig.models,
      modelRoutes: modelConfig.modelRoutes,
      providers: modelConfig.providers.map((provider) => this.toPublicProvider(provider, modelConfig.models)),
    }
  }

  private toPublicProvider(
    provider: StoredProvider,
    models: ReadonlyArray<ConfiguredProviderModel>,
  ): ProviderConfig {
    return {
      id: provider.id,
      name: provider.name ?? provider.id,
      adapterId: provider.adapterId ?? legacyProviderAdapter(provider.id),
      baseUrl: provider.baseUrl,
      enabled: provider.enabled === true,
      hasApiKey: Boolean(provider.encryptedApiKey),
      connectionStatus: isConnectionStatus(provider.connectionStatus)
        ? provider.connectionStatus
        : 'untested',
      ...(provider.lastTestedAt ? { lastTestedAt: provider.lastTestedAt } : {}),
      ...(provider.lastSyncedAt ? { lastSyncedAt: provider.lastSyncedAt } : {}),
      modelCount: models.filter((model) => model.providerId === provider.id).length,
    }
  }

  private async replaceEncryptedApiKey(id: string, encryptedApiKey: string): Promise<void> {
    await this.modelConfigStore.update((value) => {
      const current = this.normalizeModelConfig(value)
      const provider = findProvider(current, id)
      return {
        ...current,
        providers: replaceProvider(current.providers, { ...provider, encryptedApiKey }),
      }
    })
  }
}

function normalizeRecentProjectsDocument(value: unknown): StoredRecentProjectsDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.projects)) {
    return { schemaVersion: 1, projects: [] }
  }
  const projects = value.projects.flatMap((item): ReadonlyArray<StoredRecentCanvasProject> => {
    if (
      !isRecord(item) ||
      !isBoundedString(item.id, 128) ||
      !isBoundedString(item.name, 200) ||
      !isBoundedString(item.updatedAt, 100) ||
      typeof item.nodeCount !== 'number' ||
      !Number.isInteger(item.nodeCount) ||
      item.nodeCount < 0 ||
      item.nodeCount > 500 ||
      !Array.isArray(item.colors)
    ) return []
    const relativePath = typeof item.relativePath === 'string' && item.relativePath.length <= 1024
      ? item.relativePath
      : undefined
    const externalPath = typeof item.externalPath === 'string' && item.externalPath.length <= 4096
      ? item.externalPath
      : undefined
    return [{
      id: item.id,
      name: item.name,
      updatedAt: item.updatedAt,
      nodeCount: item.nodeCount,
      colors: uniqueHexColors(item.colors),
      ...(relativePath ? { relativePath } : {}),
      ...(externalPath ? { externalPath } : {}),
    }]
  })
  return { schemaVersion: 1, projects: projects.slice(0, MAX_RECENT_PROJECTS) }
}

function toStoredRecentProject(
  project: RecentCanvasProject,
  fileReference: Pick<StoredRecentCanvasProject, 'relativePath' | 'externalPath'> = {},
): StoredRecentCanvasProject {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    nodeCount: project.nodeCount,
    colors: project.colors,
    ...fileReference,
  }
}

function pickProjectFileReference(
  project: StoredRecentCanvasProject,
): Pick<StoredRecentCanvasProject, 'relativePath' | 'externalPath'> {
  if (project.relativePath) return { relativePath: project.relativePath }
  if (project.externalPath) return { externalPath: project.externalPath }
  return {}
}

function removeProjectFileReference(project: StoredRecentCanvasProject): StoredRecentCanvasProject {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    nodeCount: project.nodeCount,
    colors: project.colors,
  }
}

function compareRecentProjects(
  left: Pick<RecentCanvasProject, 'updatedAt'>,
  right: Pick<RecentCanvasProject, 'updatedAt'>,
): number {
  return parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt)
}

async function readCanvasProjectFile(filePath: string): Promise<CanvasDocument | null> {
  try {
    const fileStats = await stat(filePath)
    if (!fileStats.isFile() || fileStats.size > MAX_CANVAS_PROJECT_BYTES) return null
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return isCanvasDocument(value) ? value : null
  } catch {
    return null
  }
}

async function isReadableProjectFile(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath)
    return fileStats.isFile() && fileStats.size <= MAX_CANVAS_PROJECT_BYTES
  } catch {
    return false
  }
}

function isSupportedProjectPath(filePath: string): boolean {
  return /\.(drawcanvas|json)$/i.test(filePath)
}

function uniqueHexColors(value: ReadonlyArray<unknown>): ReadonlyArray<string> {
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item)))]
    .slice(0, 3)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function latestTimestamp(current: string | undefined, candidate: string): string {
  return current && parseTimestamp(current) > parseTimestamp(candidate) ? current : candidate
}

function findProvider(modelConfig: ModelConfigDocument, id: string): StoredProvider {
  const provider = modelConfig.providers.find((item) => item.id === id)
  if (!provider) throw new Error(`Unknown provider: ${id}`)
  return provider
}

function replaceProvider(
  providers: ReadonlyArray<StoredProvider>,
  provider: StoredProvider,
): ReadonlyArray<StoredProvider> {
  return providers.some((item) => item.id === provider.id)
    ? providers.map((item) => (item.id === provider.id ? provider : item))
    : [...providers, provider]
}

async function encryptProviderApiKey(apiKey: string): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new ProviderSecretUnavailableError()
  }
  return (await safeStorage.encryptStringAsync(apiKey)).toString('base64')
}

function legacyProviderAdapter(id: string): ProviderAdapterId {
  switch (id) {
    case 'openai': return 'openai'
    case 'openai-relay':
    case 'openai-sub2api': return 'openai-sub2api'
    case 'volcengine': return 'volcengine'
    case 'minimax': return 'minimax'
    default: return 'openai-sub2api'
  }
}

function legacyProviderName(id: string): string {
  switch (id) {
    case 'apimart': return 'APIMart'
    case 'comfly': return 'Comfly'
    case 'openai': return 'OpenAI'
    case 'openai-relay':
    case 'openai-sub2api': return 'OpenAI 中转'
    case 'volcengine': return '火山引擎'
    case 'minimax': return 'MiniMax'
    default: return id
  }
}

function isProviderAdapterId(value: unknown): value is ProviderAdapterId {
  return value === 'openai' || value === 'openai-sub2api' || value === 'volcengine' || value === 'minimax'
}

function normalizeStoredProviders(value: ReadonlyArray<StoredProvider>): ReadonlyArray<StoredProvider> {
  const providers: StoredProvider[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!isBoundedString(item?.id, 128) || ids.has(item.id)) continue
    if (!isBoundedString(item.name, 100) || !isProviderAdapterId(item.adapterId)) continue
    if (typeof item.baseUrl !== 'string' || item.baseUrl.length > 2_000) continue
    ids.add(item.id)
    providers.push({
      id: item.id,
      name: item.name,
      adapterId: item.adapterId,
      baseUrl: item.baseUrl,
      enabled: item.enabled === true,
      ...(isBoundedString(item.encryptedApiKey, 20_000) ? { encryptedApiKey: item.encryptedApiKey } : {}),
      connectionStatus: isConnectionStatus(item.connectionStatus) ? item.connectionStatus : 'untested',
      ...(isBoundedString(item.lastTestedAt, 100) ? { lastTestedAt: item.lastTestedAt } : {}),
      ...(isBoundedString(item.lastSyncedAt, 100) ? { lastSyncedAt: item.lastSyncedAt } : {}),
    })
    if (providers.length >= 50) break
  }
  return providers
}

function migrateLegacyProviders(
  storedProviders: ReadonlyArray<StoredProvider>,
  legacyOpenAiProvider: StoredProvider | undefined,
  legacyOpenAiTarget: 'openai' | 'openai-sub2api',
): ReadonlyArray<StoredProvider> {
  const migratedDefaults = defaultProviders().map((fallback) => {
    const stored = storedProviders.find((provider) => provider?.id === fallback.id) ?? (
      fallback.id === legacyOpenAiTarget ? legacyOpenAiProvider : undefined
    )
    if (!stored) return fallback
    const shouldMigrateMiniMaxGlobalEndpoint =
      fallback.id === 'minimax' &&
      stored.baseUrl === 'https://api.minimax.io/v1' &&
      !stored.encryptedApiKey
    return {
      id: fallback.id,
      name: fallback.name ?? legacyProviderName(fallback.id),
      adapterId: fallback.adapterId ?? legacyProviderAdapter(fallback.id),
      baseUrl: fallback.id === 'openai'
        ? fallback.baseUrl
        : typeof stored.baseUrl === 'string' && stored.baseUrl && !shouldMigrateMiniMaxGlobalEndpoint
          ? stored.baseUrl
          : fallback.baseUrl,
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : fallback.enabled,
      ...(typeof stored.encryptedApiKey === 'string' && stored.encryptedApiKey
        ? { encryptedApiKey: stored.encryptedApiKey }
        : {}),
      connectionStatus: isConnectionStatus(stored.connectionStatus) ? stored.connectionStatus : 'untested',
      ...(typeof stored.lastTestedAt === 'string' && stored.lastTestedAt
        ? { lastTestedAt: stored.lastTestedAt }
        : {}),
      availableModelIds: uniqueStrings(stored.availableModelIds ?? [], 500),
    }
  })
  const defaultIds = new Set(migratedDefaults.map((provider) => provider.id))
  const migratedLegacyServices = storedProviders.flatMap((stored): ReadonlyArray<StoredProvider> => {
    if (
      !isBoundedString(stored?.id, 128) ||
      stored.id === 'openai-relay' ||
      defaultIds.has(stored.id) ||
      typeof stored.baseUrl !== 'string' ||
      !stored.baseUrl ||
      stored.baseUrl.length > 2_000
    ) return []
    return [{
      id: stored.id,
      name: legacyProviderName(stored.id),
      adapterId: legacyProviderAdapter(stored.id),
      baseUrl: stored.baseUrl,
      enabled: stored.enabled === true,
      ...(isBoundedString(stored.encryptedApiKey, 20_000) ? { encryptedApiKey: stored.encryptedApiKey } : {}),
      connectionStatus: isConnectionStatus(stored.connectionStatus) ? stored.connectionStatus : 'untested',
      ...(isBoundedString(stored.lastTestedAt, 100) ? { lastTestedAt: stored.lastTestedAt } : {}),
      availableModelIds: uniqueStrings(stored.availableModelIds ?? [], 500),
    }]
  })
  return [...migratedDefaults, ...migratedLegacyServices].slice(0, 50)
}

function normalizeConfiguredModels(
  value: ReadonlyArray<ConfiguredProviderModel> | undefined,
  providers: ReadonlyArray<StoredProvider>,
): ReadonlyArray<ConfiguredProviderModel> {
  if (!Array.isArray(value)) return []
  const providerIds = new Set(providers.map((provider) => provider.id))
  const keys = new Set<string>()
  const models: ConfiguredProviderModel[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    if (!isBoundedString(item.key, 400) || keys.has(item.key)) continue
    if (!isBoundedString(item.providerId, 128) || !providerIds.has(item.providerId)) continue
    if (!isBoundedString(item.remoteModelId, 200)) continue
    if (item.key !== createProviderModelKey(item.providerId, item.remoteModelId)) continue
    if (!isBoundedString(item.displayName, 200) || !isModelKind(item.kind)) continue
    if (item.source !== 'builtin' && item.source !== 'discovered' && item.source !== 'manual') continue
    const builtin = findBuiltinModelByKey(item.key)
    keys.add(item.key)
    models.push({
      ...(builtin ?? {}),
      key: item.key,
      providerId: item.providerId,
      remoteModelId: item.remoteModelId,
      displayName: item.displayName,
      kind: item.kind,
      description: typeof item.description === 'string' ? item.description.slice(0, 500) : '',
      ...(typeof item.badge === 'string' && item.badge ? { badge: item.badge.slice(0, 50) } : {}),
      source: item.source,
      enabled: item.enabled === true,
      available: item.available === true,
    })
    if (models.length >= 1_000) break
  }
  return models
}

function createDiscoveredModel(
  provider: StoredProvider,
  remoteModelId: string,
): ConfiguredProviderModel {
  const adapterId = provider.adapterId ?? legacyProviderAdapter(provider.id)
  const builtin = BUILTIN_PROVIDER_MODELS.find((model) =>
    model.providerId === adapterId && model.remoteModelId === remoteModelId)
  const definition = builtin
    ? {
        ...builtin,
        key: createProviderModelKey(provider.id, remoteModelId),
        providerId: provider.id,
      }
    : {
        key: createProviderModelKey(provider.id, remoteModelId),
        providerId: provider.id,
        remoteModelId,
        displayName: remoteModelId,
        kind: inferModelKind(remoteModelId),
        description: '由服务商模型列表接口发现',
      }
  return createConfiguredModel(definition, 'discovered')
}

function isModelKind(value: unknown): value is ModelKind {
  return value === 'image' || value === 'video' || value === 'chat' || value === 'audio'
}

function normalizeModelRoutes(
  value: ModelRoutes | undefined,
  models: ReadonlyArray<ConfiguredProviderModel>,
): ModelRoutes {
  const modelByKey = new Map(models.map((model) => [model.key, model]))
  const routes: Partial<Record<ModelKind, { modelKeys: ReadonlyArray<string> }>> = {}
  for (const kind of ['image', 'video', 'chat', 'audio'] as const) {
    const keys = Array.isArray(value?.[kind]?.modelKeys)
      ? [...new Set(value[kind]?.modelKeys.filter((key): key is string => {
          const model = typeof key === 'string' ? modelByKey.get(key) : undefined
          return Boolean(model && model.kind === kind)
        }))].slice(0, 3)
      : []
    if (keys.length) routes[kind] = { modelKeys: keys }
  }
  return routes
}

function removeModelKeysFromRoutes(routes: ModelRoutes, removedKeys: ReadonlySet<string>): ModelRoutes {
  return Object.fromEntries(
    (['image', 'video', 'chat', 'audio'] as const).flatMap((kind) => {
      const modelKeys = routes[kind]?.modelKeys.filter((key) => !removedKeys.has(key)) ?? []
      return modelKeys.length ? [[kind, { modelKeys }]] : []
    }),
  )
}

function isConnectionStatus(value: unknown): value is ProviderConnectionStatus {
  return value === 'untested' || value === 'connected' || value === 'failed'
}

function uniqueStrings(value: ReadonlyArray<unknown>, limit: number): ReadonlyArray<string> {
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length <= 200))]
    .slice(0, limit)
}

function validModelKeys(
  value: ReadonlyArray<unknown>,
  legacyOpenAiTarget: 'openai' | 'openai-sub2api' = 'openai',
): ReadonlyArray<string> {
  return uniqueStrings(value, 500)
    .map((key) => migrateModelKey(key, legacyOpenAiTarget))
    .filter((key): key is string => Boolean(
      key && /^[a-z0-9-]+:.+$/i.test(key) && key.length <= 400,
    ))
}

function migrateLegacyModelIds(
  modelIds: ReadonlyArray<string>,
  openAiTarget: 'openai' | 'openai-sub2api' = 'openai',
): ReadonlyArray<string> {
  const normalizedIds = uniqueStrings(modelIds, 500)
  const isUntouchedLegacyDefault =
    normalizedIds.length === LEGACY_DEFAULT_MODELS.length &&
    LEGACY_DEFAULT_MODELS.every((id) => normalizedIds.includes(id))
  const fallbackImageKey = `${openAiTarget}:gpt-image-2`
  if (isUntouchedLegacyDefault) return [fallbackImageKey]

  const keys = normalizedIds.flatMap((modelId) =>
    findBuiltinModelsByRemoteId(modelId)
      .filter((model) => model.providerId === openAiTarget)
      .map((model) => model.key),
  )
  return keys.length ? validModelKeys(keys, openAiTarget) : [fallbackImageKey]
}

function normalizeDefaultModelKeys(
  value: Readonly<Partial<Record<ModelKind, string>>> | undefined,
  enabledModelKeys: ReadonlyArray<string>,
  legacyOpenAiTarget: 'openai' | 'openai-sub2api' = 'openai',
): Readonly<Partial<Record<ModelKind, string>>> {
  const defaults: Partial<Record<ModelKind, string>> = {}
  for (const kind of ['image', 'video', 'chat', 'audio'] as const) {
    const key = migrateModelKey(value?.[kind], legacyOpenAiTarget)
    if (!key || !enabledModelKeys.includes(key) || inferModelKindFromKey(key) !== kind) continue
    defaults[kind] = key
  }
  return defaults
}

function inferModelKindFromKey(key: string): ModelKind {
  const builtin = findBuiltinModelByKey(key)
  if (builtin) return builtin.kind
  return inferModelKind(key.slice(key.indexOf(':') + 1))
}

function migrateModelKey(
  key: string | undefined,
  legacyOpenAiTarget: 'openai' | 'openai-sub2api' = 'openai',
): string | undefined {
  if (key?.startsWith('openai-relay:')) {
    return `${legacyOpenAiTarget}:${key.slice('openai-relay:'.length)}`
  }
  if (key === 'volcengine:doubao-seedream-5-0-pro') {
    return 'volcengine:doubao-seedream-5-0-260128'
  }
  if (key === 'volcengine:doubao-seedream-4-5') {
    return 'volcengine:doubao-seedream-4-5-251128'
  }
  return key
}

function getLegacyOpenAiTarget(
  provider: StoredProvider | undefined,
): 'openai' | 'openai-sub2api' {
  if (!provider?.baseUrl) return 'openai'
  try {
    return new URL(provider.baseUrl).hostname.toLowerCase() === 'api.openai.com'
      ? 'openai'
      : 'openai-sub2api'
  } catch {
    return 'openai-sub2api'
  }
}

function documentsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function removeExactLegacyItems<T>(
  items: ReadonlyArray<T>,
  legacyItems: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return items.filter((item) => !legacyItems.some((legacyItem) => documentsEqual(item, legacyItem)))
}

function detectLibraryImageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp'
  return null
}

function extensionForMediaType(mediaType: GeneratedImageMediaType): 'png' | 'jpg' | 'webp' {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

function isGeneratedImageFileName(fileName: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(fileName)
}

function isGeneratedVideoFileName(fileName: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm)$/i.test(fileName)
}

function isGeneratedAudioFileName(fileName: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp3$/i.test(fileName)
}

function batchExportFileName(title: string, id: string, extension: string): string {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120) || 'Draw Canvas 生成结果'
  const safeId = id.replace(/[^a-z0-9-]/gi, '').slice(0, 8) || 'item'
  return `${safeTitle}-${safeId}${extension}`
}

function mediaTypeForFileName(fileName: string): GeneratedImageMediaType {
  if (fileName.endsWith('.jpg')) return 'image/jpeg'
  if (fileName.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}
