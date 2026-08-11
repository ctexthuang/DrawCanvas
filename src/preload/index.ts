// Sandboxed preload scripts run as bundled CommonJS and use Electron's preload-safe polyfill.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  CanvasDocument,
  CheckForUpdatesRequest,
  ClearProviderApiKeyRequest,
  DeleteRecentCanvasProjectRequest,
  DesktopApi,
  ExportGeneratedAudioRequest,
  ExportGeneratedVideoRequest,
  ExportHistoryBatchRequest,
  GenerateAudioRequest,
  GenerateChatReplyRequest,
  GenerateImageRequest,
  GenerateStoryboardRequest,
  GenerateVideoRequest,
  GeneratedArtwork,
  ImportDroppedImagesRequest,
  LoadGeneratedImageRequest,
  LoadRecentCanvasProjectRequest,
  OptimizePromptRequest,
  RemoveGeneratedVideoRequest,
  RemoveGeneratedAudioRequest,
  RemoveHistoryArtworkRequest,
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
  HISTORY_IPC_CHANNELS,
  LIBRARY_IPC_CHANNELS,
  RESOURCE_IPC_CHANNELS,
  UPDATE_IPC_CHANNELS,
} from '../shared/contracts/ipc-channels'

type FileDropDesktopApi = DesktopApi & Readonly<{
  library: DesktopApi['library'] & Readonly<{
    importDroppedImages: (
      files: ReadonlyArray<File>,
    ) => ReturnType<DesktopApi['library']['importImages']>
  }>
}>

const desktopApi: FileDropDesktopApi = {
  updates: {
    check: (request: CheckForUpdatesRequest) => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.check, request),
    openLatestRelease: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.openLatestRelease),
  },
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
    load: () => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.load),
    loadVideos: () => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.loadVideos),
    loadAudios: () => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.loadAudios),
    record: (artwork: GeneratedArtwork) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.record, artwork),
    remove: (request: RemoveHistoryArtworkRequest) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.remove, request),
    removeVideo: (request: RemoveGeneratedVideoRequest) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.removeVideo, request),
    exportVideo: (request: ExportGeneratedVideoRequest) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.exportVideo, request),
    removeAudio: (request: RemoveGeneratedAudioRequest) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.removeAudio, request),
    exportAudio: (request: ExportGeneratedAudioRequest) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.exportAudio, request),
    exportBatch: (request: ExportHistoryBatchRequest) => ipcRenderer.invoke(HISTORY_IPC_CHANNELS.exportBatch, request),
  },
  library: {
    load: () => ipcRenderer.invoke(LIBRARY_IPC_CHANNELS.load),
    importImages: () => ipcRenderer.invoke(LIBRARY_IPC_CHANNELS.importImages),
    importDroppedImages: async (files: ReadonlyArray<File>) => {
      const paths = [...new Set(files.slice(0, 50).flatMap((file) => {
        try {
          const path = webUtils.getPathForFile(file)
          return path ? [path] : []
        } catch {
          return []
        }
      }))]
      if (paths.length === 0) {
        return { ok: false, error: { code: 'INVALID_FILE', message: '没有可导入的本地图片文件' } }
      }
      const request: ImportDroppedImagesRequest = { paths }
      return ipcRenderer.invoke(LIBRARY_IPC_CHANNELS.importDroppedImages, request)
    },
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
    generateVideo: (request: GenerateVideoRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.generateVideo, request),
    generateAudio: (request: GenerateAudioRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.generateAudio, request),
    optimizePrompt: (request: OptimizePromptRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.optimizePrompt, request),
    generateChatReply: (request: GenerateChatReplyRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.generateChatReply, request),
    generateStoryboard: (request: GenerateStoryboardRequest) => ipcRenderer.invoke(GENERATION_IPC_CHANNELS.generateStoryboard, request),
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
