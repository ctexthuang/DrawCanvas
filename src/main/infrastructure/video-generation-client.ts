import { net } from 'electron/main'
import type {
  VideoGenerationRatio,
  VideoGenerationResolution,
} from '../../shared/contracts/desktop'
import type { ImageReferenceInput } from './image-generation-client'

const JSON_RESPONSE_LIMIT = 2 * 1024 * 1024
const VIDEO_RESPONSE_LIMIT = 300 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000
const TASK_TIMEOUT_MS = 20 * 60_000
const POLL_INTERVAL_MS = 10_000
const MAX_REDIRECTS = 4

export type VideoGenerationClientRequest = Readonly<{
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  duration: number
  resolution: VideoGenerationResolution
  ratio: VideoGenerationRatio
  referenceImages: ReadonlyArray<ImageReferenceInput>
}>

export type VideoGenerationClientResult = Readonly<{
  bytes: Uint8Array
  mediaType: 'video/mp4' | 'video/webm'
}>

export type VideoGenerationRequestErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class VideoGenerationRequestError extends Error {
  constructor(
    readonly code: VideoGenerationRequestErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'VideoGenerationRequestError'
  }
}

export async function generateMiniMaxVideo(
  request: VideoGenerationClientRequest,
): Promise<VideoGenerationClientResult> {
  const apiRoot = unversionedApiRoot(request.baseUrl)
  const isH3 = request.model === 'MiniMax-H3'
  const downloadUrl = isH3
    ? await generateMiniMaxH3Video(apiRoot, request)
    : await generateMiniMaxLegacyVideo(apiRoot, request)
  return downloadVideo(downloadUrl)
}

export async function generateVolcengineVideo(
  request: VideoGenerationClientRequest,
): Promise<VideoGenerationClientResult> {
  const createPayload = {
    model: request.model,
    content: [
      {
        type: 'text',
        text: `${request.prompt} --ratio ${request.ratio} --resolution ${volcengineResolution(request.resolution)} --dur ${request.duration}`,
      },
      ...request.referenceImages.map((image) => ({
        type: 'image_url',
        image_url: { url: imageDataUrl(image) },
      })),
    ],
  }
  const created = await requestJson(
    appendApiPath(request.baseUrl, 'contents/generations/tasks'),
    request.apiKey,
    { method: 'POST', body: createPayload },
  )
  const taskId = requiredString(created, 'id', '火山方舟未返回视频任务 ID')
  const deadline = Date.now() + TASK_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS)
    const task = await requestJson(
      appendApiPath(request.baseUrl, `contents/generations/tasks/${encodeURIComponent(taskId)}`),
      request.apiKey,
      { method: 'GET' },
    )
    const status = stringValue(task, 'status')?.toLowerCase()
    if (status === 'succeeded') {
      const content = recordValue(task, 'content')
      return downloadVideo(requiredString(content, 'video_url', '火山方舟任务成功但没有返回视频地址'))
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new VideoGenerationRequestError('REMOTE', remoteTaskError(task, '火山方舟视频生成失败'))
    }
  }
  throw new VideoGenerationRequestError('TIMEOUT', '视频生成等待超时，服务商任务可能仍在运行')
}

