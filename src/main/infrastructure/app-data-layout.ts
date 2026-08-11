import { cp, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  StorageCategory,
  StorageCategoryStats,
  StorageStats,
} from '../../shared/contracts/desktop'
import { readJsonFile, writeJsonFile } from './json-store'

const DATA_LAYOUT_VERSION = 1
const DATA_MANIFEST_NAME = 'draw-canvas-data.json'
const DATA_LOCATOR_NAME = 'draw-canvas-data-location.json'
const DATA_DIRECTORIES: ReadonlyArray<StorageCategory> = [
  'projects',
  'history',
  'library',
  'resources',
  'settings',
  'database',
  'cache',
]
const MANAGED_ENTRY_NAMES: ReadonlyArray<string> = [DATA_MANIFEST_NAME, ...DATA_DIRECTORIES]

type DataLocatorDocument = Readonly<{
  schemaVersion: 1
  storageDirectory: string
}>

type DataManifestDocument = Readonly<{
  schemaVersion: 1
  application: 'draw-canvas'
}>

export type AppDataPaths = Readonly<{
  root: string
  manifest: string
  settingsDirectory: string
  preferences: string
  modelConfig: string
  projectsDirectory: string
  autosave: string
  recentProjects: string
  historyDirectory: string
  generationHistory: string
  videoGenerationHistory: string
  audioGenerationHistory: string
  libraryDirectory: string
  libraryCatalog: string
  imagesDirectory: string
  videosDirectory: string
  audiosDirectory: string
  resourcesDirectory: string
  prompts: string
  workflows: string
  databaseDirectory: string
  cacheDirectory: string
}>

export type AppDataMigrationSummary = Readonly<{
  sourceDirectory: string
  targetDirectory: string
  migratedBytes: number
  migratedFileCount: number
  sourceCleanupPending: boolean
}>

export class AppDataMigrationError extends Error {
  constructor(
    readonly code: 'INVALID_TARGET' | 'TARGET_CONFLICT' | 'COPY_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'AppDataMigrationError'
  }
}

export function createAppDataPaths(storageDirectory: string): AppDataPaths {
  const root = resolve(storageDirectory)
  const settingsDirectory = join(root, 'settings')
  const projectsDirectory = join(root, 'projects')
  const historyDirectory = join(root, 'history')
  const libraryDirectory = join(root, 'library')
  const resourcesDirectory = join(root, 'resources')
  return {
    root,
    manifest: join(root, DATA_MANIFEST_NAME),
    settingsDirectory,
    preferences: join(settingsDirectory, 'app-settings.json'),
    modelConfig: join(settingsDirectory, 'model-config.json'),
    projectsDirectory,
    autosave: join(projectsDirectory, 'autosave.drawcanvas.json'),
    recentProjects: join(projectsDirectory, 'recent-projects.json'),
    historyDirectory,
    generationHistory: join(historyDirectory, 'generation-history.json'),
    videoGenerationHistory: join(historyDirectory, 'video-generation-history.json'),
    audioGenerationHistory: join(historyDirectory, 'audio-generation-history.json'),
    libraryDirectory,
    libraryCatalog: join(libraryDirectory, 'catalog.json'),
    imagesDirectory: join(libraryDirectory, 'images'),
    videosDirectory: join(libraryDirectory, 'videos'),
    audiosDirectory: join(libraryDirectory, 'audios'),
    resourcesDirectory,
    prompts: join(resourcesDirectory, 'prompts.json'),
    workflows: join(resourcesDirectory, 'workflows.json'),
    databaseDirectory: join(root, 'database'),
    cacheDirectory: join(root, 'cache'),
  }
}

export async function ensureAppDataLayout(paths: AppDataPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.settingsDirectory, { recursive: true }),
    mkdir(paths.projectsDirectory, { recursive: true }),
    mkdir(paths.historyDirectory, { recursive: true }),
    mkdir(paths.imagesDirectory, { recursive: true }),
    mkdir(paths.videosDirectory, { recursive: true }),
    mkdir(paths.audiosDirectory, { recursive: true }),
    mkdir(paths.resourcesDirectory, { recursive: true }),
    mkdir(paths.databaseDirectory, { recursive: true }),
    mkdir(paths.cacheDirectory, { recursive: true }),
  ])
  const manifest: DataManifestDocument = {
    schemaVersion: DATA_LAYOUT_VERSION,
    application: 'draw-canvas',
  }
  if (!(await readJsonFile<DataManifestDocument>(paths.manifest))) {
    await writeJsonFile(paths.manifest, manifest)
  }
}

export async function readAppDataLocation(userDataDirectory: string): Promise<string | null> {
  const locator = await readJsonFile<DataLocatorDocument>(join(userDataDirectory, DATA_LOCATOR_NAME))
  if (
    locator?.schemaVersion !== DATA_LAYOUT_VERSION ||
    typeof locator.storageDirectory !== 'string' ||
    !locator.storageDirectory
  ) return null
  return resolve(locator.storageDirectory)
}

export async function writeAppDataLocation(
  userDataDirectory: string,
  storageDirectory: string,
): Promise<void> {
  const locator: DataLocatorDocument = {
    schemaVersion: DATA_LAYOUT_VERSION,
    storageDirectory: resolve(storageDirectory),
  }
  await writeJsonFile(join(userDataDirectory, DATA_LOCATOR_NAME), locator)
}

