import type {
  GenerateImageRequest,
  GeneratedImageResult,
  LoadedGeneratedImage,
} from '../../shared/contracts/desktop'
import { findBuiltinModelByKey } from '../../shared/domain/models'
import {
  generateOpenAiCompatibleImage,
  ImageGenerationRequestError,
} from '../infrastructure/image-generation-client'
import type { AppState } from './app-state'

export type ImageGenerationServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_REQUEST'

export class ImageGenerationServiceError extends Error {
  constructor(
    readonly code: ImageGenerationServiceErrorCode,
    message: string,
  ) {
    super(message)
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
    const provider = settings.providers.find((item) => item.id === model.providerId)
    if (!provider || !provider.enabled) {
      throw new ImageGenerationServiceError('PROVIDER_NOT_CONFIGURED', '该模型所属服务商尚未启用')
    }
    if (!provider.hasApiKey) {
      throw new ImageGenerationServiceError('PROVIDER_NOT_CONFIGURED', '请先在模型设置中保存该服务商的 API Key')
    }

    if (provider.id !== 'openai-relay') {
      throw new ImageGenerationServiceError(
        'UNSUPPORTED_PROVIDER',
        '该服务商的图片生成协议尚未接入，首版请使用 OpenAI 图片模型',
      )
    }
    const apiKey = await this.appState.loadProviderApiKey(provider.id)
    if (!apiKey) {
      throw new ImageGenerationServiceError('PROVIDER_NOT_CONFIGURED', '无法读取该服务商的 API Key')
    }

    try {
      const generated = await generateOpenAiCompatibleImage(
        provider.baseUrl,
        apiKey,
        model.remoteModelId,
        request.prompt,
        request.size,
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
        throw new ImageGenerationServiceError('PROVIDER_REQUEST', error.message)
      }
      throw error
    }
  }

  async loadImage(fileName: string): Promise<LoadedGeneratedImage> {
    return this.appState.loadGeneratedImage(fileName)
  }
}
