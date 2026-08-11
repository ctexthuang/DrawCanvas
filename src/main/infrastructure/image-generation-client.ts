import { net } from 'electron/main'
import type { ImageGenerationSize } from '../../shared/contracts/desktop'
import {
  createOpenAiEndpointCandidates,
  type OpenAiCompatibleProfile,
} from './openai-compatible-endpoints'

const REQUEST_TIMEOUT_MS = 180_000
const PREMATURE_DISCONNECT_THRESHOLD_MS = 30_000
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 4

export type GeneratedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export type ImageGenerationClientResult = Readonly<{
  bytes: Uint8Array
  mediaType: GeneratedImageMediaType
}>

export type ImageReferenceInput = Readonly<{
  fileName: string
  bytes: Uint8Array
  mediaType: GeneratedImageMediaType
}>

export type ImageGenerationRequestErrorCode =
  | 'NETWORK'
  | 'DNS'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_CLOSED'
  | 'TLS'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class ImageGenerationRequestError extends Error {
  constructor(
    readonly code: ImageGenerationRequestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ImageGenerationRequestError'
  }
}

export async function generateOpenAiCompatibleImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: ImageGenerationSize,
  profile: OpenAiCompatibleProfile = 'openai',
  referenceImages: ReadonlyArray<ImageReferenceInput> = [],
): Promise<ImageGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  let hasReceivedResponse = false

  try {
    const endpointName = referenceImages.length > 0 ? 'images/edits' : 'images/generations'
    const endpoints = createOpenAiEndpointCandidates(baseUrl, endpointName, profile)
    for (const [index, endpoint] of endpoints.entries()) {
      hasReceivedResponse = false
      const multipartBody = referenceImages.length > 0
        ? createImageEditForm(model, prompt, size, profile, referenceImages)
        : null
      const response = await net.fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(!multipartBody ? { 'Content-Type': 'application/json' } : {}),
          'User-Agent': 'DrawCanvas/1.0',
        },
        body: multipartBody ?? JSON.stringify({
          model,
          prompt,
          size,
          n: 1,
          ...(profile === 'sub2api' ? { response_format: 'b64_json' } : {}),
        }),
        signal: controller.signal,
        bypassCustomProtocolHandlers: true,
      })
      hasReceivedResponse = true
      const body = await readLimitedBody(
        response,
        MAX_RESPONSE_BYTES,
        '图片服务响应数据过大',
      )
      const payload = parseJson(body)
      const remoteMessage = extractRemoteErrorMessage(payload, body)

      if (response.status === 401 || response.status === 403) {
        throw new ImageGenerationRequestError(
          'AUTHENTICATION',
          remoteMessage || 'API Key 无效或没有图片生成权限',
        )
      }
      if (response.status === 429) {
        throw new ImageGenerationRequestError(
          'RATE_LIMIT',
          remoteMessage || '请求过于频繁或账户额度不足，请稍后重试',
        )
      }
      if (!response.ok) {
        if ((response.status === 404 || response.status === 405) && index < endpoints.length - 1) continue
        throw new ImageGenerationRequestError(
          'REMOTE',
          remoteMessage
            ? `${remoteMessage}（HTTP ${response.status}）`
            : response.status >= 500
              ? `图片服务暂时不可用（HTTP ${response.status}）`
              : `图片生成请求被服务商拒绝（HTTP ${response.status}）`,
        )
      }
      if (payload === null) {
        throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务未返回有效的 JSON 数据')
      }
      return await extractGeneratedImage(payload, controller.signal)
    }
    throw new ImageGenerationRequestError('REMOTE', '中转站没有提供兼容的图片生成接口')
  } catch (error) {
    if (error instanceof ImageGenerationRequestError) throw error
    throw classifyRequestFailure(error, controller.signal, startedAt, hasReceivedResponse)
  } finally {
    clearTimeout(timeout)
  }
}

