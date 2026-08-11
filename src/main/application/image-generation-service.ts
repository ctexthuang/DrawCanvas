import type {
  GenerateImageRequest,
  GeneratedImageResult,
  LoadedGeneratedImage,
} from '../../shared/contracts/desktop'
import {
  findBuiltinModelByKey,
  isImageGenerationSizeSupported,
} from '../../shared/domain/models'
import {
  generateOpenAiCompatibleImage,
  generateMiniMaxImage,
  generateVolcengineImage,
  ImageGenerationRequestError,
} from '../infrastructure/image-generation-client'
import type { AppState } from './app-state'

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
    const settings = await this.appState.loadSettings()
    const modelKey = request.modelKey ?? settings.defaultModelKeys.image
    if (!modelKey || !settings.enabledModelKeys.includes(modelKey)) {
      throw new ImageGenerationServiceError(
        'MODEL_NOT_CONFIGURED',
        '当前没有可用的默认图片模型，请先在模型设置中启用并设为默认',
      )
    }

    const model = findBuiltinModelByKey(modelKey)
    if (!model || model.kind !== 'image') {
      throw new ImageGenerationServiceError('MODEL_NOT_CONFIGURED', '选择的模型不是可用的图片模型')
    }
    if (!isImageGenerationSizeSupported(modelKey, request.size)) {
      throw new ImageGenerationServiceError(
        'PROVIDER_REQUEST',
        `${model.displayName} 不支持尺寸 ${request.size}，请在图像生成节点中重新选择`,
      )
    }
    const provider = settings.providers.find((item) => item.id === model.providerId)
    if (!provider || !provider.enabled) {
      throw new ImageGenerationServiceError('PROVIDER_NOT_CONFIGURED', '该模型所属服务商尚未启用')
    }
    if (!provider.hasApiKey) {
      throw new ImageGenerationServiceError('PROVIDER_NOT_CONFIGURED', '请先在模型设置中保存该服务商的 API Key')
    }

    if (provider.id !== 'openai' && provider.id !== 'openai-sub2api' && provider.id !== 'volcengine' && provider.id !== 'minimax') {
      throw new ImageGenerationServiceError(
        'UNSUPPORTED_PROVIDER',
        '该服务商的图片生成协议尚未接入，请使用 OpenAI、OpenAI 中转、火山方舟或 MiniMax 图片模型',
      )
    }
    const apiKey = await this.appState.loadProviderApiKey(provider.id)
    if (!apiKey) {
      throw new ImageGenerationServiceError('PROVIDER_NOT_CONFIGURED', '无法读取该服务商的 API Key')
    }

    try {
      const referenceImages = await this.appState.loadStoredImages(request.referenceImageFileNames ?? [])
      const generated = provider.id === 'volcengine'
        ? await generateVolcengineImage(
            provider.baseUrl,
            apiKey,
            model.remoteModelId,
            request.prompt,
            request.size,
            referenceImages,
          )
        : provider.id === 'minimax'
          ? await generateMiniMaxImage(
              provider.baseUrl,
              apiKey,
              model.remoteModelId,
              request.prompt,
              request.size,
              referenceImages,
            )
        : await generateOpenAiCompatibleImage(
            provider.baseUrl,
            apiKey,
            model.remoteModelId,
            request.prompt,
            request.size,
            provider.id === 'openai-sub2api' ? 'sub2api' : 'openai',
            referenceImages,
          )
      const artwork = await this.appState.saveGeneratedImage({
        ...generated,
        prompt: request.prompt,
        modelKey,
        modelName: model.displayName,
        size: request.size,
      })
      return { artwork }
    } catch (error) {
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
