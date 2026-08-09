import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
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
  Sparkles,
  StickyNote,
  Type,
  Undo2,
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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import type {
  CanvasDocument,
  CanvasNodeData,
  CanvasNodeType,
  CanvasViewport,
  GenerateImageRequest,
  GeneratedImageResult,
  ImageGenerationSize,
} from '../../../shared/contracts/desktop'
import { DEFAULT_IMAGE_MODEL_KEY } from '../../../shared/domain/models'
import {
  arrangeSelection,
  canConnect,
  duplicateSelection,
  graphBounds,
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

type InfiniteCanvasProps = Readonly<{
  document: CanvasDocument
  defaultImageModelKey: string
  imageModels: ReadonlyArray<CanvasImageModelOption>
  onChange: (document: CanvasDocument) => void
  onClose: () => void
  onGenerateImage: (request: GenerateImageRequest) => Promise<GeneratedImageResult | null>
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
  clientX: number
  clientY: number
  world: CanvasPoint
}>

const HISTORY_LIMIT = 30

const nodeTypes: ReadonlyArray<Readonly<{ type: CanvasNodeType; label: string; description: string; icon: typeof Type }>> = [
  { type: 'prompt', label: '提示词', description: '编写图像生成提示词', icon: Type },
  { type: 'generator', label: '图像生成', description: '调用图像模型生成内容', icon: WandSparkles },
  { type: 'image', label: '图片', description: '添加或预览图片素材', icon: ImageIcon },
  { type: 'chat', label: 'AI 对话', description: '与模型讨论创意方向', icon: MessageSquare },
  { type: 'note', label: '便签', description: '记录灵感与待办事项', icon: StickyNote },
  { type: 'video', label: '视频', description: '添加视频生成节点', icon: Video },
]

export function createInitialCanvas(
  name = '未命名画布',
  prompt?: string,
  defaultImageModelKey = DEFAULT_IMAGE_MODEL_KEY,
  defaultImageModelName = 'GPT Image 2',
): CanvasDocument {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
    viewport: { x: 90, y: 55, zoom: 0.9 },
    connections: [{ id: 'c1', from: 'prompt-1', to: 'generator-1' }],
    nodes: [
      { id: 'prompt-1', type: 'prompt', title: '创意提示词', subtitle: prompt ?? '未来主义建筑漂浮在云层之上，清晨金色光线，电影感构图', x: 90, y: 135, color: '#aaff00' },
      { id: 'generator-1', type: 'generator', title: '图像生成', subtitle: `${defaultImageModelName} · 1024 × 1024`, modelKey: defaultImageModelKey, imageSize: '1024x1024', x: 440, y: 225, color: '#7c5cff' },
      { id: 'note-1', type: 'note', title: '方向备注', subtitle: '尝试增加云海层次，保留画面中央的视觉焦点。', x: 470, y: 500, color: '#ffdb5c' },
    ],
  }
}

