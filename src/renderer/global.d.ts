import type { DesktopApi } from '../shared/contracts/desktop'

type RendererDesktopApi = DesktopApi & Readonly<{
  library: DesktopApi['library'] & Readonly<{
    importDroppedImages: (
      files: ReadonlyArray<File>,
    ) => ReturnType<DesktopApi['library']['importImages']>
  }>
}>

declare global {
  const __APP_VERSION__: string

  interface Window {
    desktop?: RendererDesktopApi
  }
}

export {}
