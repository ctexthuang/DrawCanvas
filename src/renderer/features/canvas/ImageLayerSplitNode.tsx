import { Crop, Layers3, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  AnalyzeImageLayersRequest,
  CanvasNodeData,
  ImageLayerBounds,
  ImageLayerSlice,
} from '../../../shared/contracts/desktop'
import type { CanvasImageModelOption } from './InfiniteCanvas'

type SourceImage = Readonly<{
  fileName: string
  title: string
}>

type LayerEditMode = 'move' | 'nw' | 'ne' | 'se' | 'sw'

type LayerEdit = Readonly<{
  pointerId: number
  layerId: string
  mode: LayerEditMode
  startClientX: number
  startClientY: number
  original: ImageLayerBounds
}>

type ImageLayerSplitNodeProps = Readonly<{
  chatModels: ReadonlyArray<CanvasImageModelOption>
  defaultChatModelKey: string
  isAnalyzing: boolean
  isExporting: boolean
  node: CanvasNodeData
  onAnalyze: (request: AnalyzeImageLayersRequest, sourceFileName: string, dataUrl: string) => Promise<void>
  onExport: (dataUrl: string, layers: ReadonlyArray<ImageLayerSlice>, sourceFileName: string) => Promise<void>
  onLoadImage: (fileName: string) => Promise<string | null>
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  source: SourceImage | null
}>

const MAX_ANALYSIS_EDGE = 2048
const MAX_ANALYSIS_BYTES = 12 * 1024 * 1024

