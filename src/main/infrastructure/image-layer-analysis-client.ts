import { net } from 'electron/main'
import { createApiMartChatEndpointCandidates } from './apimart/endpoints'
import {
  createOpenAiEndpointCandidates,
  type OpenAiCompatibleProfile,
} from './openai-compatible-endpoints'
import {
  PromptOptimizationClientError,
  type PromptOptimizationClientProfile,
} from './prompt-optimization-client'

const REQUEST_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

type ImageLayerAnalysisImage = Readonly<{
  bytes: Uint8Array
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}>

type ImageLayerAnalysisAttempt = Readonly<{
  url: string
  kind: 'responses' | 'chat-completions'
  body: Readonly<Record<string, unknown>>
}>

export async function analyzeImageLayersWithModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  image: ImageLayerAnalysisImage,
  profile: PromptOptimizationClientProfile,
  instructions: string,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const attempts = createAnalysisAttempts(baseUrl, model, prompt, image, profile, instructions)
    for (const [index, attempt] of attempts.entries()) {
      const hasNextAttempt = index < attempts.length - 1
      let response: Response
      try {
        response = await net.fetch(attempt.url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'DrawCanvas/1.0',
          },
          body: JSON.stringify(attempt.body),
          signal: controller.signal,
          bypassCustomProtocolHandlers: true,
        })
      } catch (error) {
        if (!controller.signal.aborted && hasNextAttempt) continue
        throw error
      }

      const bytes = await readLimitedBody(response)
      const payload = parseJson(bytes)
      const message = extractRemoteErrorMessage(payload, bytes)
      const remoteStatus = profile === 'apimart' ? apiMartStatus(payload, response.status) : response.status
      if (remoteStatus === 401 || remoteStatus === 403) {
        throw new PromptOptimizationClientError('AUTHENTICATION', message || 'API Key 无效或没有视觉模型权限')
      }
      if (remoteStatus === 402 || remoteStatus === 429) {
        throw new PromptOptimizationClientError('RATE_LIMIT', message || '请求过于频繁或账户额度不足，请稍后重试')
      }
      if (!response.ok || remoteStatus !== 200) {
        if (hasNextAttempt && shouldTryNextEndpoint(profile, response.status)) continue
        throw new PromptOptimizationClientError(
          'REMOTE',
          message || `视觉模型请求失败（HTTP ${remoteStatus}）`,
          remoteStatus,
        )
      }

      const resultPayload = profile === 'apimart' ? unwrapApiMartPayload(payload) : payload
      const generatedText = cleanGeneratedText(attempt.kind === 'responses'
        ? extractResponsesText(resultPayload)
        : extractChatCompletionText(resultPayload))
      if (!generatedText) {
        if (hasNextAttempt && profile !== 'apimart') continue
        throw new PromptOptimizationClientError('INVALID_RESPONSE', '视觉模型没有返回可用的图层数据')
      }
      return generatedText
    }
    throw new PromptOptimizationClientError('INVALID_RESPONSE', '视觉模型没有返回可用的图层数据')
  } catch (error) {
    if (error instanceof PromptOptimizationClientError) throw error
    if (controller.signal.aborted) {
      throw new PromptOptimizationClientError('TIMEOUT', '视觉模型分析超时，请稍后重试')
    }
    throw new PromptOptimizationClientError('NETWORK', '无法连接视觉模型，请检查网络和接口地址')
  } finally {
    clearTimeout(timeout)
  }
}

