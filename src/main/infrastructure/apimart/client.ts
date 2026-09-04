import { net } from 'electron/main'
import type { DiscoveredProviderModel, ModelKind } from '../../../shared/domain/models'
import { parseSafeRemoteMediaUrl } from '../remote-media-url'
import { createApiMartEndpoint } from './endpoints'

const JSON_RESPONSE_LIMIT = 4 * 1024 * 1024
const AUDIO_RESPONSE_LIMIT = 50 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000
const TASK_TIMEOUT_MS = 20 * 60_000
const POLL_INTERVAL_MS = 5_000
const MAX_MODEL_COUNT = 500

export type ApiMartRequestErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class ApiMartRequestError extends Error {
  constructor(
    readonly code: ApiMartRequestErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'ApiMartRequestError'
  }
}

export async function fetchApiMartModels(
  baseUrl: string,
  apiKey: string,
): Promise<ReadonlyArray<DiscoveredProviderModel>> {
  const endpoint = new URL(createApiMartEndpoint(baseUrl, 'models'))
  endpoint.searchParams.set('expand', 'category')
  const payload = await requestJson(endpoint.toString(), apiKey, { method: 'GET' })
  if (!Array.isArray(payload.data)) {
    throw new ApiMartRequestError('INVALID_RESPONSE', 'API Mart 模型目录响应缺少 data 数组')
  }

  const models: DiscoveredProviderModel[] = []
  const ids = new Set<string>()
  for (const item of payload.data) {
    if (!isRecord(item)) continue
    const remoteModelId = boundedString(item.id, 200) ?? boundedString(item.name, 200)
    if (!remoteModelId || ids.has(remoteModelId)) continue
    ids.add(remoteModelId)
    const kind = modelKind(item.category)
    const owner = boundedString(item.owned_by, 100)
    const capabilities = Array.isArray(item.capability_tags)
      ? item.capability_tags.flatMap((value) => boundedString(value, 100) ?? []).slice(0, 8)
      : []
    const description = [owner, ...capabilities].filter(Boolean).join(' · ').slice(0, 500)
    models.push({
      remoteModelId,
      displayName: remoteModelId,
      ...(kind ? { kind } : {}),
      ...(description ? { description: `API Mart · ${description}` } : { description: '由 API Mart 模型目录发现' }),
    })
    if (models.length >= MAX_MODEL_COUNT) break
  }
  return models
}

export async function submitApiMartMediaTask(request: Readonly<{
  baseUrl: string
  apiKey: string
  endpoint: 'images/generations' | 'videos/generations'
  body: Readonly<Record<string, unknown>>
  resultKind: 'image' | 'video'
}>): Promise<string> {
  const created = await requestJson(
    createApiMartEndpoint(request.baseUrl, request.endpoint),
    request.apiKey,
    { method: 'POST', body: request.body },
  )
  const taskId = extractTaskId(created)
  if (!taskId) throw new ApiMartRequestError('INVALID_RESPONSE', 'API Mart 未返回任务 ID')

  const deadline = Date.now() + TASK_TIMEOUT_MS
  while (Date.now() < deadline) {
    const taskPayload = await requestJson(
      withLanguage(createApiMartEndpoint(request.baseUrl, `tasks/${encodeURIComponent(taskId)}`)),
      request.apiKey,
      { method: 'GET' },
    )
    const task = isRecord(taskPayload.data) ? taskPayload.data : taskPayload
    const status = boundedString(task.status, 50)?.toLowerCase()
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const resultUrl = extractTaskResultUrl(task.result, request.resultKind)
      if (!resultUrl) {
        throw new ApiMartRequestError('INVALID_RESPONSE', `API Mart ${request.resultKind === 'image' ? '图片' : '视频'}任务已完成但缺少下载地址`)
      }
      return resultUrl
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      throw new ApiMartRequestError('REMOTE', extractRemoteMessage(task) || 'API Mart 媒体生成任务失败')
    }
    if (status !== 'pending' && status !== 'processing' && status !== 'submitted' && status !== 'queued' && status !== 'running') {
      throw new ApiMartRequestError('INVALID_RESPONSE', 'API Mart 任务状态响应无效')
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new ApiMartRequestError('TIMEOUT', 'API Mart 媒体生成等待超时，远端任务可能仍在运行')
}

export async function generateApiMartSpeech(request: Readonly<{
  baseUrl: string
  apiKey: string
  model: string
  input: string
  voice: string
  speed: number
}>): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 3)
  try {
    const response = await net.fetch(createApiMartEndpoint(request.baseUrl, 'audio/speech'), {
      method: 'POST',
      headers: {
        Accept: 'audio/wav,application/json',
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DrawCanvas/1.0',
      },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        voice: request.voice,
        response_format: 'wav',
        speed: request.speed,
      }),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    const bytes = await readLimitedBody(response, AUDIO_RESPONSE_LIMIT, 'API Mart 音频响应超过 50 MB')
    if (!response.ok || response.headers.get('content-type')?.includes('application/json')) {
      const payload = parseRecord(bytes)
      throwForRemoteResponse(response.status, payload)
      throw new ApiMartRequestError('INVALID_RESPONSE', 'API Mart 音频接口返回了无效响应')
    }
    if (!bytes.byteLength || !isWav(bytes)) {
      throw new ApiMartRequestError('INVALID_RESPONSE', 'API Mart 音频接口未返回有效的 WAV 数据')
    }
    return bytes
  } catch (error) {
    if (error instanceof ApiMartRequestError) throw error
    if (controller.signal.aborted) throw new ApiMartRequestError('TIMEOUT', 'API Mart 音频生成等待超时')
    throw new ApiMartRequestError('NETWORK', '无法连接 API Mart 音频服务，请检查网络和接口地址')
  } finally {
    clearTimeout(timeout)
  }
}

