import type {
  OptimizePromptRequest,
  OptimizedPromptResult,
} from '../../shared/contracts/desktop'
import type { ProviderAdapterId } from '../../shared/domain/models'
import {
  optimizePromptWithModel,
  PromptOptimizationClientError,
  type PromptOptimizationClientProfile,
} from '../infrastructure/prompt-optimization-client'
import type { AppState } from './app-state'
import { isRetryableRemoteStatus, ModelRoutingError, runWithModelRoute } from './model-routing'

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
    try {
      return await runWithModelRoute(
        this.appState,
        'chat',
        request.modelKey,
        isRetryableOptimizationError,
        async ({ apiKey, model, provider }) => {
          const profile = providerProfile(provider.adapterId)
          if (!profile) {
            throw new PromptOptimizationServiceError(
              'UNSUPPORTED_PROVIDER',
              '该 API 服务尚未接入提示词优化',
            )
          }
          const prompt = await optimizePromptWithModel(
            provider.baseUrl,
            apiKey,
            model.remoteModelId,
            request.prompt,
            profile,
          )
          return { prompt, modelKey: model.key, modelName: model.displayName }
        },
      )
    } catch (error) {
      if (error instanceof ModelRoutingError) {
        throw new PromptOptimizationServiceError(error.code, error.message, { cause: error })
      }
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

function providerProfile(adapterId: ProviderAdapterId): PromptOptimizationClientProfile | null {
  switch (adapterId) {
    case 'openai': return 'openai-responses'
    case 'openai-sub2api': return 'sub2api-compatible'
    case 'volcengine':
    case 'minimax':
      return 'chat-completions'
    default:
      return null
  }
}

function isRetryableOptimizationError(error: unknown): boolean {
  return error instanceof PromptOptimizationClientError && (
    error.code === 'NETWORK' ||
    error.code === 'TIMEOUT' ||
    error.code === 'RATE_LIMIT' ||
    (error.code === 'REMOTE' && isRetryableRemoteStatus(error.httpStatus))
  )
}
