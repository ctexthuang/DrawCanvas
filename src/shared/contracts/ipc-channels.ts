export const GENERATION_IPC_CHANNELS = {
  generateImage: 'generation:generate-image',
  generateVideo: 'generation:generate-video',
  generateAudio: 'generation:generate-audio',
  optimizePrompt: 'generation:optimize-prompt',
  generateChatReply: 'generation:generate-chat-reply',
  generateStoryboard: 'generation:generate-storyboard',
  loadImage: 'generation:load-image',
} as const

export const HISTORY_IPC_CHANNELS = {
  load: 'history:load',
  loadVideos: 'history:load-videos',
  loadAudios: 'history:load-audios',
  record: 'history:record',
  remove: 'history:remove',
  removeVideo: 'history:remove-video',
  exportVideo: 'history:export-video',
  removeAudio: 'history:remove-audio',
  exportAudio: 'history:export-audio',
  exportBatch: 'history:export-batch',
} as const

export const CANVAS_IPC_CHANNELS = {
  listRecent: 'canvas:list-recent',
  loadRecent: 'canvas:load-recent',
  deleteRecent: 'canvas:delete-recent',
} as const

export const LIBRARY_IPC_CHANNELS = {
  load: 'library:load',
  importImages: 'library:import-images',
  importDroppedImages: 'library:import-dropped-images',
  remove: 'library:remove',
} as const

export const RESOURCE_IPC_CHANNELS = {
  load: 'resources:load',
  savePrompt: 'resources:save-prompt',
  removePrompt: 'resources:remove-prompt',
  saveWorkflow: 'resources:save-workflow',
  removeWorkflow: 'resources:remove-workflow',
} as const