export function ImageLayerSplitNode({
  chatModels,
  defaultChatModelKey,
  isAnalyzing,
  isExporting,
  node,
  onAnalyze,
  onExport,
  onLoadImage,
  onUpdate,
  source,
}: ImageLayerSplitNodeProps) {
  const editRef = useRef<LayerEdit | null>(null)
  const isBusy = isAnalyzing || isExporting
  const [failedSourceFileName, setFailedSourceFileName] = useState<string | null>(null)
  const [loadedSource, setLoadedSource] = useState<Readonly<{
    fileName: string
    dataUrl: string
    width: number
    height: number
  }> | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(node.imageLayers?.[0]?.id ?? null)
  const layers = useMemo(() => node.imageLayers ?? [], [node.imageLayers])
  const activeLoadedSource = loadedSource && loadedSource.fileName === source?.fileName ? loadedSource : null
  const dataUrl = activeLoadedSource?.dataUrl ?? null
  const sourceSize = activeLoadedSource
    ? { width: activeLoadedSource.width, height: activeLoadedSource.height }
    : null
  const savedLayerSize = node.imageLayerSourceWidth && node.imageLayerSourceHeight
    ? { width: node.imageLayerSourceWidth, height: node.imageLayerSourceHeight }
    : sourceSize
  const isSourceStale = Boolean(
    node.imageLayerSourceFileName && node.imageLayerSourceFileName !== source?.fileName,
  )
  const storedSize = isSourceStale ? sourceSize : savedLayerSize ?? sourceSize
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? layers[0]

  useEffect(() => {
    let cancelled = false
    setLoadedSource(null)
    setFailedSourceFileName(null)
    if (!source) return () => { cancelled = true }
    const sourceFileName = source.fileName
    void (async () => {
      try {
        const value = await onLoadImage(sourceFileName)
        if (!value) throw new Error('图片资源不存在')
        const image = await loadImage(value)
        if (!cancelled) {
          setLoadedSource({
            fileName: sourceFileName,
            dataUrl: value,
            width: image.naturalWidth,
            height: image.naturalHeight,
          })
        }
      } catch {
        if (!cancelled) setFailedSourceFileName(sourceFileName)
      }
    })()
    return () => { cancelled = true }
  }, [onLoadImage, source?.fileName])

  useEffect(() => {
    if (selectedLayerId && layers.some((layer) => layer.id === selectedLayerId)) return
    setSelectedLayerId(layers[0]?.id ?? null)
  }, [layers, selectedLayerId])

  async function analyze(): Promise<void> {
    if (!source || !dataUrl) return
    try {
      const prepared = await prepareAnalysisImage(dataUrl)
      await onAnalyze({
        image: prepared.image,
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight,
        ...(node.modelKey ? { modelKey: node.modelKey } : {}),
      }, source.fileName, dataUrl)
    } catch (error) {
      onUpdate({ imageLayerError: error instanceof Error ? error.message : '无法准备待分析图片' })
    }
  }

  function addManualLayer(): void {
    if (!source || !storedSize || isBusy) return
    const width = Math.min(storedSize.width, Math.max(1, Math.round(storedSize.width * 0.35)))
    const height = Math.min(storedSize.height, Math.max(1, Math.round(storedSize.height * 0.35)))
    const layer: ImageLayerSlice = {
      id: `layer-${crypto.randomUUID()}`,
      name: `图层 ${layers.length + 1}`,
      kind: 'other',
      bounds: {
        x: Math.round((storedSize.width - width) / 2),
        y: Math.round((storedSize.height - height) / 2),
        width,
        height,
      },
    }
    onUpdate({
      imageLayerSourceFileName: source.fileName,
      imageLayerSourceWidth: storedSize.width,
      imageLayerSourceHeight: storedSize.height,
      imageLayers: isSourceStale ? [layer] : [...layers, layer],
      imageLayerError: undefined,
    })
    setSelectedLayerId(layer.id)
  }

  function updateLayer(layerId: string, patch: Partial<ImageLayerSlice>): void {
    if (isBusy) return
    onUpdate({
      imageLayers: layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer),
      imageLayerError: undefined,
    })
  }

  function removeLayer(layerId: string): void {
    if (isBusy) return
    onUpdate({ imageLayers: layers.filter((layer) => layer.id !== layerId), imageLayerError: undefined })
  }

  function beginLayerEdit(event: ReactPointerEvent<HTMLElement>, layer: ImageLayerSlice, mode: LayerEditMode): void {
    if (!storedSize || isSourceStale || isBusy) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedLayerId(layer.id)
    editRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      original: layer.bounds,
    }
  }

  function moveLayer(event: ReactPointerEvent<HTMLDivElement>): void {
    const edit = editRef.current
    if (!edit || edit.pointerId !== event.pointerId || !storedSize) return
    event.preventDefault()
    event.stopPropagation()
    const stage = event.currentTarget.getBoundingClientRect()
    if (stage.width <= 0 || stage.height <= 0) return
    const deltaX = (event.clientX - edit.startClientX) * storedSize.width / stage.width
    const deltaY = (event.clientY - edit.startClientY) * storedSize.height / stage.height
    updateLayer(edit.layerId, {
      bounds: editLayerBounds(edit.original, edit.mode, deltaX, deltaY, storedSize.width, storedSize.height),
    })
  }

  function endLayerEdit(event: ReactPointerEvent<HTMLDivElement>): void {
    if (editRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    editRef.current = null
  }

  const stageStyle = storedSize
    ? previewStageStyle(storedSize.width, storedSize.height)
    : undefined

  return (
    <div className="image-layer-node-body" data-node-interactive onPointerDown={(event) => event.stopPropagation()}>
      <div className="image-layer-toolbar">
        <label>
          <span>视觉模型</span>
          <select
            aria-label="图层分析模型"
            disabled={isBusy}
            onChange={(event) => onUpdate({ modelKey: event.target.value || undefined })}
            value={node.modelKey ?? ''}
          >
            <option value="">跟随默认 · {chatModels.find((model) => model.key === defaultChatModelKey)?.label ?? '未配置'}</option>
            {node.modelKey && !chatModels.some((model) => model.key === node.modelKey) && (
              <option value={node.modelKey}>当前固定模型（不可用）</option>
            )}
            {chatModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
          </select>
        </label>
        <button disabled={!source || !dataUrl || isAnalyzing || isExporting} onClick={() => void analyze()} title="使用视觉对话模型识别图层" type="button">
          {isAnalyzing ? <LoaderCircle className="is-spinning" size={14}/> : <Layers3 size={14}/>} {isAnalyzing ? '分析中' : layers.length ? '重新分析' : '智能拆分'}
        </button>
      </div>

      {!source ? (
        <div className="image-layer-empty">
          <Layers3 size={22}/>
          <strong>连接一张源图片</strong>
          <span>从图片节点右侧端口添加图层拆分节点</span>
        </div>
      ) : !dataUrl && failedSourceFileName === source.fileName ? (
        <div className="image-layer-empty"><Layers3 size={20}/><strong>图片读取失败</strong><span>请检查源图片是否仍然存在</span></div>
      ) : !dataUrl ? (
        <div className="image-layer-empty"><LoaderCircle className="is-spinning" size={20}/><strong>正在读取图片</strong></div>
      ) : (
        <div className="image-layer-preview-frame">
          <div
            className="image-layer-preview-stage"
            onPointerMove={moveLayer}
            onPointerUp={endLayerEdit}
            onPointerCancel={endLayerEdit}
            style={stageStyle}
          >
            <img alt={source.title} draggable={false} src={dataUrl}/>
            {!isSourceStale && storedSize && layers.map((layer, index) => (
              <div
                className={`image-layer-box${selectedLayer?.id === layer.id ? ' is-selected' : ''}`}
                key={layer.id}
                onPointerDown={(event) => beginLayerEdit(event, layer, 'move')}
                style={layerBoxStyle(layer.bounds, storedSize.width, storedSize.height)}
                title={`${index + 1}. ${layer.name}`}
              >
                <span>{index + 1}</span>
                {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
                  <i
                    className={`image-layer-handle is-${corner}`}
                    key={corner}
                    onPointerDown={(event) => beginLayerEdit(event, layer, corner)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {isSourceStale && <div className="image-layer-warning">源图片已经改变，请重新分析或新建手动图层。</div>}
      {node.imageLayerError && <div className="image-layer-error">{node.imageLayerError}</div>}

      <div className="image-layer-list-heading">
        <span>{layers.length} 个可见图层</span>
        <button disabled={!source || !dataUrl || !storedSize || layers.length >= 32 || isBusy} onClick={addManualLayer} title="手动添加矩形图层" type="button"><Plus size={13}/>添加</button>
      </div>
      <div className="image-layer-list">
        {layers.length === 0 ? <span className="image-layer-list-empty">分析后可在这里调整图层范围</span> : layers.map((layer, index) => (
          <div className={`image-layer-list-item${selectedLayer?.id === layer.id ? ' is-selected' : ''}`} key={layer.id}>
            <button className="image-layer-index" onClick={() => setSelectedLayerId(layer.id)} type="button">{index + 1}</button>
            <input aria-label={`图层 ${index + 1} 名称`} disabled={isBusy} onChange={(event) => updateLayer(layer.id, { name: event.target.value.slice(0, 120) })} value={layer.name}/>
            <small>{imageLayerKindLabel(layer.kind)}</small>
            <button className="image-layer-delete" disabled={isBusy} onClick={() => removeLayer(layer.id)} title="删除图层" type="button"><Trash2 size={13}/></button>
          </div>
        ))}
      </div>

      {selectedLayer && storedSize && !isSourceStale && (
        <div className="image-layer-geometry">
          {(['x', 'y', 'width', 'height'] as const).map((field) => (
            <label key={field}>
              <span>{field === 'width' ? 'W' : field === 'height' ? 'H' : field.toUpperCase()}</span>
              <input
                aria-label={`${selectedLayer.name} ${field}`}
                disabled={isBusy}
                min={field === 'width' || field === 'height' ? 1 : 0}
                onChange={(event) => updateLayer(selectedLayer.id, {
                  bounds: updateBoundsField(selectedLayer.bounds, field, Number(event.target.value), storedSize.width, storedSize.height),
                })}
                type="number"
                value={selectedLayer.bounds[field]}
              />
            </label>
          ))}
        </div>
      )}

      <button
        className="image-layer-export"
        disabled={!dataUrl || layers.length === 0 || isSourceStale || isAnalyzing || isExporting}
        onClick={() => dataUrl && source && void onExport(dataUrl, layers, source.fileName)}
        type="button"
      >
        {isExporting ? <LoaderCircle className="is-spinning" size={15}/> : <Crop size={15}/>} {isExporting ? '正在生成图层' : `生成 ${layers.length || ''} 个图片节点`}
      </button>
    </div>
  )
}

async function prepareAnalysisImage(dataUrl: string): Promise<Readonly<{
  image: AnalyzeImageLayersRequest['image']
  sourceWidth: number
  sourceHeight: number
}>> {
  const source = await loadImage(dataUrl)
  const sourceWidth = source.naturalWidth
  const sourceHeight = source.naturalHeight
  if (
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth > 32_768 ||
    sourceHeight > 32_768 ||
    sourceWidth * sourceHeight > 100_000_000
  ) {
    throw new Error('源图片尺寸过大，最长边需小于 32768 像素且总像素不超过 1 亿')
  }
  const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前系统无法创建图片分析画布')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9)
  if (blob.size > MAX_ANALYSIS_BYTES) throw new Error('分析图片超过 12 MB，请先缩小图片')
  return {
    image: {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mediaType: 'image/jpeg',
      width,
      height,
    },
    sourceWidth,
    sourceHeight,
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('本地图片无法读取'))
    image.src = dataUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片编码失败')), type, quality)
  })
}

function previewStageStyle(width: number, height: number): CSSProperties {
  // Fit both axes inside the frame without independently clamping its aspect ratio.
  return { width: `min(100%, ${208 * width / height}px)`, aspectRatio: `${width} / ${height}` }
}

function layerBoxStyle(bounds: ImageLayerBounds, width: number, height: number): CSSProperties {
  return {
    left: `${bounds.x / width * 100}%`,
    top: `${bounds.y / height * 100}%`,
    width: `${bounds.width / width * 100}%`,
    height: `${bounds.height / height * 100}%`,
  }
}

function editLayerBounds(
  original: ImageLayerBounds,
  mode: LayerEditMode,
  deltaX: number,
  deltaY: number,
  maximumWidth: number,
  maximumHeight: number,
): ImageLayerBounds {
  const minimumWidth = Math.min(8, maximumWidth)
  const minimumHeight = Math.min(8, maximumHeight)
  if (mode === 'move') {
    return {
      ...original,
      x: Math.round(clamp(original.x + deltaX, 0, maximumWidth - original.width)),
      y: Math.round(clamp(original.y + deltaY, 0, maximumHeight - original.height)),
    }
  }
  let left = original.x
  let top = original.y
  let right = original.x + original.width
  let bottom = original.y + original.height
  if (mode.includes('w')) left = clamp(original.x + deltaX, 0, right - minimumWidth)
  if (mode.includes('e')) right = clamp(original.x + original.width + deltaX, left + minimumWidth, maximumWidth)
  if (mode.includes('n')) top = clamp(original.y + deltaY, 0, bottom - minimumHeight)
  if (mode.includes('s')) bottom = clamp(original.y + original.height + deltaY, top + minimumHeight, maximumHeight)
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  }
}

function updateBoundsField(
  bounds: ImageLayerBounds,
  field: keyof ImageLayerBounds,
  value: number,
  maximumWidth: number,
  maximumHeight: number,
): ImageLayerBounds {
  if (!Number.isFinite(value)) return bounds
  const rounded = Math.round(value)
  if (field === 'x') return { ...bounds, x: clamp(rounded, 0, maximumWidth - bounds.width) }
  if (field === 'y') return { ...bounds, y: clamp(rounded, 0, maximumHeight - bounds.height) }
  if (field === 'width') return { ...bounds, width: clamp(rounded, 1, maximumWidth - bounds.x) }
  return { ...bounds, height: clamp(rounded, 1, maximumHeight - bounds.y) }
}

function imageLayerKindLabel(kind: ImageLayerSlice['kind']): string {
  const labels: Readonly<Record<ImageLayerSlice['kind'], string>> = {
    icon: '图标',
    avatar: '头像',
    illustration: '插画',
    photo: '照片',
    'product-image': '产品',
    'complex-decoration': '装饰',
    'complex-chart': '图表',
    logo: '标志',
    other: '图层',
  }
  return labels[kind]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
