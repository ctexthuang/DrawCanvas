import { net } from 'electron/main'
import type { ProviderTestErrorCode } from '../../shared/contracts/desktop'
import type { DiscoveredProviderModel, ProviderAdapterId } from '../../shared/domain/models'
import { ApiMartRequestError, fetchApiMartModels } from './apimart/client'
import {
  createOpenAiEndpointCandidates,
  type OpenAiCompatibleProfile,
} from './openai-compatible-endpoints'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MODEL_COUNT = 500
const REQUEST_TIMEOUT_MS = 15_000

export type ProviderClientResult = Readonly<{
  latencyMs: number
  availableModels: ReadonlyArray<DiscoveredProviderModel>
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

export async function testProvider(
  adapterId: ProviderAdapterId,
  baseUrl: string,
  apiKey: string,
): Promise<ProviderClientResult> {
  if (adapterId !== 'apimart') {
    return testOpenAiCompatibleProvider(
      baseUrl,
      apiKey,
      adapterId === 'openai-sub2api' ? 'sub2api' : 'openai',
    )
  }

  const startedAt = performance.now()
  try {
    const availableModels = await fetchApiMartModels(baseUrl, apiKey)
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt))
    return {
      latencyMs,
      availableModels,
      message: availableModels.length
        ? `连接成功，发现 ${availableModels.length} 个模型`
        : '连接成功，API Mart 未返回可识别的模型列表',
    }
  } catch (error) {
    if (!(error instanceof ApiMartRequestError)) throw error
    throw new ProviderRequestError(mapApiMartErrorCode(error.code), error.message, Math.max(1, Math.round(performance.now() - startedAt)))
  }
}

export async function testOpenAiCompatibleProvider(
  baseUrl: string,
  apiKey: string,
  profile: OpenAiCompatibleProfile = 'openai',
): Promise<ProviderClientResult> {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const endpoints = createOpenAiEndpointCandidates(baseUrl, 'models', profile)
    for (const [index, endpoint] of endpoints.entries()) {
      const response = await net.fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'DrawCanvas/1.0',
        },
        signal: controller.signal,
        bypassCustomProtocolHandlers: true,
      })
      const latencyMs = Math.max(1, Math.round(performance.now() - startedAt))
      const body = await readLimitedBody(response, latencyMs)
      const payload = parseJson(body)
      const remoteMessage = extractRemoteErrorMessage(payload, body)

      if (response.status === 401 || response.status === 403) {
        throw new ProviderRequestError(
          'AUTHENTICATION',
          remoteMessage || 'API Key 无效或没有访问权限',
          latencyMs,
        )
      }
      if (!response.ok) {
        if ((response.status === 404 || response.status === 405) && index < endpoints.length - 1) continue
        throw new ProviderRequestError(
          'REMOTE',
          remoteMessage
            ? `${remoteMessage}（HTTP ${response.status}）`
            : `服务商返回异常状态（HTTP ${response.status}）`,
          latencyMs,
        )
      }
      if (payload === null) {
        throw new ProviderRequestError('INVALID_RESPONSE', '服务商未返回有效的 JSON 数据', latencyMs)
      }

      const availableModels = extractModelIds(payload).map((remoteModelId) => ({ remoteModelId }))
      return {
        latencyMs,
        availableModels,
        message: availableModels.length
          ? `连接成功，发现 ${availableModels.length} 个模型`
          : '连接成功，接口未返回可识别的模型列表',
      }
    }
    throw new ProviderRequestError('REMOTE', '服务商没有提供可用的模型列表接口')
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

function mapApiMartErrorCode(code: ApiMartRequestError['code']): ProviderTestErrorCode {
  switch (code) {
    case 'NETWORK': return 'NETWORK'
    case 'TIMEOUT': return 'TIMEOUT'
    case 'AUTHENTICATION': return 'AUTHENTICATION'
    case 'RATE_LIMIT':
    case 'REMOTE': return 'REMOTE'
    case 'INVALID_RESPONSE': return 'INVALID_RESPONSE'
  }
}

async function readLimitedBody(response: Response, latencyMs: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new ProviderRequestError('INVALID_RESPONSE', '服务商响应数据过大', latencyMs)
  }
  if (!response.body) return new Uint8Array()

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

  return Buffer.concat(chunks)
}

function parseJson(body: Uint8Array): unknown | null {
  if (body.byteLength === 0) return {}
  try {
    return JSON.parse(Buffer.from(body).toString('utf8')) as unknown
  } catch {
    return null
  }
}

function extractRemoteErrorMessage(payload: unknown | null, body: Uint8Array): string {
  if (isRecord(payload)) {
    const error = isRecord(payload.error) ? payload.error : null
    const candidate = error?.message ?? payload.message ?? payload.detail
    if (typeof candidate === 'string') return sanitizeRemoteMessage(candidate)
  }
  const contentTypeText = Buffer.from(body).toString('utf8').trim()
  return contentTypeText && !contentTypeText.startsWith('<')
    ? sanitizeRemoteMessage(contentTypeText)
    : ''
}

function sanitizeRemoteMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300)
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