export function InfiniteCanvas({ defaultImageModelKey, document, imageModels, onChange, onClose, onGenerateImage, onLoadImage, onOpen, onSave, notify }: InfiniteCanvasProps) {
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
  const [selectedIds, setSelectedIdsState] = useState<ReadonlySet<string>>(() => new Set(['generator-1']))
  const [selectedConnectionId, setSelectedConnectionIdState] = useState<string | null>(null)
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [drag, setDragState] = useState<DragState | null>(null)
  const [savedAt, setSavedAt] = useState('刚刚')
  const [generatingNodeIds, setGeneratingNodeIds] = useState<ReadonlySet<string>>(() => new Set())
  const [, setHistoryRevision] = useState(0)
  documentRef.current = document

  useEffect(() => {
    setSelectedIds(new Set(document.nodes.some((node) => node.id === 'generator-1') ? ['generator-1'] : []))
    setSelectedConnectionId(null)
    undoStackRef.current = []
    redoStackRef.current = []
    setHistoryRevision((revision) => revision + 1)
  }, [document.id])

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

  function emitDocument(next: CanvasDocument): void {
    documentRef.current = next
    onChange(next)
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
    emitDocument(restoreGraph(documentRef.current, snapshot))
    clearSelection()
    setHistoryRevision((revision) => revision + 1)
  }

  function redo(): void {
    const snapshot = redoStackRef.current.at(-1)
    if (!snapshot) return
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, snapshotGraph(documentRef.current)].slice(-HISTORY_LIMIT)
    emitDocument(restoreGraph(documentRef.current, snapshot))
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
    if (link.side === 'output' && source?.type === 'generator') {
      const resultNode = createNodeData('image', documentRef.current, link.currentWorld, defaultImageModelKey, imageModels)
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
    const node = createNodeData(type, current, position ?? screenCenterToWorld(canvasRef.current, current.viewport), defaultImageModelKey, imageModels)
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
    pushUndo()
    emitDocument(removeSelection(documentRef.current, ids))
    setSelectedIds(new Set())
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
    if ((event.target as HTMLElement).closest('.canvas-node')) {
      setContextMenu(null)
      return
    }
    const world = clientToWorld(canvasRef.current, documentRef.current.viewport, event.clientX, event.clientY)
    const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const menuLeft = clamp(event.clientX - rect.left, 8, Math.max(8, (canvasRef.current?.clientWidth ?? 1200) - 253))
    const menuTop = clamp(event.clientY - rect.top, 8, Math.max(8, (canvasRef.current?.clientHeight ?? 760) - 320))
    lastPointerWorldRef.current = world
    setAddMenuOpen(false)
    setContextMenu({ clientX: menuLeft, clientY: menuTop, world })
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

  async function generateImage(source: CanvasNodeData): Promise<void> {
    if (generatingNodeIds.has(source.id)) return
    const current = documentRef.current
    const promptNode = findPromptForSource(current, source)
    const prompt = promptNode?.subtitle?.trim() ?? ''
    if (!prompt) {
      notify('请先在提示词节点中输入图片描述')
      return
    }
    const modelKey = source.type === 'generator' ? source.modelKey ?? defaultImageModelKey : defaultImageModelKey
    const size = source.type === 'generator' ? source.imageSize ?? '1024x1024' : '1024x1024'

    setGeneratingNodeIds((ids) => new Set(ids).add(source.id))
    try {
      const result = await onGenerateImage({ prompt, modelKey, size })
      if (!result?.artwork.imageFileName) return
      const latest = documentRef.current
      const latestSource = latest.nodes.find((node) => node.id === source.id) ?? source
      const resultCount = latest.nodes.filter((node) => node.type === 'image').length
      const node: CanvasNodeData = {
        id: `image-${result.artwork.id}`,
        type: 'image',
        title: `生成结果 ${resultCount + 1}`,
        subtitle: prompt.slice(0, 80),
        imageFileName: result.artwork.imageFileName,
        modelKey: result.artwork.modelKey,
        imageSize: size,
        x: latestSource.x + nodeDimensions(latestSource).width + 78,
        y: latestSource.y + resultCount * 24,
        color: '#23c8ff',
      }
      pushUndo()
      const nextDocument: CanvasDocument = {
        ...latest,
        nodes: [...latest.nodes, node],
        connections: [...latest.connections, { id: `connection-${crypto.randomUUID()}`, from: latestSource.id, to: node.id }],
        updatedAt: new Date().toISOString(),
      }
      emitDocument(nextDocument)
      setSelectedIds(new Set([node.id]))
      notify('图片已生成并保存到本地图片库')
    } catch {
      notify('图片生成失败，请检查模型配置和网络后重试')
    } finally {
      setGeneratingNodeIds((ids) => {
        const next = new Set(ids)
        next.delete(source.id)
        return next
      })
    }
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
          <button className="canvas-primary-button" onClick={() => notify('分享链接已复制（演示）')} type="button"><Link2 size={16}/> 分享</button>
        </div>
      </header>

      <div className="canvas-stage-wrap">
        <div
          className={tool === 'hand' || drag?.kind === 'pan' ? 'canvas-stage is-panning' : drag?.kind === 'selection' ? 'canvas-stage is-selecting' : 'canvas-stage'}
          onContextMenu={onContextMenu}
          onDoubleClick={onDoubleClick}
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
                defaultImageModelKey={defaultImageModelKey}
                generating={generatingNodeIds.has(node.id)}
                imageModels={imageModels}
                node={node}
                onDelete={() => deleteNodes(selectedIdsRef.current.has(node.id) ? selectedIdsRef.current : new Set([node.id]))}
                onGenerate={() => void generateImage(node)}
                onLoadImage={onLoadImage}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onPortPointerDown={(event, side) => onPortPointerDown(event, node.id, side)}
                onResizePointerDown={(event) => onResizePointerDown(event, node)}
                onUpdate={(patch) => updateNode(node.id, patch)}
                selected={selectedIds.has(node.id)}
              />
            ))}
          </div>
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
          <button onClick={() => notify('快捷键：拖动端口连接；Alt 拖动复制；⌘/Ctrl+C/V 复制粘贴；Delete 删除')} title="帮助" type="button"><CircleHelp size={18}/></button>
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
        <div className="canvas-hint">滚轮缩放 · 空白拖动框选 · Space/中键拖动画布 · 端口拖动连线 · Alt 拖动复制</div>

        {contextMenu && (
          <div className="canvas-context-menu" style={{ left: contextMenu.clientX, top: contextMenu.clientY }}>
            <NodeMenu onAdd={(type) => addNode(type, contextMenu.world)} />
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
  defaultImageModelKey: string
  generating: boolean
  imageModels: ReadonlyArray<CanvasImageModelOption>
  node: CanvasNodeData
  selected: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPortPointerDown: (event: ReactPointerEvent<HTMLElement>, side: 'input' | 'output') => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  onGenerate: () => void
  onLoadImage: (fileName: string) => Promise<string | null>
  onDelete: () => void
}>

function CanvasNode({ defaultImageModelKey, generating, imageModels, node, selected, onPointerDown, onPortPointerDown, onResizePointerDown, onUpdate, onGenerate, onLoadImage, onDelete }: CanvasNodeProps) {
  const selectedModelKey = node.modelKey ?? defaultImageModelKey
  const selectedModel = imageModels.find((model) => model.key === selectedModelKey)
  return (
    <article
      className={`canvas-node node-${node.type}${selected ? ' is-selected' : ''}`}
      data-node-id={node.id}
      onPointerDown={onPointerDown}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height, '--node-color': node.color ?? '#aaff00' } as CSSProperties}
    >
      <span className="node-input-port" data-node-id={node.id} data-port="input" onPointerDown={(event) => onPortPointerDown(event, 'input')} />
      <span className="node-output-port" data-node-id={node.id} data-port="output" onPointerDown={(event) => onPortPointerDown(event, 'output')} />
      <header><span className="node-header-icon">{nodeIcon(node.type)}</span><input aria-label="节点标题" onChange={(event) => onUpdate({ title: event.target.value })} value={node.title}/><button onClick={onDelete} title="删除节点" type="button"><X size={14}/></button></header>
      {node.type === 'prompt' && (
        <div className="prompt-node-body">
          <textarea aria-label="提示词" onChange={(event) => onUpdate({ subtitle: event.target.value })} value={node.subtitle ?? ''}/>
          <div>
            <span>{node.subtitle?.length ?? 0} 字</span>
            <button disabled={generating} onClick={onGenerate} type="button">
              {generating ? <LoaderCircle className="is-spinning" size={13}/> : <Sparkles size={13}/>} {generating ? '生成中' : '默认模型生成'}
            </button>
          </div>
        </div>
      )}
      {node.type === 'generator' && (
        <div className="generator-node-body">
          <label>
            模型
            <select
              onChange={(event) => {
                const model = imageModels.find((item) => item.key === event.target.value)
                onUpdate({ modelKey: event.target.value, subtitle: `${model?.label ?? '图片模型'} · ${formatImageSize(node.imageSize ?? '1024x1024')}` })
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
                  onUpdate({ imageSize, subtitle: `${selectedModel?.label ?? '图片模型'} · ${formatImageSize(imageSize)}` })
                }}
                value={node.imageSize ?? '1024x1024'}
              >
                <option value="1024x1024">1:1 · 1024</option>
                <option value="1536x1024">3:2 · 横向</option>
                <option value="1024x1536">2:3 · 纵向</option>
              </select>
            </label>
            <label>数量<select disabled value="1"><option value="1">1 张</option></select></label>
          </div>
          <button className="generate-button" disabled={generating || imageModels.length === 0} onClick={onGenerate} type="button">
            {generating ? <LoaderCircle className="is-spinning" size={14}/> : <Play fill="currentColor" size={14}/>} {generating ? '生成中...' : '生成图片'}
          </button>
        </div>
      )}
      {node.type === 'image' && <CanvasImageNode node={node} onLoadImage={onLoadImage}/>}
      {node.type === 'note' && <textarea aria-label="便签内容" className="note-node-body" onChange={(event) => onUpdate({ subtitle: event.target.value })} value={node.subtitle ?? ''}/>} 
      {node.type === 'chat' && <div className="chat-node-body"><div><Bot size={16}/><span>告诉我你想探索的创意方向</span></div><input placeholder="输入消息..." /></div>}
      {node.type === 'video' && <div className="video-node-body"><Video size={24}/><span>连接图片或提示词以生成视频</span><button type="button">选择模型</button></div>}
      <span className="node-resize-handle" onPointerDown={onResizePointerDown}/>
    </article>
  )
}

