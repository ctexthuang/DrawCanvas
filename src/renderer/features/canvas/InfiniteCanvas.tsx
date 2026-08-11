import {
  ArrowLeft,
  AudioLines,
  Bot,
  Check,
  Clapperboard,
  Copy,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FolderOpen,
  Hand,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minus,
  MousePointer2,
  PanelRight,
  Play,
  Plus,
  Redo2,
  Save,
  SendHorizontal,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import type {
  CanvasDocument,
  CanvasChatMessage,
  CanvasNodeData,
  CanvasNodeType,
  CanvasViewport,
  GenerateChatReplyRequest,
  GenerateAudioRequest,
  GenerateImageRequest,
  GenerateStoryboardRequest,
  GenerateVideoRequest,
  GeneratedArtwork,
  GeneratedAudioResult,
  GeneratedChatReply,
  GeneratedImageResult,
  GeneratedStoryboard,
  GeneratedVideoResult,
  ImageGenerationCount,
  ImageGenerationSize,
  OptimizePromptRequest,
  OptimizedPromptResult,
  VideoGenerationRatio,
  VideoGenerationResolution,
} from '../../../shared/contracts/desktop'
import {
  DEFAULT_IMAGE_MODEL_KEY,
  defaultImageGenerationSizeForModel,
  imageGenerationSizeOptionsForModel,
  normalizeImageGenerationSize,
} from '../../../shared/domain/models'
import {
  arrangeSelection,
  canConnect,
  duplicateSelection,
  graphBounds,
  groupImageSelection,
  nodeDimensions,
  nodePortPoint,
  removeSelection,
  restoreGraph,
  snapshotGraph,
  type CanvasGraphSnapshot,
  type CanvasPoint,
} from './canvas-graph'

export type CanvasImageModelOption = Readonly<{
  key: string
  label: string
}>

export type CanvasImageGenerationOutcome =
  | Readonly<{ ok: true; value: GeneratedImageResult }>
  | Readonly<{ ok: false; error: string }>

export type CanvasVideoGenerationOutcome =
  | Readonly<{ ok: true; value: GeneratedVideoResult }>
  | Readonly<{ ok: false; error: string }>

export type CanvasPromptOptimizationOutcome =
  | Readonly<{ ok: true; value: OptimizedPromptResult }>
  | Readonly<{ ok: false; error: string }>

export type CanvasChatGenerationOutcome =
  | Readonly<{ ok: true; value: GeneratedChatReply }>
  | Readonly<{ ok: false; error: string }>

export type CanvasStoryboardGenerationOutcome =
  | Readonly<{ ok: true; value: GeneratedStoryboard }>
  | Readonly<{ ok: false; error: string }>

export type CanvasAudioGenerationOutcome =
  | Readonly<{ ok: true; value: GeneratedAudioResult }>
  | Readonly<{ ok: false; error: string }>

type InfiniteCanvasProps = Readonly<{
  document: CanvasDocument
  defaultChatModelKey: string
  defaultAudioModelKey: string
  defaultImageModelKey: string
  defaultVideoModelKey: string
  chatModels: ReadonlyArray<CanvasImageModelOption>
  audioModels: ReadonlyArray<CanvasImageModelOption>
  imageModels: ReadonlyArray<CanvasImageModelOption>
  videoModels: ReadonlyArray<CanvasImageModelOption>
  onChange: (document: CanvasDocument) => void
  onClose: () => void
  onGenerateChatReply: (request: GenerateChatReplyRequest) => Promise<CanvasChatGenerationOutcome>
  onGenerateAudio: (request: GenerateAudioRequest) => Promise<CanvasAudioGenerationOutcome>
  onGenerateImage: (request: GenerateImageRequest) => Promise<CanvasImageGenerationOutcome>
  onGenerateStoryboard: (request: GenerateStoryboardRequest) => Promise<CanvasStoryboardGenerationOutcome>
  onGenerateVideo: (request: GenerateVideoRequest) => Promise<CanvasVideoGenerationOutcome>
  onOptimizePrompt: (request: OptimizePromptRequest) => Promise<CanvasPromptOptimizationOutcome>
  onImportDroppedImages: (files: ReadonlyArray<File>) => Promise<ReadonlyArray<GeneratedArtwork>>
  onImportImages: () => Promise<ReadonlyArray<GeneratedArtwork>>
  onLoadImage: (fileName: string) => Promise<string | null>
  onOpen: () => void
  onSave: () => void
  notify: (message: string) => void
}>

type NodeOrigin = Readonly<{ id: string; x: number; y: number }>

type DragState =
  | Readonly<{ kind: 'pan'; startX: number; startY: number; originX: number; originY: number }>
  | Readonly<{ kind: 'nodes'; startX: number; startY: number; origins: ReadonlyArray<NodeOrigin>; historyRecorded: boolean }>
  | Readonly<{
      kind: 'selection'
      startWorld: CanvasPoint
      currentWorld: CanvasPoint
      startClient: CanvasPoint
      currentClient: CanvasPoint
      baseSelection: ReadonlySet<string>
    }>
  | Readonly<{ kind: 'link'; nodeId: string; side: 'input' | 'output'; currentWorld: CanvasPoint }>
  | Readonly<{
      kind: 'resize'
      nodeId: string
      startX: number
      startY: number
      originWidth: number
      originHeight: number
      historyRecorded: boolean
    }>

type ContextMenuState = Readonly<{
  kind: 'canvas' | 'selection'
  clientX: number
  clientY: number
  world: CanvasPoint
}>

type PendingGenerationTask = Readonly<{
  documentId: string
  nodeId: string
  request: GenerateImageRequest
  resolve?: (succeeded: boolean) => void
}>

type ConnectedVideoPrompt = Readonly<{
  id: string
  label: string
  prompt: string
}>

type ConnectedReferenceImage = Readonly<{
  key: string
  fileName: string
  sourceNodeId: string
}>

type ReferenceMentionRange = Readonly<{
  start: number
  end: number
  query: string
}>

const HISTORY_LIMIT = 30
const MAX_CONCURRENT_GENERATIONS = 4
const AUDIO_VOICE_OPTIONS = [
  { value: 'female-shaonv', label: '少女音' },
  { value: 'male-qn-qingse', label: '青年男声' },
  { value: 'female-yujie', label: '御姐音' },
  { value: 'male-qn-jingying', label: '精英男声' },
] as const
const AUDIO_EMOTION_OPTIONS = [
  { value: '', label: '自动情绪' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '生气' },
  { value: 'fearful', label: '恐惧' },
  { value: 'surprised', label: '惊讶' },
  { value: 'calm', label: '平静' },
] as const

const nodeTypes: ReadonlyArray<Readonly<{ type: CanvasNodeType; label: string; description: string; icon: typeof Type }>> = [
  { type: 'prompt', label: '提示词', description: '编写图像生成提示词', icon: Type },
  { type: 'storyboard', label: '分镜提示词', description: '根据主题生成独立分镜节点', icon: Clapperboard },
  { type: 'shot-list', label: '分镜节点', description: '新增、编辑和删除各项分镜提示词', icon: LayoutGrid },
  { type: 'generator', label: '图像生成', description: '调用图像模型生成内容', icon: WandSparkles },
  { type: 'compositor', label: '图片合成', description: '使用多张参考图合成图片', icon: Images },
  { type: 'image', label: '图片', description: '添加或预览图片素材', icon: ImageIcon },
  { type: 'reference-folder', label: '参考图文件夹', description: '批量管理并整体连接参考图', icon: FolderOpen },
  { type: 'chat', label: 'AI 对话', description: '与模型讨论创意方向', icon: MessageSquare },
  { type: 'note', label: '便签', description: '记录灵感与待办事项', icon: StickyNote },
  { type: 'video', label: '视频', description: '添加视频生成节点', icon: Video },
  { type: 'audio', label: '语音', description: '将文本合成为本地语音', icon: AudioLines },
]

export function createInitialCanvas(
  name = '未命名画布',
  prompt?: string,
  defaultImageModelKey = DEFAULT_IMAGE_MODEL_KEY,
  defaultImageModelName = 'GPT Image 2',
): CanvasDocument {
  const defaultImageSize = defaultImageGenerationSizeForModel(defaultImageModelKey)
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
    viewport: { x: 90, y: 55, zoom: 0.9 },
    connections: [{ id: 'c1', from: 'prompt-1', to: 'generator-1' }],
    nodes: [
      { id: 'prompt-1', type: 'prompt', title: '创意提示词', subtitle: prompt ?? '未来主义建筑漂浮在云层之上，清晨金色光线，电影感构图', x: 90, y: 135, color: '#aaff00' },
      { id: 'generator-1', type: 'generator', title: '图像生成', subtitle: `${defaultImageModelName} · ${formatImageSize(defaultImageSize)}`, modelKey: defaultImageModelKey, imageSize: defaultImageSize, generationCount: 1, x: 440, y: 225, color: '#7c5cff' },
      { id: 'note-1', type: 'note', title: '方向备注', subtitle: '尝试增加云海层次，保留画面中央的视觉焦点。', x: 470, y: 500, color: '#ffdb5c' },
    ],
  }
}

