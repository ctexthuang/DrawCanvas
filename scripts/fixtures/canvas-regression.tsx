import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createInitialCanvas, InfiniteCanvas, type CanvasImageModelOption } from '../../src/renderer/features/canvas/InfiniteCanvas'
import '../../src/renderer/styles.css'
import type { CanvasDocument, GenerateImageRequest } from '../../src/shared/contracts/desktop'

declare global {
  interface Window {
    regressionDocument: CanvasDocument
    setRegressionDocument: (document: CanvasDocument) => void
    regressionFiles: File[]
    regressionImageRequests: GenerateImageRequest[]
    createRegressionCanvas: typeof createInitialCanvas
  }
}

const raster = document.createElement('canvas')
raster.width = 1000
raster.height = 1000
const context = raster.getContext('2d')
if (!context) throw new Error('Canvas is unavailable')
context.fillStyle = '#f16a87'
context.fillRect(100, 100, 300, 350)
context.fillRect(110, 455, 8, 8)
context.fillStyle = '#47cbb8'
context.fillRect(550, 250, 200, 200)
const dataUrl = raster.toDataURL()
const noop = () => {}
const noResult = async () => ({ ok: false as const, error: 'No provider calls in regression tests' })
const noImages = async () => []
const loadImage = async () => dataUrl
const imageModels: ReadonlyArray<CanvasImageModelOption> = [
  { key: 'custom-openai:gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', adapterId: 'openai' },
  { key: 'custom-relay:gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', adapterId: 'openai-sub2api' },
  { key: 'custom-openai:gpt-image-1', label: 'GPT Image 1', adapterId: 'openai' },
]
window.regressionImageRequests = []
window.createRegressionCanvas = createInitialCanvas

const initial: CanvasDocument = {
  version: 1,
  id: 'canvas-regression',
  name: 'Canvas regression',
  updatedAt: new Date().toISOString(),
  viewport: { x: 40, y: 30, zoom: 1 },
  nodes: [
    { id: 'source', type: 'image', title: 'Source', x: -400, y: 100, imageFileName: 'source.png' },
    {
      id: 'split', type: 'layer-split', title: 'Layer split', x: 100, y: 100, color: '#2dd4bf',
      imageLayerSourceFileName: 'source.png', imageLayerSourceWidth: 1000, imageLayerSourceHeight: 1000,
      imageLayers: [
        { id: 'pink', kind: 'illustration', name: 'Pink', bounds: { x: 90, y: 90, width: 330, height: 380 } },
        { id: 'green', kind: 'icon', name: 'Green', bounds: { x: 540, y: 240, width: 220, height: 220 } },
      ],
    },
    ...[0, 1, 2, 3].map((index) => ({
      id: `output-${index}`, type: 'image' as const, title: `Output ${index}`,
      x: 700, y: index * 340 - 120, imageFileName: 'source.png', color: '#23c8ff',
    })),
  ],
  connections: [
    { id: 'input', from: 'source', to: 'split' },
    ...[0, 1, 2, 3].map((index) => ({ id: `out-${index}`, from: 'split', to: `output-${index}` })),
  ],
}

function Fixture() {
  const [value, setValue] = useState(initial)
  window.regressionDocument = value
  window.setRegressionDocument = setValue
  return <div style={{ height: '100vh' }}>
    <InfiniteCanvas
      document={value} onChange={setValue} audioModels={[]} chatModels={[]} imageModels={imageModels} videoModels={[]}
      defaultAudioModelKey="" defaultChatModelKey="" defaultImageModelKey={imageModels[0].key} defaultVideoModelKey=""
      onAnalyzeImageLayers={noResult} onGenerateAudio={noResult} onGenerateChatReply={noResult}
      onGenerateImage={async (request) => {
        window.regressionImageRequests.push(request)
        return noResult()
      }} onGenerateStoryboard={noResult} onGenerateVideo={noResult}
      onOptimizePrompt={noResult} onImportImages={noImages} onImportDroppedImages={noImages}
      onImportPastedImages={async (files) => {
        window.regressionFiles = [...files]
        return files.map((file, index) => ({
          id: `export-${index}`, title: file.name, imageFileName: `export-${index}.png`,
          prompt: '', model: 'regression', size: 'original', createdAt: new Date().toISOString(),
          palette: '', tags: [],
        }))
      }}
      onLoadImage={loadImage} onOpen={noop} onClose={noop} onSave={noop} notify={noop}
    />
  </div>
}

const root = document.getElementById('root')
if (!root) throw new Error('Fixture root is unavailable')
createRoot(root).render(<Fixture/>)