async function generateMiniMaxH3Video(
  apiRoot: string,
  request: VideoGenerationClientRequest,
): Promise<string> {
  const created = await requestJson(
    appendRootPath(apiRoot, 'v2/video_generation'),
    request.apiKey,
    {
      method: 'POST',
      body: {
        model: request.model,
        content: [
          { type: 'text', text: request.prompt },
          ...request.referenceImages.slice(0, 9).map((image) => ({
            type: 'image_url',
            image_url: { url: imageDataUrl(image) },
            role: 'reference_image',
          })),
        ],
        duration: request.duration,
        resolution: request.resolution === '2K' ? '2K' : '768P',
        ...(request.referenceImages.length === 0
          ? { ratio: request.ratio === 'adaptive' ? '16:9' : request.ratio }
          : {}),
      },
    },
  )
  const taskId = requiredString(created, 'task_id', 'MiniMax 未返回视频任务 ID')
  const deadline = Date.now() + TASK_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS)
    const payload = await requestJson(
      appendRootPath(apiRoot, `v2/query/video_generation/${encodeURIComponent(taskId)}`),
      request.apiKey,
      { method: 'GET' },
    )
    const task = recordValue(payload, 'task')
    const status = stringValue(task, 'status')?.toLowerCase()
    if (status === 'succeeded') {
      return requiredString(recordValue(task, 'content'), 'url', 'MiniMax 任务成功但没有返回视频地址')
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new VideoGenerationRequestError('REMOTE', remoteTaskError(task, 'MiniMax 视频生成失败'))
    }
  }
  throw new VideoGenerationRequestError('TIMEOUT', '视频生成等待超时，服务商任务可能仍在运行')
}

async function generateMiniMaxLegacyVideo(
  apiRoot: string,
  request: VideoGenerationClientRequest,
): Promise<string> {
  const duration = request.duration <= 6 ? 6 : 10
  const resolution = request.resolution === '1080P' || request.resolution === '2K'
    ? '1080P'
    : '768P'
  const firstFrame = request.referenceImages[0]
  const created = await requestJson(
    appendRootPath(apiRoot, 'v1/video_generation'),
    request.apiKey,
    {
      method: 'POST',
      body: {
        model: request.model,
        prompt: request.prompt,
        duration,
        resolution,
        ...(firstFrame ? { first_frame_image: imageDataUrl(firstFrame) } : {}),
      },
    },
  )
  const taskId = requiredString(created, 'task_id', 'MiniMax 未返回视频任务 ID')
  const deadline = Date.now() + TASK_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS)
    const payload = await requestJson(
      withQuery(appendRootPath(apiRoot, 'v1/query/video_generation'), 'task_id', taskId),
      request.apiKey,
      { method: 'GET' },
    )
    const status = stringValue(payload, 'status')?.toLowerCase()
    if (status === 'success' || status === 'succeeded') {
      const fileId = requiredString(payload, 'file_id', 'MiniMax 任务成功但没有返回视频文件 ID')
      const file = await requestJson(
        withQuery(appendRootPath(apiRoot, 'v1/files/retrieve'), 'file_id', fileId),
        request.apiKey,
        { method: 'GET' },
      )
      const fileRecord = recordValue(file, 'file')
      return requiredString(fileRecord, 'download_url', 'MiniMax 没有返回视频下载地址')
    }
    if (status === 'fail' || status === 'failed' || status === 'cancelled') {
      throw new VideoGenerationRequestError('REMOTE', remoteTaskError(payload, 'MiniMax 视频生成失败'))
    }
  }
  throw new VideoGenerationRequestError('TIMEOUT', '视频生成等待超时，服务商任务可能仍在运行')
}

async function requestJson(
  url: string,
  apiKey: string,
  options: Readonly<{ method: 'GET' | 'POST'; body?: unknown }>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'User-Agent': 'DrawCanvas/1.0',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    const bytes = await readLimitedBody(response, JSON_RESPONSE_LIMIT, '视频服务响应数据过大')
    const payload = parseRecord(bytes)
    const message = remoteTaskError(payload, '')
    if (response.status === 401 || response.status === 403) {
      throw new VideoGenerationRequestError('AUTHENTICATION', message || 'API Key 无效或没有视频生成权限')
    }
    if (response.status === 429) {
      throw new VideoGenerationRequestError('RATE_LIMIT', message || '请求过于频繁或账户额度不足，请稍后重试')
    }
    if (!response.ok) {
      throw new VideoGenerationRequestError(
        'REMOTE',
        message || `视频服务请求失败（HTTP ${response.status}）`,
        response.status,
      )
    }
    if (!payload) {
      throw new VideoGenerationRequestError('INVALID_RESPONSE', '视频服务未返回有效 JSON 数据')
    }
    return payload
  } catch (error) {
    if (error instanceof VideoGenerationRequestError) throw error
    if (controller.signal.aborted) throw new VideoGenerationRequestError('TIMEOUT', '视频服务请求超时')
    throw new VideoGenerationRequestError('NETWORK', '无法连接视频服务，请检查网络和接口地址')
  } finally {
    clearTimeout(timeout)
  }
}

