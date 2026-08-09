import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

/**
 * A small single-process store for local JSON documents.
 *
 * The queue prevents concurrent renderer requests from overwriting each other,
 * while the cache avoids repeatedly parsing the same short-lived desktop state.
 */
export class JsonFileStore<T> {
  private cached = false
  private cachedValue: T | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly pathFactory: () => string) {}

  read(): Promise<T | null> {
    return this.enqueue(() => this.readUnsafe())
  }

  write(value: T): Promise<T> {
    return this.enqueue(async () => {
      await writeJsonFile(this.pathFactory(), value)
      this.cachedValue = value
      this.cached = true
      return value
    })
  }

  update(updater: (current: T | null) => T): Promise<T> {
    return this.enqueue(async () => {
      const current = await this.readUnsafe()
      const next = updater(current)
      await writeJsonFile(this.pathFactory(), next)
      this.cachedValue = next
      this.cached = true
      return next
    })
  }

  remove(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await unlink(this.pathFactory())
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      this.cachedValue = null
      this.cached = true
    })
  }

  async drain(): Promise<void> {
    await this.queue
  }

  resetCache(): void {
    this.cached = false
    this.cachedValue = null
  }

  private async readUnsafe(): Promise<T | null> {
    if (!this.cached) {
      this.cachedValue = await readJsonFile<T>(this.pathFactory())
      this.cached = true
    }
    return this.cachedValue
  }

  private enqueue<TResult>(task: () => Promise<TResult>): Promise<TResult> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}