function createAnalysisAttempts(
  baseUrl: string,
  model: string,
  prompt: string,
  image: ImageLayerAnalysisImage,
  profile: PromptOptimizationClientProfile,
  instructions: string,
): ReadonlyArray<ImageLayerAnalysisAttempt> {
  const imageUrl = `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`
  const attempts: ImageLayerAnalysisAttempt[] = []
  if (profile === 'apimart') {
    for (const url of createApiMartChatEndpointCandidates(baseUrl)) {
      attempts.push({
        url,
        kind: 'chat-completions',
        body: createChatCompletionsBody(model, prompt, imageUrl, instructions),
      })
    }
    return attempts
  }

  if (profile === 'openai-responses' || profile === 'sub2api-compatible') {
    const endpointProfile: OpenAiCompatibleProfile = profile === 'sub2api-compatible' ? 'sub2api' : 'openai'
    for (const url of createOpenAiEndpointCandidates(baseUrl, 'responses', endpointProfile)) {
      attempts.push({
        url,
        kind: 'responses',
        body: {
          model,
          instructions,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: imageUrl, detail: 'high' },
            ],
          }],
          store: false,
        },
      })
    }
  }

  const endpointProfile: OpenAiCompatibleProfile = profile === 'sub2api-compatible' ? 'sub2api' : 'openai'
  for (const url of createOpenAiEndpointCandidates(baseUrl, 'chat/completions', endpointProfile)) {
    attempts.push({
      url,
      kind: 'chat-completions',
      body: createChatCompletionsBody(model, prompt, imageUrl, instructions),
    })
  }
  return attempts
}

function createChatCompletionsBody(
  model: string,
  prompt: string,
  imageUrl: string,
  instructions: string,
): Readonly<Record<string, unknown>> {
  return {
    model,
    stream: false,
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
        ],
      },
    ],
  }
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new PromptOptimizationClientError('INVALID_RESPONSE', '视觉模型响应数据过大')
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
      throw new PromptOptimizationClientError('INVALID_RESPONSE', '视觉模型响应数据过大')
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

function parseJson(bytes: Uint8Array): unknown | null {
  if (bytes.byteLength === 0) return null
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
  } catch {
    return null
  }
}

function extractResponsesText(payload: unknown | null): string {
  if (!isRecord(payload)) return ''
  if (typeof payload.output_text === 'string') return payload.output_text
  if (!Array.isArray(payload.output)) return ''
  return payload.output.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return []
    return item.content.flatMap((content) => {
      if (!isRecord(content)) return []
      if (typeof content.text === 'string') return [content.text]
      if (typeof content.value === 'string') return [content.value]
      return []
    })
  }).join('\n')
}

function extractChatCompletionText(payload: unknown | null): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return ''
  const choice = payload.choices.find(isRecord)
  if (!choice) return ''
  const message = isRecord(choice.message) ? choice.message : null
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content.flatMap((content) =>
    isRecord(content) && typeof content.text === 'string' ? [content.text] : [],
  ).join('\n')
}

function extractRemoteErrorMessage(payload: unknown | null, bytes: Uint8Array): string {
  if (isRecord(payload)) {
    const error = isRecord(payload.error) ? payload.error : null
    const baseResponse = isRecord(payload.base_resp) ? payload.base_resp : null
    const data = isRecord(payload.data) ? payload.data : null
    const dataError = isRecord(data?.error) ? data.error : null
    const candidate = error?.message ?? dataError?.message ?? data?.message ?? baseResponse?.status_msg ?? payload.message ?? payload.detail
    if (typeof candidate === 'string') return sanitizeRemoteMessage(candidate)
  }
  const text = Buffer.from(bytes).toString('utf8').trim()
  return text && !text.startsWith('<') ? sanitizeRemoteMessage(text) : ''
}

function apiMartStatus(payload: unknown | null, httpStatus: number): number {
  if (httpStatus >= 400 || !isRecord(payload)) return httpStatus
  return typeof payload.code === 'number' ? payload.code : payload.success === false ? 500 : httpStatus
}

function unwrapApiMartPayload(payload: unknown | null): unknown | null {
  return isRecord(payload) && isRecord(payload.data) ? payload.data : payload
}

function shouldTryNextEndpoint(profile: PromptOptimizationClientProfile, httpStatus: number): boolean {
  return profile !== 'apimart' || httpStatus === 404 || httpStatus === 405
}

function cleanGeneratedText(value: string): string {
  return value.trim().slice(0, 40_000)
}

function sanitizeRemoteMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
