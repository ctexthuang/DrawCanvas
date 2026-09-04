import { isIP } from 'node:net'

export function parseSafeRemoteMediaUrl(value: string): URL | null {
  if (value.length === 0 || value.length > 4_096) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || isNonPublicHostname(url.hostname)) {
      return null
    }
    return url
  } catch {
    return null
  }
}

export function isPublicRemoteMediaAddress(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, '')
  const ipVersion = isIP(address)
  if (ipVersion === 4) return !isNonPublicIpv4(address)
  if (ipVersion === 6) return !isNonPublicIpv6(address)
  return false
}

function isNonPublicHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const ipVersion = isIP(hostname)
  if (ipVersion !== 0) return !isPublicRemoteMediaAddress(hostname)
  if (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localdomain')
  ) return true
  return false
}

function isNonPublicIpv4(value: string): boolean {
  const [first, second, third] = value.split('.').map(Number)
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
}

function isNonPublicIpv6(value: string): boolean {
  return value === '::' ||
    value === '::1' ||
    value.startsWith('::ffff:') ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    /^fe[89ab]/.test(value) ||
    value.startsWith('ff') ||
    value.startsWith('2001:db8:')
}
