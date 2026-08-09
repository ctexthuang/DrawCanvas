export const GENERATION_IPC_CHANNELS = {
  generateImage: 'generation:generate-image',
  loadImage: 'generation:load-image',
} as const

export const CANVAS_IPC_CHANNELS = {
  listRecent: 'canvas:list-recent',
  loadRecent: 'canvas:load-recent',
  deleteRecent: 'canvas:delete-recent',
} as const

export const LIBRARY_IPC_CHANNELS = {
  load: 'library:load',
  importImages: 'library:import-images',
  remove: 'library:remove',
} as const

export const RESOURCE_IPC_CHANNELS = {
  load: 'resources:load',
  savePrompt: 'resources:save-prompt',
  removePrompt: 'resources:remove-prompt',
  saveWorkflow: 'resources:save-workflow',
  removeWorkflow: 'resources:remove-workflow',
} as const
