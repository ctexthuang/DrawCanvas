export type ModelKind = 'image' | 'video' | 'chat' | 'audio'

export type ProviderAdapterId = 'openai' | 'openai-sub2api' | 'volcengine' | 'minimax'

export type ProviderModelSource = 'builtin' | 'discovered' | 'manual'

export const IMAGE_GENERATION_SIZES = [
  'auto',
  '720x1280',
  '832x1248',
  '864x1152',
  '1024x1024',
  '1024x1536',
  '1152x864',
  '1152x2048',
  '1248x832',
  '1280x720',
  '1296x3024',
  '1344x576',
  '1440x2560',
  '1536x1024',
  '1664x2496',
  '1728x2304',
  '2048x1152',
  '2048x2048',
  '2160x3840',
  '2304x1728',
  '2496x1664',
  '2560x1440',
  '3024x1296',
  '3840x2160',
] as const

export type ImageGenerationSize = typeof IMAGE_GENERATION_SIZES[number]

export type ImageGenerationAspectRatio =
  | '1:1'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '16:9'
  | '9:16'
  | '21:9'
  | '9:21'

export type ImageGenerationResolutionTier = 'standard' | '2k' | '4k'

export type ImageGenerationSizeMapping = Readonly<{
  value: Exclude<ImageGenerationSize, 'auto'>
  aspectRatio: ImageGenerationAspectRatio
  tier: ImageGenerationResolutionTier
}>

export type ImageGenerationSizeOption = Readonly<{
  value: ImageGenerationSize
  label: string
}>

export type ProviderModelDefinition = Readonly<{
  key: string
  providerId: string
  remoteModelId: string
  displayName: string
  kind: ModelKind
  description: string
  badge?: string
  supportsAutomaticImageSize?: boolean
  imageSizeMappings?: ReadonlyArray<ImageGenerationSizeMapping>
}>

export type ConfiguredProviderModel = Readonly<ProviderModelDefinition & {
  enabled: boolean
  available: boolean
  source: ProviderModelSource
}>

export type ModelRoute = Readonly<{
  modelKeys: ReadonlyArray<string>
}>

export type ModelRoutes = Readonly<Partial<Record<ModelKind, ModelRoute>>>

export function createProviderModelKey(providerId: string, remoteModelId: string): string {
  return `${providerId}:${remoteModelId}`
}

export function inferModelKind(remoteModelId: string): ModelKind {
  const value = remoteModelId.toLowerCase()
  if (/(speech|audio|voice|tts|music)/.test(value)) return 'audio'
  if (/(video|veo|sora|seedance|kling|wan.*video)/.test(value)) return 'video'
  if (/(image|seedream|flux|dall|midjourney|recraft|ideogram)/.test(value)) return 'image'
  return 'chat'
}

export function createConfiguredModel(
  model: ProviderModelDefinition,
  source: ProviderModelSource = 'builtin',
): ConfiguredProviderModel {
  return { ...model, enabled: true, available: true, source }
}

export function primaryModelKey(routes: ModelRoutes, kind: ModelKind): string | undefined {
  return routes[kind]?.modelKeys[0]
}

export const DEFAULT_IMAGE_MODEL_KEY = createProviderModelKey('openai', 'gpt-image-2')
export const DEFAULT_CHAT_MODEL_KEY = createProviderModelKey('openai', 'gpt-5.6-sol')

function imageSizeMapping(
  value: ImageGenerationSizeMapping['value'],
  aspectRatio: ImageGenerationAspectRatio,
  tier: ImageGenerationResolutionTier,
): ImageGenerationSizeMapping {
  return { value, aspectRatio, tier }
}

type OpenAiModelCatalogEntry = Readonly<Omit<ProviderModelDefinition, 'key' | 'providerId'>>

