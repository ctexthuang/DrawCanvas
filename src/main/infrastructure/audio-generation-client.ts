import { net } from 'electron/main'

const REQUEST_TIMEOUT_MS = 180_000
const MAX_RESPONSE_BYTES = 100 * 1024 * 1024
const MAX_AUDIO_BYTES = 50 * 1024 * 1024

export type AudioGenerationClientRequest = Readonly<{
  baseUrl: string
  apiKey: string
  model: string
  text: string
  voiceId: string
  speed: number
  pitch: number
  emotion: string
}>

export type AudioGenerationClientResult = Readonly<{
  bytes: Uint8Array
  mediaType: 'audio/mpeg'
  durationMs: number
}>

export type AudioGenerationRequestErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class AudioGenerationRequestError extends Error {
  constructor(
    readonly code: AudioGenerationRequestErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'AudioGenerationRequestError'
  }
}

export async function generateMiniMaxAudio(
  request: AudioGenerationClientRequest,
): Promise<AudioGenerationClientResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await net.fetch(miniMaxSpeechEndpoint(request.baseUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DrawCanvas/1.0',
      },
      body: JSON.stringify({
        model: request.model,
        text: request.text,
        stream: false,
        output_format: 'hex',
        voice_setting: {
          voice_id: request.voiceId,
          speed: request.speed,
          vol: 1,
          pitch: request.pitch,
          ...(request.emotion ? { emotion: request.emotion } : {}),
        },
        audio_setting: {
          sample_rate: 32_000,
          bitrate: 128_000,
          format: 'mp3',
          channel: 1,
        },
        subtitle_enable: false,
      }),
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    })
    const bytes = await readLimitedBody(response)
    const payload = parseJson(bytes)
    const remoteMessage = extractRemoteError(payload)
    if (response.status === 401 || response.status === 403) {
      throw new AudioGenerationRequestError('AUTHENTICATION', remoteMessage || 'MiniMax API Key 无效或没有语音模型权限')
    }
    if (response.status === 429) {
      throw new AudioGenerationRequestError('RATE_LIMIT', remoteMessage || 'MiniMax 语音请求过于频繁或额度不足')
    }
    if (!response.ok) {
      throw new AudioGenerationRequestError(
        'REMOTE',
        remoteMessage || `MiniMax 语音请求失败（HTTP ${response.status}）`,
        response.status,
      )
    }
    if (!isRecord(payload)) {
      throw new AudioGenerationRequestError('INVALID_RESPONSE', 'MiniMax 语音响应不是有效 JSON')
    }
    const baseResponse = isRecord(payload.base_resp) ? payload.base_resp : null
    if (typeof baseResponse?.status_code === 'number' && baseResponse.status_code !== 0) {
      throw new AudioGenerationRequestError('REMOTE', remoteMessage || `MiniMax 语音生成失败（${baseResponse.status_code}）`)
    }
    const data = isRecord(payload.data) ? payload.data : null
    const audioHex = typeof data?.audio === 'string' ? data.audio.trim() : ''
    if (!audioHex || audioHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(audioHex)) {
      throw new AudioGenerationRequestError('INVALID_RESPONSE', 'MiniMax 语音响应缺少有效音频数据')
    }
    const audioBytes = Buffer.from(audioHex, 'hex')
    if (audioBytes.byteLength === 0 || audioBytes.byteLength > MAX_AUDIO_BYTES) {
      throw new AudioGenerationRequestError('INVALID_RESPONSE', 'MiniMax 返回的音频为空或超过 50 MB')
    }
    const extraInfo = isRecord(payload.extra_info) ? payload.extra_info : null
    const durationMs = typeof extraInfo?.audio_length === 'number' && Number.isFinite(extraInfo.audio_length)
      ? Math.max(0, Math.round(extraInfo.audio_length))
      : 0
    return { bytes: audioBytes, mediaType: 'audio/mpeg', durationMs }
  } catch (error) {
    if (error instanceof AudioGenerationRequestError) throw error
    if (controller.signal.aborted) {
      throw new AudioGenerationRequestError('TIMEOUT', '语音生成等待超过 180 秒，请稍后重试')
    }
    throw new AudioGenerationRequestError('NETWORK', '无法连接 MiniMax 语音服务，请检查网络和接口地址')
  } finally {
    clearTimeout(timeout)
  }
}

function miniMaxSpeechEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/v1') ? `${path}/t2a_v2` : `${path}/v1/t2a_v2`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new AudioGenerationRequestError('INVALID_RESPONSE', 'MiniMax 语音响应数据过大')
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
      throw new AudioGenerationRequestError('INVALID_RESPONSE', 'MiniMax 语音响应数据过大')
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

function parseJson(bytes: Uint8Array): unknown | null {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
  } catch {
    return null
  }
}

function extractRemoteError(payload: unknown): string {
  if (!isRecord(payload)) return ''
  const baseResponse = isRecord(payload.base_resp) ? payload.base_resp : null
  const error = isRecord(payload.error) ? payload.error : null
  const message = baseResponse?.status_msg ?? error?.message ?? payload.message
  return typeof message === 'string' ? message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) : ''
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