export function InfiniteCanvas({ audioModels, chatModels, defaultAudioModelKey, defaultChatModelKey, defaultImageModelKey, defaultVideoModelKey, document, imageModels, videoModels, onChange, onClose, onGenerateAudio, onGenerateChatReply, onGenerateImage, onGenerateStoryboard, onGenerateVideo, onImportDroppedImages, onImportImages, onLoadImage, onOpen, onOptimizePrompt, onSave, notify }: InfiniteCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef(document)
  const selectedIdsRef = useRef<ReadonlySet<string>>(new Set(['generator-1']))
  const selectedConnectionIdRef = useRef<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const undoStackRef = useRef<CanvasGraphSnapshot[]>([])
  const redoStackRef = useRef<CanvasGraphSnapshot[]>([])
  const clipboardRef = useRef<CanvasGraphSnapshot | null>(null)
  const lastPointerWorldRef = useRef<CanvasPoint>({ x: 300, y: 240 })
  const spacePressedRef = useRef(false)
  const minimapPointerIdRef = useRef<number | null>(null)
  const generationQueueRef = useRef<PendingGenerationTask[]>([])
  const activeGenerationCountRef = useRef(0)
  const fileDragDepthRef = useRef(0)
  const workflowRunIdRef = useRef<string | null>(null)
  const [selectedIds, setSelectedIdsState] = useState<ReadonlySet<string>>(() => new Set(['generator-1']))
  const [selectedConnectionId, setSelectedConnectionIdState] = useState<string | null>(null)
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [drag, setDragState] = useState<DragState | null>(null)
  const [savedAt, setSavedAt] = useState('刚刚')
  const [generationNow, setGenerationNow] = useState(() => Date.now())
  const [isFileDragActive, setFileDragActive] = useState(false)
  const [fileDropTargetNodeId, setFileDropTargetNodeId] = useState<string | null>(null)
  const [optimizingPromptNodeIds, setOptimizingPromptNodeIds] = useState<ReadonlySet<string>>(() => new Set())
  const [chattingNodeIds, setChattingNodeIds] = useState<ReadonlySet<string>>(() => new Set())
  const [storyboardNodeIds, setStoryboardNodeIds] = useState<ReadonlySet<string>>(() => new Set())
  const [workflowRunning, setWorkflowRunning] = useState(false)
  const [, setHistoryRevision] = useState(0)
  documentRef.current = document

  useEffect(() => {
    workflowRunIdRef.current = null
    setWorkflowRunning(false)
    generationQueueRef.current = generationQueueRef.current.filter((task) => task.documentId === document.id)
    setSelectedIds(new Set(document.nodes.some((node) => node.id === 'generator-1') ? ['generator-1'] : []))
    setSelectedConnectionId(null)
    undoStackRef.current = []
    redoStackRef.current = []
    setHistoryRevision((revision) => revision + 1)
  }, [document.id])

  const hasActiveGenerationTasks = document.nodes.some((node) =>
    node.generationStatus === 'queued' || node.generationStatus === 'generating',
  )
  const workflowFailureCount = document.nodes.filter((node) =>
    node.workflowStatus === 'failed' || node.workflowStatus === 'skipped',
  ).length
  const selectedNodes = document.nodes.filter((node) => selectedIds.has(node.id))
  const canGroupSelectedImages = selectedNodes.length >= 2 && selectedNodes.every((node) =>
    node.type === 'image' && Boolean(node.imageFileName),
  ) && new Set(selectedNodes.flatMap((node) => node.imageFileName ? [node.imageFileName] : [])).size >= 2

  useEffect(() => {
    if (!hasActiveGenerationTasks) return
    setGenerationNow(Date.now())
    const interval = window.setInterval(() => setGenerationNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [hasActiveGenerationTasks])

  useEffect(() => {
    const timer = window.setTimeout(() => setSavedAt('刚刚'), 900)
    return () => window.clearTimeout(timer)
  }, [document.updatedAt])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const isEditing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'))
      if (event.code === 'Space' && !isEditing) {
        spacePressedRef.current = true
        event.preventDefault()
      }
      if (isEditing) return
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedIds(new Set(documentRef.current.nodes.map((node) => node.id)))
      } else if (command && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copySelectedNodes()
      } else if (command && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteSelectedNodes()
      } else if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        deleteSelectionOrConnection()
      } else if (event.key === 'Escape') {
        setActiveDrag(null)
        setContextMenu(null)
        setAddMenuOpen(false)
        setSelectedConnectionId(null)
      }
    }
    function onKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') spacePressedRef.current = false
    }
    function onWindowBlur(): void {
      spacePressedRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])

  const zoomPercent = Math.round(document.viewport.zoom * 100)
  const worldStyle = {
    transform: `translate(${document.viewport.x}px, ${document.viewport.y}px) scale(${document.viewport.zoom})`,
  } satisfies CSSProperties
  const minimap = useMemo(() => buildMinimap(document, canvasRef.current), [document])

  function setSelectedIds(ids: ReadonlySet<string>): void {
    selectedIdsRef.current = ids
    setSelectedIdsState(ids)
  }

  function setSelectedConnectionId(id: string | null): void {
    selectedConnectionIdRef.current = id
    setSelectedConnectionIdState(id)
  }

  function setActiveDrag(next: DragState | null): void {
    dragRef.current = next
    setDragState(next)
  }

  function emitDocument(next: CanvasDocument, reconcileReferences = true): void {
    const reconciled = reconcileReferences
      ? reconcileReferenceMentions(documentRef.current, next)
      : next
    documentRef.current = reconciled
    onChange(reconciled)
  }

  function updateViewport(viewport: CanvasViewport): void {
    emitDocument({ ...documentRef.current, viewport, updatedAt: new Date().toISOString() })
  }

  function updateNode(nodeId: string, patch: Partial<CanvasNodeData>): void {
    const current = documentRef.current
    emitDocument({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
      updatedAt: new Date().toISOString(),
    })
  }

  function pushUndo(): void {
    undoStackRef.current = [...undoStackRef.current, snapshotGraph(documentRef.current)].slice(-HISTORY_LIMIT)
    redoStackRef.current = []
    setHistoryRevision((revision) => revision + 1)
  }

  function undo(): void {
    const snapshot = undoStackRef.current.at(-1)
    if (!snapshot) return
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, snapshotGraph(documentRef.current)].slice(-HISTORY_LIMIT)
    emitDocument(restoreGraph(documentRef.current, snapshot), false)
    clearSelection()
    setHistoryRevision((revision) => revision + 1)
  }

  function redo(): void {
    const snapshot = redoStackRef.current.at(-1)
    if (!snapshot) return
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, snapshotGraph(documentRef.current)].slice(-HISTORY_LIMIT)
    emitDocument(restoreGraph(documentRef.current, snapshot), false)
    clearSelection()
    setHistoryRevision((revision) => revision + 1)
  }

  function clearSelection(): void {
    setSelectedIds(new Set())
    setSelectedConnectionId(null)
  }

  function onCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target as HTMLElement
    if (target.closest('.canvas-node, .connection-interaction')) return
    setContextMenu(null)
    setAddMenuOpen(false)
    const viewport = documentRef.current.viewport
    const world = clientToWorld(canvasRef.current, viewport, event.clientX, event.clientY)
    lastPointerWorldRef.current = world
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.button === 1 || tool === 'hand' || spacePressedRef.current) {
      setActiveDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y })
      return
    }
    setSelectedConnectionId(null)
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    if (!additive) setSelectedIds(new Set())
    const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const clientPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    setActiveDrag({
      kind: 'selection',
      startWorld: world,
      currentWorld: world,
      startClient: clientPoint,
      currentClient: clientPoint,
      baseSelection: additive ? selectedIdsRef.current : new Set(),
    })
  }

  function onNodePointerDown(event: ReactPointerEvent<HTMLElement>, node: CanvasNodeData): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, select, [data-port], .node-resize-handle')) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setContextMenu(null)
    setSelectedConnectionId(null)
    const viewport = documentRef.current.viewport
    if (tool === 'hand' || spacePressedRef.current) {
      setActiveDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y })
      return
    }

    const current = documentRef.current
    let nextSelection = selectedIdsRef.current
    if (event.metaKey || event.ctrlKey) {
      const toggled = new Set(nextSelection)
      if (toggled.has(node.id)) toggled.delete(node.id)
      else toggled.add(node.id)
      setSelectedIds(toggled)
      if (!toggled.has(node.id)) return
      nextSelection = toggled
    } else if (event.shiftKey) {
      nextSelection = new Set([...nextSelection, node.id])
      setSelectedIds(nextSelection)
    } else if (!nextSelection.has(node.id)) {
      nextSelection = new Set([node.id])
      setSelectedIds(nextSelection)
    }

    let historyRecorded = false
    if (event.altKey) {
      pushUndo()
      const duplicated = duplicateSelection(current, nextSelection)
      emitDocument(duplicated.document)
      setSelectedIds(duplicated.selectedIds)
      nextSelection = duplicated.selectedIds
      historyRecorded = true
    }
    const latest = documentRef.current
    const origins = latest.nodes
      .filter((item) => nextSelection.has(item.id))
      .map((item) => ({ id: item.id, x: item.x, y: item.y }))
    setActiveDrag({ kind: 'nodes', startX: event.clientX, startY: event.clientY, origins, historyRecorded })
  }

  function onPortPointerDown(event: ReactPointerEvent<HTMLElement>, nodeId: string, side: 'input' | 'output'): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const node = documentRef.current.nodes.find((item) => item.id === nodeId)
    if (!node) return
    setSelectedIds(new Set([nodeId]))
    setSelectedConnectionId(null)
    setActiveDrag({ kind: 'link', nodeId, side, currentWorld: nodePortPoint(node, side) })
  }

  function onResizePointerDown(event: ReactPointerEvent<HTMLElement>, node: CanvasNodeData): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const dimensions = nodeDimensions(node)
    setSelectedIds(new Set([node.id]))
    setSelectedConnectionId(null)
    setActiveDrag({
      kind: 'resize',
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: dimensions.width,
      originHeight: dimensions.height,
      historyRecorded: false,
    })
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = documentRef.current
    const world = clientToWorld(canvasRef.current, current.viewport, event.clientX, event.clientY)
    lastPointerWorldRef.current = world
    const activeDrag = dragRef.current
    if (!activeDrag) return
    if (activeDrag.kind === 'pan') {
      updateViewport({
        ...current.viewport,
        x: activeDrag.originX + event.clientX - activeDrag.startX,
        y: activeDrag.originY + event.clientY - activeDrag.startY,
      })
      return
    }
    if (activeDrag.kind === 'selection') {
      const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
      setActiveDrag({ ...activeDrag, currentWorld: world, currentClient: { x: event.clientX - rect.left, y: event.clientY - rect.top } })
      return
    }
    if (activeDrag.kind === 'link') {
      setActiveDrag({ ...activeDrag, currentWorld: world })
      return
    }
    if (activeDrag.kind === 'nodes') {
      let nextDrag = activeDrag
      if (!activeDrag.historyRecorded) {
        pushUndo()
        nextDrag = { ...activeDrag, historyRecorded: true }
        setActiveDrag(nextDrag)
      }
      const deltaX = (event.clientX - activeDrag.startX) / current.viewport.zoom
      const deltaY = (event.clientY - activeDrag.startY) / current.viewport.zoom
      const origins = new Map(activeDrag.origins.map((origin) => [origin.id, origin]))
      emitDocument({
        ...current,
        nodes: current.nodes.map((node) => {
          const origin = origins.get(node.id)
          return origin ? { ...node, x: Math.round(origin.x + deltaX), y: Math.round(origin.y + deltaY) } : node
        }),
        updatedAt: new Date().toISOString(),
      })
      dragRef.current = nextDrag
      return
    }
    let nextDrag = activeDrag
    if (!activeDrag.historyRecorded) {
      pushUndo()
      nextDrag = { ...activeDrag, historyRecorded: true }
      setActiveDrag(nextDrag)
    }
    const resizingNode = current.nodes.find((node) => node.id === activeDrag.nodeId)
    const minimumHeight = resizingNode
      ? nodeDimensions({ ...resizingNode, width: undefined, height: undefined }).height
      : 130
    updateNode(activeDrag.nodeId, {
      width: Math.round(clamp(activeDrag.originWidth + (event.clientX - activeDrag.startX) / current.viewport.zoom, 220, 720)),
      height: Math.round(clamp(activeDrag.originHeight + (event.clientY - activeDrag.startY) / current.viewport.zoom, minimumHeight, 640)),
    })
    dragRef.current = nextDrag
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeDrag = dragRef.current
    if (!activeDrag) return
    if (activeDrag.kind === 'selection') finishSelection(activeDrag)
    if (activeDrag.kind === 'link') finishLink(activeDrag, event.clientX, event.clientY)
    setActiveDrag(null)
  }

  function finishSelection(selection: Extract<DragState, { kind: 'selection' }>): void {
    const left = Math.min(selection.startWorld.x, selection.currentWorld.x)
    const right = Math.max(selection.startWorld.x, selection.currentWorld.x)
    const top = Math.min(selection.startWorld.y, selection.currentWorld.y)
    const bottom = Math.max(selection.startWorld.y, selection.currentWorld.y)
    const next = new Set(selection.baseSelection)
    for (const node of documentRef.current.nodes) {
      const dimensions = nodeDimensions(node)
      if (node.x <= right && node.x + dimensions.width >= left && node.y <= bottom && node.y + dimensions.height >= top) next.add(node.id)
    }
    setSelectedIds(next)
  }

  function finishLink(link: Extract<DragState, { kind: 'link' }>, clientX: number, clientY: number): void {
    const oppositeSide = link.side === 'output' ? 'input' : 'output'
    const targetId = nearestPort(canvasRef.current, oppositeSide, clientX, clientY, link.nodeId)
      ?? nodeIdAtClientPoint(clientX, clientY, link.nodeId)
    const fromId = link.side === 'output' ? link.nodeId : targetId
    const toId = link.side === 'output' ? targetId : link.nodeId
    if (fromId && toId) {
      const current = documentRef.current
      const validation = canConnect(current.nodes, current.connections, fromId, toId)
      if (!validation.ok) {
        notify(validation.reason ?? '无法连接节点')
        return
      }
      pushUndo()
      emitDocument({
        ...current,
        connections: [...current.connections, { id: `connection-${crypto.randomUUID()}`, from: fromId, to: toId }],
        updatedAt: new Date().toISOString(),
      })
      return
    }
    const source = documentRef.current.nodes.find((node) => node.id === link.nodeId)
    if (link.side === 'output' && (source?.type === 'generator' || source?.type === 'compositor')) {
      const resultNode = createNodeData('image', documentRef.current, link.currentWorld, defaultImageModelKey, defaultVideoModelKey, imageModels, videoModels)
      pushUndo()
      emitDocument({
        ...documentRef.current,
        nodes: [...documentRef.current.nodes, resultNode],
        connections: [...documentRef.current.connections, { id: `connection-${crypto.randomUUID()}`, from: source.id, to: resultNode.id }],
        updatedAt: new Date().toISOString(),
      })
      setSelectedIds(new Set([resultNode.id]))
    }
  }

  function onWheel(event: WheelEvent<HTMLDivElement>): void {
    if (!canvasRef.current) return
    if (event.target instanceof Element && event.target.closest('.canvas-node, .add-node-menu, .canvas-context-menu')) {
      return
    }
    event.preventDefault()
    const current = documentRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const pointX = event.clientX - rect.left
    const pointY = event.clientY - rect.top
    const nextZoom = clamp(current.viewport.zoom * Math.exp(-event.deltaY * 0.0015), 0.2, 2.5)
    const scale = nextZoom / current.viewport.zoom
    updateViewport({
      zoom: nextZoom,
      x: pointX - (pointX - current.viewport.x) * scale,
      y: pointY - (pointY - current.viewport.y) * scale,
    })
  }

  function setZoom(zoom: number): void {
    const current = documentRef.current
    const width = canvasRef.current?.clientWidth ?? 1200
    const height = canvasRef.current?.clientHeight ?? 760
    const nextZoom = clamp(zoom, 0.2, 2.5)
    const scale = nextZoom / current.viewport.zoom
    updateViewport({
      zoom: nextZoom,
      x: width / 2 - (width / 2 - current.viewport.x) * scale,
      y: height / 2 - (height / 2 - current.viewport.y) * scale,
    })
  }

  function fitView(): void {
    const current = documentRef.current
    if (current.nodes.length === 0) {
      updateViewport({ x: 90, y: 55, zoom: 0.9 })
      return
    }
    const bounds = graphBounds(current.nodes)
    const width = canvasRef.current?.clientWidth ?? 1200
    const height = canvasRef.current?.clientHeight ?? 760
    const zoom = clamp(Math.min((width - 160) / bounds.width, (height - 160) / bounds.height), 0.2, 1.5)
    updateViewport({
      zoom,
      x: Math.round((width - bounds.width * zoom) / 2 - bounds.x * zoom),
      y: Math.round((height - bounds.height * zoom) / 2 - bounds.y * zoom),
    })
  }

  function addNode(type: CanvasNodeType, position?: CanvasPoint): void {
    const current = documentRef.current
    const node = createNodeData(type, current, position ?? screenCenterToWorld(canvasRef.current, current.viewport), defaultImageModelKey, defaultVideoModelKey, imageModels, videoModels)
    pushUndo()
    emitDocument({ ...current, nodes: [...current.nodes, node], updatedAt: new Date().toISOString() })
    setSelectedIds(new Set([node.id]))
    setSelectedConnectionId(null)
    setAddMenuOpen(false)
    setContextMenu(null)
    notify(`已添加${nodeTypes.find((item) => item.type === type)?.label ?? ''}节点`)
  }

  function deleteNodes(ids: ReadonlySet<string>): void {
    if (ids.size === 0) return
    const current = documentRef.current
    pushUndo()
    emitDocument(removeSelection(current, ids))
    setSelectedIds(new Set())
  }

  function groupSelectedImages(): void {
    const result = groupImageSelection(documentRef.current, selectedIdsRef.current)
    if (!result.ok) {
      notify(result.reason)
      return
    }
    pushUndo()
    emitDocument(result.document)
    setSelectedIds(new Set([result.folderId]))
    setContextMenu(null)
    notify(`已将 ${result.imageCount} 张图片组成参考图文件夹`)
  }

  function deleteConnection(connectionId: string): void {
    const current = documentRef.current
    if (!current.connections.some((connection) => connection.id === connectionId)) return
    pushUndo()
    emitDocument({
      ...current,
      connections: current.connections.filter((connection) => connection.id !== connectionId),
      updatedAt: new Date().toISOString(),
    })
    setSelectedConnectionId(null)
  }

  function removeReferenceImage(targetNodeId: string, reference: ConnectedReferenceImage): void {
    const current = documentRef.current
    const source = current.nodes.find((node) => node.id === reference.sourceNodeId)
    if (!source || (source.type !== 'image' && source.type !== 'reference-folder')) return
    pushUndo()
    if (source.type === 'image') {
      emitDocument({
        ...current,
        connections: current.connections.filter((connection) =>
          !(connection.from === source.id && connection.to === targetNodeId)),
        updatedAt: new Date().toISOString(),
      })
    } else {
      const nestedImageIds = new Set(current.nodes.flatMap((node) =>
        node.type === 'image' && node.imageFileName === reference.fileName ? [node.id] : [],
      ))
      emitDocument({
        ...current,
        nodes: current.nodes.map((node) => node.id === source.id
          ? { ...node, imageFileNames: (node.imageFileNames ?? []).filter((fileName) => fileName !== reference.fileName) }
          : node),
        connections: current.connections.filter((connection) =>
          !(connection.to === source.id && nestedImageIds.has(connection.from))),
        updatedAt: new Date().toISOString(),
      })
    }
    notify('已移除参考图并更新提示词编号')
  }

  function deleteSelectionOrConnection(): void {
    const connectionId = selectedConnectionIdRef.current
    if (connectionId) deleteConnection(connectionId)
    else deleteNodes(selectedIdsRef.current)
  }

  function copySelectedNodes(): void {
    const ids = selectedIdsRef.current
    if (ids.size === 0) return
    const current = documentRef.current
    clipboardRef.current = {
      nodes: current.nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node })),
      connections: current.connections.filter((connection) => ids.has(connection.from) && ids.has(connection.to)).map((connection) => ({ ...connection })),
    }
    notify(`已复制 ${ids.size} 个节点`)
  }

  function pasteSelectedNodes(): void {
    const copied = clipboardRef.current
    if (!copied || copied.nodes.length === 0) return
    const current = documentRef.current
    const temporaryDocument: CanvasDocument = {
      ...current,
      nodes: copied.nodes,
      connections: copied.connections,
    }
    const duplicated = duplicateSelection(temporaryDocument, new Set(copied.nodes.map((node) => node.id)), lastPointerWorldRef.current)
    const newNodes = duplicated.document.nodes.filter((node) => duplicated.selectedIds.has(node.id))
    const newConnections = duplicated.document.connections.filter((connection) => duplicated.selectedIds.has(connection.from) && duplicated.selectedIds.has(connection.to))
    pushUndo()
    emitDocument({
      ...current,
      nodes: [...current.nodes, ...newNodes],
      connections: [...current.connections, ...newConnections],
      updatedAt: new Date().toISOString(),
    })
    setSelectedIds(duplicated.selectedIds)
  }

  function autoArrange(): void {
    const current = documentRef.current
    const ids = selectedIdsRef.current.size > 0 ? selectedIdsRef.current : new Set(current.nodes.map((node) => node.id))
    if (ids.size === 0) return
    pushUndo()
    emitDocument(arrangeSelection(current, ids))
    setSelectedIds(ids)
    notify(ids.size === 1 ? '已整理相连节点' : `已整理 ${ids.size} 个节点`)
  }

  function onContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault()
    const nodeId = (event.target as HTMLElement)
      .closest<HTMLElement>('.canvas-node[data-node-id]')
      ?.dataset.nodeId
    if (nodeId && !selectedIdsRef.current.has(nodeId)) setSelectedIds(new Set([nodeId]))
    const world = clientToWorld(canvasRef.current, documentRef.current.viewport, event.clientX, event.clientY)
    const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const menuLeft = clamp(event.clientX - rect.left, 8, Math.max(8, (canvasRef.current?.clientWidth ?? 1200) - 253))
    const menuTop = clamp(event.clientY - rect.top, 8, Math.max(8, (canvasRef.current?.clientHeight ?? 760) - 320))
    lastPointerWorldRef.current = world
    setAddMenuOpen(false)
    setContextMenu({ kind: nodeId ? 'selection' : 'canvas', clientX: menuLeft, clientY: menuTop, world })
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('.canvas-node, .connection-interaction')) return
    addNode('note', clientToWorld(canvasRef.current, documentRef.current.viewport, event.clientX, event.clientY))
  }

  function moveFromMinimap(event: ReactPointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = clamp(event.clientX - rect.left - 5, 0, 160)
    const y = clamp(event.clientY - rect.top - 5, 0, 94)
    const worldX = minimap.bounds.x + x / minimap.scale
    const worldY = minimap.bounds.y + y / minimap.scale
    const current = documentRef.current
    const width = canvasRef.current?.clientWidth ?? 1200
    const height = canvasRef.current?.clientHeight ?? 760
    updateViewport({
      ...current.viewport,
      x: width / 2 - worldX * current.viewport.zoom,
      y: height / 2 - worldY * current.viewport.zoom,
    })
  }

  async function generateImage(source: CanvasNodeData): Promise<boolean> {
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id)
    if (!latestSource) return false
    const referenceImageFileNames = findReferenceImageFileNames(current, latestSource)
    let prompts: ReadonlyArray<string>
    if (latestSource.type === 'compositor') {
      if (referenceImageFileNames.length < 2) {
        notify('图片合成至少需要连接 2 个已有图片节点')
        return false
      }
      const compositionPrompt = latestSource.subtitle?.trim()
      if (!compositionPrompt) {
        notify('请先填写图片合成要求')
        return false
      }
      prompts = [compositionPrompt]
    } else {
      prompts = findPromptTextsForSource(current, latestSource)
    }
    if (prompts.length === 0) {
      notify('请先在提示词节点中输入图片描述')
      return false
    }
    const modelKey = latestSource.type === 'generator' || latestSource.type === 'compositor'
      ? latestSource.modelKey ?? defaultImageModelKey
      : defaultImageModelKey
    const size = normalizeImageGenerationSize(
      modelKey,
      latestSource.type === 'generator' || latestSource.type === 'compositor'
        ? latestSource.imageSize
        : undefined,
    )
    const count = latestSource.type === 'generator' || latestSource.type === 'compositor'
      ? latestSource.generationCount ?? 1
      : 1
    const taskPrompts = prompts.flatMap((prompt) => Array.from({ length: count }, () => prompt))
    if (taskPrompts.length > 50) {
      notify('单次最多生成 50 张图片，请减少提示词节点后重试')
      return false
    }
    const reusableResultIds = new Set(current.connections
      .filter((connection) => connection.from === latestSource.id)
      .map((connection) => connection.to))
    const reusableResultNodes = current.nodes.filter((node) =>
      node.type === 'image' &&
      reusableResultIds.has(node.id) &&
      !node.imageFileName &&
      node.generationStatus !== 'queued' &&
      node.generationStatus !== 'generating',
    ).slice(0, taskPrompts.length)
    const newTaskCount = taskPrompts.length - reusableResultNodes.length
    if (current.nodes.length + newTaskCount > 500) {
      notify('画布节点数量已达到上限，请删除部分节点后再生成')
      return false
    }
    const startedAt = new Date().toISOString()
    const resultCount = current.nodes.filter((node) => node.type === 'image').length
    const positions = findGenerationNodePositions(current, latestSource, taskPrompts.length)
    const taskNodes = positions.map((position, index): CanvasNodeData => ({
      ...(reusableResultNodes[index] ?? {}),
      id: reusableResultNodes[index]?.id ?? `image-task-${crypto.randomUUID()}`,
      type: 'image',
      title: reusableResultNodes[index]?.title || `生成结果 ${resultCount + index + 1}`,
      subtitle: taskPrompts[index].slice(0, 80),
      modelKey,
      imageSize: size,
      generationStatus: 'queued',
      generationStartedAt: startedAt,
      generationBatchId: undefined,
      generationBatchIndex: undefined,
      x: reusableResultNodes[index]?.x ?? position.x,
      y: reusableResultNodes[index]?.y ?? position.y,
      color: '#23c8ff',
    }))
    const reusedNodeIds = new Set(reusableResultNodes.map((node) => node.id))
    const newTaskNodes = taskNodes.filter((node) => !reusedNodeIds.has(node.id))
    const taskNodeById = new Map(taskNodes.map((node) => [node.id, node]))

    pushUndo()
    emitDocument({
      ...current,
      nodes: [
        ...current.nodes.map((node) => taskNodeById.get(node.id) ?? node),
        ...newTaskNodes,
      ],
      connections: [
        ...current.connections,
        ...newTaskNodes.map((node) => ({
          id: `connection-${crypto.randomUUID()}`,
          from: latestSource.id,
          to: node.id,
        })),
      ],
      updatedAt: startedAt,
    })
    setSelectedIds(new Set(taskNodes.map((node) => node.id)))
    notify(taskPrompts.length > 1
      ? `已创建 ${taskPrompts.length} 个异步任务（${prompts.length} 个提示词 × 每个 ${count} 张）`
      : '图片生成任务已创建')
    const outcomes = await Promise.all(taskNodes.map((node, index) => new Promise<boolean>((resolve) => {
      enqueueGenerationTask({
        documentId: current.id,
        nodeId: node.id,
        request: { prompt: taskPrompts[index], modelKey, size, referenceImageFileNames },
        resolve,
      })
    })))
    return outcomes.every(Boolean)
  }

  async function optimizePrompt(source: CanvasNodeData): Promise<void> {
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id && node.type === 'prompt')
    const originalPrompt = latestSource?.subtitle?.trim() ?? ''
    if (!latestSource || !originalPrompt) {
      notify('请先输入需要优化的创意提示词')
      return
    }
    setOptimizingPromptNodeIds((ids) => new Set([...ids, latestSource.id]))
    try {
      const outcome = await onOptimizePrompt({ prompt: originalPrompt })
      if (!outcome.ok) {
        notify(outcome.error)
        return
      }
      const currentSource = documentRef.current.nodes.find((node) => node.id === latestSource.id)
      if (!currentSource || currentSource.subtitle?.trim() !== originalPrompt) {
        notify('优化期间提示词已被修改，未覆盖当前内容')
        return
      }
      pushUndo()
      updateNode(latestSource.id, { subtitle: outcome.value.prompt })
      notify(`已使用 ${outcome.value.modelName} 优化提示词`)
    } catch {
      notify('提示词优化失败，请检查默认对话模型和网络')
    } finally {
      setOptimizingPromptNodeIds((ids) => {
        const next = new Set(ids)
        next.delete(latestSource.id)
        return next
      })
    }
  }

  async function sendChatMessage(source: CanvasNodeData, content: string): Promise<boolean> {
    const messageContent = content.trim()
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id && node.type === 'chat')
    if (!latestSource || !messageContent || chattingNodeIds.has(latestSource.id)) return false
    if (!defaultChatModelKey && !latestSource.modelKey) {
      notify('请先在模型设置中启用并选择默认对话模型')
      return false
    }
    const userMessage: CanvasChatMessage = {
      id: `message-${crypto.randomUUID()}`,
      role: 'user',
      content: messageContent,
      createdAt: new Date().toISOString(),
    }
    const messages = [...(latestSource.chatMessages ?? []).slice(-98), userMessage]
    pushUndo()
    updateNode(latestSource.id, { chatMessages: messages, modelKey: latestSource.modelKey ?? defaultChatModelKey })
    setChattingNodeIds((ids) => new Set([...ids, latestSource.id]))
    try {
      const outcome = await onGenerateChatReply({
        modelKey: latestSource.modelKey ?? defaultChatModelKey,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      })
      if (!outcome.ok) {
        notify(outcome.error)
        return false
      }
      const latestDocument = documentRef.current
      const currentNode = latestDocument.nodes.find((node) => node.id === latestSource.id && node.type === 'chat')
      if (!currentNode) return false
      const assistantMessage: CanvasChatMessage = {
        id: `message-${crypto.randomUUID()}`,
        role: 'assistant',
        content: outcome.value.content,
        createdAt: new Date().toISOString(),
      }
      updateNode(currentNode.id, {
        chatMessages: [...(currentNode.chatMessages ?? []), assistantMessage].slice(-100),
        modelKey: outcome.value.modelKey,
      })
      return true
    } catch {
      notify('AI 对话失败，请检查默认对话模型和网络')
      return false
    } finally {
      setChattingNodeIds((ids) => {
        const next = new Set(ids)
        next.delete(latestSource.id)
        return next
      })
    }
  }

  async function generateStoryboard(source: CanvasNodeData): Promise<boolean> {
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id && node.type === 'storyboard')
    const ownTheme = latestSource?.subtitle?.trim() ?? ''
    const theme = ownTheme || (latestSource ? findConnectedPromptTexts(current, latestSource)[0] : '') || ''
    if (!latestSource || !theme || storyboardNodeIds.has(source.id)) {
      if (!theme) notify('请填写分镜主题，或从左侧连接创意提示词 / AI 对话节点')
      return false
    }
    const shotCount = latestSource.storyboardShotCount ?? 4
    setStoryboardNodeIds((ids) => new Set([...ids, latestSource.id]))
    try {
      const outcome = await onGenerateStoryboard({
        theme,
        shotCount,
        modelKey: latestSource.modelKey ?? defaultChatModelKey,
      })
      if (!outcome.ok) {
        notify(outcome.error)
        return false
      }
      const latestDocument = documentRef.current
      const currentSource = latestDocument.nodes.find((node) => node.id === latestSource.id)
      if (!currentSource) return false
      if (latestDocument.nodes.length >= 500 || latestDocument.connections.length >= 1000) {
        notify('画布节点或连线数量已达到上限，无法创建分镜节点')
        return false
      }
      const sourceDimensions = nodeDimensions(currentSource)
      const existingResultCount = latestDocument.connections.filter((connection) =>
        connection.from === currentSource.id && latestDocument.nodes.some((node) => node.id === connection.to && node.type === 'shot-list'),
      ).length
      const resultNode: CanvasNodeData = {
        id: `shot-list-${crypto.randomUUID()}`,
        type: 'shot-list',
        title: `分镜节点 ${latestDocument.nodes.filter((node) => node.type === 'shot-list').length + 1}`,
        subtitle: theme,
        storyboardShots: outcome.value.shots,
        x: currentSource.x + sourceDimensions.width + 92,
        y: currentSource.y + existingResultCount * 42,
        color: '#fbbf24',
      }
      pushUndo()
      emitDocument({
        ...latestDocument,
        nodes: [
          ...latestDocument.nodes.map((node) => node.id === currentSource.id
            ? { ...node, modelKey: outcome.value.modelKey, subtitle: ownTheme || theme }
            : node),
          resultNode,
        ],
        connections: [
          ...latestDocument.connections,
          { id: `connection-${crypto.randomUUID()}`, from: currentSource.id, to: resultNode.id },
        ],
        updatedAt: new Date().toISOString(),
      })
      setSelectedIds(new Set([resultNode.id]))
      notify(`已使用 ${outcome.value.modelName} 创建包含 ${outcome.value.shots.length} 镜的分镜节点`)
      return true
    } catch {
      notify('分镜生成失败，请检查默认对话模型和网络')
      return false
    } finally {
      setStoryboardNodeIds((ids) => {
        const next = new Set(ids)
        next.delete(latestSource.id)
        return next
      })
    }
  }

  function createPromptFromText(source: CanvasNodeData, content: string, title = '创意提示词'): void {
    const prompt = content.trim()
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id)
    if (!latestSource || !prompt) return
    if (current.nodes.length >= 500) {
      notify('画布节点数量已达到上限')
      return
    }
    const sameSourcePromptCount = current.connections.filter((connection) => connection.from === latestSource.id)
      .filter((connection) => current.nodes.some((node) => node.id === connection.to && node.type === 'prompt'))
      .length
    const sourceSize = nodeDimensions(latestSource)
    const promptNode: CanvasNodeData = {
      id: `prompt-${crypto.randomUUID()}`,
      type: 'prompt',
      title,
      subtitle: prompt,
      x: latestSource.x + sourceSize.width + 92,
      y: latestSource.y + sameSourcePromptCount * 235,
      color: '#aaff00',
    }
    pushUndo()
    emitDocument({
      ...current,
      nodes: [...current.nodes, promptNode],
      connections: [
        ...current.connections,
        { id: `connection-${crypto.randomUUID()}`, from: latestSource.id, to: promptNode.id },
      ],
      updatedAt: new Date().toISOString(),
    })
    setSelectedIds(new Set([promptNode.id]))
    notify('已创建提示词节点')
  }

  async function generateVideo(source: CanvasNodeData): Promise<boolean> {
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id)
    if (!latestSource || latestSource.type !== 'video') return false
    if (latestSource.generationStatus === 'queued' || latestSource.generationStatus === 'generating') {
      notify('这个视频节点已有任务正在运行')
      return false
    }
    const promptOptions = findVideoPromptOptions(current, latestSource)
    const selectedPrompt = promptOptions.find((option) => option.id === latestSource.videoPromptId) ?? promptOptions[0]
    if (!selectedPrompt) {
      notify('请先连接一个有内容的提示词节点或分镜节点')
      return false
    }
    const modelKey = latestSource.modelKey ?? defaultVideoModelKey
    if (!modelKey || videoModels.length === 0) {
      notify('请先在模型设置中启用一个视频模型')
      return false
    }
    const referenceImageFileNames = findReferenceImageFileNames(current, latestSource).slice(0, 12)
    const startedAt = new Date().toISOString()
    pushUndo()
    updateNode(latestSource.id, {
      modelKey,
      videoPromptId: selectedPrompt.id,
      generationStatus: 'generating',
      generationStartedAt: startedAt,
      generationCompletedAt: undefined,
      generationError: undefined,
      videoFileName: undefined,
    })
    try {
      const outcome = await onGenerateVideo({
        prompt: selectedPrompt.prompt,
        modelKey,
        duration: latestSource.videoDuration ?? 5,
        resolution: latestSource.videoResolution ?? '768P',
        ratio: latestSource.videoRatio ?? '16:9',
        referenceImageFileNames,
      })
      if (!outcome.ok) {
        updateNode(latestSource.id, {
          generationStatus: 'failed',
          generationCompletedAt: new Date().toISOString(),
          generationError: outcome.error.slice(0, 1000),
        })
        notify(outcome.error)
        return false
      }
      updateNode(latestSource.id, {
        videoFileName: outcome.value.video.videoFileName,
        videoDuration: outcome.value.video.duration,
        videoResolution: outcome.value.video.resolution,
        videoRatio: outcome.value.video.ratio,
        generationStatus: 'succeeded',
        generationCompletedAt: new Date().toISOString(),
        generationError: undefined,
      })
      notify('视频已生成并保存到本地数据目录')
      return true
    } catch {
      updateNode(latestSource.id, {
        generationStatus: 'failed',
        generationCompletedAt: new Date().toISOString(),
        generationError: '视频生成失败，请检查模型配置和网络后重试',
      })
      notify('视频生成失败，请检查模型配置和网络后重试')
      return false
    }
  }

  async function generateAudio(source: CanvasNodeData): Promise<boolean> {
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id && node.type === 'audio')
    if (!latestSource) return false
    if (latestSource.generationStatus === 'queued' || latestSource.generationStatus === 'generating') {
      notify('这个语音节点已有任务正在运行')
      return false
    }
    const connectedText = findPromptTextsForSource(current, latestSource)[0]
    const ownText = latestSource.subtitle?.trim()
    const text = connectedText || (ownText === '连接提示词或输入旁白文本' ? '' : ownText) || ''
    if (!text) {
      notify('请连接提示词节点，或输入需要合成的旁白文本')
      return false
    }
    if (text.length >= 10_000) {
      notify('单次同步语音合成文本必须少于 10000 字')
      return false
    }
    const modelKey = latestSource.modelKey ?? defaultAudioModelKey
    if (!modelKey || audioModels.length === 0) {
      notify('请先在模型设置中启用一个语音模型')
      return false
    }
    pushUndo()
    updateNode(latestSource.id, {
      modelKey,
      generationStatus: 'generating',
      generationStartedAt: new Date().toISOString(),
      generationCompletedAt: undefined,
      generationError: undefined,
      audioFileName: undefined,
    })
    try {
      const outcome = await onGenerateAudio({
        text,
        modelKey,
        voiceId: latestSource.audioVoiceId ?? 'female-shaonv',
        speed: latestSource.audioSpeed ?? 1,
        pitch: latestSource.audioPitch ?? 0,
        emotion: latestSource.audioEmotion ?? '',
      })
      if (!outcome.ok) {
        updateNode(latestSource.id, {
          generationStatus: 'failed',
          generationCompletedAt: new Date().toISOString(),
          generationError: outcome.error.slice(0, 1000),
        })
        notify(outcome.error)
        return false
      }
      updateNode(latestSource.id, {
        audioFileName: outcome.value.audio.audioFileName,
        modelKey: outcome.value.audio.modelKey,
        generationStatus: 'succeeded',
        generationCompletedAt: new Date().toISOString(),
        generationError: undefined,
      })
      notify('语音已生成并保存到本地数据目录')
      return true
    } catch {
      updateNode(latestSource.id, {
        generationStatus: 'failed',
        generationCompletedAt: new Date().toISOString(),
        generationError: '语音生成失败，请检查 MiniMax 配置和网络后重试',
      })
      notify('语音生成失败，请检查 MiniMax 配置和网络后重试')
      return false
    }
  }

  async function runWorkflow(retryFailed = false): Promise<void> {
    if (workflowRunning || hasActiveGenerationTasks || chattingNodeIds.size > 0 || storyboardNodeIds.size > 0) {
      notify('当前已有生成任务或工作流正在运行')
      return
    }
    const initial = documentRef.current
    const targetIds = new Set(initial.nodes.flatMap((node) =>
      !retryFailed || node.workflowStatus === 'failed' || node.workflowStatus === 'skipped'
        ? [node.id]
        : [],
    ))
    if (targetIds.size === 0) {
      notify('没有需要重试的失败节点')
      return
    }
    const runId = crypto.randomUUID()
    workflowRunIdRef.current = runId
    setWorkflowRunning(true)
    pushUndo()
    emitDocument({
      ...initial,
      nodes: initial.nodes.map((node) => targetIds.has(node.id)
        ? { ...node, workflowStatus: 'idle', workflowError: undefined }
        : node),
      updatedAt: new Date().toISOString(),
    })
    const failedNodeIds = new Set<string>()
    let succeededCount = 0
    try {
      for (const nodeId of topologicalNodeIds(initial)) {
        if (workflowRunIdRef.current !== runId || !targetIds.has(nodeId)) return
        const blockedByDependency = initial.connections.some((connection) =>
          connection.to === nodeId && failedNodeIds.has(connection.from),
        )
        if (blockedByDependency) {
          failedNodeIds.add(nodeId)
          updateNode(nodeId, { workflowStatus: 'skipped', workflowError: '上游节点执行失败，当前节点已跳过' })
          continue
        }
        const node = documentRef.current.nodes.find((item) => item.id === nodeId)
        if (!node) continue
        updateNode(nodeId, { workflowStatus: 'running', workflowError: undefined })
        const succeeded = await executeWorkflowNode(node)
        if (workflowRunIdRef.current !== runId) return
        if (succeeded) {
          succeededCount += 1
          updateNode(nodeId, { workflowStatus: 'succeeded', workflowError: undefined })
        } else {
          failedNodeIds.add(nodeId)
          updateNode(nodeId, {
            workflowStatus: 'failed',
            workflowError: workflowFailureMessage(node.type),
          })
        }
      }
      notify(failedNodeIds.size > 0
        ? `工作流完成：${succeededCount} 个成功，${failedNodeIds.size} 个失败或跳过`
        : `工作流执行完成：${succeededCount} 个节点成功`)
    } finally {
      if (workflowRunIdRef.current === runId) {
        workflowRunIdRef.current = null
        setWorkflowRunning(false)
      }
    }
  }

  async function executeWorkflowNode(node: CanvasNodeData): Promise<boolean> {
    const current = documentRef.current
    const latestNode = current.nodes.find((item) => item.id === node.id)
    if (!latestNode) return false
    switch (latestNode.type) {
      case 'prompt':
        return Boolean(latestNode.subtitle?.trim())
      case 'storyboard': {
        const theme = latestNode.subtitle?.trim() || findPromptTextsForSource(current, latestNode)[0]
        if (!theme) return false
        if (!latestNode.subtitle?.trim()) updateNode(latestNode.id, { subtitle: theme })
        return generateStoryboard({ ...latestNode, subtitle: theme })
      }
      case 'shot-list':
        return (latestNode.storyboardShots ?? []).some((shot) => shot.prompt.trim())
      case 'chat': {
        const input = findPromptTextsForSource(current, latestNode)[0]
          ?? [...(latestNode.chatMessages ?? [])].reverse().find((message) => message.role === 'user')?.content
        return input ? sendChatMessage(latestNode, input) : false
      }
      case 'generator':
      case 'compositor':
        return generateImage(latestNode)
      case 'video':
        return generateVideo(latestNode)
      case 'audio':
        return generateAudio(latestNode)
      case 'image':
        return Boolean(latestNode.imageFileName)
      case 'reference-folder':
        return (latestNode.imageFileNames?.length ?? 0) > 0 || !current.connections.some((connection) => connection.from === latestNode.id)
      case 'note':
        return true
    }
  }

  async function importImagesIntoNode(source: CanvasNodeData): Promise<void> {
    const imported = await onImportImages()
    if (imported.length === 0) return
    const current = documentRef.current
    const latestSource = current.nodes.find((node) => node.id === source.id)
    if (!latestSource || (latestSource.type !== 'image' && latestSource.type !== 'reference-folder')) return
    if (latestSource.type === 'reference-folder') {
      const importedFileNames = imported.flatMap((artwork) => artwork.imageFileName ? [artwork.imageFileName] : [])
      const nextFileNames = [...new Set([...(latestSource.imageFileNames ?? []), ...importedFileNames])].slice(0, 50)
      if (nextFileNames.length === (latestSource.imageFileNames?.length ?? 0)) return
      pushUndo()
      updateNode(latestSource.id, { imageFileNames: nextFileNames })
      notify(`参考图文件夹现有 ${nextFileNames.length} 张图片`)
      return
    }
    const accepted = imported.slice(0, Math.max(0, 500 - current.nodes.length + 1))
    if (accepted.length === 0) {
      notify('画布节点数量已达到上限')
      return
    }
    const [first, ...remaining] = accepted
    if (!first?.imageFileName) return
    const addedNodes = remaining.flatMap((artwork, index): ReadonlyArray<CanvasNodeData> => {
      if (!artwork.imageFileName) return []
      return [{
        id: `image-${crypto.randomUUID()}`,
        type: 'image',
        title: artwork.title,
        subtitle: '本地参考图',
        imageFileName: artwork.imageFileName,
        x: latestSource.x,
        y: latestSource.y + (index + 1) * 330,
        color: '#23c8ff',
      }]
    })
    pushUndo()
    emitDocument({
      ...current,
      nodes: [
        ...current.nodes.map((node) => node.id === latestSource.id
          ? {
              ...node,
              title: first.title,
              subtitle: '本地参考图',
              imageFileName: first.imageFileName,
              generationStatus: undefined,
              generationError: undefined,
            }
          : node),
        ...addedNodes,
      ],
      updatedAt: new Date().toISOString(),
    })
    setSelectedIds(new Set([latestSource.id, ...addedNodes.map((node) => node.id)]))
  }

  function onFileDragEnter(event: ReactDragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    fileDragDepthRef.current += 1
    setFileDragActive(true)
  }

  function onFileDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFileDragActive(true)
    setFileDropTargetNodeId(findImageDropTargetNodeId(event.target, documentRef.current))
  }

  function onFileDragLeave(event: ReactDragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event.dataTransfer)) return
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1)
    if (fileDragDepthRef.current > 0) return
    setFileDragActive(false)
    setFileDropTargetNodeId(null)
  }

  function onFileDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    fileDragDepthRef.current = 0
    setFileDragActive(false)
    setFileDropTargetNodeId(null)

    const current = documentRef.current
    const targetNodeId = findImageDropTargetNodeId(event.target, current)
    const availableNodeCount = targetNodeId
      ? 50
      : Math.max(0, 500 - current.nodes.length)
    if (availableNodeCount === 0) {
      notify('画布节点数量已达到上限')
      return
    }
    const supportedFiles = Array.from(event.dataTransfer.files).filter(isSupportedDroppedImage)
    if (supportedFiles.length === 0) {
      notify('仅支持拖入 PNG、JPG、JPEG 和 WEBP 图片')
      return
    }
    const acceptedFiles = supportedFiles.slice(0, Math.min(50, availableNodeCount))
    if (acceptedFiles.length < supportedFiles.length) {
      notify(`本次将导入前 ${acceptedFiles.length} 张图片`)
    }
    const dropPoint = clientToWorld(
      canvasRef.current,
      current.viewport,
      event.clientX,
      event.clientY,
    )
    void importDroppedImagesAt(acceptedFiles, dropPoint, targetNodeId, current.id)
  }

  async function importDroppedImagesAt(
    files: ReadonlyArray<File>,
    dropPoint: CanvasPoint,
    targetNodeId: string | null,
    documentId: string,
  ): Promise<void> {
    const imported = await onImportDroppedImages(files)
    if (imported.length === 0) return
    const current = documentRef.current
    if (current.id !== documentId) return

    const targetNode = targetNodeId
      ? current.nodes.find((node) =>
          node.id === targetNodeId && (node.type === 'image' || node.type === 'reference-folder'))
      : undefined
    if (targetNode?.type === 'reference-folder') {
      const importedFileNames = imported.flatMap((artwork) => artwork.imageFileName ? [artwork.imageFileName] : [])
      const nextFileNames = [...new Set([...(targetNode.imageFileNames ?? []), ...importedFileNames])].slice(0, 50)
      pushUndo()
      updateNode(targetNode.id, { imageFileNames: nextFileNames })
      setSelectedIds(new Set([targetNode.id]))
      notify(`参考图文件夹现有 ${nextFileNames.length} 张图片`)
      return
    }
    const availableNodeCount = targetNode
      ? Math.max(0, 501 - current.nodes.length)
      : Math.max(0, 500 - current.nodes.length)
    const accepted = imported.slice(0, availableNodeCount)
    if (accepted.length === 0) {
      notify('画布节点数量已达到上限；图片已保存到图片库')
      return
    }

    const firstArtwork = targetNode ? accepted[0] : undefined
    const newArtworks = targetNode ? accepted.slice(1) : accepted
    const origin = targetNode
      ? { x: targetNode.x + nodeDimensions(targetNode).width + 28, y: targetNode.y }
      : { x: Math.round(dropPoint.x - 146), y: Math.round(dropPoint.y - 146) }
    const addedNodes = newArtworks.flatMap((artwork, index): ReadonlyArray<CanvasNodeData> => {
      if (!artwork.imageFileName) return []
      return [{
        id: `image-${crypto.randomUUID()}`,
        type: 'image',
        title: artwork.title,
        subtitle: '本地参考图',
        imageFileName: artwork.imageFileName,
        x: origin.x + (index % 4) * 320,
        y: origin.y + Math.floor(index / 4) * 330,
        color: '#23c8ff',
      }]
    })

    pushUndo()
    emitDocument({
      ...current,
      nodes: [
        ...current.nodes.map((node) => node.id === targetNode?.id && firstArtwork?.imageFileName
          ? {
              ...node,
              title: firstArtwork.title,
              subtitle: '本地参考图',
              imageFileName: firstArtwork.imageFileName,
              generationStatus: undefined,
              generationStartedAt: undefined,
              generationCompletedAt: undefined,
              generationError: undefined,
            }
          : node),
        ...addedNodes,
      ],
      updatedAt: new Date().toISOString(),
    })
    setSelectedIds(new Set([
      ...(targetNode && firstArtwork?.imageFileName ? [targetNode.id] : []),
      ...addedNodes.map((node) => node.id),
    ]))
  }

  function enqueueGenerationTask(task: PendingGenerationTask): void {
    generationQueueRef.current = [...generationQueueRef.current, task]
    drainGenerationQueue()
  }

  function drainGenerationQueue(): void {
    while (
      activeGenerationCountRef.current < MAX_CONCURRENT_GENERATIONS &&
      generationQueueRef.current.length > 0
    ) {
      const task = generationQueueRef.current.shift()
      if (!task) continue
      if (!isQueuedGenerationTask(documentRef.current, task)) {
        task.resolve?.(false)
        continue
      }
      activeGenerationCountRef.current += 1
      updateGenerationTaskNode(task, { generationStatus: 'generating' })
      void executeGenerationTask(task).finally(() => {
        activeGenerationCountRef.current = Math.max(0, activeGenerationCountRef.current - 1)
        drainGenerationQueue()
      })
    }
  }

  async function executeGenerationTask(task: PendingGenerationTask): Promise<void> {
    try {
      const outcome = await onGenerateImage(task.request)
      if (!outcome.ok) {
        failGenerationTask(task, outcome.error)
        return
      }
      const imageFileName = outcome.value.artwork.imageFileName
      if (!imageFileName) {
        failGenerationTask(task, '图片服务没有返回可保存的图片文件')
        return
      }
      updateGenerationTaskNode(task, {
        imageFileName,
        modelKey: outcome.value.artwork.modelKey ?? task.request.modelKey,
        generationStatus: 'succeeded',
        generationCompletedAt: new Date().toISOString(),
        generationError: undefined,
      })
      task.resolve?.(true)
    } catch {
      failGenerationTask(task, '图片生成失败，请检查模型配置和网络后重试')
    }
  }

  function failGenerationTask(task: PendingGenerationTask, message: string): void {
    if (updateGenerationTaskNode(task, {
      generationStatus: 'failed',
      generationCompletedAt: new Date().toISOString(),
      generationError: message.slice(0, 1000),
    })) notify(message)
    task.resolve?.(false)
  }

  function updateGenerationTaskNode(
    task: PendingGenerationTask,
    patch: Partial<CanvasNodeData>,
  ): boolean {
    const current = documentRef.current
    if (current.id !== task.documentId || !current.nodes.some((node) => node.id === task.nodeId)) {
      return false
    }
    emitDocument({
      ...current,
      nodes: current.nodes.map((node) => node.id === task.nodeId ? { ...node, ...patch } : node),
      updatedAt: new Date().toISOString(),
    })
    return true
  }

  return (
    <div className="canvas-workspace">
      <header className="canvas-topbar">
        <div className="canvas-topbar-left">
          <button className="canvas-icon-button" onClick={onClose} title="返回文件" type="button"><ArrowLeft size={18}/></button>
          <div className="canvas-brand"><span>DC</span><strong>Draw Canvas</strong></div>
          <i className="topbar-divider" />
          <input aria-label="画布名称" className="canvas-name" onChange={(event) => emitDocument({ ...documentRef.current, name: event.target.value, updatedAt: new Date().toISOString() })} value={document.name}/>
          <span className="autosave-status"><Check size={13}/> 已自动保存 · {savedAt}</span>
        </div>
        <div className="canvas-topbar-actions">
          <button className="canvas-text-button" onClick={onOpen} type="button">打开</button>
          <button className="canvas-icon-button" disabled={undoStackRef.current.length === 0} onClick={undo} title="撤销 (⌘/Ctrl+Z)" type="button"><Undo2 size={17}/></button>
          <button className="canvas-icon-button" disabled={redoStackRef.current.length === 0} onClick={redo} title="重做 (⇧⌘Z/Ctrl+Y)" type="button"><Redo2 size={17}/></button>
          <button className="canvas-text-button" onClick={onSave} type="button"><Save size={16}/> 保存文件</button>
          {workflowFailureCount > 0 && <button className="canvas-text-button workflow-retry-button" disabled={workflowRunning} onClick={() => void runWorkflow(true)} type="button"><Redo2 size={15}/> 重试 {workflowFailureCount}</button>}
          <button className="canvas-text-button workflow-run-button" disabled={workflowRunning || hasActiveGenerationTasks} onClick={() => void runWorkflow()} type="button">{workflowRunning ? <LoaderCircle className="is-spinning" size={15}/> : <Play size={15}/>} {workflowRunning ? '执行中' : '运行工作流'}</button>
        </div>
      </header>

      <div className="canvas-stage-wrap">
        <div
          className={`${tool === 'hand' || drag?.kind === 'pan' ? 'canvas-stage is-panning' : drag?.kind === 'selection' ? 'canvas-stage is-selecting' : 'canvas-stage'}${isFileDragActive ? ' is-file-dragging' : ''}`}
          onContextMenu={onContextMenu}
          onDoubleClick={onDoubleClick}
          onDragEnter={onFileDragEnter}
          onDragLeave={onFileDragLeave}
          onDragOver={onFileDragOver}
          onDrop={onFileDrop}
          onPointerCancel={() => setActiveDrag(null)}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          ref={canvasRef}
        >
          <div className="canvas-grid" />
          <div className="canvas-world" style={worldStyle}>
            <CanvasConnections
              document={document}
              drag={drag?.kind === 'link' ? drag : null}
              onDelete={deleteConnection}
              onSelect={(connectionId) => {
                setSelectedIds(new Set())
                setSelectedConnectionId(connectionId)
              }}
              selectedConnectionId={selectedConnectionId}
            />
            {document.nodes.map((node) => (
              <CanvasNode
                key={node.id}
                activeGenerationCount={countActiveGenerationTasks(document, node.id)}
                audioModels={audioModels}
                chatModels={chatModels}
                defaultAudioModelKey={defaultAudioModelKey}
                defaultChatModelKey={defaultChatModelKey}
                defaultImageModelKey={defaultImageModelKey}
                defaultVideoModelKey={defaultVideoModelKey}
                generationNow={generationNow}
                imageModels={imageModels}
                isChatting={chattingNodeIds.has(node.id)}
                isGeneratingStoryboard={storyboardNodeIds.has(node.id)}
                isOptimizingPrompt={optimizingPromptNodeIds.has(node.id)}
                storyboardInputAvailable={findConnectedPromptTexts(document, node).length > 0}
                node={node}
                dropTarget={fileDropTargetNodeId === node.id}
                onDelete={() => deleteNodes(selectedIdsRef.current.has(node.id) ? selectedIdsRef.current : new Set([node.id]))}
                onGenerateAudio={() => void generateAudio(node)}
                onGenerateImage={() => void generateImage(node)}
                onGenerateStoryboard={() => void generateStoryboard(node)}
                onGenerateVideo={() => void generateVideo(node)}
                onImportImages={() => void importImagesIntoNode(node)}
                onLoadImage={onLoadImage}
                onOptimizePrompt={() => void optimizePrompt(node)}
                onCreatePrompt={(content, title) => createPromptFromText(node, content, title)}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onPortPointerDown={(event, side) => onPortPointerDown(event, node.id, side)}
                onResizePointerDown={(event) => onResizePointerDown(event, node)}
                onUpdate={(patch) => updateNode(node.id, patch)}
                onSendChat={(content) => void sendChatMessage(node, content)}
                onRemoveReference={(reference) => removeReferenceImage(node.id, reference)}
                mentionReferenceImages={findMentionReferenceImages(document, node)}
                referenceImages={findConnectedReferenceImages(document, node)}
                selected={selectedIds.has(node.id)}
                videoPromptOptions={findVideoPromptOptions(document, node)}
                videoModels={videoModels}
              />
            ))}
          </div>
          {isFileDragActive && (
            <div className="canvas-drop-hint">
              <Upload size={18}/>
              <div>
                <strong>{fileDropTargetNodeId ? '松开以填充这个图片节点' : '松开以创建本地参考图节点'}</strong>
                <small>支持 PNG、JPG、JPEG、WEBP，一次最多 50 张</small>
              </div>
            </div>
          )}
          {drag?.kind === 'selection' && <SelectionRectangle selection={drag}/>}
        </div>

        <div className="canvas-toolbar">
          <button className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')} title="选择与框选" type="button"><MousePointer2 size={18}/></button>
          <button className={tool === 'hand' ? 'is-active' : ''} onClick={() => setTool('hand')} title="抓手" type="button"><Hand size={18}/></button>
          <i />
          <div className="add-node-wrap">
            <button className={addMenuOpen ? 'add-node-trigger is-active' : 'add-node-trigger'} onClick={() => { setContextMenu(null); setAddMenuOpen(!addMenuOpen) }} type="button"><Plus size={18}/><span>添加节点</span><ChevronDown size={14}/></button>
            {addMenuOpen && <NodeMenu onAdd={(type) => addNode(type)} />}
          </div>
          <i />
          <button onClick={autoArrange} title="自动整理节点" type="button"><LayoutGrid size={18}/></button>
          <button onClick={() => notify('快捷键：拖动端口连接；多选图片后右键可组成文件夹；⌘/Ctrl+C/V 复制粘贴；Delete 删除')} title="帮助" type="button"><CircleHelp size={18}/></button>
        </div>

        <div className="canvas-view-controls">
          <button onClick={() => setZoom(document.viewport.zoom - 0.1)} type="button"><Minus size={15}/></button>
          <button className="zoom-label" onClick={() => setZoom(1)} type="button">{zoomPercent}%</button>
          <button onClick={() => setZoom(document.viewport.zoom + 0.1)} type="button"><Plus size={15}/></button>
          <i />
          <button onClick={fitView} title="适应画布" type="button"><Maximize2 size={16}/></button>
          <button title="属性面板" type="button"><PanelRight size={16}/></button>
        </div>

        <div
          className="canvas-minimap"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            minimapPointerIdRef.current = event.pointerId
            moveFromMinimap(event)
          }}
          onPointerMove={(event) => {
            if (minimapPointerIdRef.current === event.pointerId) moveFromMinimap(event)
          }}
          onPointerUp={() => { minimapPointerIdRef.current = null }}
        >
          <div className="minimap-world">
            {minimap.nodes.map((node) => <span key={node.id} style={{ left: node.x, top: node.y, width: node.width, height: node.height, background: node.color }}/>) }
          </div>
          <i style={{ left: minimap.viewport.x, top: minimap.viewport.y, width: minimap.viewport.width, height: minimap.viewport.height }}/>
        </div>
        <div className="canvas-hint">滚轮缩放 · 空白拖动框选 · Space/中键拖动画布 · 端口拖动连线 · 多选图片后右键组成文件夹</div>

        {contextMenu && (
          <div
            className="canvas-context-menu"
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
          >
            {contextMenu.kind === 'canvas'
              ? <NodeMenu onAdd={(type) => addNode(type, contextMenu.world)} />
              : (
                  <SelectionContextMenu
                    canGroupImages={canGroupSelectedImages}
                    onCopy={() => { copySelectedNodes(); setContextMenu(null) }}
                    onDelete={() => { deleteNodes(selectedIdsRef.current); setContextMenu(null) }}
                    onGroupImages={groupSelectedImages}
                    selectedCount={selectedNodes.length}
                  />
                )}
          </div>
        )}
      </div>
    </div>
  )
}

