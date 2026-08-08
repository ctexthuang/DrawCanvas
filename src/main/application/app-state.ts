import { dirname, join, resolve } from 'node:path'
import { unlink } from 'node:fs/promises'
import { app, safeStorage } from 'electron/main'
import type {
  AppSettings,
  CanvasDocument,
  GeneratedArtwork,
  ProviderConfig,
  ProviderConnectionStatus,
  ResourceCatalog,
  SaveProviderRequest,
  StorageMigrationResult,
  StorageStats,
  ThemeMode,
  UpdateSettingsRequest,
} from '../../shared/contracts/desktop'
import {
  DEFAULT_CHAT_MODEL_KEY,
  DEFAULT_IMAGE_MODEL_KEY,
  findBuiltinModelByKey,
  findBuiltinModelsByRemoteId,
  type ModelKind,
} from '../../shared/domain/models'
import {
  seedArtworks,
  seedPrompts,
  seedResourceCatalog,
  seedWorkflows,
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
  schemaVersion: 4
  enabledModelKeys: ReadonlyArray<string>
  defaultModelKeys: Readonly<Partial<Record<ModelKind, string>>>
  providers: ReadonlyArray<StoredProvider>
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
    createDefaultProvider('openai-relay', 'https://api.openai.com/v1', true),
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
    })
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

  async loadLibrary(): Promise<ReadonlyArray<GeneratedArtwork>> {
    return this.withStorageOperation(async () => (await this.libraryStore.read()) ?? seedArtworks)
  }

  async loadResources(): Promise<ResourceCatalog> {
    return this.withStorageOperation(async () => {
      const [prompts, workflows] = await Promise.all([
        this.promptsStore.read(),
        this.workflowsStore.read(),
      ])
      return {
        prompts: prompts ?? seedPrompts,
        workflows: workflows ?? seedWorkflows,
      }
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
    if (!library) await this.libraryStore.write(seedArtworks)
    if (!prompts) await this.promptsStore.write(seedResourceCatalog.prompts)
    if (!workflows) await this.workflowsStore.write(seedResourceCatalog.workflows)

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

  private get stores(): ReadonlyArray<JsonFileStore<unknown>> {
    return [
      this.preferencesStore,
      this.modelConfigStore,
      this.autosaveStore,
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
      favoriteImageIds: uniqueStrings(value?.favoriteImageIds ?? ['1', '2', '4', '6', '8'], 500),
    }
  }

  private normalizeModelConfig(value: StoredModelConfigDocument | null): ModelConfigDocument {
    const storedProviders = Array.isArray(value?.providers) ? value.providers : []
    const providers = defaultProviders().map((fallback) => {
      const stored = storedProviders.find((provider) => provider?.id === fallback.id)
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
        baseUrl: typeof stored.baseUrl === 'string' && stored.baseUrl && !shouldMigrateMiniMaxGlobalEndpoint
          ? stored.baseUrl
          : fallback.baseUrl,
        enabled: fallback.enabled === true && stored.enabled !== false,
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
      ? validModelKeys(value?.enabledModelKeys ?? [])
      : migrateLegacyModelIds(value?.selectedModelIds ?? LEGACY_DEFAULT_MODELS)
    const enabledModelKeys = (value?.schemaVersion ?? 0) < 3 && !storedEnabledModelKeys.includes(DEFAULT_CHAT_MODEL_KEY)
      ? [...storedEnabledModelKeys, DEFAULT_CHAT_MODEL_KEY]
      : storedEnabledModelKeys
    const storedDefaultModelKeys = (value?.schemaVersion ?? 0) >= 2
      ? value?.defaultModelKeys
      : { image: DEFAULT_IMAGE_MODEL_KEY }
    const defaultModelKeys = normalizeDefaultModelKeys(
      (value?.schemaVersion ?? 0) < 3
        ? { ...storedDefaultModelKeys, chat: DEFAULT_CHAT_MODEL_KEY }
        : storedDefaultModelKeys,
      enabledModelKeys,
    )
    return {
      schemaVersion: 4,
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

function validModelKeys(value: ReadonlyArray<unknown>): ReadonlyArray<string> {
  return uniqueStrings(value, 500)
    .map((key) => migrateModelKey(key))
    .filter((key): key is string => Boolean(
      key && /^[a-z0-9-]+:.+$/i.test(key) && key.length <= 400,
    ))
}

function migrateLegacyModelIds(modelIds: ReadonlyArray<string>): ReadonlyArray<string> {
  const normalizedIds = uniqueStrings(modelIds, 500)
  const isUntouchedLegacyDefault =
    normalizedIds.length === LEGACY_DEFAULT_MODELS.length &&
    LEGACY_DEFAULT_MODELS.every((id) => normalizedIds.includes(id))
  if (isUntouchedLegacyDefault) return [DEFAULT_IMAGE_MODEL_KEY]

  const keys = normalizedIds.flatMap((modelId) =>
    findBuiltinModelsByRemoteId(modelId).map((model) => model.key),
  )
  return keys.length ? validModelKeys(keys) : [DEFAULT_IMAGE_MODEL_KEY]
}

function normalizeDefaultModelKeys(
  value: Readonly<Partial<Record<ModelKind, string>>> | undefined,
  enabledModelKeys: ReadonlyArray<string>,
): Readonly<Partial<Record<ModelKind, string>>> {
  const defaults: Partial<Record<ModelKind, string>> = {}
  for (const kind of ['image', 'video', 'chat', 'audio'] as const) {
    const key = migrateModelKey(value?.[kind])
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

function migrateModelKey(key: string | undefined): string | undefined {
  if (key === 'volcengine:doubao-seedream-5-0-pro') {
    return 'volcengine:doubao-seedream-5-0-260128'
  }
  if (key === 'volcengine:doubao-seedream-4-5') {
    return 'volcengine:doubao-seedream-4-5-251128'
  }
  return key
}

function documentsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
