import { net } from 'electron/main'
import type { ImageGenerationSize } from '../../shared/contracts/desktop'
import {
  createOpenAiEndpointCandidates,
  type OpenAiCompatibleProfile,
} from './openai-compatible-endpoints'

const REQUEST_TIMEOUT_MS = 180_000
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 4

export type GeneratedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export type ImageGenerationClientResult = Readonly<{
  bytes: Uint8Array
  mediaType: GeneratedImageMediaType
}>

export type ImageGenerationRequestErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class ImageGenerationRequestError extends Error {
  constructor(
    readonly code: ImageGenerationRequestErrorCode,
    message: string,
  ) {
    super(message)
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
): Promise<ImageGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const endpoints = createOpenAiEndpointCandidates(baseUrl, 'images/generations', profile)
    for (const [index, endpoint] of endpoints.entries()) {
      const response = await net.fetch(endpoint, {
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
          n: 1,
          ...(profile === 'sub2api' ? { response_format: 'b64_json' } : {}),
        }),
        signal: controller.signal,
        bypassCustomProtocolHandlers: true,
      })
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
    if (controller.signal.aborted) {
      throw new ImageGenerationRequestError('TIMEOUT', '图片生成超时，请稍后重试')
    }
    throw new ImageGenerationRequestError('NETWORK', '无法连接图片服务，请检查网络和接口地址')
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
    const candidate = error?.message ?? payload.message ?? payload.detail
    if (typeof candidate === 'string') return sanitizeRemoteMessage(candidate)
  }
  const text = Buffer.from(body).toString('utf8').trim()
  return text && !text.startsWith('<') ? sanitizeRemoteMessage(text) : ''
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