function CanvasConnections({ document, drag, onDelete, onSelect, selectedConnectionId }: Readonly<{
  document: CanvasDocument
  drag: Extract<DragState, { kind: 'link' }> | null
  onDelete: (connectionId: string) => void
  onSelect: (connectionId: string) => void
  selectedConnectionId: string | null
}>) {
  const paths = useMemo(() => document.connections.flatMap((connection) => {
    const from = document.nodes.find((node) => node.id === connection.from)
    const to = document.nodes.find((node) => node.id === connection.to)
    if (!from || !to) return []
    const start = nodePortPoint(from, 'output')
    const end = nodePortPoint(to, 'input')
    const path = connectionPath(start, end)
    const midpoint = bezierMidpoint(start, end)
    const selected = selectedConnectionId === connection.id
    return [
      <g className={`connection-interaction${selected ? ' is-selected' : ''}`} key={connection.id}>
        <path className="connection-shadow" d={path}/>
        <path className="connection-line" d={path}/>
        <path className="connection-hit" d={path} onPointerDown={(event) => { event.stopPropagation(); onSelect(connection.id) }}/>
        <circle className="connection-endpoint" cx={start.x} cy={start.y} r="5"/>
        <circle className="connection-endpoint" cx={end.x} cy={end.y} r="5"/>
        {selected && (
          <g className="connection-delete" onPointerDown={(event) => { event.stopPropagation(); onDelete(connection.id) }} transform={`translate(${midpoint.x} ${midpoint.y})`}>
            <circle r="10"/><path d="M -3 -3 L 3 3 M 3 -3 L -3 3"/>
          </g>
        )}
      </g>,
    ]
  }), [document.connections, document.nodes, onDelete, onSelect, selectedConnectionId])
  let temporaryPath: string | null = null
  if (drag) {
    const source = document.nodes.find((node) => node.id === drag.nodeId)
    if (source) {
      const port = nodePortPoint(source, drag.side)
      temporaryPath = drag.side === 'output' ? connectionPath(port, drag.currentWorld) : connectionPath(drag.currentWorld, port)
    }
  }
  return <svg className="connections-layer" height="1" width="1">{paths}{temporaryPath && <path className="connection-preview" d={temporaryPath}/>}</svg>
}

