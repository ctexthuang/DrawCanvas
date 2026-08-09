import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { app, safeStorage } from 'electron/main'
import type {
  AppSettings,
  CanvasDocument,
  GeneratedArtwork,
  ImageGenerationSize,
  LoadedGeneratedImage,
  ProviderConfig,
  ProviderConnectionStatus,
  RecentCanvasProject,
  RemoveLibraryImageRequest,
  RemoveResourceRequest,
  ResourceCatalog,
  SavePromptRequest,
  SaveProviderRequest,
  SaveWorkflowRequest,
  StorageMigrationResult,
  StorageStats,
  ThemeMode,
  UpdateSettingsRequest,
} from '../../shared/contracts/desktop'
import { createRecentCanvasProject, isCanvasDocument } from '../../shared/domain/canvas-document'
import {
  DEFAULT_CHAT_MODEL_KEY,
  DEFAULT_IMAGE_MODEL_KEY,
  findBuiltinModelByKey,
  findBuiltinModelsByRemoteId,
  type ModelKind,
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
import { JsonFileStore, readJsonFile } from '../infrastructure/json-store'
import type { GeneratedImageMediaType } from '../infrastructure/image-generation-client'

const MAX_STORED_IMAGE_BYTES = 25 * 1024 * 1024
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

type StoredProvider = Readonly<{
  id: string
  baseUrl: string
  enabled?: boolean
  encryptedApiKey?: string
  connectionStatus?: ProviderConnectionStatus
  lastTestedAt?: string
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
}>

type ModelConfigDocument = Readonly<{
  schemaVersion: 5
  enabledModelKeys: ReadonlyArray<string>
  defaultModelKeys: Readonly<Partial<Record<ModelKind, string>>>
  providers: ReadonlyArray<StoredProvider>
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
    createDefaultProvider('apimart', 'https://api.apimart.ai/v1', false),
    createDefaultProvider('volcengine', 'https://ark.cn-beijing.volces.com/api/v3', true),
    createDefaultProvider('minimax', 'https://api.minimaxi.com/v1', true),
    createDefaultProvider('comfly', 'https://api.comfly.chat/v1', false),
    createDefaultProvider('openai', 'https://api.openai.com/v1', true),
    createDefaultProvider('openai-sub2api', '', false),
  ]
}