export async function migrateAppDataDirectory(
  sourceDirectory: string,
  targetDirectory: string,
): Promise<Omit<AppDataMigrationSummary, 'sourceCleanupPending'>> {
  const source = await canonicalDirectory(sourceDirectory)
  const target = await canonicalDirectory(targetDirectory)
  if (source === target) {
    return {
      sourceDirectory: source,
      targetDirectory: target,
      migratedBytes: 0,
      migratedFileCount: 0,
    }
  }
  if (isSameOrNestedPath(source, target) || isSameOrNestedPath(target, source)) {
    throw new AppDataMigrationError('INVALID_TARGET', '新旧数据目录不能互相包含')
  }
  await assertTargetHasNoAppData(target)

  const stagingDirectory = join(target, `.draw-canvas-migration-${randomUUID()}`)
  const stagingPaths = createAppDataPaths(stagingDirectory)
  const committedEntries: string[] = []
  try {
    await mkdir(stagingDirectory, { recursive: false })
    for (const entryName of MANAGED_ENTRY_NAMES) {
      const sourcePath = join(source, entryName)
      if (!(await pathExists(sourcePath))) continue
      await cp(sourcePath, join(stagingDirectory, entryName), {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      })
      await verifyCopy(sourcePath, join(stagingDirectory, entryName))
    }
    await ensureAppDataLayout(stagingPaths)
    const stagedStats = await collectStorageStats(stagingDirectory)

    await assertTargetHasNoAppData(target)
    for (const entryName of MANAGED_ENTRY_NAMES) {
      const stagedPath = join(stagingDirectory, entryName)
      if (!(await pathExists(stagedPath))) continue
      await rename(stagedPath, join(target, entryName))
      committedEntries.push(entryName)
    }
    await rm(stagingDirectory, { recursive: true, force: true })
    return {
      sourceDirectory: source,
      targetDirectory: target,
      migratedBytes: stagedStats.totalBytes,
      migratedFileCount: stagedStats.totalFileCount,
    }
  } catch (error) {
    for (const entryName of committedEntries.reverse()) {
      const committedPath = join(target, entryName)
      if (!(await pathExists(committedPath))) continue
      await rename(committedPath, join(stagingDirectory, entryName)).catch(() => undefined)
    }
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    if (error instanceof AppDataMigrationError) throw error
    throw new AppDataMigrationError('COPY_FAILED', '复制或校验应用数据失败')
  }
}

export async function removeManagedAppData(storageDirectory: string): Promise<boolean> {
  const root = resolve(storageDirectory)
  let cleanupPending = false
  for (const entryName of MANAGED_ENTRY_NAMES) {
    try {
      await rm(join(root, entryName), { recursive: true, force: true })
    } catch {
      cleanupPending = true
    }
  }
  // Keep the selected root itself even when empty. It may be a folder the user created explicitly.
  return cleanupPending
}

export async function collectStorageStats(storageDirectory: string): Promise<StorageStats> {
  const root = resolve(storageDirectory)
  const categoryEntries = await Promise.all(
    DATA_DIRECTORIES.map(async (category) => [category, await scanPath(join(root, category))] as const),
  )
  const categories = Object.fromEntries(categoryEntries) as Record<StorageCategory, StorageCategoryStats>
  let other = emptyCategoryStats()
  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (DATA_DIRECTORIES.includes(entry.name as StorageCategory)) continue
      other = addCategoryStats(other, await scanPath(join(root, entry.name)))
    }
  } catch {
    // A missing root is reported as an empty data directory.
  }
  const allCategories = { ...categories, other }
  const totals = Object.values(allCategories).reduce(addCategoryStats, emptyCategoryStats())
  return {
    totalBytes: totals.bytes,
    totalFileCount: totals.fileCount,
    categories: allCategories,
  }
}

async function assertTargetHasNoAppData(targetDirectory: string): Promise<void> {
  const conflicts = await Promise.all(
    MANAGED_ENTRY_NAMES.map(async (entryName) =>
      (await pathExists(join(targetDirectory, entryName))) ? entryName : null),
  )
  if (conflicts.some(Boolean)) {
    throw new AppDataMigrationError(
      'TARGET_CONFLICT',
      '目标目录已经包含 Draw Canvas 数据，请选择其他目录',
    )
  }
}

async function canonicalDirectory(directory: string): Promise<string> {
  const resolved = resolve(directory)
  try {
    await mkdir(resolved, { recursive: true })
    return await realpath(resolved)
  } catch {
    throw new AppDataMigrationError('INVALID_TARGET', '无法创建或访问所选数据目录')
  }
}

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const child = relative(parentPath, candidatePath)
  return child === '' || (!child.startsWith('..') && child !== '..')
}

async function verifyCopy(sourcePath: string, targetPath: string): Promise<void> {
  const [sourceStats, targetStats] = await Promise.all([scanPath(sourcePath), scanPath(targetPath)])
  if (
    sourceStats.bytes !== targetStats.bytes ||
    sourceStats.fileCount !== targetStats.fileCount
  ) {
    throw new AppDataMigrationError('COPY_FAILED', '数据复制校验失败')
  }
}

async function scanPath(path: string): Promise<StorageCategoryStats> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || info.isFile()) {
      return { bytes: info.size, fileCount: 1 }
    }
    if (!info.isDirectory()) return emptyCategoryStats()
    const entries = await readdir(path)
    const results = await Promise.all(entries.map((entry) => scanPath(join(path, entry))))
    return results.reduce(addCategoryStats, emptyCategoryStats())
  } catch {
    return emptyCategoryStats()
  }
}

function emptyCategoryStats(): StorageCategoryStats {
  return { bytes: 0, fileCount: 0 }
}

function addCategoryStats(
  left: StorageCategoryStats,
  right: StorageCategoryStats,
): StorageCategoryStats {
  return {
    bytes: left.bytes + right.bytes,
    fileCount: left.fileCount + right.fileCount,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
  }
}