type CanvasNodeProps = Readonly<{
  activeGenerationCount: number
  audioModels: ReadonlyArray<CanvasImageModelOption>
  chatModels: ReadonlyArray<CanvasImageModelOption>
  defaultAudioModelKey: string
  defaultChatModelKey: string
  defaultImageModelKey: string
  defaultVideoModelKey: string
  generationNow: number
  imageModels: ReadonlyArray<CanvasImageModelOption>
  isChatting: boolean
  isGeneratingStoryboard: boolean
  isOptimizingPrompt: boolean
  storyboardInputAvailable: boolean
  videoPromptOptions: ReadonlyArray<ConnectedVideoPrompt>
  videoModels: ReadonlyArray<CanvasImageModelOption>
  node: CanvasNodeData
  dropTarget: boolean
  mentionReferenceImages: ReadonlyArray<ConnectedReferenceImage>
  referenceImages: ReadonlyArray<ConnectedReferenceImage>
  selected: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPortPointerDown: (event: ReactPointerEvent<HTMLElement>, side: 'input' | 'output') => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  onGenerateImage: () => void
  onGenerateAudio: () => void
  onGenerateStoryboard: () => void
  onGenerateVideo: () => void
  onImportImages: () => void
  onLoadImage: (fileName: string) => Promise<string | null>
  onRemoveReference: (reference: ConnectedReferenceImage) => void
  onOptimizePrompt: () => void
  onCreatePrompt: (content: string, title?: string) => void
  onSendChat: (content: string) => void
  onDelete: () => void
}>