function createDefaultProvider(id: string, baseUrl: string, enabled: boolean): StoredProvider {
  return {
    id,
    baseUrl,
    enabled,
    connectionStatus: 'untested',
    availableModelIds: [],
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

      if (request.enabledModelKeys !== undefined || request.defaultModelKeys !== undefined) {
        await this.modelConfigStore.update((value) => {
          const current = this.normalizeModelConfig(value)
          const enabledModelKeys = request.enabledModelKeys !== undefined
            ? validModelKeys(request.enabledModelKeys)
            : current.enabledModelKeys
          const requestedDefaults = request.defaultModelKeys !== undefined
            ? normalizeDefaultModelKeys(request.defaultModelKeys, enabledModelKeys)
            : current.defaultModelKeys
          const defaults = normalizeDefaultModelKeys(requestedDefaults, enabledModelKeys)
          return {
            ...current,
            enabledModelKeys,
            defaultModelKeys: defaults,
          }
        })
      }

      return this.loadSettingsUnsafe()
    })
  }

  async saveProvider(request: SaveProviderRequest): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      let encryptedApiKey: string | undefined
      if (request.apiKey !== undefined) {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) {
          throw new ProviderSecretUnavailableError()
        }
        encryptedApiKey = (await safeStorage.encryptStringAsync(request.apiKey)).toString('base64')
      }

      const storedModelConfig = await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = current.providers.find((provider) => provider.id === request.id)
        const credentialsChanged = request.apiKey !== undefined
        const endpointChanged = existing?.baseUrl !== request.baseUrl
        const provider: StoredProvider = {
          id: request.id,
          baseUrl: request.baseUrl,
          enabled: existing?.enabled ?? true,
          ...(encryptedApiKey || existing?.encryptedApiKey
            ? { encryptedApiKey: encryptedApiKey ?? existing?.encryptedApiKey }
            : {}),
          connectionStatus:
            credentialsChanged || endpointChanged ? 'untested' : existing?.connectionStatus ?? 'untested',
          ...(!credentialsChanged && !endpointChanged && existing?.lastTestedAt
            ? { lastTestedAt: existing.lastTestedAt }
            : {}),
          availableModelIds:
            credentialsChanged || endpointChanged ? [] : existing?.availableModelIds ?? [],
        }
        return {
          ...current,
          providers: replaceProvider(current.providers, provider),
        }
      })
      const modelConfig = this.normalizeModelConfig(storedModelConfig)
      return this.toPublicProvider(findProvider(modelConfig, request.id))
    })
  }

  async clearProviderApiKey(id: string): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      const storedModelConfig = await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = findProvider(current, id)
        const provider: StoredProvider = {
          id: existing.id,
          baseUrl: existing.baseUrl,
          enabled: existing.enabled ?? true,
          connectionStatus: 'untested',
          availableModelIds: [],
        }
        return { ...current, providers: replaceProvider(current.providers, provider) }
      })
      const modelConfig = this.normalizeModelConfig(storedModelConfig)
      return this.toPublicProvider(findProvider(modelConfig, id))
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
      return this.toPublicProvider(findProvider(modelConfig, id))
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
    return this.withStorageOperation(async () =>
      this.toPublicProvider(findProvider(this.normalizeModelConfig(await this.modelConfigStore.read()), id)))
  }

  async markProviderTest(
    id: string,
    connectionStatus: Extract<ProviderConnectionStatus, 'connected' | 'failed'>,
    testedAt: string,
    availableModelIds: ReadonlyArray<string>,
  ): Promise<ProviderConfig> {
    return this.withStorageOperation(async () => {
      const storedModelConfig = await this.modelConfigStore.update((value) => {
        const current = this.normalizeModelConfig(value)
        const existing = findProvider(current, id)
        const provider: StoredProvider = {
          ...existing,
          connectionStatus,
          lastTestedAt: testedAt,
          availableModelIds: connectionStatus === 'connected' ? uniqueStrings(availableModelIds, 500) : [],
        }
        return { ...current, providers: replaceProvider(current.providers, provider) }
      })
      const modelConfig = this.normalizeModelConfig(storedModelConfig)
      return this.toPublicProvider(findProvider(modelConfig, id))
    })
  }

  async loadAutosave(): Promise<CanvasDocument | null> {
    return this.withStorageOperation(() => this.autosaveStore.read())
  }

  async saveAutosave(document: CanvasDocument): Promise<void> {
    await this.withStorageOperation(async () => {
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

  async recordArtwork(artwork: GeneratedArtwork): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(() => this.historyStore.update((value) => {
      const current = value ?? []
      return [artwork, ...current.filter((item) => item.id !== artwork.id)].slice(0, 200)
    }))
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
        await unlink(join(this.paths.imagesDirectory, artwork.imageFileName)).catch(() => undefined)
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
    const providers = defaultProviders().map((fallback) => {
      const stored = storedProviders.find((provider) => provider?.id === fallback.id) ?? (
        fallback.id === legacyOpenAiTarget ? legacyOpenAiProvider : undefined
      )
      if (!stored) return fallback
      const connectionStatus = isConnectionStatus(stored.connectionStatus)
        ? stored.connectionStatus
        : 'untested'
      const shouldMigrateMiniMaxGlobalEndpoint =
        fallback.id === 'minimax' &&
        stored.baseUrl === 'https://api.minimax.io/v1' &&
        !stored.encryptedApiKey
      return {
        id: fallback.id,
        baseUrl: fallback.id === 'openai'
          ? fallback.baseUrl
          : typeof stored.baseUrl === 'string' && stored.baseUrl && !shouldMigrateMiniMaxGlobalEndpoint
          ? stored.baseUrl
          : fallback.baseUrl,
        enabled: typeof stored.enabled === 'boolean' ? stored.enabled : fallback.enabled,
        ...(typeof stored.encryptedApiKey === 'string' && stored.encryptedApiKey
          ? { encryptedApiKey: stored.encryptedApiKey }
          : {}),
        connectionStatus,
        ...(typeof stored.lastTestedAt === 'string' && stored.lastTestedAt
          ? { lastTestedAt: stored.lastTestedAt }
          : {}),
        availableModelIds: uniqueStrings(stored.availableModelIds ?? [], 500),
      }
    })
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
    return {
      schemaVersion: 5,
      enabledModelKeys,
      defaultModelKeys,
      providers,
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
      enabledModelKeys: modelConfig.enabledModelKeys,
      defaultModelKeys: modelConfig.defaultModelKeys,
      providers: modelConfig.providers.map((provider) => this.toPublicProvider(provider)),
    }
  }

  private toPublicProvider(provider: StoredProvider): ProviderConfig {
    return {
      id: provider.id,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled === true,
      hasApiKey: Boolean(provider.encryptedApiKey),
      connectionStatus: isConnectionStatus(provider.connectionStatus)
        ? provider.connectionStatus
        : 'untested',
      ...(provider.lastTestedAt ? { lastTestedAt: provider.lastTestedAt } : {}),
      availableModelIds: uniqueStrings(provider.availableModelIds ?? [], 500),
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
  const remoteModelId = key.slice(key.indexOf(':') + 1).toLowerCase()
  if (/(speech|audio|voice|tts|music)/.test(remoteModelId)) return 'audio'
  if (/(video|veo|sora|seedance|kling|wan.*video)/.test(remoteModelId)) return 'video'
  if (/(image|seedream|flux|dall|midjourney|recraft|ideogram)/.test(remoteModelId)) return 'image'
  return 'chat'
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

function mediaTypeForFileName(fileName: string): GeneratedImageMediaType {
  if (fileName.endsWith('.jpg')) return 'image/jpeg'
  if (fileName.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}
