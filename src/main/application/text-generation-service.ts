import type {
  GenerateChatReplyRequest,
  GeneratedChatReply,
  GeneratedStoryboard,
  GenerateStoryboardRequest,
  StoryboardShot,
} from '../../shared/contracts/desktop'
import { findBuiltinModelByKey } from '../../shared/domain/models'
import {
  generateTextWithModel,
  PromptOptimizationClientError,
  type PromptOptimizationClientProfile,
} from '../infrastructure/prompt-optimization-client'
import type { AppState } from './app-state'

export type TextGenerationServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_REMOTE'
  | 'PROVIDER_INVALID_RESPONSE'

export class TextGenerationServiceError extends Error {
  constructor(
    readonly code: TextGenerationServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TextGenerationServiceError'
  }
}

type ResolvedChatModel = Readonly<{
  apiKey: string
  baseUrl: string
  modelKey: string
  modelName: string
  profile: PromptOptimizationClientProfile
  remoteModelId: string
}>

const CHAT_INSTRUCTIONS = [
  '你是 Draw Canvas 内置的创意协作助手。',
  '围绕图像、视频、分镜、构图和提示词提供直接、可执行的建议。',
  '记住对话中已经确认的约束，不虚构已经生成的文件或调用结果。',
  '默认使用用户当前使用的语言回答，内容清楚精炼。',
].join('')

export class TextGenerationService {
  constructor(private readonly appState: AppState) {}

  async chat(request: GenerateChatReplyRequest): Promise<GeneratedChatReply> {
    const model = await this.resolveModel(request.modelKey)
    const content = await this.callModel(
      model,
      request.messages.map((message) => ({ role: message.role, content: message.content })),
      CHAT_INSTRUCTIONS,
    )
    return { content, modelKey: model.modelKey, modelName: model.modelName }
  }

  async storyboard(request: GenerateStoryboardRequest): Promise<GeneratedStoryboard> {
    const model = await this.resolveModel(request.modelKey)
    const instructions = [
      '你是 Draw Canvas 的专业分镜设计师。',
      `必须根据用户主题生成恰好 ${request.shotCount} 个连续镜头。`,
      '只返回 JSON 数组，不要 Markdown。',
      '每项必须包含 title、prompt、durationSeconds；prompt 要能直接用于图像或视频生成，写清主体、动作、景别、机位、光线、环境和风格，并保持人物与场景连续性。',
      'durationSeconds 使用 1 到 60 的整数。',
    ].join('')
    const raw = await this.callModel(
      model,
      [{ role: 'user', content: request.theme }],
      instructions,
    )
    const shots = parseStoryboard(raw, request.shotCount)
    return { shots, modelKey: model.modelKey, modelName: model.modelName }
  }

  private async resolveModel(requestedModelKey?: string): Promise<ResolvedChatModel> {
    const settings = await this.appState.loadSettings()
    const modelKey = requestedModelKey ?? settings.defaultModelKeys.chat
    if (!modelKey || !settings.enabledModelKeys.includes(modelKey)) {
      throw new TextGenerationServiceError(
        'MODEL_NOT_CONFIGURED',
        '当前没有可用的对话模型，请先在模型设置中启用并设为默认',
      )
    }
    const model = findBuiltinModelByKey(modelKey)
    if (!model || model.kind !== 'chat') {
      throw new TextGenerationServiceError('MODEL_NOT_CONFIGURED', '选择的模型不是可用的对话模型')
    }
    const provider = settings.providers.find((item) => item.id === model.providerId)
    if (!provider?.enabled || !provider.hasApiKey) {
      throw new TextGenerationServiceError(
        'PROVIDER_NOT_CONFIGURED',
        '请先启用对话模型所属服务商并保存 API Key',
      )
    }
    const profile = providerProfile(provider.id)
    if (!profile) {
      throw new TextGenerationServiceError('UNSUPPORTED_PROVIDER', '当前服务商尚未接入对话能力')
    }
    let apiKey: string | null
    try {
      apiKey = await this.appState.loadProviderApiKey(provider.id)
    } catch (error) {
      throw new TextGenerationServiceError(
        'PROVIDER_NOT_CONFIGURED',
        '无法解密对话模型服务商的 API Key，请重新保存后再试',
        { cause: error },
      )
    }
    if (!apiKey) {
      throw new TextGenerationServiceError('PROVIDER_NOT_CONFIGURED', '无法读取对话模型服务商的 API Key')
    }
    return {
      apiKey,
      baseUrl: provider.baseUrl,
      modelKey,
      modelName: model.displayName,
      profile,
      remoteModelId: model.remoteModelId,
    }
  }

