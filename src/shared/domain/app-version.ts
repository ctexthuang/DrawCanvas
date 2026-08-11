export type SemanticVersion = Readonly<{
  major: number
  minor: number
  patch: number
  prerelease: ReadonlyArray<string>
}>

const SEMANTIC_VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = SEMANTIC_VERSION_PATTERN.exec(value.trim())
  if (!match) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return null
  }

  return { major, minor, patch, prerelease }
}

export function normalizeSemanticVersion(value: string): string | null {
  const version = parseSemanticVersion(value)
  if (!version) return null
  const prerelease = version.prerelease.length > 0
    ? `-${version.prerelease.join('.')}`
    : ''
  return `${version.major}.${version.minor}.${version.patch}${prerelease}`
}

export function compareSemanticVersions(leftValue: string, rightValue: string): number | null {
  const left = parseSemanticVersion(leftValue)
  const right = parseSemanticVersion(rightValue)
  if (!left || !right) return null

  for (const field of ['major', 'minor', 'patch'] as const) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }

  const identifierCount = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftIsNumeric = /^\d+$/.test(leftIdentifier)
    const rightIsNumeric = /^\d+$/.test(rightIdentifier)
    if (leftIsNumeric && rightIsNumeric) {
      const leftNumber = Number(leftIdentifier)
      const rightNumber = Number(rightIdentifier)
      if (!Number.isSafeInteger(leftNumber) || !Number.isSafeInteger(rightNumber)) {
        return leftIdentifier.length === rightIdentifier.length
          ? (leftIdentifier > rightIdentifier ? 1 : -1)
          : (leftIdentifier.length > rightIdentifier.length ? 1 : -1)
      }
      return leftNumber > rightNumber ? 1 : -1
    }
    if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1
    return leftIdentifier > rightIdentifier ? 1 : -1
  }

  return 0
}