function CanvasImageNode({ node, onLoadImage }: Readonly<{
  node: CanvasNodeData
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

  return (
    <div className="image-node-body">
      <div className={`generated-art${node.imageFileName ? ' has-image' : ''}`}>
        {imageUrl
          ? <img alt={node.title} draggable={false} src={imageUrl}/>
          : node.imageFileName
            ? <div className="generated-art-status">{loadFailed ? <ImageIcon size={22}/> : <LoaderCircle className="is-spinning" size={22}/>}<span>{loadFailed ? '图片无法读取' : '正在载入图片'}</span></div>
            : <><span>AI</span><i/><b>DRAW CANVAS</b></>}
      </div>
      <div className="image-node-meta">
        <span>{node.subtitle}</span>
        <button disabled={!imageUrl} onClick={() => imageUrl && downloadGeneratedImage(imageUrl, node.title)} title="导出" type="button"><Download size={15}/></button>
      </div>
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
  imageModels: ReadonlyArray<CanvasImageModelOption>,
): CanvasNodeData {
  const count = document.nodes.filter((node) => node.type === type).length + 1
  const labels: Record<CanvasNodeType, string> = { prompt: '创意提示词', generator: '图像生成', image: '图片素材', note: '新便签', chat: 'AI 对话', video: '视频生成' }
  const defaultImageModelName = imageModels.find((model) => model.key === defaultImageModelKey)?.label ?? '默认图片模型'
  return {
    id: `${type}-${crypto.randomUUID()}`,
    type,
    title: `${labels[type]} ${count}`,
    subtitle: type === 'generator' ? `${defaultImageModelName} · 1024 × 1024` : defaultSubtitle(type),
    ...(type === 'generator' ? { modelKey: defaultImageModelKey, imageSize: '1024x1024' as const } : {}),
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
    generator: 'GPT Image 2 · 1024 × 1024',
    image: '拖入图片，或连接生成节点',
    note: '记录一个新想法...',
    chat: '开始一段创意对话',
    video: '连接图片或提示词',
  }
  return subtitles[type]
}

function defaultColor(type: CanvasNodeType): string {
  const colors: Record<CanvasNodeType, string> = { prompt: '#aaff00', generator: '#7c5cff', image: '#23c8ff', note: '#ffdb5c', chat: '#fb7185', video: '#f97316' }
  return colors[type]
}

function clientToWorld(element: HTMLDivElement | null, viewport: CanvasViewport, clientX: number, clientY: number): CanvasPoint {
  const rect = element?.getBoundingClientRect() ?? { left: 0, top: 0 }
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom,
  }
}

function screenCenterToWorld(element: HTMLDivElement | null, viewport: CanvasViewport): CanvasPoint {
  const width = element?.clientWidth ?? 1200
  const height = element?.clientHeight ?? 760
  return { x: Math.round((width / 2 - viewport.x) / viewport.zoom - 130), y: Math.round((height / 2 - viewport.y) / viewport.zoom - 90) }
}

function findPromptForSource(document: CanvasDocument, source: CanvasNodeData): CanvasNodeData | undefined {
  if (source.type === 'prompt') return document.nodes.find((node) => node.id === source.id)
  const connectedPromptIds = document.connections.filter((connection) => connection.to === source.id).map((connection) => connection.from)
  return document.nodes.find((node) => node.type === 'prompt' && connectedPromptIds.includes(node.id))
    ?? document.nodes.find((node) => node.type === 'prompt')
}

function formatImageSize(size: ImageGenerationSize): string {
  return size.replace('x', ' × ')
}

function downloadGeneratedImage(dataUrl: string, title: string): void {
  const link = window.document.createElement('a')
  link.href = dataUrl
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Draw Canvas 图片'}.png`
  link.click()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
