import type {
  OptimizePromptRequest,
  OptimizedPromptResult,
} from '../../shared/contracts/desktop'
import { findBuiltinModelByKey } from '../../shared/domain/models'
import {
  optimizePromptWithModel,
  PromptOptimizationClientError,
  type PromptOptimizationClientProfile,
} from '../infrastructure/prompt-optimization-client'
import type { AppState } from './app-state'

export type PromptOptimizationServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_REMOTE'
  | 'PROVIDER_INVALID_RESPONSE'

export class PromptOptimizationServiceError extends Error {
  constructor(
    readonly code: PromptOptimizationServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PromptOptimizationServiceError'
  }
}

export class PromptOptimizationService {
  constructor(private readonly appState: AppState) {}

  async optimize(request: OptimizePromptRequest): Promise<OptimizedPromptResult> {
    const settings = await this.appState.loadSettings()
    const modelKey = request.modelKey ?? settings.defaultModelKeys.chat
    if (!modelKey || !settings.enabledModelKeys.includes(modelKey)) {
      throw new PromptOptimizationServiceError(
        'MODEL_NOT_CONFIGURED',
        '当前没有可用的默认对话模型，请先在模型设置中启用并设为默认',
      )
    }
    const model = findBuiltinModelByKey(modelKey)
    if (!model || model.kind !== 'chat') {
      throw new PromptOptimizationServiceError('MODEL_NOT_CONFIGURED', '选择的模型不是可用的对话模型')
    }
    const provider = settings.providers.find((item) => item.id === model.providerId)
    if (!provider?.enabled || !provider.hasApiKey) {
      throw new PromptOptimizationServiceError(
        'PROVIDER_NOT_CONFIGURED',
        '请先启用默认对话模型所属服务商并保存 API Key',
      )
    }
    const profile = providerProfile(provider.id)
    if (!profile) {
      throw new PromptOptimizationServiceError(
        'UNSUPPORTED_PROVIDER',
        '当前默认对话模型所属服务商尚未接入提示词优化',
      )
    }
    let apiKey: string | null
    try {
      apiKey = await this.appState.loadProviderApiKey(provider.id)
    } catch (error) {
      throw new PromptOptimizationServiceError(
        'PROVIDER_NOT_CONFIGURED',
        '无法解密对话模型服务商的 API Key，请重新保存后再试',
        { cause: error },
      )
    }
    if (!apiKey) {
      throw new PromptOptimizationServiceError('PROVIDER_NOT_CONFIGURED', '无法读取对话模型服务商的 API Key')
    }
    try {
      const prompt = await optimizePromptWithModel(
        provider.baseUrl,
        apiKey,
        model.remoteModelId,
        request.prompt,
        profile,
      )
      return { prompt, modelKey, modelName: model.displayName }
    } catch (error) {
      if (error instanceof PromptOptimizationClientError) {
        throw new PromptOptimizationServiceError(
          mapProviderErrorCode(error.code),
          error.message,
          { cause: error },
        )
      }
      throw error
    }
  }
}

function mapProviderErrorCode(
  code: PromptOptimizationClientError['code'],
): PromptOptimizationServiceErrorCode {
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
