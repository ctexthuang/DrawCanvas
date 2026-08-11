import type {
  GenerateAudioRequest,
  GeneratedAudioResult,
} from '../../shared/contracts/desktop'
import { findBuiltinModelByKey } from '../../shared/domain/models'
import {
  AudioGenerationRequestError,
  generateMiniMaxAudio,
} from '../infrastructure/audio-generation-client'
import type { AppState } from './app-state'

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
    const settings = await this.appState.loadSettings()
    const modelKey = request.modelKey ?? settings.defaultModelKeys.audio
    if (!modelKey || !settings.enabledModelKeys.includes(modelKey)) {
      throw new AudioGenerationServiceError(
        'MODEL_NOT_CONFIGURED',
        '当前没有可用的默认语音模型，请先在模型设置中启用并设为默认',
      )
    }
    const model = findBuiltinModelByKey(modelKey)
    if (!model || model.kind !== 'audio') {
      throw new AudioGenerationServiceError('MODEL_NOT_CONFIGURED', '选择的模型不是可用的语音模型')
    }
    const provider = settings.providers.find((item) => item.id === model.providerId)
    if (!provider?.enabled || !provider.hasApiKey) {
      throw new AudioGenerationServiceError('PROVIDER_NOT_CONFIGURED', '请先启用 MiniMax 并保存 API Key')
    }
    if (provider.id !== 'minimax') {
      throw new AudioGenerationServiceError('UNSUPPORTED_PROVIDER', '当前语音节点支持 MiniMax Speech 2.8 模型')
    }
    const apiKey = await this.appState.loadProviderApiKey(provider.id)
    if (!apiKey) {
      throw new AudioGenerationServiceError('PROVIDER_NOT_CONFIGURED', '无法读取 MiniMax API Key')
    }
    try {
      const generated = await generateMiniMaxAudio({
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
        modelKey,
        modelName: model.displayName,
        voiceId: request.voiceId,
        speed: request.speed,
        pitch: request.pitch,
        emotion: request.emotion,
      })
      return { audio }
    } catch (error) {
      if (error instanceof AudioGenerationRequestError) {
        throw new AudioGenerationServiceError('PROVIDER_REQUEST', error.message)
      }
      throw error
    }
  }
}