function CanvasNode({ activeGenerationCount, audioModels, chatModels, defaultAudioModelKey, defaultChatModelKey, defaultImageModelKey, defaultVideoModelKey, generationNow, imageModels, videoModels, videoPromptOptions, node, dropTarget, isChatting, isGeneratingStoryboard, isOptimizingPrompt, storyboardInputAvailable, mentionReferenceImages, referenceImages, selected, onPointerDown, onPortPointerDown, onResizePointerDown, onUpdate, onGenerateAudio, onGenerateImage, onGenerateStoryboard, onGenerateVideo, onImportImages, onLoadImage, onOptimizePrompt, onCreatePrompt, onRemoveReference, onSendChat, onDelete }: CanvasNodeProps) {
  const [storyboardHelpOpen, setStoryboardHelpOpen] = useState(false)
  const renderedHeight = nodeDimensions(node).height

  useEffect(() => {
    if (!storyboardHelpOpen) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      const owner = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-storyboard-help-node]')
        : null
      if (owner?.dataset.storyboardHelpNode === node.id) return
      setStoryboardHelpOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setStoryboardHelpOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [node.id, storyboardHelpOpen])

  return (
    <article
      className={`canvas-node node-${node.type}${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}${node.generationStatus ? ` is-${node.generationStatus}` : ''}${node.collapsed ? ' is-collapsed' : ''}${storyboardHelpOpen ? ' is-help-open' : ''}`}
      data-node-id={node.id}
      onPointerDown={onPointerDown}
      style={{ left: node.x, top: node.y, width: node.width, height: renderedHeight, minHeight: renderedHeight, '--node-color': node.color ?? '#aaff00' } as CSSProperties}
    >
      <span className="node-input-port" data-node-id={node.id} data-port="input" onPointerDown={(event) => onPortPointerDown(event, 'input')} title={node.type === 'storyboard' ? '输入：连接创意提示词或 AI 对话节点' : node.type === 'shot-list' ? '输入：分镜生成结果' : '输入端口'} />
      <span className="node-output-port" data-node-id={node.id} data-port="output" onPointerDown={(event) => onPortPointerDown(event, 'output')} title={node.type === 'shot-list' ? '输出：将分镜提示词传给视频等下游节点' : '输出端口'} />
      <header>
        <span className="node-header-icon">{nodeIcon(node.type)}</span>
        <input aria-label="节点标题" onChange={(event) => onUpdate({ title: event.target.value })} value={node.title}/>
        {node.workflowStatus && node.workflowStatus !== 'idle' && <span className={`node-workflow-status is-${node.workflowStatus}`} title={node.workflowError}>{workflowStatusLabel(node.workflowStatus)}</span>}
        <span className="node-header-actions">
          {node.type === 'storyboard' && <button aria-expanded={storyboardHelpOpen} aria-label="查看分镜生成器使用说明" className="node-help-button" data-storyboard-help-node={node.id} onClick={() => setStoryboardHelpOpen((open) => !open)} title="使用说明" type="button"><CircleHelp size={14}/></button>}
          <button className="node-delete-button" onClick={onDelete} title="删除节点" type="button"><X size={14}/></button>
        </span>
      </header>
      {node.type === 'storyboard' && storyboardHelpOpen && <StoryboardHelpPopover nodeId={node.id}/>}
      {node.type === 'prompt' && (
        <div className="prompt-node-body">
          <div className="prompt-editor">
            <ReferenceMentionTextarea
              ariaLabel="提示词"
              onChange={(value) => onUpdate({ subtitle: value })}
              onLoadImage={onLoadImage}
              references={mentionReferenceImages}
              value={node.subtitle ?? ''}
            />
            <button className="prompt-optimize-button" disabled={isOptimizingPrompt || !node.subtitle?.trim()} onClick={onOptimizePrompt} title="使用默认对话模型优化" type="button">
              {isOptimizingPrompt ? <LoaderCircle className="is-spinning" size={12}/> : <WandSparkles size={12}/>} {isOptimizingPrompt ? '优化中' : '一键优化'}
            </button>
          </div>
          <div><span>{node.subtitle?.length ?? 0} 字</span></div>
        </div>
      )}
      {node.type === 'storyboard' && (
        <StoryboardNode
          chatModels={chatModels}
          defaultChatModelKey={defaultChatModelKey}
          generating={isGeneratingStoryboard}
          inputAvailable={storyboardInputAvailable}
          node={node}
          onGenerate={onGenerateStoryboard}
          onUpdate={onUpdate}
        />
      )}
      {node.type === 'shot-list' && <ShotListNode node={node} onLoadImage={onLoadImage} onUpdate={onUpdate} references={mentionReferenceImages}/>}
      {(node.type === 'generator' || node.type === 'compositor') && (
        <ImageGenerationNodeControls
          activeGenerationCount={activeGenerationCount}
          defaultImageModelKey={defaultImageModelKey}
          imageModels={imageModels}
          isCompositor={node.type === 'compositor'}
          node={node}
          onGenerate={onGenerateImage}
          onLoadImage={onLoadImage}
          onRemoveReference={onRemoveReference}
          onUpdate={onUpdate}
          referenceImages={referenceImages}
        />
      )}
      {node.type === 'image' && <CanvasImageNode generationNow={generationNow} node={node} onImportImages={onImportImages} onLoadImage={onLoadImage}/>}
      {node.type === 'reference-folder' && <ReferenceFolderNode node={node} onImportImages={onImportImages} onLoadImage={onLoadImage} onUpdate={onUpdate}/>}
      {node.type === 'note' && <textarea aria-label="便签内容" className="note-node-body" onChange={(event) => onUpdate({ subtitle: event.target.value })} value={node.subtitle ?? ''}/>} 
      {node.type === 'chat' && (
        <ChatNode
          chatModels={chatModels}
          defaultChatModelKey={defaultChatModelKey}
          isChatting={isChatting}
          node={node}
          onCreatePrompt={onCreatePrompt}
          onSend={onSendChat}
          onUpdate={onUpdate}
        />
      )}
      {node.type === 'video' && (
        <CanvasVideoNode
          defaultVideoModelKey={defaultVideoModelKey}
          generationNow={generationNow}
          node={node}
          onGenerate={onGenerateVideo}
          onLoadImage={onLoadImage}
          onRemoveReference={onRemoveReference}
          onUpdate={onUpdate}
          referenceImages={referenceImages}
          videoPromptOptions={videoPromptOptions}
          videoModels={videoModels}
        />
      )}
      {node.type === 'audio' && (
        <CanvasAudioNode
          audioModels={audioModels}
          defaultAudioModelKey={defaultAudioModelKey}
          generationNow={generationNow}
          node={node}
          onGenerate={onGenerateAudio}
          onUpdate={onUpdate}
        />
      )}
      <span className="node-resize-handle" onPointerDown={onResizePointerDown}/>
    </article>
  )
}

function StoryboardHelpPopover({ nodeId }: Readonly<{ nodeId: string }>) {
  return (
    <div className="storyboard-help-popover" data-storyboard-help-node={nodeId} onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-label="分镜提示词使用说明">
      <div className="storyboard-help-heading"><strong>分镜提示词怎么用</strong></div>
      <ol>
        <li><b>1</b><span>填写故事主题，或者从左侧端口连接创意提示词 / AI 对话节点。</span></li>
        <li><b>2</b><span>选择文本模型和镜头数量，点击“生成分镜节点”。</span></li>
        <li><b>3</b><span>生成成功后，右侧会自动新建一个可编辑的分镜节点。</span></li>
      </ol>
      <div><span>提示</span><p>点击浮层外任意位置即可关闭</p><span>分镜节点</span><p>支持新增、编辑、调整时长和逐镜删除</p></div>
    </div>
  )
}

function ChatNode({ chatModels, defaultChatModelKey, isChatting, node, onCreatePrompt, onSend, onUpdate }: Readonly<{
  chatModels: ReadonlyArray<CanvasImageModelOption>
  defaultChatModelKey: string
  isChatting: boolean
  node: CanvasNodeData
  onCreatePrompt: (content: string, title?: string) => void
  onSend: (content: string) => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
}>) {
  const [draft, setDraft] = useState('')
  const messages = node.chatMessages ?? []

  function submit(): void {
    const content = draft.trim()
    if (!content || isChatting) return
    setDraft('')
    onSend(content)
  }

  return (
    <div className="chat-node-body">
      <div className="chat-model-row">
        <Bot size={14}/>
        <select aria-label="对话模型" disabled={chatModels.length === 0 || isChatting} onChange={(event) => onUpdate({ modelKey: event.target.value })} value={node.modelKey ?? defaultChatModelKey}>
          {chatModels.length === 0 && <option value="">未配置对话模型</option>}
          {chatModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
        </select>
        {messages.length > 0 && <button onClick={() => onUpdate({ chatMessages: [] })} title="清空对话" type="button"><Trash2 size={12}/></button>}
      </div>
      <div className="chat-message-list">
        {messages.length === 0 && <div className="chat-empty">讨论创意、分镜和提示词，回复可一键转为提示词节点。</div>}
        {messages.map((message) => (
          <div className={`chat-message is-${message.role}`} key={message.id}>
            <span>{message.role === 'user' ? '你' : 'AI'}</span>
            <p>{message.content}</p>
            {message.role === 'assistant' && <button onClick={() => onCreatePrompt(message.content, 'AI 对话提示词')} title="转为提示词节点" type="button"><WandSparkles size={11}/> 转提示词</button>}
          </div>
        ))}
        {isChatting && <div className="chat-thinking"><LoaderCircle className="is-spinning" size={13}/> 正在思考…</div>}
      </div>
      <div className="chat-composer">
        <textarea aria-label="对话内容" disabled={isChatting} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }} placeholder="输入消息，Enter 发送，Shift+Enter 换行" value={draft}/>
        <button disabled={!draft.trim() || isChatting || chatModels.length === 0} onClick={submit} title="发送" type="button">{isChatting ? <LoaderCircle className="is-spinning" size={13}/> : <SendHorizontal size={13}/>}</button>
      </div>
    </div>
  )
}

