import { net } from 'electron/main'
import type { ProviderTestErrorCode } from '../../shared/contracts/desktop'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MODEL_COUNT = 500
const REQUEST_TIMEOUT_MS = 15_000

export type ProviderClientResult = Readonly<{
  latencyMs: number
  availableModelIds: ReadonlyArray<string>
  message: string
}>

export class ProviderRequestError extends Error {
  constructor(
    readonly code: ProviderTestErrorCode,
    message: string,
    readonly latencyMs?: number,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

export async function testOpenAiCompatibleProvider(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderClientResult> {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await net.fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt))

    if (response.status === 401 || response.status === 403) {
      throw new ProviderRequestError('AUTHENTICATION', 'API Key 无效或没有访问权限', latencyMs)
    }
    if (!response.ok) {
      throw new ProviderRequestError(
        'REMOTE',
        `服务商返回异常状态（HTTP ${response.status}）`,
        latencyMs,
      )
    }

    const payload = await readLimitedJson(response, latencyMs)
    const availableModelIds = extractModelIds(payload)
    return {
      latencyMs,
      availableModelIds,
      message: availableModelIds.length
        ? `连接成功，发现 ${availableModelIds.length} 个模型`
        : '连接成功，接口未返回可识别的模型列表',
    }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt))
    if (controller.signal.aborted) {
      throw new ProviderRequestError('TIMEOUT', '连接超时，请检查接口地址或网络', latencyMs)
    }
    throw new ProviderRequestError('NETWORK', '无法连接服务商，请检查接口地址和网络', latencyMs)
  } finally {
    clearTimeout(timeout)
  }
}

async function readLimitedJson(response: Response, latencyMs: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new ProviderRequestError('INVALID_RESPONSE', '服务商响应数据过大', latencyMs)
  }
  if (!response.body) return {}

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    totalBytes += chunk.value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new ProviderRequestError('INVALID_RESPONSE', '服务商响应数据过大', latencyMs)
    }
    chunks.push(chunk.value)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ProviderRequestError('INVALID_RESPONSE', '服务商未返回有效的 JSON 数据', latencyMs)
  }
}

function extractModelIds(payload: unknown): ReadonlyArray<string> {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : []

  const ids = candidates.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!isRecord(item)) return []
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : null
    return id ? [id] : []
  })
  return [...new Set(ids.filter((id) => id.length > 0 && id.length <= 200))].slice(0, MAX_MODEL_COUNT)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}