const OPENAI_MODEL_CATALOG: ReadonlyArray<OpenAiModelCatalogEntry> = [
  {
    remoteModelId: 'gpt-image-2',
    displayName: 'GPT Image 2',
    kind: 'image',
    description: '默认图像生成模型',
    badge: '推荐',
    supportsAutomaticImageSize: true,
    imageSizeMappings: [
      imageSizeMapping('1024x1024', '1:1', 'standard'),
      imageSizeMapping('1536x1024', '3:2', 'standard'),
      imageSizeMapping('1024x1536', '2:3', 'standard'),
      imageSizeMapping('2048x2048', '1:1', '2k'),
      imageSizeMapping('2048x1152', '16:9', '2k'),
      imageSizeMapping('3840x2160', '16:9', '4k'),
      imageSizeMapping('2160x3840', '9:16', '4k'),
    ],
  },
  {
    remoteModelId: 'gpt-image-1.5',
    displayName: 'GPT Image 1.5',
    kind: 'image',
    description: '通用图像生成模型',
    imageSizeMappings: [
      imageSizeMapping('1024x1024', '1:1', 'standard'),
      imageSizeMapping('1536x1024', '3:2', 'standard'),
      imageSizeMapping('1024x1536', '2:3', 'standard'),
    ],
  },
  {
    remoteModelId: 'gpt-image-1',
    displayName: 'GPT Image 1',
    kind: 'image',
    description: '基础图像生成模型',
    imageSizeMappings: [
      imageSizeMapping('1024x1024', '1:1', 'standard'),
      imageSizeMapping('1536x1024', '3:2', 'standard'),
      imageSizeMapping('1024x1536', '2:3', 'standard'),
    ],
  },
  {
    remoteModelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    kind: 'chat',
    description: '复杂推理、编码与专业任务的旗舰模型',
    badge: '推荐',
  },
  {
    remoteModelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    kind: 'chat',
    description: '能力、延迟与成本均衡的通用模型',
    badge: '推荐',
  },
  {
    remoteModelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    kind: 'chat',
    description: '面向低成本、高吞吐任务的轻量模型',
  },
  {
    remoteModelId: 'gpt-5.5',
    displayName: 'GPT-5.5',
    kind: 'chat',
    description: '上一代复杂推理与专业工作模型',
  },
  {
    remoteModelId: 'gpt-5.4',
    displayName: 'GPT-5.4',
    kind: 'chat',
    description: '稳定的通用推理与编码模型',
  },
  {
    remoteModelId: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 mini',
    kind: 'chat',
    description: '低延迟的中小型任务模型',
  },
  {
    remoteModelId: 'gpt-5.4-nano',
    displayName: 'GPT-5.4 nano',
    kind: 'chat',
    description: '简单高频任务的低成本模型',
  },
  {
    remoteModelId: 'gpt-4.1',
    displayName: 'GPT-4.1',
    kind: 'chat',
    description: '经典非推理通用模型',
  },
  {
    remoteModelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 mini',
    kind: 'chat',
    description: '更快、更经济的 GPT-4.1 变体',
  },
  {
    remoteModelId: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    kind: 'chat',
    description: '适合聚焦型对话任务的轻量模型',
  },
]

function createOpenAiProviderModels(providerId: 'openai' | 'openai-sub2api'): ReadonlyArray<ProviderModelDefinition> {
  const providerLabel = providerId === 'openai' ? 'OpenAI' : 'OpenAI 中转'
  return OPENAI_MODEL_CATALOG.map((model) => ({
    ...model,
    key: createProviderModelKey(providerId, model.remoteModelId),
    providerId,
    description: `${providerLabel} · ${model.description}`,
  }))
}

