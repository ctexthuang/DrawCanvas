import type { ProviderConfig } from '../../shared/contracts/desktop'
import type { ConfiguredProviderModel, ModelKind } from '../../shared/domain/models'
import type { AppState } from './app-state'

export type ModelRoutingErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'

export class ModelRoutingError extends Error {
  constructor(
    readonly code: ModelRoutingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ModelRoutingError'
  }
}

export type ResolvedProviderModel = Readonly<{
  apiKey: string
  model: ConfiguredProviderModel
  provider: ProviderConfig
}>

export async function runWithModelRoute<TResult>(
  appState: AppState,
  kind: ModelKind,
  requestedModelKey: string | undefined,
  isRetryable: (error: unknown) => boolean,
  run: (candidate: ResolvedProviderModel) => Promise<TResult>,
): Promise<TResult> {
  const settings = await appState.loadSettings()
  const modelKeys = requestedModelKey
    ? [requestedModelKey]
    : settings.modelRoutes[kind]?.modelKeys ?? []

  if (modelKeys.length === 0) {
    throw new ModelRoutingError(
      'MODEL_NOT_CONFIGURED',
      `当前没有可用的默认${modelKindLabel(kind)}模型，请先在模型设置中配置`,
    )
  }

  for (const [index, modelKey] of modelKeys.entries()) {
    const candidate = await resolveCandidate(appState, settings, kind, modelKey)
    try {
      return await run(candidate)
    } catch (error) {
      const hasFallback = !requestedModelKey && index < modelKeys.length - 1
      if (!hasFallback || !isRetryable(error)) throw error
    }
  }

  throw new ModelRoutingError('MODEL_NOT_CONFIGURED', `没有可用的${modelKindLabel(kind)}模型`)
}

export function isRetryableRemoteStatus(httpStatus: number | undefined): boolean {
  return httpStatus === undefined || httpStatus < 400 || httpStatus >= 500
}

async function resolveCandidate(
  appState: AppState,
  settings: Awaited<ReturnType<AppState['loadSettings']>>,
  kind: ModelKind,
  modelKey: string,
): Promise<ResolvedProviderModel> {
  const model = settings.models.find((item) => item.key === modelKey)
  if (!model || model.kind !== kind || !model.enabled || !model.available) {
    throw new ModelRoutingError(
      'MODEL_NOT_CONFIGURED',
      `模型 ${model?.displayName ?? modelKey} 不可用，请检查模型目录和默认路由`,
    )
  }

  const provider = settings.providers.find((item) => item.id === model.providerId)
  if (!provider?.enabled || !provider.hasApiKey) {
    throw new ModelRoutingError(
      'PROVIDER_NOT_CONFIGURED',
      `请启用 ${provider?.name ?? model.providerId} 并保存 API Key`,
    )
  }

  let apiKey: string | null
  try {
    apiKey = await appState.loadProviderApiKey(provider.id)
  } catch (error) {
    throw new ModelRoutingError(
      'PROVIDER_NOT_CONFIGURED',
      `无法解密 ${provider.name} 的 API Key，请重新保存后再试`,
      { cause: error },
    )
  }
  if (!apiKey) {
    throw new ModelRoutingError('PROVIDER_NOT_CONFIGURED', `无法读取 ${provider.name} 的 API Key`)
  }

  return { apiKey, model, provider }
}

function modelKindLabel(kind: ModelKind): string {
  switch (kind) {
    case 'image': return '图片'
    case 'video': return '视频'
    case 'chat': return '对话'
    case 'audio': return '音频'
  }
}
