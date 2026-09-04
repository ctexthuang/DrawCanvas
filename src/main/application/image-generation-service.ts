import type {
  GenerateImageRequest,
  GeneratedImageResult,
  LoadedGeneratedImage,
} from '../../shared/contracts/desktop'
import {
  isImageGenerationSizeSupported,
} from '../../shared/domain/models'
import {
  generateApiMartImage,
  generateOpenAiCompatibleImage,
  generateMiniMaxImage,
  generateVolcengineImage,
  ImageGenerationRequestError,
} from '../infrastructure/image-generation-client'
import type { AppState } from './app-state'
import { isRetryableRemoteStatus, ModelRoutingError, runWithModelRoute } from './model-routing'

export type ImageGenerationServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_DNS'
  | 'PROVIDER_CONNECTION_REFUSED'
  | 'PROVIDER_CONNECTION_CLOSED'
  | 'PROVIDER_TLS'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_REMOTE'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_REQUEST'

export class ImageGenerationServiceError extends Error {
  constructor(
    readonly code: ImageGenerationServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ImageGenerationServiceError'
  }
}

export class ImageGenerationService {
  constructor(private readonly appState: AppState) {}

  async generate(request: GenerateImageRequest): Promise<GeneratedImageResult> {
    try {
      const referenceImages = await this.appState.loadStoredImages(request.referenceImageFileNames ?? [])
      return await runWithModelRoute(
        this.appState,
        'image',
        request.modelKey,
        isRetryableImageError,
        async ({ apiKey, model, provider }) => {
          if (!isImageGenerationSizeSupported(model.key, request.size)) {
            throw new ImageGenerationServiceError(
              'PROVIDER_REQUEST',
              `${model.displayName} 不支持尺寸 ${request.size}，请在图像生成节点中重新选择`,
            )
          }
          const generated = provider.adapterId === 'volcengine'
            ? await generateVolcengineImage(
                provider.baseUrl,
                apiKey,
                model.remoteModelId,
                request.prompt,
                request.size,
                referenceImages,
              )
            : provider.adapterId === 'minimax'
              ? await generateMiniMaxImage(
                  provider.baseUrl,
                  apiKey,
                  model.remoteModelId,
                  request.prompt,
                  request.size,
                  referenceImages,
                )
              : provider.adapterId === 'apimart'
                ? await generateApiMartImage(
                    provider.baseUrl,
                    apiKey,
                    model.remoteModelId,
                    request.prompt,
                    request.size,
                    referenceImages,
                  )
              : provider.adapterId === 'openai' || provider.adapterId === 'openai-sub2api'
                ? await generateOpenAiCompatibleImage(
                    provider.baseUrl,
                    apiKey,
                    model.remoteModelId,
                    request.prompt,
                    request.size,
                    provider.adapterId === 'openai-sub2api' ? 'sub2api' : 'openai',
                    referenceImages,
                  )
                : unsupportedImageProvider()
          const artwork = await this.appState.saveGeneratedImage({
            ...generated,
            prompt: request.prompt,
            modelKey: model.key,
            modelName: model.displayName,
            size: request.size,
          })
          return { artwork }
        },
      )
    } catch (error) {
      if (error instanceof ModelRoutingError) {
        throw new ImageGenerationServiceError(error.code, error.message, { cause: error })
      }
      if (error instanceof ImageGenerationRequestError) {
        throw new ImageGenerationServiceError(
          mapProviderErrorCode(error.code),
          error.message,
          { cause: error },
        )
      }
      if (error instanceof Error && error.message.startsWith('Stored image reference')) {
        throw new ImageGenerationServiceError(
          'PROVIDER_REQUEST',
          error.message.includes('too large')
            ? '参考图总大小超过 45 MB，请减少图片数量或压缩图片'
            : '有参考图已被移动或删除，请重新导入后再生成',
        )
      }
      throw error
    }
  }

  async loadImage(fileName: string): Promise<LoadedGeneratedImage> {
    return this.appState.loadGeneratedImage(fileName)
  }
}

function unsupportedImageProvider(): never {
  throw new ImageGenerationServiceError(
    'UNSUPPORTED_PROVIDER',
    '该 API 服务的图片生成协议尚未接入',
  )
}

function isRetryableImageError(error: unknown): boolean {
  return error instanceof ImageGenerationRequestError && (
    error.code === 'NETWORK' ||
    error.code === 'DNS' ||
    error.code === 'CONNECTION_REFUSED' ||
    error.code === 'CONNECTION_CLOSED' ||
    error.code === 'TLS' ||
    error.code === 'TIMEOUT' ||
    error.code === 'RATE_LIMIT' ||
    (error.code === 'REMOTE' && isRetryableRemoteStatus(error.httpStatus))
  )
}

function mapProviderErrorCode(
  code: ImageGenerationRequestError['code'],
): ImageGenerationServiceErrorCode {
  switch (code) {
    case 'NETWORK': return 'PROVIDER_NETWORK'
    case 'DNS': return 'PROVIDER_DNS'
    case 'CONNECTION_REFUSED': return 'PROVIDER_CONNECTION_REFUSED'
    case 'CONNECTION_CLOSED': return 'PROVIDER_CONNECTION_CLOSED'
    case 'TLS': return 'PROVIDER_TLS'
    case 'TIMEOUT': return 'PROVIDER_TIMEOUT'
    case 'AUTHENTICATION': return 'PROVIDER_AUTHENTICATION'
    case 'RATE_LIMIT': return 'PROVIDER_RATE_LIMIT'
    case 'REMOTE': return 'PROVIDER_REMOTE'
    case 'INVALID_RESPONSE': return 'PROVIDER_INVALID_RESPONSE'
  }
}
