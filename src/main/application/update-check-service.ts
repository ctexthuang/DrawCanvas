import type { AppUpdateCheck } from '../../shared/contracts/desktop'
import {
  compareSemanticVersions,
  normalizeSemanticVersion,
} from '../../shared/domain/app-version'
import {
  fetchLatestGithubRelease,
  GithubReleaseClientError,
  type GithubReleaseClientErrorCode,
} from '../infrastructure/github-release-client'

const CACHE_TTL_MS = 5 * 60 * 1000

export type UpdateCheckServiceErrorCode = GithubReleaseClientErrorCode

export class UpdateCheckServiceError extends Error {
  constructor(readonly code: UpdateCheckServiceErrorCode, message: string) {
    super(message)
    this.name = 'UpdateCheckServiceError'
  }
}

export class UpdateCheckService {
  private cachedResult: Readonly<{ value: AppUpdateCheck; expiresAt: number }> | null = null
  private inFlight: Promise<AppUpdateCheck> | null = null

  async check(currentVersion: string, force: boolean): Promise<AppUpdateCheck> {
    if (!force && this.cachedResult && this.cachedResult.expiresAt > Date.now()) {
      return this.cachedResult.value
    }
    if (this.inFlight) return this.inFlight

    const request = this.checkLatestRelease(currentVersion)
    this.inFlight = request
    try {
      const value = await request
      this.cachedResult = { value, expiresAt: Date.now() + CACHE_TTL_MS }
      return value
    } finally {
      if (this.inFlight === request) this.inFlight = null
    }
  }

  private async checkLatestRelease(currentVersion: string): Promise<AppUpdateCheck> {
    const normalizedCurrentVersion = normalizeSemanticVersion(currentVersion)
    if (!normalizedCurrentVersion) {
      throw new UpdateCheckServiceError('INVALID_RESPONSE', '当前应用版本号无效')
    }

    try {
      const release = await fetchLatestGithubRelease(normalizedCurrentVersion)
      const checkedAt = new Date().toISOString()
      if (!release) {
        return {
          status: 'not-published',
          currentVersion: normalizedCurrentVersion,
          checkedAt,
        }
      }

      const latestVersion = normalizeSemanticVersion(release.tagName)
      const comparison = compareSemanticVersions(release.tagName, normalizedCurrentVersion)
      if (!latestVersion || comparison === null) {
        throw new UpdateCheckServiceError(
          'INVALID_RESPONSE',
          `GitHub Release 版本号无效：${release.tagName}`,
        )
      }

      return {
        status: comparison > 0 ? 'available' : 'up-to-date',
        currentVersion: normalizedCurrentVersion,
        latestVersion,
        latestTag: release.tagName,
        releaseName: release.name,
        ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}),
        checkedAt,
      }
    } catch (error) {
      if (error instanceof UpdateCheckServiceError) throw error
      if (error instanceof GithubReleaseClientError) {
        throw new UpdateCheckServiceError(error.code, error.message)
      }
      throw new UpdateCheckServiceError('NETWORK', '检查更新失败，请稍后重试')
    }
  }
}