export async function generateVolcengineImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: ImageGenerationSize,
  referenceImages: ReadonlyArray<ImageReferenceInput> = [],
): Promise<ImageGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  let hasReceivedResponse = false
  try {
    const endpoint = new URL(baseUrl)
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/images/generations`
    const response = await net.fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DrawCanvas/1.0',
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        response_format: 'b64_json',
        ...(referenceImages.length > 0
          ? { image: referenceImages.map(referenceImageDataUrl) }
          : {}),
      }),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    hasReceivedResponse = true
    const body = await readLimitedBody(response, MAX_RESPONSE_BYTES, '图片服务响应数据过大')
    const payload = parseJson(body)
    const remoteMessage = extractRemoteErrorMessage(payload, body)
    if (response.status === 401 || response.status === 403) {
      throw new ImageGenerationRequestError('AUTHENTICATION', remoteMessage || 'API Key 无效或没有图片生成权限')
    }
    if (response.status === 429) {
      throw new ImageGenerationRequestError('RATE_LIMIT', remoteMessage || '请求过于频繁或账户额度不足，请稍后重试')
    }
    if (!response.ok) {
      throw new ImageGenerationRequestError('REMOTE', remoteMessage || `图片生成请求被服务商拒绝（HTTP ${response.status}）`)
    }
    if (payload === null) {
      throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务未返回有效的 JSON 数据')
    }
    return await extractGeneratedImage(payload, controller.signal)
  } catch (error) {
    if (error instanceof ImageGenerationRequestError) throw error
    throw classifyRequestFailure(error, controller.signal, startedAt, hasReceivedResponse)
  } finally {
    clearTimeout(timeout)
  }
}

export async function generateMiniMaxImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: ImageGenerationSize,
  referenceImages: ReadonlyArray<ImageReferenceInput> = [],
): Promise<ImageGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  let hasReceivedResponse = false
  try {
    const endpoint = new URL(baseUrl)
    const basePath = endpoint.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')
    endpoint.pathname = `${basePath}/v1/image_generation`
    const response = await net.fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DrawCanvas/1.0',
      },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: imageSizeAspectRatio(size),
        response_format: 'base64',
        n: 1,
        ...(referenceImages.length > 0
          ? {
              subject_reference: referenceImages.slice(0, 9).map((reference) => ({
                type: 'character',
                image_file: referenceImageDataUrl(reference),
              })),
            }
          : {}),
      }),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    hasReceivedResponse = true
    const body = await readLimitedBody(response, MAX_RESPONSE_BYTES, '图片服务响应数据过大')
    const payload = parseJson(body)
    const remoteMessage = extractRemoteErrorMessage(payload, body)
    if (response.status === 401 || response.status === 403) {
      throw new ImageGenerationRequestError('AUTHENTICATION', remoteMessage || 'API Key 无效或没有图片生成权限')
    }
    if (response.status === 429) {
      throw new ImageGenerationRequestError('RATE_LIMIT', remoteMessage || '请求过于频繁或账户额度不足，请稍后重试')
    }
    if (!response.ok) {
      throw new ImageGenerationRequestError('REMOTE', remoteMessage || `图片生成请求被服务商拒绝（HTTP ${response.status}）`)
    }
    return await extractMiniMaxImage(payload, controller.signal)
  } catch (error) {
    if (error instanceof ImageGenerationRequestError) throw error
    throw classifyRequestFailure(error, controller.signal, startedAt, hasReceivedResponse)
  } finally {
    clearTimeout(timeout)
  }
}

function classifyRequestFailure(
  error: unknown,
  signal: AbortSignal,
  startedAt: number,
  hasReceivedResponse: boolean,
): ImageGenerationRequestError {
  const elapsedMs = Math.max(0, Date.now() - startedAt)
  const fingerprint = errorFingerprint(error)
  const options = { cause: error }

  if (signal.aborted) {
    return new ImageGenerationRequestError(
      'TIMEOUT',
      `Draw Canvas 等待图片结果超过 ${formatDuration(REQUEST_TIMEOUT_MS)}，已停止请求`,
      options,
    )
  }
  if (includesAny(fingerprint, ['ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED', 'NAME_NOT_RESOLVED'])) {
    return new ImageGenerationRequestError(
      'DNS',
      '无法解析图片服务域名，请检查接口地址和 DNS 设置',
      options,
    )
  }
  if (includesAny(fingerprint, ['ECONNREFUSED', 'ERR_CONNECTION_REFUSED', 'CONNECTION_REFUSED'])) {
    return new ImageGenerationRequestError(
      'CONNECTION_REFUSED',
      '图片服务拒绝连接，请确认中转站正在运行且端口可以访问',
      options,
    )
  }
  if (includesAny(fingerprint, ['ERR_CERT', 'CERT_', 'TLS', 'SSL'])) {
    return new ImageGenerationRequestError(
      'TLS',
      '图片服务 HTTPS 证书或 TLS 连接校验失败',
      options,
    )
  }
  if (
    hasReceivedResponse ||
    elapsedMs >= PREMATURE_DISCONNECT_THRESHOLD_MS ||
    includesAny(fingerprint, [
      'ECONNRESET',
      'EPIPE',
      'UND_ERR_SOCKET',
      'ERR_CONNECTION_RESET',
      'ERR_CONNECTION_CLOSED',
      'ERR_EMPTY_RESPONSE',
      'ERR_CONTENT_LENGTH_MISMATCH',
      'ERR_INCOMPLETE_CHUNKED_ENCODING',
      'SOCKET HANG UP',
      'TERMINATED',
    ])
  ) {
    return new ImageGenerationRequestError(
      'CONNECTION_CLOSED',
      `图片服务连接在等待 ${formatDuration(elapsedMs)} 后被中转站、反向代理或上游提前断开；Draw Canvas 尚未达到自身超时`,
      options,
    )
  }
  return new ImageGenerationRequestError(
    'NETWORK',
    '无法建立图片服务连接，请检查网络和接口地址',
    options,
  )
}

function errorFingerprint(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.name, current.message)
      current = current.cause
      continue
    }
    if (isRecord(current)) {
      for (const key of ['name', 'code', 'message']) {
        const value = current[key]
        if (typeof value === 'string') parts.push(value)
      }
      current = current.cause
      continue
    }
    parts.push(String(current))
    break
  }
  return parts.join(' ').toUpperCase()
}

function includesAny(value: string, candidates: ReadonlyArray<string>): boolean {
  return candidates.some((candidate) => value.includes(candidate))
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000))
  return `${seconds} 秒`
}

function createImageEditForm(
  model: string,
  prompt: string,
  size: ImageGenerationSize,
  profile: OpenAiCompatibleProfile,
  referenceImages: ReadonlyArray<ImageReferenceInput>,
): FormData {
  const body = new FormData()
  body.set('model', model)
  body.set('prompt', prompt)
  body.set('size', size)
  body.set('n', '1')
  if (profile === 'sub2api') body.set('response_format', 'b64_json')
  for (const reference of referenceImages) {
    body.append('image[]', new Blob([Uint8Array.from(reference.bytes).buffer], { type: reference.mediaType }), reference.fileName)
  }
  return body
}

function referenceImageDataUrl(reference: ImageReferenceInput): string {
  return `data:${reference.mediaType};base64,${Buffer.from(reference.bytes).toString('base64')}`
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number,
  oversizedMessage: string,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', oversizedMessage)
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
      throw new ImageGenerationRequestError('INVALID_RESPONSE', oversizedMessage)
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

function parseJson(body: Uint8Array): unknown | null {
  if (body.byteLength === 0) return null
  try {
    return JSON.parse(Buffer.from(body).toString('utf8')) as unknown
  } catch {
    return null
  }
}

async function extractGeneratedImage(
  payload: unknown,
  signal: AbortSignal,
): Promise<ImageGenerationClientResult> {
  if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.data[0])) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务响应缺少生成结果')
  }
  const image = payload.data[0]
  const encoded = [image.b64_json, image.base64, image.image_base64]
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  if (encoded) return decodeBase64Image(encoded)

  if (typeof image.url === 'string' && image.url) {
    return image.url.startsWith('data:')
      ? decodeImageDataUrl(image.url)
      : downloadGeneratedImage(image.url, signal)
  }
  throw new ImageGenerationRequestError(
    'INVALID_RESPONSE',
    '当前服务未返回可保存的图片数据，请确认接口兼容 OpenAI 图片生成格式',
  )
}

async function extractMiniMaxImage(
  payload: unknown,
  signal: AbortSignal,
): Promise<ImageGenerationClientResult> {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', 'MiniMax 图片服务响应缺少生成结果')
  }
  const encoded = Array.isArray(payload.data.image_base64)
    ? payload.data.image_base64.find((value): value is string => typeof value === 'string' && value.length > 0)
    : undefined
  if (encoded) return decodeBase64Image(encoded)
  const imageUrl = Array.isArray(payload.data.image_urls)
    ? payload.data.image_urls.find((value): value is string => typeof value === 'string' && value.length > 0)
    : undefined
  if (imageUrl) {
    return imageUrl.startsWith('data:')
      ? decodeImageDataUrl(imageUrl)
      : downloadGeneratedImage(imageUrl, signal)
  }
  throw new ImageGenerationRequestError('INVALID_RESPONSE', 'MiniMax 没有返回可保存的图片数据')
}

function decodeImageDataUrl(value: string): ImageGenerationClientResult {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(value)
  if (!match) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了无效的 data URL')
  }
  return decodeBase64Image(match[2])
}

function decodeBase64Image(encoded: string): ImageGenerationClientResult {
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || !/^[a-z0-9+/=\r\n]+$/i.test(encoded)) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了无效或过大的图片数据')
  }
  const bytes = Buffer.from(encoded.replace(/\s/g, ''), 'base64')
  if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了无效或过大的图片数据')
  }
  return { bytes, mediaType: detectMediaType(bytes) }
}

async function downloadGeneratedImage(
  initialUrl: string,
  signal: AbortSignal,
): Promise<ImageGenerationClientResult> {
  let currentUrl = validateRemoteImageUrl(initialUrl)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await net.fetch(currentUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'image/png,image/jpeg,image/webp' },
      redirect: 'manual',
      signal,
      bypassCustomProtocolHandlers: true,
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片下载地址重定向异常')
      }
      currentUrl = validateRemoteImageUrl(new URL(location, currentUrl).toString())
      continue
    }
    if (!response.ok) {
      throw new ImageGenerationRequestError('REMOTE', `生成图片下载失败（HTTP ${response.status}）`)
    }
    const bytes = await readLimitedBody(response, MAX_IMAGE_BYTES, '生成图片文件过大')
    if (!bytes.byteLength) {
      throw new ImageGenerationRequestError('INVALID_RESPONSE', '生成图片文件为空')
    }
    return { bytes, mediaType: detectMediaType(bytes) }
  }
  throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片下载地址重定向异常')
}

function validateRemoteImageUrl(value: string): URL {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe image URL')
    return url
  } catch {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了不安全的下载地址')
  }
}

function extractRemoteErrorMessage(payload: unknown | null, body: Uint8Array): string {
  if (isRecord(payload)) {
    const error = isRecord(payload.error) ? payload.error : null
    const baseResponse = isRecord(payload.base_resp) ? payload.base_resp : null
    const candidate = error?.message ?? baseResponse?.status_msg ?? payload.message ?? payload.detail
    if (typeof candidate === 'string') return sanitizeRemoteMessage(candidate)
  }
  const text = Buffer.from(body).toString('utf8').trim()
  return text && !text.startsWith('<') ? sanitizeRemoteMessage(text) : ''
}

function imageSizeAspectRatio(size: ImageGenerationSize): '1:1' | '16:9' | '4:3' | '3:2' | '2:3' | '3:4' | '9:16' | '21:9' {
  switch (size) {
    case '1280x720': return '16:9'
    case '1152x864': return '4:3'
    case '1248x832': return '3:2'
    case '832x1248': return '2:3'
    case '864x1152': return '3:4'
    case '720x1280': return '9:16'
    case '1344x576': return '21:9'
    default: return '1:1'
  }
}

function sanitizeRemoteMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500)
}

function detectMediaType(bytes: Uint8Array): GeneratedImageMediaType {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp'
  throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了不支持的文件格式')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}