async function downloadVideo(initialUrl: string): Promise<VideoGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 5)
  try {
    let currentUrl = safeHttpsUrl(initialUrl)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await net.fetch(currentUrl.toString(), {
        method: 'GET',
        headers: { Accept: 'video/mp4,video/webm,application/octet-stream' },
        redirect: 'manual',
        signal: controller.signal,
        bypassCustomProtocolHandlers: true,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location || redirects === MAX_REDIRECTS) {
          throw new VideoGenerationRequestError('INVALID_RESPONSE', '视频下载地址重定向异常')
        }
        currentUrl = safeHttpsUrl(new URL(location, currentUrl).toString())
        continue
      }
      if (!response.ok) {
        throw new VideoGenerationRequestError(
          'REMOTE',
          `生成视频下载失败（HTTP ${response.status}）`,
          response.status,
        )
      }
      const bytes = await readLimitedBody(response, VIDEO_RESPONSE_LIMIT, '生成视频文件过大')
      return { bytes, mediaType: detectVideoMediaType(bytes) }
    }
    throw new VideoGenerationRequestError('INVALID_RESPONSE', '视频下载地址重定向异常')
  } catch (error) {
    if (error instanceof VideoGenerationRequestError) throw error
    if (controller.signal.aborted) throw new VideoGenerationRequestError('TIMEOUT', '生成视频下载超时')
    throw new VideoGenerationRequestError('NETWORK', '无法下载生成视频')
  } finally {
    clearTimeout(timeout)
  }
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number,
  oversizedMessage: string,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new VideoGenerationRequestError('INVALID_RESPONSE', oversizedMessage)
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
      throw new VideoGenerationRequestError('INVALID_RESPONSE', oversizedMessage)
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

function parseRecord(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function detectVideoMediaType(bytes: Uint8Array): 'video/mp4' | 'video/webm' {
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  ) return 'video/mp4'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm'
  }
  throw new VideoGenerationRequestError('INVALID_RESPONSE', '视频服务返回了不支持的文件格式')
}

function imageDataUrl(image: ImageReferenceInput): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`
}

function volcengineResolution(resolution: VideoGenerationResolution): '720p' | '1080p' {
  return resolution === '1080P' || resolution === '2K' ? '1080p' : '720p'
}

function unversionedApiRoot(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '') || '/'
  return url.toString().replace(/\/+$/, '')
}

function appendRootPath(root: string, path: string): string {
  const url = new URL(root)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  return url.toString()
}

function appendApiPath(baseUrl: string, path: string): string {
  return appendRootPath(baseUrl, path)
}

function withQuery(url: string, key: string, value: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set(key, value)
  return parsed.toString()
}

function safeHttpsUrl(value: string): URL {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL')
    return url
  } catch {
    throw new VideoGenerationRequestError('INVALID_RESPONSE', '视频服务返回了不安全的下载地址')
  }
}

function requiredString(
  value: Record<string, unknown> | null,
  key: string,
  message: string,
): string {
  const result = stringValue(value, key)
  if (!result || result.length > 4096) throw new VideoGenerationRequestError('INVALID_RESPONSE', message)
  return result
}

function stringValue(value: Record<string, unknown> | null, key: string): string | null {
  const candidate = value?.[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function recordValue(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const candidate = value?.[key]
  return isRecord(candidate) ? candidate : null
}

function remoteTaskError(value: Record<string, unknown> | null, fallback: string): string {
  if (!value) return fallback
  const error = recordValue(value, 'error') ?? recordValue(value, 'base_resp')
  const candidate = stringValue(error, 'message') ?? stringValue(error, 'status_msg')
    ?? stringValue(value, 'message') ?? stringValue(value, 'detail')
  return candidate ? candidate.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
