import type {
  GeneratedVideoResult,
  GenerateVideoRequest,
} from '../../shared/contracts/desktop'
import {
  generateMiniMaxVideo,
  generateVolcengineVideo,
  VideoGenerationRequestError,
} from '../infrastructure/video-generation-client'
import type { AppState } from './app-state'
import { isRetryableRemoteStatus, ModelRoutingError, runWithModelRoute } from './model-routing'

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
    try {
      return await runWithModelRoute(
        this.appState,
        'video',
        request.modelKey,
        isRetryableVideoError,
        async ({ apiKey, model, provider }) => {
          if (provider.adapterId !== 'minimax' && provider.adapterId !== 'volcengine') {
            throw new VideoGenerationServiceError('UNSUPPORTED_PROVIDER', '该 API 服务的视频生成协议尚未接入')
          }
          const maximumReferences = model.remoteModelId === 'MiniMax-H3'
            ? 9
            : model.remoteModelId.startsWith('MiniMax-Hailuo') ? 1 : 12
          const referenceFileNames = [...new Set(request.referenceImageFileNames ?? [])]
            .slice(0, maximumReferences)
          const referenceImages = await this.appState.loadStoredImages(referenceFileNames)
          const normalizedRequest = normalizeVideoOptions(model.remoteModelId, request)
          const generated = provider.adapterId === 'minimax'
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
            modelKey: model.key,
            modelName: model.displayName,
            duration: normalizedRequest.duration,
            resolution: normalizedRequest.resolution,
            ratio: normalizedRequest.ratio,
            referenceImageFileNames: referenceFileNames,
          })
          return { video }
        },
      )
    } catch (error) {
      if (error instanceof ModelRoutingError) {
        throw new VideoGenerationServiceError(error.code, error.message)
      }
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

function isRetryableVideoError(error: unknown): boolean {
  return error instanceof VideoGenerationRequestError && (
    error.code === 'NETWORK' ||
    error.code === 'TIMEOUT' ||
    error.code === 'RATE_LIMIT' ||
    (error.code === 'REMOTE' && isRetryableRemoteStatus(error.httpStatus))
  )
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
