import type {
  GeneratedVideoResult,
  GenerateVideoRequest,
} from '../../shared/contracts/desktop'
import { findBuiltinModelByKey } from '../../shared/domain/models'
import {
  generateMiniMaxVideo,
  generateVolcengineVideo,
  VideoGenerationRequestError,
} from '../infrastructure/video-generation-client'
import type { AppState } from './app-state'

export type VideoGenerationServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_REQUEST'

export class VideoGenerationServiceError extends Error {
  constructor(
    readonly code: VideoGenerationServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'VideoGenerationServiceError'
  }
}

export class VideoGenerationService {
  constructor(private readonly appState: AppState) {}

  async generate(request: GenerateVideoRequest): Promise<GeneratedVideoResult> {
    const settings = await this.appState.loadSettings()
    const modelKey = request.modelKey ?? settings.defaultModelKeys.video
    if (!modelKey || !settings.enabledModelKeys.includes(modelKey)) {
      throw new VideoGenerationServiceError(
        'MODEL_NOT_CONFIGURED',
        '当前没有可用的默认视频模型，请先在模型设置中启用并设为默认',
      )
    }
    const model = findBuiltinModelByKey(modelKey)
    if (!model || model.kind !== 'video') {
      throw new VideoGenerationServiceError('MODEL_NOT_CONFIGURED', '选择的模型不是可用的视频模型')
    }
    const provider = settings.providers.find((item) => item.id === model.providerId)
    if (!provider?.enabled || !provider.hasApiKey) {
      throw new VideoGenerationServiceError(
        'PROVIDER_NOT_CONFIGURED',
        '请先启用该视频模型所属服务商并保存 API Key',
      )
    }
    if (provider.id !== 'minimax' && provider.id !== 'volcengine') {
      throw new VideoGenerationServiceError(
        'UNSUPPORTED_PROVIDER',
        '当前视频节点支持 MiniMax 和火山方舟视频模型',
      )
    }
    const apiKey = await this.appState.loadProviderApiKey(provider.id)
    if (!apiKey) {
      throw new VideoGenerationServiceError('PROVIDER_NOT_CONFIGURED', '无法读取该服务商的 API Key')
    }
    try {
      const maximumReferences = model.remoteModelId === 'MiniMax-H3'
        ? 9
        : model.remoteModelId.startsWith('MiniMax-Hailuo') ? 1 : 12
      const referenceFileNames = [...new Set(request.referenceImageFileNames ?? [])].slice(0, maximumReferences)
      const referenceImages = await this.appState.loadStoredImages(referenceFileNames)
      const normalizedRequest = normalizeVideoOptions(model.remoteModelId, request)
      const generated = provider.id === 'minimax'
        ? await generateMiniMaxVideo({
            ...normalizedRequest,
            baseUrl: provider.baseUrl,
            apiKey,
            model: model.remoteModelId,
            referenceImages,
          })
        : await generateVolcengineVideo({
            ...normalizedRequest,
            baseUrl: provider.baseUrl,
            apiKey,
            model: model.remoteModelId,
            referenceImages,
          })
      const video = await this.appState.saveGeneratedVideo({
        ...generated,
        prompt: request.prompt,
        modelKey,
        modelName: model.displayName,
        duration: normalizedRequest.duration,
        resolution: normalizedRequest.resolution,
        ratio: normalizedRequest.ratio,
        referenceImageFileNames: referenceFileNames,
      })
      return { video }
    } catch (error) {
      if (error instanceof VideoGenerationRequestError) {
        throw new VideoGenerationServiceError('PROVIDER_REQUEST', error.message)
      }
      if (error instanceof Error && error.message.startsWith('Stored image reference')) {
        throw new VideoGenerationServiceError(
          'PROVIDER_REQUEST',
          error.message.includes('too large')
            ? '参考图总大小超过 45 MB，请减少图片数量或压缩图片'
            : '有参考图已被移动或删除，请重新导入后再生成',
        )
      }
      throw error
    }
  }
}

function normalizeVideoOptions(
  remoteModelId: string,
  request: GenerateVideoRequest,
): Pick<GenerateVideoRequest, 'prompt' | 'duration' | 'resolution' | 'ratio'> {
  if (remoteModelId === 'MiniMax-H3') {
    return {
      prompt: request.prompt,
      duration: request.duration,
      resolution: request.resolution === '2K' ? '2K' : '768P',
      ratio: request.ratio,
    }
  }
  if (remoteModelId.startsWith('MiniMax-Hailuo')) {
    const duration = request.duration <= 6 ? 6 : 10
    return {
      prompt: request.prompt,
      duration,
      resolution: duration === 10
        ? '768P'
        : request.resolution === '1080P' || request.resolution === '2K' ? '1080P' : '768P',
      ratio: request.ratio,
    }
  }
  return {
    prompt: request.prompt,
    duration: request.duration,
    resolution: request.resolution,
    ratio: request.ratio,
  }
}
