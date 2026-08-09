export type OpenAiCompatibleProfile = 'openai' | 'sub2api'

export function createOpenAiEndpointCandidates(
  baseUrl: string,
  endpoint: string,
  profile: OpenAiCompatibleProfile,
): ReadonlyArray<string> {
  const directEndpoint = appendEndpoint(baseUrl, endpoint)
  if (profile !== 'sub2api') return [directEndpoint]

  const versionedEndpoint = appendEndpoint(ensureVersionOneBaseUrl(baseUrl), endpoint)
  return versionedEndpoint === directEndpoint
    ? [versionedEndpoint]
    : [versionedEndpoint, directEndpoint]
}

function ensureVersionOneBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (!/(?:^|\/)v1$/i.test(pathname)) url.pathname = `${pathname}/v1`
  return url.toString().replace(/\/+$/, '')
}

function appendEndpoint(baseUrl: string, endpoint: string): string {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = `${pathname}/${endpoint.replace(/^\/+/, '')}`
  return url.toString()
}