function StoryboardNode({ chatModels, defaultChatModelKey, generating, inputAvailable, node, onGenerate, onUpdate }: Readonly<{
  chatModels: ReadonlyArray<CanvasImageModelOption>
  defaultChatModelKey: string
  generating: boolean
  inputAvailable: boolean
  node: CanvasNodeData
  onGenerate: () => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
}>) {
  return (
    <div className="storyboard-node-body">
      <textarea aria-label="分镜主题" disabled={generating} onChange={(event) => onUpdate({ subtitle: event.target.value })} placeholder="描述故事主题、人物、场景与风格…" value={node.subtitle ?? ''}/>
      <div className="storyboard-controls">
        <label><span>文本模型</span><select aria-label="分镜对话模型" disabled={generating || chatModels.length === 0} onChange={(event) => onUpdate({ modelKey: event.target.value })} value={node.modelKey ?? defaultChatModelKey}>
          {chatModels.length === 0 && <option value="">未配置对话模型</option>}
          {chatModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
        </select></label>
        <label><span>镜头数</span><select aria-label="分镜数量" disabled={generating} onChange={(event) => onUpdate({ storyboardShotCount: Number(event.target.value) })} value={node.storyboardShotCount ?? 4}>
          {[2, 3, 4, 5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count} 镜</option>)}
        </select></label>
        <button disabled={generating || (!node.subtitle?.trim() && !inputAvailable) || chatModels.length === 0} onClick={onGenerate} type="button">{generating ? <LoaderCircle className="is-spinning" size={13}/> : <Sparkles size={13}/>} {generating ? '生成中' : '生成分镜节点'}</button>
      </div>
      <div className="storyboard-empty-state">
        <Clapperboard size={20}/>
        <strong>{inputAvailable ? '已连接主题输入' : '等待分镜主题'}</strong>
        <span>{inputAvailable ? '生成后会在右侧创建独立分镜节点' : '输入主题或连接提示词，点击右上角问号查看说明'}</span>
      </div>
    </div>
  )
}

function ShotListNode({ node, onLoadImage, onUpdate, references }: Readonly<{
  node: CanvasNodeData
  onLoadImage: (fileName: string) => Promise<string | null>
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  references: ReadonlyArray<ConnectedReferenceImage>
}>) {
  const shots = node.storyboardShots ?? []

  function updateShot(shotId: string, patch: Partial<(typeof shots)[number]>): void {
    onUpdate({ storyboardShots: shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot) })
  }

  function addShot(): void {
    if (shots.length >= 12) return
    const index = shots.length + 1
    onUpdate({
      storyboardShots: [...shots, {
        id: `shot-${crypto.randomUUID()}`,
        index,
        title: `镜头 ${index}`,
        prompt: '',
        durationSeconds: 5,
      }],
    })
  }

  function removeShot(shotId: string): void {
    onUpdate({
      storyboardShots: shots
        .filter((shot) => shot.id !== shotId)
        .map((shot, index) => ({ ...shot, index: index + 1 })),
    })
  }

  return (
    <div className="shot-list-node-body">
      <div className="shot-list-summary"><span>{shots.length > 0 ? `${shots.length} 个分镜提示词` : '空白分镜节点'}</span><button disabled={shots.length >= 12} onClick={addShot} type="button"><Plus size={12}/>{shots.length >= 12 ? '已达上限' : '新增镜头'}</button></div>
      {shots.length === 0
        ? <div className="shot-list-empty"><LayoutGrid size={22}/><strong>还没有分镜</strong><span>点击“新增镜头”开始编辑</span></div>
        : <div className="storyboard-shot-list">
            {shots.map((shot) => (
              <section key={shot.id}>
                <div className="shot-list-item-header"><b>{shot.index}</b><input aria-label={`镜头 ${shot.index} 标题`} onChange={(event) => updateShot(shot.id, { title: event.target.value })} value={shot.title}/><label><input aria-label={`镜头 ${shot.index} 时长`} max={60} min={1} onChange={(event) => updateShot(shot.id, { durationSeconds: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })} type="number" value={shot.durationSeconds}/>秒</label><button aria-label={`删除镜头 ${shot.index}`} className="shot-list-delete-button" onClick={() => removeShot(shot.id)} title="删除这个镜头" type="button"><Trash2 size={12}/></button></div>
                <ReferenceMentionTextarea
                  ariaLabel={`镜头 ${shot.index} 提示词`}
                  className="shot-reference-mention-editor"
                  onChange={(value) => updateShot(shot.id, { prompt: value })}
                  onLoadImage={onLoadImage}
                  placeholder="描述这一镜的画面、动作、镜头与光线…"
                  references={references}
                  value={shot.prompt}
                />
              </section>
            ))}
          </div>}
    </div>
  )
}

function ReferenceMentionTextarea({ ariaLabel, className, onChange, onLoadImage, placeholder, references, value }: Readonly<{
  ariaLabel: string
  className?: string
  onChange: (value: string) => void
  onLoadImage: (fileName: string) => Promise<string | null>
  placeholder?: string
  references: ReadonlyArray<ConnectedReferenceImage>
  value: string
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionRange, setMentionRange] = useState<ReferenceMentionRange | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const imageUrls = useReferenceImageUrls(references, onLoadImage)
  const filteredReferences = useMemo(() => {
    if (!mentionRange) return []
    const query = mentionRange.query.toLocaleLowerCase()
    return references.flatMap((reference, index) => {
      const label = `参考图${index + 1}`
      return !query || label.toLocaleLowerCase().includes(query)
        ? [{ reference, index, label }]
        : []
    })
  }, [mentionRange, references])

  useEffect(() => {
    setActiveIndex(0)
  }, [mentionRange?.query, references])

  function insertReference(referenceIndex: number): void {
    if (!mentionRange) return
    const token = `@参考图${referenceIndex + 1}`
    const suffix = value.slice(mentionRange.end)
    const separator = suffix.length === 0 || !/^[\s，。！？、；：,.!?;:)]/.test(suffix) ? ' ' : ''
    const nextValue = `${value.slice(0, mentionRange.start)}${token}${separator}${suffix}`
    const nextCaret = mentionRange.start + token.length + separator.length
    onChange(nextValue)
    setMentionRange(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (!mentionRange || filteredReferences.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % filteredReferences.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + filteredReferences.length) % filteredReferences.length)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const selected = filteredReferences[activeIndex] ?? filteredReferences[0]
      if (selected) insertReference(selected.index)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setMentionRange(null)
    }
  }

  const isOpen = mentionRange !== null && filteredReferences.length > 0
  return (
    <div className={`reference-mention-editor${isOpen ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <textarea
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        onBlur={() => setMentionRange(null)}
        onChange={(event) => {
          const nextValue = event.currentTarget.value
          const caret = event.currentTarget.selectionStart ?? nextValue.length
          onChange(nextValue)
          setMentionRange(references.length > 0 ? findReferenceMentionRange(nextValue, caret) : null)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        role="combobox"
        value={value}
      />
      {isOpen && (
        <div aria-label="可用参考图" className="reference-mention-menu" role="listbox">
          {filteredReferences.map(({ reference, index, label }, optionIndex) => (
            <button
              aria-selected={optionIndex === activeIndex}
              className={optionIndex === activeIndex ? 'is-active' : ''}
              key={reference.key}
              onPointerDown={(event) => {
                event.preventDefault()
                insertReference(index)
              }}
              role="option"
              type="button"
            >
              {imageUrls[reference.fileName]
                ? <img alt="" draggable={false} src={imageUrls[reference.fileName]}/>
                : <span><ImageIcon size={14}/></span>}
              <span><b>@{label}</b><small>{reference.fileName}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useReferenceImageUrls(
  references: ReadonlyArray<ConnectedReferenceImage>,
  onLoadImage: (fileName: string) => Promise<string | null>,
): Readonly<Record<string, string>> {
  const fileNames = references.map((reference) => reference.fileName)
  const fileNameSignature = fileNames.join('\u0000')
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(fileNames.map(async (fileName) => ({
      fileName,
      imageUrl: await onLoadImage(fileName),
    }))).then((items) => {
      if (cancelled) return
      setImageUrls(Object.fromEntries(items.flatMap((item) =>
        item.imageUrl ? [[item.fileName, item.imageUrl]] : [],
      )))
    }).catch(() => {
      if (!cancelled) setImageUrls({})
    })
    return () => { cancelled = true }
  }, [fileNameSignature, onLoadImage])

  return imageUrls
}

function ConnectedReferenceStrip({ emptyLabel, mentionHint, note, onLoadImage, onRemove, references }: Readonly<{
  emptyLabel: string
  mentionHint: string
  note?: string
  onLoadImage: (fileName: string) => Promise<string | null>
  onRemove: (reference: ConnectedReferenceImage) => void
  references: ReadonlyArray<ConnectedReferenceImage>
}>) {
  const imageUrls = useReferenceImageUrls(references, onLoadImage)

  if (references.length === 0) {
    return <div className="reference-count"><Images size={13}/><span>{emptyLabel}</span></div>
  }

  return (
    <div className="connected-reference-strip">
      <div className="connected-reference-heading"><Images size={13}/><span>{references.length} 张参考图</span><small>{mentionHint}{note ? ` · ${note}` : ''}</small></div>
      <div className="connected-reference-list">
        {references.map((reference, index) => (
          <div className="connected-reference-item" key={reference.key} title={`在提示词中使用 @参考图${index + 1}`}>
            {imageUrls[reference.fileName]
              ? <img alt={`@参考图${index + 1}`} draggable={false} src={imageUrls[reference.fileName]}/>
              : <span><ImageIcon size={14}/></span>}
            <b>@参考图{index + 1}</b>
            <button aria-label={`移除参考图 ${index + 1}`} onClick={() => onRemove(reference)} title="移除参考图" type="button"><X size={11}/></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImageGenerationNodeControls({ activeGenerationCount, defaultImageModelKey, imageModels, isCompositor, node, onGenerate, onLoadImage, onRemoveReference, onUpdate, referenceImages }: Readonly<{
  activeGenerationCount: number
  defaultImageModelKey: string
  imageModels: ReadonlyArray<CanvasImageModelOption>
  isCompositor: boolean
  node: CanvasNodeData
  onGenerate: () => void
  onLoadImage: (fileName: string) => Promise<string | null>
  onRemoveReference: (reference: ConnectedReferenceImage) => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  referenceImages: ReadonlyArray<ConnectedReferenceImage>
}>) {
  const selectedModelKey = node.modelKey ?? defaultImageModelKey
  const selectedModel = imageModels.find((model) => model.key === selectedModelKey)
  const sizeOptions = imageGenerationSizeOptionsForModel(selectedModelKey)
  const selectedImageSize = normalizeImageGenerationSize(selectedModelKey, node.imageSize)
  return (
    <div className="generator-node-body">
      {isCompositor && (
        <div className="composition-prompt">
          <span>合成要求</span>
          <ReferenceMentionTextarea
            ariaLabel="图片合成要求"
            onChange={(value) => onUpdate({ subtitle: value })}
            onLoadImage={onLoadImage}
            placeholder="例如：保留 @参考图1 的人物，使用 @参考图2 的场景和光线"
            references={referenceImages}
            value={node.subtitle ?? ''}
          />
        </div>
      )}
      <ConnectedReferenceStrip
        emptyLabel={isCompositor ? '请连接至少 2 张图片' : '未连接参考图，将执行文生图'}
        mentionHint={isCompositor ? '在合成要求中输入 @ 可选择' : '在已连接的提示词中输入 @ 可选择'}
        onLoadImage={onLoadImage}
        onRemove={onRemoveReference}
        references={referenceImages}
      />
      <label>
        模型
        <select
          onChange={(event) => {
            const model = imageModels.find((item) => item.key === event.target.value)
            const imageSize = normalizeImageGenerationSize(event.target.value, node.imageSize)
            onUpdate(isCompositor
              ? { modelKey: event.target.value, imageSize }
              : { modelKey: event.target.value, imageSize, subtitle: `${model?.label ?? '图片模型'} · ${formatImageSize(imageSize)}` })
          }}
          value={selectedModelKey}
        >
          {!selectedModel && <option value={selectedModelKey}>当前默认图片模型</option>}
          {imageModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
        </select>
      </label>
      <div className="generator-fields">
        <label>
          尺寸
          <select
            onChange={(event) => {
              const imageSize = event.target.value as ImageGenerationSize
              onUpdate(isCompositor
                ? { imageSize }
                : { imageSize, subtitle: `${selectedModel?.label ?? '图片模型'} · ${formatImageSize(imageSize)}` })
            }}
            value={selectedImageSize}
          >
            {sizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>数量<select onChange={(event) => onUpdate({ generationCount: Number(event.target.value) as ImageGenerationCount })} value={node.generationCount ?? 1}><option value="1">1 张</option><option value="2">2 张</option><option value="3">3 张</option><option value="4">4 张</option></select></label>
      </div>
      <button className="generate-button" disabled={imageModels.length === 0 || (isCompositor && (referenceImages.length < 2 || !node.subtitle?.trim()))} onClick={onGenerate} type="button">
        {activeGenerationCount > 0 ? <LoaderCircle className="is-spinning" size={14}/> : <Play fill="currentColor" size={14}/>} {activeGenerationCount > 0 ? `继续生成 · ${activeGenerationCount} 进行中` : isCompositor ? '合成图片' : referenceImages.length > 0 ? '参考图生成' : '生成图片'}
      </button>
    </div>
  )
}

function CanvasVideoNode({ defaultVideoModelKey, generationNow, node, onGenerate, onLoadImage, onRemoveReference, onUpdate, referenceImages, videoModels, videoPromptOptions }: Readonly<{
  defaultVideoModelKey: string
  generationNow: number
  node: CanvasNodeData
  onGenerate: () => void
  onLoadImage: (fileName: string) => Promise<string | null>
  onRemoveReference: (reference: ConnectedReferenceImage) => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  referenceImages: ReadonlyArray<ConnectedReferenceImage>
  videoModels: ReadonlyArray<CanvasImageModelOption>
  videoPromptOptions: ReadonlyArray<ConnectedVideoPrompt>
}>) {
  const modelKey = node.modelKey ?? defaultVideoModelKey
  const selectedModel = videoModels.find((model) => model.key === modelKey)
  const selectedPrompt = videoPromptOptions.find((option) => option.id === node.videoPromptId) ?? videoPromptOptions[0]
  const usesOnlyFirstReference = modelKey.includes(':MiniMax-Hailuo-')
  const pending = node.generationStatus === 'queued' || node.generationStatus === 'generating'
  const elapsedSeconds = generationElapsedSeconds(
    node.generationStartedAt,
    node.generationCompletedAt ? Date.parse(node.generationCompletedAt) : generationNow,
  )
  return (
    <div className="video-node-body">
      {(pending || node.generationStatus === 'failed' || node.videoFileName) && (
        <div className={`video-preview${pending ? ' is-generating' : ''}${node.generationStatus === 'failed' ? ' is-failed' : ''}`}>
          {pending
            ? <div><LoaderCircle className="is-spinning" size={24}/><strong>正在生成视频</strong><small>{elapsedSeconds} 秒</small></div>
            : node.generationStatus === 'failed'
              ? <div><Video size={24}/><strong>生成失败</strong><small>{node.generationError ?? '请重试'}</small></div>
              : node.videoFileName
                ? <video controls preload="metadata" src={`drawcanvas-media://video/${encodeURIComponent(node.videoFileName)}`}/>
                : null}
        </div>
      )}
      <label>
        提示词来源
        <select
          disabled={videoPromptOptions.length === 0}
          onChange={(event) => onUpdate({ videoPromptId: event.target.value })}
          value={selectedPrompt?.id ?? ''}
        >
          {videoPromptOptions.length === 0 && <option value="">请连接提示词或分镜节点</option>}
          {videoPromptOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      {selectedPrompt && <div className="video-prompt-preview">{selectedPrompt.prompt}</div>}
      <ConnectedReferenceStrip
        emptyLabel="未连接参考图 · 可连接生成图、导入图或参考图文件夹"
        mentionHint="在已连接的提示词或分镜中输入 @ 可选择"
        note={usesOnlyFirstReference && referenceImages.length > 1 ? 'Hailuo 仅使用 @参考图1 作为首帧' : undefined}
        onLoadImage={onLoadImage}
        onRemove={onRemoveReference}
        references={referenceImages}
      />
      <label>模型<select onChange={(event) => onUpdate({ modelKey: event.target.value })} value={modelKey}>{!selectedModel && modelKey && <option value={modelKey}>当前视频模型</option>}{videoModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}</select></label>
      <div className="video-fields">
        <label>时长<select onChange={(event) => onUpdate({ videoDuration: Number(event.target.value) })} value={node.videoDuration ?? 5}><option value="5">5 秒</option><option value="6">6 秒</option><option value="10">10 秒</option></select></label>
        <label>清晰度<select onChange={(event) => onUpdate({ videoResolution: event.target.value as VideoGenerationResolution })} value={node.videoResolution ?? '768P'}><option value="768P">768P</option><option value="1080P">1080P</option><option value="2K">2K</option></select></label>
        <label>比例<select onChange={(event) => onUpdate({ videoRatio: event.target.value as VideoGenerationRatio })} value={node.videoRatio ?? '16:9'}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="adaptive">自适应</option></select></label>
      </div>
      <button className="generate-button" disabled={pending || videoModels.length === 0 || !selectedPrompt} onClick={onGenerate} type="button">{pending ? <LoaderCircle className="is-spinning" size={14}/> : <Play fill="currentColor" size={14}/>} {pending ? `生成中 · ${elapsedSeconds} 秒` : node.videoFileName ? '重新生成视频' : '生成视频'}</button>
    </div>
  )
}

