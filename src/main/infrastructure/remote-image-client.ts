import { isIP } from 'node:net'
import { net } from 'electron/main'
import {
  isPublicRemoteMediaAddress,
  parseSafeRemoteMediaUrl,
} from './remote-media-url'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024

export class RemoteImageRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteImageRequestError'
  }
}

export async function downloadRemoteImage(
  initialUrl: string,
  maximumBytes = MAX_REMOTE_IMAGE_BYTES,
): Promise<Readonly<{ bytes: Uint8Array; title: string }>> {
  if (!Number.isFinite(maximumBytes) || maximumBytes <= 0) {
    throw new RemoteImageRequestError('本次粘贴图片总大小超过 50 MB')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    let currentUrl = requireSafeUrl(initialUrl)
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await requirePublicResolution(currentUrl)
      const response = await net.fetch(currentUrl.toString(), {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Accept: 'image/png,image/jpeg,image/webp',
          'User-Agent': 'DrawCanvas/1.0',
        },
        referrerPolicy: 'no-referrer',
        redirect: 'manual',
        signal: controller.signal,
        bypassCustomProtocolHandlers: true,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new RemoteImageRequestError('网络图片重定向次数过多或地址无效')
        }
        currentUrl = requireSafeUrl(new URL(location, currentUrl).toString())
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new RemoteImageRequestError(`网络图片下载失败（HTTP ${response.status}）`)
      }
      const bytes = await readLimitedBody(response, Math.min(maximumBytes, MAX_REMOTE_IMAGE_BYTES))
      if (bytes.byteLength === 0) throw new RemoteImageRequestError('网络图片内容为空')
      return { bytes, title: titleFromUrl(currentUrl) }
    }
    throw new RemoteImageRequestError('网络图片重定向次数过多')
  } catch (error) {
    if (error instanceof RemoteImageRequestError) throw error
    if (controller.signal.aborted) throw new RemoteImageRequestError('网络图片下载超时')
    throw new RemoteImageRequestError('无法下载网络图片，请检查图片地址和网络连接')
  } finally {
    clearTimeout(timeout)
  }
}

async function requirePublicResolution(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) !== 0) {
    if (!isPublicRemoteMediaAddress(hostname)) {
      throw new RemoteImageRequestError('网络图片地址解析到了本机或非公开网络')
    }
    return
  }
  let endpoints: ReadonlyArray<Readonly<{ address: string }>>
  try {
    endpoints = (await net.resolveHost(hostname, {
      cacheUsage: 'allowed',
      secureDnsPolicy: 'allow',
      source: 'any',
    })).endpoints
  } catch {
    throw new RemoteImageRequestError('无法解析网络图片地址')
  }
  if (endpoints.length === 0 || endpoints.some((endpoint) => !isPublicRemoteMediaAddress(endpoint.address))) {
    throw new RemoteImageRequestError('网络图片地址解析到了本机或非公开网络')
  }
}

async function readLimitedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (maximumBytes <= 0) throw new RemoteImageRequestError('本次粘贴图片总大小超过 50 MB')
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new RemoteImageRequestError('网络图片超过单张或本次粘贴大小限制')
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
      throw new RemoteImageRequestError('网络图片超过单张或本次粘贴大小限制')
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

function requireSafeUrl(value: string): URL {
  const url = parseSafeRemoteMediaUrl(value)
  if (url) return url
  throw new RemoteImageRequestError('仅支持公开可访问的 HTTPS 网络图片地址')
}

function titleFromUrl(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
  try {
    return decodeURIComponent(segment).replace(/\.(?:png|jpe?g|webp)$/i, '').trim().slice(0, 200) || '网络图片'
  } catch {
    return segment.replace(/\.(?:png|jpe?g|webp)$/i, '').trim().slice(0, 200) || '网络图片'
  }
}
