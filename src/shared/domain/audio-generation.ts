export const APIMART_TTS_VOICE_IDS = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
] as const

export type ApiMartTtsVoiceId = (typeof APIMART_TTS_VOICE_IDS)[number]

export function normalizeApiMartTtsVoiceId(value: string): ApiMartTtsVoiceId {
  if (isApiMartTtsVoiceId(value)) return value
  switch (value) {
    case 'female-shaonv': return 'nova'
    case 'female-yujie': return 'shimmer'
    case 'male-qn-qingse': return 'echo'
    case 'male-qn-jingying': return 'onyx'
    default: return 'alloy'
  }
}

export function normalizeMiniMaxTtsVoiceId(value: string): string {
  switch (value) {
    case 'nova': return 'female-shaonv'
    case 'shimmer': return 'female-yujie'
    case 'echo': return 'male-qn-qingse'
    case 'fable':
    case 'onyx': return 'male-qn-jingying'
    case 'alloy': return 'female-shaonv'
    default: return value
  }
}

function isApiMartTtsVoiceId(value: string): value is ApiMartTtsVoiceId {
  return APIMART_TTS_VOICE_IDS.some((voiceId) => voiceId === value)
}
