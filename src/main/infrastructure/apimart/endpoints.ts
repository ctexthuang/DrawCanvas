export const APIMART_DEFAULT_BASE_URL = 'https://api.apimart.ai/v1'

export function createApiMartEndpoint(baseUrl: string, endpoint: string): string {
  const url = ensureVersionOneBaseUrl(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
  return url.toString()
}

export function createApiMartChatEndpointCandidates(baseUrl: string): ReadonlyArray<string> {
  const compatibleEndpoint = createApiMartEndpoint(baseUrl, 'chat/completions')
  const url = new URL(baseUrl)
  url.pathname = '/api/v1/chat/completions'
  url.search = ''
  url.hash = ''
  const documentedEndpoint = url.toString()
  return documentedEndpoint === compatibleEndpoint
    ? [compatibleEndpoint]
    : [documentedEndpoint, compatibleEndpoint]
}

function ensureVersionOneBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (!/(?:^|\/)v1$/i.test(pathname)) url.pathname = `${pathname}/v1`
  url.search = ''
  url.hash = ''
  return url
}
