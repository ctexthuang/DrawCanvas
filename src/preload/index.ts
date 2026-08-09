// Sandboxed preload scripts run as bundled CommonJS and use Electron's preload-safe polyfill.
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CanvasDocument,
  ClearProviderApiKeyRequest,
  DesktopApi,
  GenerateImageRequest,
  GeneratedArtwork,
  LoadGeneratedImageRequest,
  SaveProviderRequest,
  SetProviderEnabledRequest,
  TestProviderRequest,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import { GENERATION_IPC_CHANNELS } from '../shared/contracts/ipc-channels'

const desktopApi: DesktopApi = {
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    update: (request: UpdateSettingsRequest) => ipcRenderer.invoke('settings:update', request),
  },
  models: {
    saveProvider: (request: SaveProviderRequest) => ipcRenderer.invoke('models:save-provider', request),
    testProvider: (request: TestProviderRequest) => ipcRenderer.invoke('models:test-provider', request),
    clearApiKey: (request: ClearProviderApiKeyRequest) => ipcRenderer.invoke('models:clear-api-key', request),
    setProviderEnabled: (request: SetProviderEnabledRequest) => ipcRenderer.invoke('models:set-provider-enabled', request),
  },
  history: {
    load: () => ipcRenderer.invoke('history:load'),
    record: (artwork: GeneratedArtwork) => ipcRenderer.invoke('history:record', artwork),
  },
  library: {
    load: () => ipcRenderer.invoke('library:load'),
  },
  resources: {
    load: () => ipcRenderer.invoke('resources:load'),
  },
  generation: {
    generateImage: (request: GenerateImageRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.generateImage, request),
    loadImage: (request: LoadGeneratedImageRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.loadImage, request),
  },
  storage: {
    changeDirectory: () => ipcRenderer.invoke('storage:change-directory'),
    openDirectory: () => ipcRenderer.invoke('storage:open-directory'),
    stats: () => ipcRenderer.invoke('storage:stats'),
  },
  canvas: {
    loadAutosave: () => ipcRenderer.invoke('canvas:load-autosave'),
    saveAutosave: (document: CanvasDocument) => ipcRenderer.invoke('canvas:save-autosave', document),
    openFile: () => ipcRenderer.invoke('canvas:open-file'),
    saveFile: (document: CanvasDocument) => ipcRenderer.invoke('canvas:save-file', document),
  },
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
