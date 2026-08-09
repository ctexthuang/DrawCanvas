// Sandboxed preload scripts run as bundled CommonJS and use Electron's preload-safe polyfill.
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CanvasDocument,
  ClearProviderApiKeyRequest,
  DeleteRecentCanvasProjectRequest,
  DesktopApi,
  GenerateImageRequest,
  GeneratedArtwork,
  LoadGeneratedImageRequest,
  LoadRecentCanvasProjectRequest,
  RemoveLibraryImageRequest,
  RemoveResourceRequest,
  SavePromptRequest,
  SaveProviderRequest,
  SaveWorkflowRequest,
  SetProviderEnabledRequest,
  TestProviderRequest,
  UpdateSettingsRequest,
} from '../shared/contracts/desktop'
import {
  CANVAS_IPC_CHANNELS,
  GENERATION_IPC_CHANNELS,
  LIBRARY_IPC_CHANNELS,
  RESOURCE_IPC_CHANNELS,
} from '../shared/contracts/ipc-channels'

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
    load: () => ipcRenderer.invoke(LIBRARY_IPC_CHANNELS.load),
    importImages: () => ipcRenderer.invoke(LIBRARY_IPC_CHANNELS.importImages),
    remove: (request: RemoveLibraryImageRequest) => ipcRenderer.invoke(LIBRARY_IPC_CHANNELS.remove, request),
  },
  resources: {
    load: () => ipcRenderer.invoke(RESOURCE_IPC_CHANNELS.load),
    savePrompt: (request: SavePromptRequest) => ipcRenderer.invoke(RESOURCE_IPC_CHANNELS.savePrompt, request),
    removePrompt: (request: RemoveResourceRequest) => ipcRenderer.invoke(RESOURCE_IPC_CHANNELS.removePrompt, request),
    saveWorkflow: (request: SaveWorkflowRequest) => ipcRenderer.invoke(RESOURCE_IPC_CHANNELS.saveWorkflow, request),
    removeWorkflow: (request: RemoveResourceRequest) => ipcRenderer.invoke(RESOURCE_IPC_CHANNELS.removeWorkflow, request),
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
    listRecent: () => ipcRenderer.invoke(CANVAS_IPC_CHANNELS.listRecent),
    loadRecent: (request: LoadRecentCanvasProjectRequest) => ipcRenderer.invoke(CANVAS_IPC_CHANNELS.loadRecent, request),
    deleteRecent: (request: DeleteRecentCanvasProjectRequest) => ipcRenderer.invoke(CANVAS_IPC_CHANNELS.deleteRecent, request),
    openFile: () => ipcRenderer.invoke('canvas:open-file'),
    saveFile: (document: CanvasDocument) => ipcRenderer.invoke('canvas:save-file', document),
  },
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