async function requestJson(
  url: string,
  apiKey: string,
  options: Readonly<{ method: 'GET' | 'POST'; body?: Readonly<Record<string, unknown>> }>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': 'DrawCanvas/1.0',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    const bytes = await readLimitedBody(response, JSON_RESPONSE_LIMIT, 'API Mart 响应数据过大')
    const payload = parseRecord(bytes)
    throwForRemoteResponse(response.status, payload)
    if (!payload) throw new ApiMartRequestError('INVALID_RESPONSE', 'API Mart 未返回有效的 JSON 数据')
    return payload
  } catch (error) {
    if (error instanceof ApiMartRequestError) throw error
    if (controller.signal.aborted) throw new ApiMartRequestError('TIMEOUT', 'API Mart 请求超时')
    throw new ApiMartRequestError('NETWORK', '无法连接 API Mart，请检查网络和接口地址')
  } finally {
    clearTimeout(timeout)
  }
}

function throwForRemoteResponse(status: number, payload: Record<string, unknown> | null): void {
  const message = extractRemoteMessage(payload)
  const payloadCode = typeof payload?.code === 'number' ? payload.code : null
  const remoteStatus = status >= 400 ? status : payloadCode
  if (remoteStatus === 401 || remoteStatus === 403) {
    throw new ApiMartRequestError('AUTHENTICATION', message || 'API Mart API Key 无效或没有访问权限', remoteStatus)
  }
  if (remoteStatus === 402 || remoteStatus === 429) {
    throw new ApiMartRequestError('RATE_LIMIT', message || 'API Mart 请求过于频繁或账户额度不足', remoteStatus)
  }
  if (status >= 400 || (payloadCode !== null && payloadCode !== 200) || payload?.success === false) {
    throw new ApiMartRequestError('REMOTE', message || `API Mart 请求失败（HTTP ${status}）`, remoteStatus ?? status)
  }
}

async function readLimitedBody(response: Response, maximumBytes: number, message: string): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ApiMartRequestError('INVALID_RESPONSE', message)
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    totalBytes += chunk.value.byteLength
    if (totalBytes > maximumBytes) {
      await reader.cancel()
      throw new ApiMartRequestError('INVALID_RESPONSE', message)
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

function parseRecord(bytes: Uint8Array): Record<string, unknown> | null {
  if (!bytes.byteLength) return null
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function extractTaskId(payload: Record<string, unknown>): string | null {
  const data = Array.isArray(payload.data) ? payload.data.find(isRecord) : isRecord(payload.data) ? payload.data : payload
  return boundedString(data?.task_id, 200) ?? boundedString(data?.id, 200)
}

function extractTaskResultUrl(value: unknown, kind: 'image' | 'video'): string | null {
  if (!isRecord(value)) return null
  const collection = value[kind === 'image' ? 'images' : 'videos']
  if (Array.isArray(collection)) {
    for (const item of collection) {
      const url = extractKnownUrl(item, kind)
      if (url) return url
    }
  }
  return extractKnownUrl(value, kind)
}

function extractKnownUrl(value: unknown, kind: 'image' | 'video'): string | null {
  if (typeof value === 'string') return boundedHttpsUrl(value)
  if (!isRecord(value)) return null
  const candidates = kind === 'image'
    ? [value.url, value.image_url, value.download_url]
    : [value.url, value.video_url, value.download_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const url = boundedHttpsUrl(candidate)
      if (url) return url
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item !== 'string') continue
        const url = boundedHttpsUrl(item)
        if (url) return url
      }
    }
  }
  return null
}

function extractRemoteMessage(value: unknown): string {
  if (!isRecord(value)) return ''
  const error = isRecord(value.error) ? value.error : null
  const data = isRecord(value.data) ? value.data : null
  const dataError = isRecord(data?.error) ? data.error : null
  const candidate = error?.message ?? dataError?.message ?? data?.message ?? value.message ?? value.msg
  return typeof candidate === 'string'
    ? candidate.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500)
    : ''
}

function modelKind(value: unknown): ModelKind | null {
  return value === 'chat' || value === 'image' || value === 'video' || value === 'audio'
    ? value
    : null
}

function boundedString(value: unknown, maximumLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength ? value : null
}

function boundedHttpsUrl(value: string): string | null {
  return parseSafeRemoteMediaUrl(value)?.toString() ?? null
}

function withLanguage(value: string): string {
  const url = new URL(value)
  url.searchParams.set('language', 'zh')
  return url.toString()
}

function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
