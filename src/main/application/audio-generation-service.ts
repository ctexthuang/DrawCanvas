import type {
  GenerateAudioRequest,
  GeneratedAudioResult,
} from '../../shared/contracts/desktop'
import {
  AudioGenerationRequestError,
  generateApiMartAudio,
  generateMiniMaxAudio,
} from '../infrastructure/audio-generation-client'
import type { AppState } from './app-state'
import { isRetryableRemoteStatus, ModelRoutingError, runWithModelRoute } from './model-routing'

export type AudioGenerationServiceErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_REQUEST'

export class AudioGenerationServiceError extends Error {
  constructor(
    readonly code: AudioGenerationServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AudioGenerationServiceError'
  }
}

export class AudioGenerationService {
  constructor(private readonly appState: AppState) {}

  async generate(request: GenerateAudioRequest): Promise<GeneratedAudioResult> {
    try {
      return await runWithModelRoute(
        this.appState,
        'audio',
        request.modelKey,
        isRetryableAudioError,
        async ({ apiKey, model, provider }) => {
          if (provider.adapterId !== 'minimax' && provider.adapterId !== 'apimart') {
            throw new AudioGenerationServiceError('UNSUPPORTED_PROVIDER', '该 API 服务的音频生成协议尚未接入')
          }
          const generateAudio = provider.adapterId === 'apimart'
            ? generateApiMartAudio
            : generateMiniMaxAudio
          const generated = await generateAudio({
            baseUrl: provider.baseUrl,
            apiKey,
            model: model.remoteModelId,
            text: request.text,
            voiceId: request.voiceId,
            speed: request.speed,
            pitch: request.pitch,
            emotion: request.emotion,
          })
          const audio = await this.appState.saveGeneratedAudio({
            ...generated,
            text: request.text,
            modelKey: model.key,
            modelName: model.displayName,
            speed: request.speed,
          })
          return { audio }
        },
      )
    } catch (error) {
      if (error instanceof ModelRoutingError) {
        throw new AudioGenerationServiceError(error.code, error.message)
      }
      if (error instanceof AudioGenerationRequestError) {
        throw new AudioGenerationServiceError('PROVIDER_REQUEST', error.message)
      }
      throw error
    }
  }
}

function isRetryableAudioError(error: unknown): boolean {
  return error instanceof AudioGenerationRequestError && (
    error.code === 'NETWORK' ||
    error.code === 'TIMEOUT' ||
    error.code === 'RATE_LIMIT' ||
    (error.code === 'REMOTE' && isRetryableRemoteStatus(error.httpStatus))
  )
}
