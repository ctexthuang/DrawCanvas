import { net } from 'electron/main'
import type { ImageGenerationSize } from '../../shared/contracts/desktop'

const REQUEST_TIMEOUT_MS = 180_000
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

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
): Promise<ImageGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await net.fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })

    if (response.status === 401 || response.status === 403) {
      throw new ImageGenerationRequestError('AUTHENTICATION', 'API Key 无效或没有图片生成权限')
    }
    if (response.status === 429) {
      throw new ImageGenerationRequestError('RATE_LIMIT', '请求过于频繁或账户额度不足，请稍后重试')
    }
    if (!response.ok) {
      throw new ImageGenerationRequestError(
        'REMOTE',
        response.status >= 500
          ? `图片服务暂时不可用（HTTP ${response.status}）`
          : `图片生成请求被服务商拒绝（HTTP ${response.status}）`,
      )
    }

    return extractGeneratedImage(await readLimitedJson(response))
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

async function readLimitedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务响应数据过大')
  }
  if (!response.body) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务未返回内容')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    totalBytes += chunk.value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务响应数据过大')
    }
    chunks.push(chunk.value)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务未返回有效的 JSON 数据')
  }
}

function extractGeneratedImage(payload: unknown): ImageGenerationClientResult {
  if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.data[0])) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务响应缺少生成结果')
  }
  const encoded = payload.data[0].b64_json
  if (typeof encoded !== 'string' || !encoded) {
    throw new ImageGenerationRequestError(
      'INVALID_RESPONSE',
      '当前服务未返回可保存的图片数据，请确认接口兼容 OpenAI 图片生成格式',
    )
  }
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || !/^[a-z0-9+/=\r\n]+$/i.test(encoded)) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了无效或过大的图片数据')
  }

  const bytes = Buffer.from(encoded.replace(/\s/g, ''), 'base64')
  if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageGenerationRequestError('INVALID_RESPONSE', '图片服务返回了无效或过大的图片数据')
  }
  return { bytes, mediaType: detectMediaType(bytes) }
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