export const BUILTIN_PROVIDER_MODELS: ReadonlyArray<ProviderModelDefinition> = [
  ...createOpenAiProviderModels('openai'),
  ...createOpenAiProviderModels('openai-sub2api'),
  {
    key: createProviderModelKey('volcengine', 'doubao-seedream-5-0-260128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedream-5-0-260128',
    displayName: 'Doubao Seedream 5.0',
    kind: 'image',
    description: '火山方舟最新图片生成模型，支持知识增强与专业场景生成',
    badge: '推荐',
    imageSizeMappings: [
      imageSizeMapping('2048x2048', '1:1', '2k'),
      imageSizeMapping('2304x1728', '4:3', '2k'),
      imageSizeMapping('1728x2304', '3:4', '2k'),
      imageSizeMapping('2496x1664', '3:2', '2k'),
      imageSizeMapping('1664x2496', '2:3', '2k'),
      imageSizeMapping('2560x1440', '16:9', '2k'),
      imageSizeMapping('1440x2560', '9:16', '2k'),
      imageSizeMapping('3024x1296', '21:9', '2k'),
      imageSizeMapping('1296x3024', '9:21', '2k'),
    ],
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedream-5-0-lite-260128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedream-5-0-lite-260128',
    displayName: 'Doubao Seedream 5.0 Lite',
    kind: 'image',
    description: 'Seedream 5.0 轻量版本，适合低延迟图片生成',
    imageSizeMappings: [
      imageSizeMapping('2048x2048', '1:1', '2k'),
      imageSizeMapping('2304x1728', '4:3', '2k'),
      imageSizeMapping('1728x2304', '3:4', '2k'),
      imageSizeMapping('2496x1664', '3:2', '2k'),
      imageSizeMapping('1664x2496', '2:3', '2k'),
      imageSizeMapping('2560x1440', '16:9', '2k'),
      imageSizeMapping('1440x2560', '9:16', '2k'),
      imageSizeMapping('3024x1296', '21:9', '2k'),
      imageSizeMapping('1296x3024', '9:21', '2k'),
    ],
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedream-4-5-251128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedream-4-5-251128',
    displayName: 'Doubao Seedream 4.5',
    kind: 'image',
    description: '支持高质量生成、图像编辑与 4K 输出的稳定版本',
    imageSizeMappings: [
      imageSizeMapping('2048x2048', '1:1', '2k'),
      imageSizeMapping('2304x1728', '4:3', '2k'),
      imageSizeMapping('1728x2304', '3:4', '2k'),
      imageSizeMapping('2496x1664', '3:2', '2k'),
      imageSizeMapping('1664x2496', '2:3', '2k'),
      imageSizeMapping('2560x1440', '16:9', '2k'),
      imageSizeMapping('1440x2560', '9:16', '2k'),
      imageSizeMapping('3024x1296', '21:9', '2k'),
      imageSizeMapping('1296x3024', '9:21', '2k'),
    ],
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedance-2-0-260128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedance-2-0-260128',
    displayName: 'Doubao Seedance 2.0',
    kind: 'video',
    description: '火山方舟新一代视听生成模型，支持多模态参考与原生音轨',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedance-1-5-pro-251215'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedance-1-5-pro-251215',
    displayName: 'Doubao Seedance 1.5 Pro',
    kind: 'video',
    description: '支持文生视频、图生视频与有声视频生成',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seed-2-0-pro-260215'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seed-2-0-pro-260215',
    displayName: 'Doubao Seed 2.0 Pro',
    kind: 'chat',
    description: '面向复杂推理与长链路 Agent 任务的旗舰通用模型',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seed-2-0-lite-260215'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seed-2-0-lite-260215',
    displayName: 'Doubao Seed 2.0 Lite',
    kind: 'chat',
    description: '支持文本、图像、视频与音频理解的高性价比通用模型',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seed-2-0-mini-260215'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seed-2-0-mini-260215',
    displayName: 'Doubao Seed 2.0 Mini',
    kind: 'chat',
    description: '适合低延迟、高并发对话和轻量任务',
  },
  {
    key: createProviderModelKey('minimax', 'image-01'),
    providerId: 'minimax',
    remoteModelId: 'image-01',
    displayName: 'MiniMax Image 01',
    kind: 'image',
    description: '支持文生图与主体参考图生图的高质量图片模型',
    imageSizeMappings: [
      imageSizeMapping('1024x1024', '1:1', 'standard'),
      imageSizeMapping('1280x720', '16:9', 'standard'),
      imageSizeMapping('1152x864', '4:3', 'standard'),
      imageSizeMapping('1248x832', '3:2', 'standard'),
      imageSizeMapping('832x1248', '2:3', 'standard'),
      imageSizeMapping('864x1152', '3:4', 'standard'),
      imageSizeMapping('720x1280', '9:16', 'standard'),
      imageSizeMapping('1344x576', '21:9', 'standard'),
    ],
  },
  {
    key: createProviderModelKey('minimax', 'MiniMax-H3'),
    providerId: 'minimax',
    remoteModelId: 'MiniMax-H3',
    displayName: 'MiniMax H3',
    kind: 'video',
    description: '全模态音视频生成模型，支持多模态上下文、原生双声道与 2K 输出',
    badge: '最新',
  },
  {
    key: createProviderModelKey('minimax', 'MiniMax-Hailuo-2.3'),
    providerId: 'minimax',
    remoteModelId: 'MiniMax-Hailuo-2.3',
    displayName: 'MiniMax Hailuo 2.3',
    kind: 'video',
    description: '支持文生视频与图生视频，强化人物动作、表情和物理表现',
  },
  {
    key: createProviderModelKey('minimax', 'MiniMax-Hailuo-2.3-Fast'),
    providerId: 'minimax',
    remoteModelId: 'MiniMax-Hailuo-2.3-Fast',
    displayName: 'MiniMax Hailuo 2.3 Fast',
    kind: 'video',
    description: '面向图生视频的高效率版本',
  },
  {
    key: createProviderModelKey('minimax', 'MiniMax-M3'),
    providerId: 'minimax',
    remoteModelId: 'MiniMax-M3',
    displayName: 'MiniMax M3',
    kind: 'chat',
    description: 'MiniMax 最新 Agent 通用模型，支持长上下文与多模态理解',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('minimax', 'MiniMax-M2.7'),
    providerId: 'minimax',
    remoteModelId: 'MiniMax-M2.7',
    displayName: 'MiniMax M2.7',
    kind: 'chat',
    description: '适合编程、Agent 工作流与复杂任务的通用模型',
  },
  {
    key: createProviderModelKey('minimax', 'MiniMax-M2.7-highspeed'),
    providerId: 'minimax',
    remoteModelId: 'MiniMax-M2.7-highspeed',
    displayName: 'MiniMax M2.7 Highspeed',
    kind: 'chat',
    description: 'M2.7 的高吞吐低延迟版本',
  },
  {
    key: createProviderModelKey('minimax', 'speech-2.8-hd'),
    providerId: 'minimax',
    remoteModelId: 'speech-2.8-hd',
    displayName: 'MiniMax Speech 2.8 HD',
    kind: 'audio',
    description: '高拟真语音合成模型，支持声音标签与多语言输出',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('minimax', 'speech-2.8-turbo'),
    providerId: 'minimax',
    remoteModelId: 'speech-2.8-turbo',
    displayName: 'MiniMax Speech 2.8 Turbo',
    kind: 'audio',
    description: '兼顾自然度、速度与成本的实时语音合成模型',
  },
  // {
  //   key: createProviderModelKey('apimart', 'gemini-3-pro-image-preview-official'),
  //   providerId: 'apimart',
  //   remoteModelId: 'gemini-3-pro-image-preview-official',
  //   displayName: 'Gemini 3 Pro Image',
  //   kind: 'image',
  //   description: '强大的图文理解与多轮图像编辑',
  //   badge: '最新',
  // },
  // {
  //   key: createProviderModelKey('apimart', 'gemini-2.5-flash-image-preview-official'),
  //   providerId: 'apimart',
  //   remoteModelId: 'gemini-2.5-flash-image-preview-official',
  //   displayName: 'Gemini 2.5 Flash Image',
  //   kind: 'image',
  //   description: '低延迟创意草图与快速预览',
  // },
]

export function findBuiltinModelByKey(key: string): ProviderModelDefinition | undefined {
  return BUILTIN_PROVIDER_MODELS.find((model) => model.key === key)
}

export function findBuiltinModelsByRemoteId(remoteModelId: string): ReadonlyArray<ProviderModelDefinition> {
  return BUILTIN_PROVIDER_MODELS.filter((model) => model.remoteModelId === remoteModelId)
}

const IMAGE_GENERATION_SIZE_SET: ReadonlySet<string> = new Set(IMAGE_GENERATION_SIZES)

export function isImageGenerationSize(value: unknown): value is ImageGenerationSize {
  return typeof value === 'string' && IMAGE_GENERATION_SIZE_SET.has(value)
}

export function imageGenerationSizeOptionsForModel(modelKey: string): ReadonlyArray<ImageGenerationSizeOption> {
  const model = findBuiltinModelByKey(modelKey)
  const mappings = model?.kind === 'image' && model.imageSizeMappings?.length
    ? model.imageSizeMappings
    : [imageSizeMapping('1024x1024', '1:1', 'standard')]
  const mappedOptions = mappings.map((mapping) => ({
    value: mapping.value,
    label: imageGenerationSizeLabel(mapping),
  }))
  return model?.kind === 'image' && model.supportsAutomaticImageSize
    ? [{ value: 'auto', label: '自动 · auto' }, ...mappedOptions]
    : mappedOptions
}

export function defaultImageGenerationSizeForModel(modelKey: string): ImageGenerationSize {
  const model = findBuiltinModelByKey(modelKey)
  return model?.kind === 'image' && model.imageSizeMappings?.length
    ? model.imageSizeMappings[0].value
    : '1024x1024'
}

export function isImageGenerationSizeSupported(modelKey: string, size: ImageGenerationSize): boolean {
  const model = findBuiltinModelByKey(modelKey)
  if (!model) return size === '1024x1024'
  if (model.kind !== 'image') return false
  if (size === 'auto') return model.supportsAutomaticImageSize === true
  return Boolean(model.imageSizeMappings?.some((mapping) => mapping.value === size))
}

export function normalizeImageGenerationSize(
  modelKey: string,
  size: ImageGenerationSize | undefined,
): ImageGenerationSize {
  if (size && isImageGenerationSizeSupported(modelKey, size)) return size
  const model = findBuiltinModelByKey(modelKey)
  if (size && size !== 'auto' && model?.kind === 'image' && model.imageSizeMappings?.length) {
    const sourceRatio = imageSizeRatio(size)
    const matchingRatio = model.imageSizeMappings.find((candidate) =>
      Math.abs(imageSizeRatio(candidate.value) - sourceRatio) < 0.001,
    )
    if (matchingRatio) return matchingRatio.value
    const nearestRatio = model.imageSizeMappings.reduce((nearest, candidate) =>
      Math.abs(Math.log(imageSizeRatio(candidate.value) / sourceRatio)) <
      Math.abs(Math.log(imageSizeRatio(nearest.value) / sourceRatio))
        ? candidate
        : nearest,
    )
    return nearestRatio.value
  }
  return defaultImageGenerationSizeForModel(modelKey)
}

function imageGenerationSizeLabel(mapping: ImageGenerationSizeMapping): string {
  const [width, height] = mapping.value.split('x')
  return `${mapping.aspectRatio} · ${imageResolutionTierLabel(mapping.tier)} · ${width} × ${height}`
}

function imageResolutionTierLabel(tier: ImageGenerationResolutionTier): string {
  switch (tier) {
    case 'standard': return '标准'
    case '2k': return '2K'
    case '4k': return '4K'
  }
}

function imageSizeRatio(size: Exclude<ImageGenerationSize, 'auto'>): number {
  const [width, height] = size.split('x').map(Number)
  return width / height
}
