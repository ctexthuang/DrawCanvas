export type ModelKind = 'image' | 'video' | 'chat' | 'audio'

export type ProviderModelDefinition = Readonly<{
  key: string
  providerId: string
  remoteModelId: string
  displayName: string
  kind: ModelKind
  description: string
  badge?: string
}>

export function createProviderModelKey(providerId: string, remoteModelId: string): string {
  return `${providerId}:${remoteModelId}`
}

export const DEFAULT_IMAGE_MODEL_KEY = createProviderModelKey('openai-relay', 'gpt-image-2')
export const DEFAULT_CHAT_MODEL_KEY = createProviderModelKey('openai-relay', 'gpt-5.6-sol')

export const BUILTIN_PROVIDER_MODELS: ReadonlyArray<ProviderModelDefinition> = [
  {
    key: createProviderModelKey('openai-relay', 'gpt-image-2'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-image-2',
    displayName: 'GPT Image 2',
    kind: 'image',
    description: 'OpenAI Relay 默认图像生成模型',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-image-1.5'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-image-1.5',
    displayName: 'GPT Image 1.5',
    kind: 'image',
    description: 'OpenAI Relay 通用图像生成模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-image-1'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-image-1',
    displayName: 'GPT Image 1',
    kind: 'image',
    description: 'OpenAI Relay 基础图像生成模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.6-sol'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    kind: 'chat',
    description: '复杂推理、编码与专业任务的旗舰模型',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.6-terra'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    kind: 'chat',
    description: '能力、延迟与成本均衡的通用模型',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.6-luna'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    kind: 'chat',
    description: '面向低成本、高吞吐任务的轻量模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.5'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.5',
    displayName: 'GPT-5.5',
    kind: 'chat',
    description: '上一代复杂推理与专业工作模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.4'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.4',
    displayName: 'GPT-5.4',
    kind: 'chat',
    description: '稳定的通用推理与编码模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.4-mini'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 mini',
    kind: 'chat',
    description: '低延迟的中小型任务模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-5.4-nano'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-5.4-nano',
    displayName: 'GPT-5.4 nano',
    kind: 'chat',
    description: '简单高频任务的低成本模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-4.1'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-4.1',
    displayName: 'GPT-4.1',
    kind: 'chat',
    description: '经典非推理通用模型',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-4.1-mini'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 mini',
    kind: 'chat',
    description: '更快、更经济的 GPT-4.1 变体',
  },
  {
    key: createProviderModelKey('openai-relay', 'gpt-4o-mini'),
    providerId: 'openai-relay',
    remoteModelId: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    kind: 'chat',
    description: '适合聚焦型对话任务的轻量模型',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedream-5-0-260128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedream-5-0-260128',
    displayName: 'Doubao Seedream 5.0',
    kind: 'image',
    description: '火山方舟最新图片生成模型，支持知识增强与专业场景生成',
    badge: '推荐',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedream-5-0-lite-260128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedream-5-0-lite-260128',
    displayName: 'Doubao Seedream 5.0 Lite',
    kind: 'image',
    description: 'Seedream 5.0 轻量版本，适合低延迟图片生成',
  },
  {
    key: createProviderModelKey('volcengine', 'doubao-seedream-4-5-251128'),
    providerId: 'volcengine',
    remoteModelId: 'doubao-seedream-4-5-251128',
    displayName: 'Doubao Seedream 4.5',
    kind: 'image',
    description: '支持高质量生成、图像编辑与 4K 输出的稳定版本',
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