function CanvasAudioNode({ audioModels, defaultAudioModelKey, generationNow, node, onGenerate, onUpdate }: Readonly<{
  audioModels: ReadonlyArray<CanvasImageModelOption>
  defaultAudioModelKey: string
  generationNow: number
  node: CanvasNodeData
  onGenerate: () => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
}>) {
  const modelKey = node.modelKey ?? defaultAudioModelKey
  const selectedModel = audioModels.find((model) => model.key === modelKey)
  const pending = node.generationStatus === 'queued' || node.generationStatus === 'generating'
  const elapsedSeconds = generationElapsedSeconds(
    node.generationStartedAt,
    node.generationCompletedAt ? Date.parse(node.generationCompletedAt) : generationNow,
  )
  return (
    <div className="audio-node-body">
      {(pending || node.generationStatus === 'failed' || node.audioFileName) && (
        <div className={`audio-preview${pending ? ' is-generating' : ''}${node.generationStatus === 'failed' ? ' is-failed' : ''}`}>
          {pending
            ? <div><LoaderCircle className="is-spinning" size={22}/><strong>正在生成语音</strong><small>{elapsedSeconds} 秒</small></div>
            : node.generationStatus === 'failed'
              ? <div><AudioLines size={22}/><strong>生成失败</strong><small>{node.generationError ?? '请重试'}</small></div>
              : node.audioFileName
                ? <audio controls preload="metadata" src={`drawcanvas-media://audio/${encodeURIComponent(node.audioFileName)}`}/>
                : null}
        </div>
      )}
      <label className="audio-text">旁白文本<textarea maxLength={9_999} onChange={(event) => onUpdate({ subtitle: event.target.value })} placeholder="也可以连接提示词、AI 对话或分镜节点" value={node.subtitle === '连接提示词或输入旁白文本' ? '' : node.subtitle ?? ''}/></label>
      <label>模型<select onChange={(event) => onUpdate({ modelKey: event.target.value })} value={modelKey}>{!selectedModel && modelKey && <option value={modelKey}>当前语音模型</option>}{audioModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}</select></label>
      <div className="audio-fields">
        <label>音色<input list={`audio-voices-${node.id}`} onChange={(event) => onUpdate({ audioVoiceId: event.target.value })} placeholder="系统或克隆音色 ID" value={node.audioVoiceId ?? 'female-shaonv'}/><datalist id={`audio-voices-${node.id}`}>{AUDIO_VOICE_OPTIONS.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</datalist></label>
        <label>语速<select onChange={(event) => onUpdate({ audioSpeed: Number(event.target.value) })} value={node.audioSpeed ?? 1}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
        <label>音调<select onChange={(event) => onUpdate({ audioPitch: Number(event.target.value) })} value={node.audioPitch ?? 0}>{[-6, -3, 0, 3, 6].map((pitch) => <option key={pitch} value={pitch}>{pitch > 0 ? `+${pitch}` : pitch}</option>)}</select></label>
        <label>情绪<select onChange={(event) => onUpdate({ audioEmotion: event.target.value })} value={node.audioEmotion ?? ''}>{AUDIO_EMOTION_OPTIONS.map((emotion) => <option key={emotion.value} value={emotion.value}>{emotion.label}</option>)}</select></label>
      </div>
      <button className="generate-button" disabled={pending || audioModels.length === 0 || !(node.audioVoiceId ?? 'female-shaonv').trim()} onClick={onGenerate} type="button">{pending ? <LoaderCircle className="is-spinning" size={14}/> : <Play fill="currentColor" size={14}/>} {pending ? `生成中 · ${elapsedSeconds} 秒` : node.audioFileName ? '重新生成语音' : '生成语音'}</button>
    </div>
  )
}

function CanvasImageNode({ generationNow, node, onImportImages, onLoadImage }: Readonly<{
  generationNow: number
  node: CanvasNodeData
  onImportImages: () => void
  onLoadImage: (fileName: string) => Promise<string | null>
}>) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!node.imageFileName) return
    let cancelled = false
    setImageUrl(null)
    setLoadFailed(false)
    void onLoadImage(node.imageFileName).then((dataUrl) => {
      if (cancelled) return
      setImageUrl(dataUrl)
      setLoadFailed(!dataUrl)
    }).catch(() => {
      if (!cancelled) setLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [node.imageFileName, onLoadImage])

  const isPending = node.generationStatus === 'queued' || node.generationStatus === 'generating'
  const completedTimestamp = node.generationCompletedAt
    ? Date.parse(node.generationCompletedAt)
    : generationNow
  const elapsedSeconds = generationElapsedSeconds(node.generationStartedAt, completedTimestamp)

  return (
    <div className="image-node-body">
      <div className={`generated-art${node.imageFileName ? ' has-image' : ''}${isPending ? ' is-generating' : ''}${node.generationStatus === 'failed' ? ' is-failed' : ''}`}>
        {isPending
          ? <div className="generation-progress"><span className="generation-spinner"><LoaderCircle className="is-spinning" size={25}/></span><strong>{node.generationStatus === 'queued' ? '等待生成' : '正在生成图片'}</strong><small>{elapsedSeconds} 秒</small><i/></div>
          : node.generationStatus === 'failed'
            ? <div className="generation-progress is-error"><ImageIcon size={25}/><strong>生成失败</strong><small>{node.generationError ?? '请重新生成'}</small></div>
          : imageUrl
          ? <img alt={node.title} draggable={false} src={imageUrl}/>
          : node.imageFileName
            ? <div className="generated-art-status">{loadFailed ? <ImageIcon size={22}/> : <LoaderCircle className="is-spinning" size={22}/>}<span>{loadFailed ? '图片无法读取' : '正在载入图片'}</span></div>
            : <div className="image-import-empty"><Upload size={24}/><strong>导入本地参考图</strong><small>支持 PNG、JPG、WEBP，可一次选择多张</small><button onClick={onImportImages} type="button">选择图片</button></div>}
      </div>
      <div className="image-node-meta">
        <div><span>{node.subtitle}</span>{node.generationStatus === 'succeeded' && <small>完成 · {elapsedSeconds} 秒</small>}</div>
        <button disabled={!imageUrl} onClick={() => imageUrl && downloadGeneratedImage(imageUrl, node.title)} title="导出" type="button"><Download size={15}/></button>
      </div>
    </div>
  )
}

function ReferenceFolderNode({ node, onImportImages, onLoadImage, onUpdate }: Readonly<{
  node: CanvasNodeData
  onImportImages: () => void
  onLoadImage: (fileName: string) => Promise<string | null>
  onUpdate: (patch: Partial<CanvasNodeData>) => void
}>) {
  const fileNames = useMemo(() => node.imageFileNames ?? [], [node.imageFileNames])
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(fileNames.map(async (fileName) => ({
      fileName,
      imageUrl: await onLoadImage(fileName),
    }))).then((items) => {
      if (cancelled) return
      setImageUrls(Object.fromEntries(items.flatMap((item) =>
        item.imageUrl ? [[item.fileName, item.imageUrl]] : [],
      )))
    })
    return () => { cancelled = true }
  }, [fileNames, onLoadImage])

  function moveImage(index: number, offset: -1 | 1): void {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= fileNames.length) return
    const next = [...fileNames]
    const current = next[index]
    const target = next[targetIndex]
    if (!current || !target) return
    next[index] = target
    next[targetIndex] = current
    onUpdate({ imageFileNames: next })
  }

  function removeImage(fileName: string): void {
    onUpdate({ imageFileNames: fileNames.filter((item) => item !== fileName) })
  }

  return (
    <div className="reference-folder-body">
      <div className="reference-folder-summary"><FolderOpen size={15}/><span>{fileNames.length > 0 ? `${fileNames.length} 张参考图 · 可整体连接生成、合成或视频节点` : '文件夹为空，可选择或拖入多张图片'}</span><button onClick={() => onUpdate({ collapsed: !node.collapsed })} title={node.collapsed ? '展开' : '折叠'} type="button">{node.collapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button></div>
      {!node.collapsed && fileNames.length > 0 && (
        <div className="reference-folder-grid">
          {fileNames.map((fileName, index) => (
            <div className="reference-folder-item" key={fileName}>
              {imageUrls[fileName]
                ? <img alt={`参考图 ${index + 1}`} src={imageUrls[fileName]}/>
                : <div><ImageIcon size={18}/></div>}
              <span>{index + 1}</span>
              <div className="reference-folder-item-actions">
                <button disabled={index === 0} onClick={() => moveImage(index, -1)} title="前移" type="button"><ChevronLeft size={12}/></button>
                <button disabled={index === fileNames.length - 1} onClick={() => moveImage(index, 1)} title="后移" type="button"><ChevronRight size={12}/></button>
                <button onClick={() => removeImage(fileName)} title="移出文件夹" type="button"><Trash2 size={12}/></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!node.collapsed && <button className="reference-folder-add" disabled={fileNames.length >= 50} onClick={onImportImages} type="button"><Plus size={14}/>{fileNames.length >= 50 ? '已达到 50 张上限' : '添加参考图'}</button>}
    </div>
  )
}

function NodeMenu({ onAdd }: Readonly<{ onAdd: (type: CanvasNodeType) => void }>) {
  return (
    <div className="add-node-menu">
      <strong>添加节点</strong>
      {nodeTypes.map(({ type, label, description, icon: Icon }) => (
        <button key={type} onClick={() => onAdd(type)} type="button">
          <span className={`node-type-icon type-${type}`}><Icon size={17}/></span>
          <span><b>{label}</b><small>{description}</small></span>
        </button>
      ))}
    </div>
  )
}

function SelectionContextMenu({ canGroupImages, onCopy, onDelete, onGroupImages, selectedCount }: Readonly<{
  canGroupImages: boolean
  onCopy: () => void
  onDelete: () => void
  onGroupImages: () => void
  selectedCount: number
}>) {
  return (
    <div className="selection-context-menu">
      <strong>已选择 {selectedCount} 个节点</strong>
      <button disabled={!canGroupImages} onClick={onGroupImages} title={canGroupImages ? '将所选图片收进一个参考图文件夹' : '请选中至少 2 张已生成或已导入的图片'} type="button">
        <FolderOpen size={15}/><span><b>组成参考图文件夹</b><small>{canGroupImages ? '保留图片并整体作为下游参考图' : '需要至少 2 张可用图片'}</small></span>
      </button>
      <i/>
      <button onClick={onCopy} type="button"><Copy size={14}/><span><b>复制所选节点</b></span></button>
      <button className="is-danger" onClick={onDelete} type="button"><Trash2 size={14}/><span><b>删除所选节点</b></span></button>
    </div>
  )
}

function SelectionRectangle({ selection }: Readonly<{ selection: Extract<DragState, { kind: 'selection' }> }>) {
  return <div className="canvas-selection-box" style={{
    left: Math.min(selection.startClient.x, selection.currentClient.x),
    top: Math.min(selection.startClient.y, selection.currentClient.y),
    width: Math.abs(selection.currentClient.x - selection.startClient.x),
    height: Math.abs(selection.currentClient.y - selection.startClient.y),
  }}/>
}

function buildMinimap(document: CanvasDocument, element: HTMLDivElement | null) {
  const contentBounds = graphBounds(document.nodes)
  const padding = 160
  const bounds = {
    x: contentBounds.x - padding,
    y: contentBounds.y - padding,
    width: contentBounds.width + padding * 2,
    height: contentBounds.height + padding * 2,
  }
  const scale = Math.min(160 / bounds.width, 94 / bounds.height)
  const viewportWorld = {
    x: -document.viewport.x / document.viewport.zoom,
    y: -document.viewport.y / document.viewport.zoom,
    width: (element?.clientWidth ?? 1200) / document.viewport.zoom,
    height: (element?.clientHeight ?? 760) / document.viewport.zoom,
  }
  const viewportWidth = clamp(viewportWorld.width * scale, 8, 160)
  const viewportHeight = clamp(viewportWorld.height * scale, 8, 94)
  return {
    bounds,
    scale,
    nodes: document.nodes.map((node) => {
      const dimensions = nodeDimensions(node)
      return {
        id: node.id,
        x: (node.x - bounds.x) * scale,
        y: (node.y - bounds.y) * scale,
        width: Math.max(3, dimensions.width * scale),
        height: Math.max(2, dimensions.height * scale),
        color: node.color,
      }
    }),
    viewport: {
      x: clamp(5 + (viewportWorld.x - bounds.x) * scale, 5, 165 - viewportWidth),
      y: clamp(5 + (viewportWorld.y - bounds.y) * scale, 5, 99 - viewportHeight),
      width: viewportWidth,
      height: viewportHeight,
    },
  }
}

function createNodeData(
  type: CanvasNodeType,
  document: CanvasDocument,
  position: CanvasPoint,
  defaultImageModelKey: string,
  defaultVideoModelKey: string,
  imageModels: ReadonlyArray<CanvasImageModelOption>,
  videoModels: ReadonlyArray<CanvasImageModelOption>,
): CanvasNodeData {
  const count = document.nodes.filter((node) => node.type === type).length + 1
  const labels: Record<CanvasNodeType, string> = { prompt: '创意提示词', storyboard: '分镜提示词', 'shot-list': '分镜节点', generator: '图像生成', compositor: '图片合成', image: '图片素材', 'reference-folder': '参考图文件夹', note: '新便签', chat: 'AI 对话', video: '视频生成', audio: '语音生成' }
  const defaultImageModelName = imageModels.find((model) => model.key === defaultImageModelKey)?.label ?? '默认图片模型'
  const defaultImageSize = defaultImageGenerationSizeForModel(defaultImageModelKey)
  const defaultVideoModelName = videoModels.find((model) => model.key === defaultVideoModelKey)?.label ?? '默认视频模型'
  return {
    id: `${type}-${crypto.randomUUID()}`,
    type,
    title: `${labels[type]} ${count}`,
    subtitle: type === 'generator' ? `${defaultImageModelName} · ${formatImageSize(defaultImageSize)}` : type === 'video' || type === 'compositor' ? '' : defaultSubtitle(type),
    ...(type === 'generator' || type === 'compositor'
      ? { modelKey: defaultImageModelKey, imageSize: defaultImageSize, generationCount: 1 as const }
      : type === 'video'
        ? { modelKey: defaultVideoModelKey, videoDuration: 5, videoResolution: '768P' as const, videoRatio: '16:9' as const, title: `${labels[type]} ${count} · ${defaultVideoModelName}` }
      : type === 'storyboard'
        ? { storyboardShotCount: 4 }
      : type === 'shot-list'
        ? { storyboardShots: [] }
      : type === 'chat'
        ? { chatMessages: [] }
      : type === 'audio'
        ? { audioVoiceId: 'female-shaonv', audioSpeed: 1, audioPitch: 0, audioEmotion: '' }
      : {}),
    x: Math.round(position.x),
    y: Math.round(position.y),
    color: defaultColor(type),
  }
}

function nearestPort(
  element: HTMLDivElement | null,
  side: 'input' | 'output',
  clientX: number,
  clientY: number,
  excludedNodeId: string,
): string | null {
  if (!element) return null
  let nearestId: string | null = null
  let nearestDistance = 48
  for (const port of element.querySelectorAll<HTMLElement>(`[data-port="${side}"]`)) {
    if (port.dataset.nodeId === excludedNodeId) continue
    const rect = port.getBoundingClientRect()
    const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2))
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestId = port.dataset.nodeId ?? null
    }
  }
  return nearestId
}

function nodeIdAtClientPoint(clientX: number, clientY: number, excludedNodeId: string): string | null {
  const nodeId = window.document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('.canvas-node[data-node-id]')
    ?.dataset.nodeId
  return nodeId && nodeId !== excludedNodeId ? nodeId : null
}

function connectionPath(start: CanvasPoint, end: CanvasPoint): string {
  const bend = Math.max(80, Math.abs(end.x - start.x) * 0.45)
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
}

function bezierMidpoint(start: CanvasPoint, end: CanvasPoint): CanvasPoint {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
}

function nodeIcon(type: CanvasNodeType) {
  const Icon = nodeTypes.find((item) => item.type === type)?.icon ?? Type
  return <Icon size={15}/>
}

function defaultSubtitle(type: CanvasNodeType): string {
  const subtitles: Record<CanvasNodeType, string> = {
    prompt: '在这里输入你的创意描述...',
    storyboard: '',
    'shot-list': '',
    generator: 'GPT Image 2 · 1024 × 1024',
    compositor: '描述多张参考图需要如何组合...',
    image: '拖入图片，或连接生成节点',
    'reference-folder': '批量管理参考图片',
    note: '记录一个新想法...',
    chat: '开始一段创意对话',
    video: '连接图片或提示词',
    audio: '连接提示词或输入旁白文本',
  }
  return subtitles[type]
}

function defaultColor(type: CanvasNodeType): string {
  const colors: Record<CanvasNodeType, string> = { prompt: '#aaff00', storyboard: '#f59e0b', 'shot-list': '#fbbf24', generator: '#7c5cff', compositor: '#d879ff', image: '#23c8ff', 'reference-folder': '#38bdf8', note: '#ffdb5c', chat: '#fb7185', video: '#f97316', audio: '#14b8a6' }
  return colors[type]
}

function clientToWorld(element: HTMLDivElement | null, viewport: CanvasViewport, clientX: number, clientY: number): CanvasPoint {
  const rect = element?.getBoundingClientRect() ?? { left: 0, top: 0 }
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom,
  }
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files') ||
    Array.from(dataTransfer.items).some((item) => item.kind === 'file')
}