  private async callModel(
    model: ResolvedChatModel,
    messages: Parameters<typeof generateTextWithModel>[3],
    instructions: string,
  ): Promise<string> {
    try {
      return await generateTextWithModel(
        model.baseUrl,
        model.apiKey,
        model.remoteModelId,
        messages,
        model.profile,
        instructions,
      )
    } catch (error) {
      if (error instanceof PromptOptimizationClientError) {
        throw new TextGenerationServiceError(mapProviderErrorCode(error.code), error.message, { cause: error })
      }
      throw error
    }
  }
}

function parseStoryboard(value: string, shotCount: number): ReadonlyArray<StoryboardShot> {
  const start = value.indexOf('[')
  const end = value.lastIndexOf(']')
  if (start < 0 || end <= start) {
    throw new TextGenerationServiceError('PROVIDER_INVALID_RESPONSE', '对话模型没有返回有效的分镜 JSON')
  }
  let payload: unknown
  try {
    payload = JSON.parse(value.slice(start, end + 1)) as unknown
  } catch {
    throw new TextGenerationServiceError('PROVIDER_INVALID_RESPONSE', '分镜结果不是有效 JSON，请重试')
  }
  if (!Array.isArray(payload) || payload.length !== shotCount) {
    throw new TextGenerationServiceError('PROVIDER_INVALID_RESPONSE', `模型没有返回要求的 ${shotCount} 个镜头，请重试`)
  }
  return payload.map((item, index) => {
    if (!isRecord(item)) {
      throw new TextGenerationServiceError('PROVIDER_INVALID_RESPONSE', `第 ${index + 1} 个分镜格式无效`)
    }
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : ''
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim().slice(0, 10_000) : ''
    const rawDuration = typeof item.durationSeconds === 'number' ? item.durationSeconds : 5
    if (!prompt) {
      throw new TextGenerationServiceError('PROVIDER_INVALID_RESPONSE', `第 ${index + 1} 个分镜缺少可用提示词`)
    }
    return {
      id: `shot-${crypto.randomUUID()}`,
      index: index + 1,
      title: title || `镜头 ${index + 1}`,
      prompt,
      durationSeconds: Math.max(1, Math.min(60, Math.round(rawDuration))),
    }
  })
}

function mapProviderErrorCode(
  code: PromptOptimizationClientError['code'],
): TextGenerationServiceErrorCode {
  switch (code) {
    case 'NETWORK': return 'PROVIDER_NETWORK'
    case 'TIMEOUT': return 'PROVIDER_TIMEOUT'
    case 'AUTHENTICATION': return 'PROVIDER_AUTHENTICATION'
    case 'RATE_LIMIT': return 'PROVIDER_RATE_LIMIT'
    case 'REMOTE': return 'PROVIDER_REMOTE'
    case 'INVALID_RESPONSE': return 'PROVIDER_INVALID_RESPONSE'
  }
}

function providerProfile(providerId: string): PromptOptimizationClientProfile | null {
  switch (providerId) {
    case 'openai': return 'openai-responses'
    case 'openai-sub2api': return 'sub2api-compatible'
    case 'volcengine':
    case 'minimax':
      return 'chat-completions'
    default:
      return null
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
