import { net } from 'electron/main'
import { createApiMartChatEndpointCandidates } from './apimart/endpoints'
import {
  createOpenAiEndpointCandidates,
  type OpenAiCompatibleProfile,
} from './openai-compatible-endpoints'

const REQUEST_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_OPTIMIZED_PROMPT_LENGTH = 5_000
const MAX_GENERATED_TEXT_LENGTH = 40_000

const OPTIMIZATION_INSTRUCTIONS = [
  '你是 Draw Canvas 的视觉生成提示词优化器。',
  '保留用户的核心意图、主体数量、专有名词、画面文字、限制条件和否定要求。',
  '在不改变含义的前提下补充有助于图像或视频生成的构图、镜头、光线、材质、色彩、空间层次和风格描述。',
  '使用与原提示词相同的主要语言，只返回一段可直接用于生成的优化提示词，不要解释、标题、引号或 Markdown。',
].join('')

export type PromptOptimizationClientProfile =
  | 'openai-responses'
  | 'sub2api-compatible'
  | 'chat-completions'
  | 'apimart'

export type PromptOptimizationClientErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'REMOTE'
  | 'INVALID_RESPONSE'

export class PromptOptimizationClientError extends Error {
  constructor(
    readonly code: PromptOptimizationClientErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'PromptOptimizationClientError'
  }
}

export type TextGenerationMessage = Readonly<{
  role: 'user' | 'assistant'
  content: string
}>

export async function optimizePromptWithModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  profile: PromptOptimizationClientProfile,
): Promise<string> {
  const result = await generateTextWithModel(
    baseUrl,
    apiKey,
    model,
    [{ role: 'user', content: prompt }],
    profile,
    OPTIMIZATION_INSTRUCTIONS,
  )
  const optimizedPrompt = cleanOptimizedPrompt(result)
  if (!optimizedPrompt) {
    throw new PromptOptimizationClientError('INVALID_RESPONSE', '对话模型没有返回可用的优化提示词')
  }
  return optimizedPrompt
}

export async function generateTextWithModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ReadonlyArray<TextGenerationMessage>,
  profile: PromptOptimizationClientProfile,
  instructions: string,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const attempts = requestAttempts(baseUrl, model, messages, profile, instructions)
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
        throw new PromptOptimizationClientError('AUTHENTICATION', message || 'API Key 无效或没有对话模型权限')
      }
      if (remoteStatus === 402 || remoteStatus === 429) {
        throw new PromptOptimizationClientError('RATE_LIMIT', message || '请求过于频繁或账户额度不足，请稍后重试')
      }
      if (!response.ok || remoteStatus !== 200) {
        if (hasNextAttempt && shouldTryNextEndpoint(profile, response.status)) continue
        throw new PromptOptimizationClientError(
          'REMOTE',
          message || `对话模型请求失败（HTTP ${remoteStatus}）`,
          remoteStatus,
        )
      }
      const resultPayload = profile === 'apimart' ? unwrapApiMartPayload(payload) : payload
      const generatedText = cleanGeneratedText(attempt.kind === 'responses'
        ? extractResponsesText(resultPayload)
        : extractChatCompletionText(resultPayload))
      if (!generatedText) {
        if (hasNextAttempt && profile !== 'apimart') continue
        throw new PromptOptimizationClientError('INVALID_RESPONSE', '对话模型没有返回可用内容')
      }
      return generatedText
    }
    throw new PromptOptimizationClientError('INVALID_RESPONSE', '对话模型没有返回可用内容')
  } catch (error) {
    if (error instanceof PromptOptimizationClientError) throw error
    if (controller.signal.aborted) {
      throw new PromptOptimizationClientError('TIMEOUT', '对话模型等待超时，请稍后重试')
    }
    throw new PromptOptimizationClientError('NETWORK', '无法连接对话模型，请检查网络和接口地址')
  } finally {
    clearTimeout(timeout)
  }
}

type PromptRequestAttempt = Readonly<{
  url: string
  kind: 'responses' | 'chat-completions'
  body: Readonly<Record<string, unknown>>
}>

function requestAttempts(
  baseUrl: string,
  model: string,
  messages: ReadonlyArray<TextGenerationMessage>,
  profile: PromptOptimizationClientProfile,
  instructions: string,
): ReadonlyArray<PromptRequestAttempt> {
  const attempts: PromptRequestAttempt[] = []
  if (profile === 'apimart') {
    for (const url of createApiMartChatEndpointCandidates(baseUrl)) {
      attempts.push({
        url,
        kind: 'chat-completions',
        body: {
          model,
          stream: false,
          messages: [
            { role: 'system', content: instructions },
            ...messages,
          ],
        },
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
          input: messages,
          store: false,
        },
      })
    }
  }
  if (
    profile === 'openai-responses' ||
    profile === 'chat-completions' ||
    profile === 'sub2api-compatible'
  ) {
    const endpointProfile: OpenAiCompatibleProfile = profile === 'sub2api-compatible' ? 'sub2api' : 'openai'
    for (const url of createOpenAiEndpointCandidates(baseUrl, 'chat/completions', endpointProfile)) {
      attempts.push({
        url,
        kind: 'chat-completions',
        body: {
          model,
          messages: [
            { role: 'system', content: instructions },
            ...messages,
          ],
        },
      })
    }
  }
  return attempts
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new PromptOptimizationClientError('INVALID_RESPONSE', '对话模型响应数据过大')
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
      throw new PromptOptimizationClientError('INVALID_RESPONSE', '对话模型响应数据过大')
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

function cleanOptimizedPrompt(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:优化后的?提示词|优化提示词|prompt)\s*[：:]\s*/i, '')
    .replace(/^(["“])([\s\S]*)(["”])$/, '$2')
    .trim()
    .slice(0, MAX_OPTIMIZED_PROMPT_LENGTH)
}

function cleanGeneratedText(value: string): string {
  return value.trim().slice(0, MAX_GENERATED_TEXT_LENGTH)
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

function sanitizeRemoteMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
