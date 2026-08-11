import { net } from 'electron/main'

const LATEST_RELEASE_ENDPOINT =
  'https://api.github.com/repos/ctexthuang/DrawCanvas/releases/latest'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 512 * 1024

export const DRAW_CANVAS_RELEASES_URL =
  'https://github.com/ctexthuang/DrawCanvas/releases/latest'

export type GithubReleaseClientErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class GithubReleaseClientError extends Error {
  constructor(readonly code: GithubReleaseClientErrorCode, message: string) {
    super(message)
    this.name = 'GithubReleaseClientError'
  }
}

export type GithubRelease = Readonly<{
  tagName: string
  name: string
  publishedAt?: string
}>

export async function fetchLatestGithubRelease(
  currentVersion: string,
): Promise<GithubRelease | null> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS)

  try {
    let response: Response
    try {
      response = await net.fetch(LATEST_RELEASE_ENDPOINT, {
        bypassCustomProtocolHandlers: true,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `DrawCanvas/${currentVersion}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: abortController.signal,
      })
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new GithubReleaseClientError('TIMEOUT', '检查更新超时，请稍后重试')
      }
      throw new GithubReleaseClientError('NETWORK', '无法连接 GitHub，请检查网络后重试')
    }

    if (response.status === 404) return null
    if (
      response.status === 429 ||
      response.headers.get('x-ratelimit-remaining') === '0'
    ) {
      throw new GithubReleaseClientError('RATE_LIMIT', 'GitHub 请求次数受限，请稍后重试')
    }
    if (!response.ok) {
      throw new GithubReleaseClientError(
        'REMOTE',
        `GitHub 更新服务暂不可用（HTTP ${response.status}）`,
      )
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new GithubReleaseClientError('INVALID_RESPONSE', 'GitHub Release 响应过大')
    }

    const responseBytes = await readBoundedResponse(response)

    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(responseBytes))
    } catch {
      throw new GithubReleaseClientError('INVALID_RESPONSE', 'GitHub Release 响应格式无效')
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new GithubReleaseClientError('INVALID_RESPONSE', 'GitHub Release 响应格式无效')
    }

    const release = payload as Record<string, unknown>
    if (
      typeof release.tag_name !== 'string' ||
      release.tag_name.length === 0 ||
      release.tag_name.length > 100
    ) {
      throw new GithubReleaseClientError('INVALID_RESPONSE', 'GitHub Release 缺少有效版本号')
    }

    const name = typeof release.name === 'string' && release.name.trim().length > 0
      ? release.name.trim().slice(0, 200)
      : release.tag_name
    const publishedAt = typeof release.published_at === 'string' &&
      release.published_at.length <= 100 &&
      Number.isFinite(Date.parse(release.published_at))
      ? new Date(release.published_at).toISOString()
      : undefined

    return {
      tagName: release.tag_name,
      name,
      ...(publishedAt ? { publishedAt } : {}),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new GithubReleaseClientError('INVALID_RESPONSE', 'GitHub Release 响应过大')
    }
    chunks.push(value)
  }

  const responseBytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    responseBytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return responseBytes
}