function isSupportedDroppedImage(file: File): boolean {
  return /^image\/(png|jpeg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)
}

function findImageDropTargetNodeId(
  target: EventTarget | null,
  document: CanvasDocument,
): string | null {
  if (!(target instanceof Element)) return null
  const nodeId = target.closest<HTMLElement>('.canvas-node[data-node-id]')?.dataset.nodeId
  if (!nodeId) return null
  return document.nodes.some((node) =>
    node.id === nodeId && (node.type === 'image' || node.type === 'reference-folder'))
    ? nodeId
    : null
}

function screenCenterToWorld(element: HTMLDivElement | null, viewport: CanvasViewport): CanvasPoint {
  const width = element?.clientWidth ?? 1200
  const height = element?.clientHeight ?? 760
  return { x: Math.round((width / 2 - viewport.x) / viewport.zoom - 130), y: Math.round((height / 2 - viewport.y) / viewport.zoom - 90) }
}

function findPromptTextsForSource(document: CanvasDocument, source: CanvasNodeData): ReadonlyArray<string> {
  if (source.type === 'prompt') {
    const prompt = document.nodes.find((node) => node.id === source.id && node.type === 'prompt')
    return prompt?.subtitle?.trim() ? [prompt.subtitle.trim()] : []
  }
  const connectedPrompts = findConnectedPromptTexts(document, source)
  if (connectedPrompts.length > 0) return connectedPrompts
  const fallbackPrompt = document.nodes.find((node) => node.type === 'prompt')
  return fallbackPrompt?.subtitle?.trim() ? [fallbackPrompt.subtitle.trim()] : []
}

function findConnectedPromptTexts(document: CanvasDocument, source: CanvasNodeData): ReadonlyArray<string> {
  const connectedSourceIds = new Set(document.connections
    .filter((connection) => connection.to === source.id)
    .map((connection) => connection.from))
  return document.nodes.flatMap((node): ReadonlyArray<string> => {
    if (!connectedSourceIds.has(node.id)) return []
    if (node.type === 'prompt') return node.subtitle?.trim() ? [node.subtitle.trim()] : []
    if (node.type === 'chat') {
      const reply = [...(node.chatMessages ?? [])].reverse().find((message) => message.role === 'assistant')
      return reply?.content.trim() ? [reply.content.trim()] : []
    }
    if (node.type === 'shot-list' || node.type === 'storyboard') {
      return (node.storyboardShots ?? []).map((shot) => shot.prompt.trim()).filter(Boolean)
    }
    return []
  })
}

function findVideoPromptOptions(
  document: CanvasDocument,
  source: CanvasNodeData,
): ReadonlyArray<ConnectedVideoPrompt> {
  if (source.type !== 'video') return []
  const connectedSourceIds = new Set(document.connections
    .filter((connection) => connection.to === source.id)
    .map((connection) => connection.from))
  return document.nodes.flatMap((node): ReadonlyArray<ConnectedVideoPrompt> => {
    if (!connectedSourceIds.has(node.id)) return []
    if (node.type === 'prompt') {
      const prompt = node.subtitle?.trim()
      return prompt ? [{ id: node.id, label: node.title, prompt }] : []
    }
    if (node.type !== 'shot-list') return []
    return (node.storyboardShots ?? []).flatMap((shot): ReadonlyArray<ConnectedVideoPrompt> => {
      const prompt = shot.prompt.trim()
      return prompt
        ? [{ id: `${node.id}:${shot.id}`, label: `${node.title} · 第 ${shot.index} 镜 · ${shot.title || '未命名'}`, prompt }]
        : []
    })
  })
}

function findReferenceMentionRange(value: string, caret: number): ReferenceMentionRange | null {
  const safeCaret = clamp(caret, 0, value.length)
  if (safeCaret === 0) return null
  const start = value.lastIndexOf('@', safeCaret - 1)
  if (start < 0) return null
  const query = value.slice(start + 1, safeCaret)
  if (/\s|@/.test(query)) return null
  return { start, end: safeCaret, query }
}

function findMentionReferenceImages(
  document: CanvasDocument,
  source: CanvasNodeData,
): ReadonlyArray<ConnectedReferenceImage> {
  if (source.type === 'compositor') return findConnectedReferenceImages(document, source)
  if (source.type !== 'prompt' && source.type !== 'shot-list') return []

  const downstreamIds = new Set(document.connections
    .filter((connection) => connection.from === source.id)
    .map((connection) => connection.to))
  const referenceSets = document.nodes.flatMap((node): ReadonlyArray<ReadonlyArray<ConnectedReferenceImage>> => {
    if (!downstreamIds.has(node.id) || (node.type !== 'generator' && node.type !== 'video')) return []
    const references = findConnectedReferenceImages(document, node)
    return references.length > 0 ? [references] : []
  })
  const primaryReferences = referenceSets[0]
  if (!primaryReferences) return []
  const primaryFileNames = primaryReferences.map((reference) => reference.fileName)
  const hasConflictingOrder = referenceSets.slice(1).some((references) =>
    !sameStringSequence(primaryFileNames, references.map((reference) => reference.fileName)),
  )
  return hasConflictingOrder ? [] : primaryReferences
}

function findReferenceImageFileNames(
  document: CanvasDocument,
  source: CanvasNodeData,
): ReadonlyArray<string> {
  return findConnectedReferenceImages(document, source).map((reference) => reference.fileName)
}

function findConnectedReferenceImages(
  document: CanvasDocument,
  source: CanvasNodeData,
): ReadonlyArray<ConnectedReferenceImage> {
  const connectedImageIds = new Set(document.connections
    .filter((connection) => connection.to === source.id)
    .map((connection) => connection.from))
  const references = document.nodes.flatMap((node): ReadonlyArray<ConnectedReferenceImage> => {
    if (!connectedImageIds.has(node.id)) return []
    if (node.type === 'image') {
      return node.imageFileName
        ? [{ key: `${node.id}:${node.imageFileName}`, fileName: node.imageFileName, sourceNodeId: node.id }]
        : []
    }
    if (node.type !== 'reference-folder') return []
    const connectedFolderImageIds = new Set(document.connections
      .filter((connection) => connection.to === node.id)
      .map((connection) => connection.from))
    const connectedFileNames = document.nodes.flatMap((candidate) =>
      candidate.type === 'image' && connectedFolderImageIds.has(candidate.id) && candidate.imageFileName
        ? [candidate.imageFileName]
        : [],
    )
    return [...(node.imageFileNames ?? []), ...connectedFileNames].map((fileName) => ({
      key: `${node.id}:${fileName}`,
      fileName,
      sourceNodeId: node.id,
    }))
  })
  const uniqueReferences = new Map<string, ConnectedReferenceImage>()
  for (const reference of references) {
    if (!uniqueReferences.has(reference.fileName)) uniqueReferences.set(reference.fileName, reference)
  }
  return [...uniqueReferences.values()].slice(0, 16)
}

function reconcileReferenceMentions(
  previous: CanvasDocument,
  next: CanvasDocument,
): CanvasDocument {
  let nodes = next.nodes
  let changed = false
  for (const target of next.nodes) {
    if (target.type !== 'generator' && target.type !== 'compositor' && target.type !== 'video') continue
    const previousTarget = previous.nodes.find((node) => node.id === target.id)
    const previousFileNames = previousTarget
      ? findReferenceImageFileNames(previous, previousTarget)
      : []
    const nextFileNames = findReferenceImageFileNames(next, target)
    if (sameStringSequence(previousFileNames, nextFileNames)) continue

    const promptSourceIds = new Set(next.connections
      .filter((connection) => connection.to === target.id)
      .map((connection) => connection.from))
    nodes = nodes.map((node) => {
      if (node.id === target.id && node.type === 'compositor') {
        const subtitle = remapReferenceMentions(node.subtitle ?? '', previousFileNames, nextFileNames)
        if (subtitle !== (node.subtitle ?? '')) {
          changed = true
          return { ...node, subtitle }
        }
      }
      if (!promptSourceIds.has(node.id)) return node
      if (node.type === 'prompt') {
        const subtitle = remapReferenceMentions(node.subtitle ?? '', previousFileNames, nextFileNames)
        if (subtitle !== (node.subtitle ?? '')) {
          changed = true
          return { ...node, subtitle }
        }
      }
      if (node.type === 'shot-list') {
        const storyboardShots = (node.storyboardShots ?? []).map((shot) => ({
          ...shot,
          prompt: remapReferenceMentions(shot.prompt, previousFileNames, nextFileNames),
        }))
        if (storyboardShots.some((shot, index) => shot.prompt !== node.storyboardShots?.[index]?.prompt)) {
          changed = true
          return { ...node, storyboardShots }
        }
      }
      return node
    })
  }
  return changed ? { ...next, nodes } : next
}

function remapReferenceMentions(
  prompt: string,
  previousFileNames: ReadonlyArray<string>,
  nextFileNames: ReadonlyArray<string>,
): string {
  return prompt.replace(/@参考图\s*(\d+)/g, (mention, rawIndex: string) => {
    const previousFileName = previousFileNames[Number(rawIndex) - 1]
    if (!previousFileName) return mention
    const nextIndex = nextFileNames.indexOf(previousFileName)
    return nextIndex >= 0 ? `@参考图${nextIndex + 1}` : ''
  }).replace(/[ \t]{2,}/g, ' ')
}

function sameStringSequence(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isQueuedGenerationTask(document: CanvasDocument, task: PendingGenerationTask): boolean {
  return document.id === task.documentId && document.nodes.some((node) =>
    node.id === task.nodeId && node.generationStatus === 'queued',
  )
}

function countActiveGenerationTasks(document: CanvasDocument, sourceNodeId: string): number {
  const targetIds = new Set(document.connections
    .filter((connection) => connection.from === sourceNodeId)
    .map((connection) => connection.to))
  return document.nodes.filter((node) =>
    targetIds.has(node.id) &&
    (node.generationStatus === 'queued' || node.generationStatus === 'generating'),
  ).length
}

function findGenerationNodePositions(
  document: CanvasDocument,
  source: CanvasNodeData,
  count: number,
): ReadonlyArray<CanvasPoint> {
  const resultDimensions = nodeDimensions({ id: 'result-template', type: 'image', title: '', x: 0, y: 0 })
  const occupied = document.nodes.map((node) => ({ ...nodeDimensions(node), x: node.x, y: node.y }))
  const positions: CanvasPoint[] = []
  const originX = source.x + nodeDimensions(source).width + 78
  const verticalStep = resultDimensions.height + 36
  const horizontalStep = resultDimensions.width + 78

  for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
    let position: CanvasPoint | null = null
    for (let column = 0; column < 8 && !position; column += 1) {
      for (let slot = 0; slot < 40; slot += 1) {
        const distance = Math.ceil(slot / 2) * verticalStep
        const direction = slot === 0 || slot % 2 === 1 ? 1 : -1
        const candidate = {
          x: Math.round(originX + column * horizontalStep),
          y: Math.round(source.y + distance * direction),
        }
        const candidateBounds = { ...candidate, ...resultDimensions }
        if (!occupied.some((bounds) => rectanglesOverlap(candidateBounds, bounds, 24))) {
          position = candidate
          occupied.push(candidateBounds)
          break
        }
      }
    }
    const fallback = position ?? {
      x: Math.round(originX + (itemIndex + 1) * horizontalStep),
      y: Math.round(source.y),
    }
    if (!position) occupied.push({ ...fallback, ...resultDimensions })
    positions.push(fallback)
  }
  return [...positions].sort((left, right) => left.y - right.y || left.x - right.x)
}

function rectanglesOverlap(
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
  padding: number,
): boolean {
  return left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y
}

function generationElapsedSeconds(startedAt: string | undefined, now: number): number {
  if (!startedAt || !Number.isFinite(now)) return 0
  const started = Date.parse(startedAt)
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0
}

function formatImageSize(size: ImageGenerationSize): string {
  return size === 'auto' ? '自动尺寸' : size.replace('x', ' × ')
}

function downloadGeneratedImage(dataUrl: string, title: string): void {
  const link = window.document.createElement('a')
  link.href = dataUrl
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Draw Canvas 图片'}.png`
  link.click()
}

function topologicalNodeIds(document: CanvasDocument): ReadonlyArray<string> {
  const nodeIds = new Set(document.nodes.map((node) => node.id))
  const incomingCount = new Map(document.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(document.nodes.map((node) => [node.id, [] as string[]]))
  for (const connection of document.connections) {
    if (!nodeIds.has(connection.from) || !nodeIds.has(connection.to)) continue
    incomingCount.set(connection.to, (incomingCount.get(connection.to) ?? 0) + 1)
    outgoing.get(connection.from)?.push(connection.to)
  }
  const queue = document.nodes.filter((node) => incomingCount.get(node.id) === 0).map((node) => node.id)
  const result: string[] = []
  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (!nodeId) continue
    result.push(nodeId)
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const nextCount = (incomingCount.get(targetId) ?? 1) - 1
      incomingCount.set(targetId, nextCount)
      if (nextCount === 0) queue.push(targetId)
    }
  }
  return result.length === document.nodes.length
    ? result
    : [...result, ...document.nodes.map((node) => node.id).filter((nodeId) => !result.includes(nodeId))]
}

function workflowFailureMessage(type: CanvasNodeType): string {
  const messages: Readonly<Record<CanvasNodeType, string>> = {
    prompt: '提示词为空',
    storyboard: '分镜生成失败',
    'shot-list': '分镜节点没有可用提示词',
    generator: '图片生成失败',
    compositor: '图片合成失败',
    image: '图片资源不可用',
    'reference-folder': '参考图文件夹为空',
    note: '便签节点执行失败',
    chat: 'AI 对话失败',
    video: '视频生成失败',
    audio: '语音生成失败',
  }
  return messages[type]
}

function workflowStatusLabel(status: NonNullable<CanvasNodeData['workflowStatus']>): string {
  switch (status) {
    case 'idle': return '待执行'
    case 'running': return '执行中'
    case 'succeeded': return '成功'
    case 'failed': return '失败'
    case 'skipped': return '已跳过'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
