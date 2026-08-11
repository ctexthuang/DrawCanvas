import type { DesktopApi } from '../shared/contracts/desktop'

type RendererDesktopApi = DesktopApi & Readonly<{
  library: DesktopApi['library'] & Readonly<{
    importDroppedImages: (
      files: ReadonlyArray<File>,
    ) => ReturnType<DesktopApi['library']['importImages']>
  }>
}>

declare global {
  interface Window {
    desktop?: RendererDesktopApi
  }
}

export {}
