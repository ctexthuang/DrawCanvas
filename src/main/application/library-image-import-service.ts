import type {
  ImportPastedImagesRequest,
  ImportPastedImagesResult,
} from '../../shared/contracts/desktop'
import { downloadRemoteImage, RemoteImageRequestError } from '../infrastructure/remote-image-client'
import type { AppState, LibraryImageDataInput } from './app-state'

const MAX_PASTED_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024

export class LibraryImageImportServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryImageImportServiceError'
  }
}

export class LibraryImageImportService {
  constructor(private readonly appState: AppState) {}

  async importPastedImages(request: ImportPastedImagesRequest): Promise<ImportPastedImagesResult> {
    const inputs: LibraryImageDataInput[] = request.images.map((image, index) => ({
      bytes: image.bytes,
      title: image.name?.trim() || `粘贴图片 ${index + 1}`,
      source: 'clipboard',
    }))
    let totalBytes = inputs.reduce((total, input) => total + input.bytes.byteLength, 0)
    try {
      for (const remoteUrl of request.remoteUrls) {
        const downloaded = await downloadRemoteImage(remoteUrl, MAX_PASTED_IMAGE_TOTAL_BYTES - totalBytes)
        inputs.push({ ...downloaded, source: 'network' })
        totalBytes += downloaded.bytes.byteLength
      }
      return await this.appState.importLibraryImageData(inputs)
    } catch (error) {
      if (error instanceof RemoteImageRequestError) {
        throw new LibraryImageImportServiceError(error.message)
      }
      throw error
    }
  }
}
