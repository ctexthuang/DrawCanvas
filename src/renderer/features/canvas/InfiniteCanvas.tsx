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
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import type { CanvasDocument, CanvasNodeData, CanvasNodeType, CanvasViewport, GeneratedArtwork } from '../../../shared/contracts/desktop'

type InfiniteCanvasProps = Readonly<{
  document: CanvasDocument
  onChange: (document: CanvasDocument) => void
  onClose: () => void
  onGenerated: (artwork: GeneratedArtwork) => void
  onOpen: () => void
  onSave: () => void
  notify: (message: string) => void
}>

type DragState =
  | Readonly<{ kind: 'pan'; startX: number; startY: number; originX: number; originY: number }>
  | Readonly<{ kind: 'node'; nodeId: string; startX: number; startY: number; originX: number; originY: number }>

const nodeTypes: ReadonlyArray<Readonly<{ type: CanvasNodeType; label: string; description: string; icon: typeof Type }>> = [
  { type: 'prompt', label: '提示词', description: '编写图像生成提示词', icon: Type },
  { type: 'generator', label: '图像生成', description: '调用图像模型生成内容', icon: WandSparkles },
  { type: 'image', label: '图片', description: '添加或预览图片素材', icon: ImageIcon },
  { type: 'chat', label: 'AI 对话', description: '与模型讨论创意方向', icon: MessageSquare },
  { type: 'note', label: '便签', description: '记录灵感与待办事项', icon: StickyNote },
  { type: 'video', label: '视频', description: '添加视频生成节点', icon: Video },
]

export function createInitialCanvas(name = '未命名画布', prompt?: string): CanvasDocument {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
    viewport: { x: 90, y: 55, zoom: 0.9 },
    connections: [
      { id: 'c1', from: 'prompt-1', to: 'generator-1' },
      { id: 'c2', from: 'generator-1', to: 'image-1' },
    ],
    nodes: [
      { id: 'prompt-1', type: 'prompt', title: '创意提示词', subtitle: prompt ?? '未来主义建筑漂浮在云层之上，清晨金色光线，电影感构图', x: 90, y: 135, color: '#aaff00' },
      { id: 'generator-1', type: 'generator', title: '图像生成', subtitle: 'Seedream 5.0 Pro · 2048 × 2048', x: 440, y: 225, color: '#7c5cff' },
      { id: 'image-1', type: 'image', title: '生成结果 01', subtitle: '已完成 · 18.4 秒', x: 800, y: 110, color: '#23c8ff' },
      { id: 'note-1', type: 'note', title: '方向备注', subtitle: '尝试增加云海层次，保留画面中央的视觉焦点。', x: 470, y: 500, color: '#ffdb5c' },
    ],
  }
}

export function InfiniteCanvas({ document, onChange, onClose, onGenerated, onOpen, onSave, notify }: InfiniteCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>('generator-1')
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [savedAt, setSavedAt] = useState('刚刚')

  useEffect(() => {
    const timer = window.setTimeout(() => setSavedAt('刚刚'), 900)
    return () => window.clearTimeout(timer)
  }, [document.updatedAt])

  const selectedNode = document.nodes.find((node) => node.id === selectedId)
  const zoomPercent = Math.round(document.viewport.zoom * 100)
  const worldStyle = {
    transform: `translate(${document.viewport.x}px, ${document.viewport.y}px) scale(${document.viewport.zoom})`,
  } satisfies CSSProperties

  function updateViewport(viewport: CanvasViewport): void {
    onChange({ ...document, viewport, updatedAt: new Date().toISOString() })
  }

  function updateNode(nodeId: string, patch: Partial<CanvasNodeData>): void {
    onChange({
      ...document,
      nodes: document.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
      updatedAt: new Date().toISOString(),
    })
  }

  function onCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 && event.button !== 1) return
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('canvas-grid')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(null)
    setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, originX: document.viewport.x, originY: document.viewport.y })
  }

  function onNodePointerDown(event: ReactPointerEvent<HTMLElement>, node: CanvasNodeData): void {
    if ((event.target as HTMLElement).closest('button, input, textarea, select')) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(node.id)
    if (tool === 'hand') {
      setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, originX: document.viewport.x, originY: document.viewport.y })
      return
    }
    setDrag({ kind: 'node', nodeId: node.id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y })
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag) return
    if (drag.kind === 'pan') {
      updateViewport({ ...document.viewport, x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY })
    } else {
      updateNode(drag.nodeId, {
        x: Math.round(drag.originX + (event.clientX - drag.startX) / document.viewport.zoom),
        y: Math.round(drag.originY + (event.clientY - drag.startY) / document.viewport.zoom),
      })
    }
  }

  function onWheel(event: WheelEvent<HTMLDivElement>): void {
    if (!canvasRef.current) return
    event.preventDefault()
    if (!event.ctrlKey && !event.metaKey) {
      updateViewport({ ...document.viewport, x: document.viewport.x - event.deltaX, y: document.viewport.y - event.deltaY })
      return
    }
    const rect = canvasRef.current.getBoundingClientRect()
    const pointX = event.clientX - rect.left
    const pointY = event.clientY - rect.top
    const nextZoom = clamp(document.viewport.zoom * Math.exp(-event.deltaY * 0.002), 0.3, 2)
    const scale = nextZoom / document.viewport.zoom
    updateViewport({
      zoom: nextZoom,
      x: pointX - (pointX - document.viewport.x) * scale,
      y: pointY - (pointY - document.viewport.y) * scale,
    })
  }

  function setZoom(zoom: number): void {
    updateViewport({ ...document.viewport, zoom: clamp(zoom, 0.3, 2) })
  }

  function addNode(type: CanvasNodeType): void {
    const count = document.nodes.filter((node) => node.type === type).length + 1
    const id = `${type}-${Date.now()}`
    const position = screenCenterToWorld(canvasRef.current, document.viewport)
    const labels: Record<CanvasNodeType, string> = { prompt: '创意提示词', generator: '图像生成', image: '图片素材', note: '新便签', chat: 'AI 对话', video: '视频生成' }
    const node: CanvasNodeData = { id, type, title: `${labels[type]} ${count}`, subtitle: defaultSubtitle(type), x: position.x, y: position.y, color: defaultColor(type) }
    onChange({ ...document, nodes: [...document.nodes, node], updatedAt: new Date().toISOString() })
    setSelectedId(id)
    setAddMenuOpen(false)
    notify(`已添加${labels[type]}节点`)
  }

  function deleteSelected(): void {
    if (!selectedId) return
    onChange({
      ...document,
      nodes: document.nodes.filter((node) => node.id !== selectedId),
      connections: document.connections.filter((connection) => connection.from !== selectedId && connection.to !== selectedId),
      updatedAt: new Date().toISOString(),
    })
    setSelectedId(null)
  }

  function generateImage(source: CanvasNodeData): void {
    const promptNode = document.nodes.find((node) => node.type === 'prompt')
    const id = `image-${Date.now()}`
    const node: CanvasNodeData = {
      id,
      type: 'image',
      title: `生成结果 ${document.nodes.filter((item) => item.type === 'image').length + 1}`,
      subtitle: promptNode?.subtitle?.slice(0, 42) ?? 'AI 生成图片',
      x: source.x + 350,
      y: source.y + 20,
      color: '#23c8ff',
    }
    onChange({
      ...document,
      nodes: [...document.nodes, node],
      connections: [...document.connections, { id: `connection-${Date.now()}`, from: source.id, to: id }],
      updatedAt: new Date().toISOString(),
    })
    const palettes = [
      'linear-gradient(145deg, #1d2941 0%, #734fc1 42%, #ef617a 71%, #ffc06f 100%)',
      'radial-gradient(circle at 45% 35%, #9deaff 0 8%, #2869b7 24%, #0b1c46 58%, #030914 100%)',
      'linear-gradient(155deg, #20342b 0%, #64785b 42%, #d19b57 66%, #392d27 100%)',
    ]
    onGenerated({
      id,
      title: node.title,
      prompt: promptNode?.subtitle ?? 'AI 生成图片',
      model: 'Seedream 5.0 Pro',
      size: '2048 × 2048',
      createdAt: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      palette: palettes[document.nodes.filter((item) => item.type === 'image').length % palettes.length] ?? palettes[0]!,
      tags: ['画布生成', 'AI'],
    })
    setSelectedId(id)
    notify('生成任务已完成（演示数据）')
  }

  return (
    <div className="canvas-workspace">
      <header className="canvas-topbar">
        <div className="canvas-topbar-left">
          <button className="canvas-icon-button" onClick={onClose} title="返回文件" type="button"><ArrowLeft size={18}/></button>
          <div className="canvas-brand"><span>DC</span><strong>Draw Canvas</strong></div>
          <i className="topbar-divider" />
          <input aria-label="画布名称" className="canvas-name" onChange={(event) => onChange({ ...document, name: event.target.value, updatedAt: new Date().toISOString() })} value={document.name}/>
          <span className="autosave-status"><Check size={13}/> 已自动保存 · {savedAt}</span>
        </div>
        <div className="canvas-topbar-actions">
          <button className="canvas-text-button" onClick={onOpen} type="button">打开</button>
          <button className="canvas-icon-button" title="撤销" type="button"><Undo2 size={17}/></button>
          <button className="canvas-icon-button" title="重做" type="button"><Redo2 size={17}/></button>
          <button className="canvas-text-button" onClick={onSave} type="button"><Save size={16}/> 保存文件</button>
          <button className="canvas-primary-button" onClick={() => notify('分享链接已复制（演示）')} type="button"><Link2 size={16}/> 分享</button>
        </div>
      </header>

      <div className="canvas-stage-wrap">
        <div
          className={tool === 'hand' || drag?.kind === 'pan' ? 'canvas-stage is-panning' : 'canvas-stage'}
          onDoubleClick={() => addNode('note')}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
          onWheel={onWheel}
          ref={canvasRef}
        >
          <div className="canvas-grid" />
          <div className="canvas-world" style={worldStyle}>
            <CanvasConnections document={document} />
            {document.nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                onDelete={deleteSelected}
                onGenerate={() => generateImage(node)}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onUpdate={(patch) => updateNode(node.id, patch)}
                selected={selectedId === node.id}
              />
            ))}
          </div>
        </div>

        <div className="canvas-toolbar">
          <button className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')} title="选择" type="button"><MousePointer2 size={18}/></button>
          <button className={tool === 'hand' ? 'is-active' : ''} onClick={() => setTool('hand')} title="抓手" type="button"><Hand size={18}/></button>
          <i />
          <div className="add-node-wrap">
            <button className={addMenuOpen ? 'add-node-trigger is-active' : 'add-node-trigger'} onClick={() => setAddMenuOpen(!addMenuOpen)} type="button"><Plus size={18}/><span>添加节点</span><ChevronDown size={14}/></button>
            {addMenuOpen && <div className="add-node-menu"><strong>添加节点</strong>{nodeTypes.map(({ type, label, description, icon: Icon }) => <button key={type} onClick={() => addNode(type)} type="button"><span className={`node-type-icon type-${type}`}><Icon size={17}/></span><span><b>{label}</b><small>{description}</small></span></button>)}</div>}
          </div>
          <i />
          <button title="框架" type="button"><LayoutGrid size={18}/></button>
          <button title="帮助" type="button"><CircleHelp size={18}/></button>
        </div>

        <div className="canvas-view-controls">
          <button onClick={() => setZoom(document.viewport.zoom - 0.1)} type="button"><Minus size={15}/></button>
          <button className="zoom-label" onClick={() => setZoom(1)} type="button">{zoomPercent}%</button>
          <button onClick={() => setZoom(document.viewport.zoom + 0.1)} type="button"><Plus size={15}/></button>
          <i />
          <button onClick={() => updateViewport({ x: 90, y: 55, zoom: 0.9 })} title="适应画布" type="button"><Maximize2 size={16}/></button>
          <button title="属性面板" type="button"><PanelRight size={16}/></button>
        </div>

        <div className="canvas-minimap">
          <div className="minimap-world">{document.nodes.map((node) => <span key={node.id} style={{ left: `${clamp(node.x / 12, 4, 142)}px`, top: `${clamp(node.y / 9, 4, 82)}px`, background: node.color }}/>)}</div>
          <i />
        </div>
        <div className="canvas-hint">双击空白处添加便签 · 按住 Ctrl/⌘ 滚动缩放</div>
      </div>
    </div>
  )
}

function CanvasConnections({ document }: Readonly<{ document: CanvasDocument }>) {
  const paths = useMemo(() => document.connections.map((connection) => {
    const from = document.nodes.find((node) => node.id === connection.from)
    const to = document.nodes.find((node) => node.id === connection.to)
    if (!from || !to) return null
    const fromWidth = from.type === 'image' ? 292 : 272
    const fromHeight = nodeHeight(from.type)
    const toHeight = nodeHeight(to.type)
    const startX = from.x + fromWidth
    const startY = from.y + fromHeight / 2
    const endX = to.x
    const endY = to.y + toHeight / 2
    const bend = Math.max(80, Math.abs(endX - startX) * 0.45)
    return <g key={connection.id}><path className="connection-shadow" d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}/><path className="connection-line" d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}/><circle cx={startX} cy={startY} r="5"/><circle cx={endX} cy={endY} r="5"/></g>
  }), [document.connections, document.nodes])
  return <svg className="connections-layer" height="1800" width="2600">{paths}</svg>
}

type CanvasNodeProps = Readonly<{
  node: CanvasNodeData
  selected: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onUpdate: (patch: Partial<CanvasNodeData>) => void
  onGenerate: () => void
  onDelete: () => void
}>

function CanvasNode({ node, selected, onPointerDown, onUpdate, onGenerate, onDelete }: CanvasNodeProps) {
  return (
    <article
      className={`canvas-node node-${node.type}${selected ? ' is-selected' : ''}`}
      onPointerDown={onPointerDown}
      style={{ left: node.x, top: node.y, '--node-color': node.color ?? '#aaff00' } as CSSProperties}
    >
      <span className="node-input-port" />
      <span className="node-output-port" />
      <header><span className="node-header-icon">{nodeIcon(node.type)}</span><input aria-label="节点标题" onChange={(event) => onUpdate({ title: event.target.value })} value={node.title}/><button onClick={onDelete} title="删除节点" type="button"><X size={14}/></button></header>
      {node.type === 'prompt' && <div className="prompt-node-body"><textarea aria-label="提示词" onChange={(event) => onUpdate({ subtitle: event.target.value })} value={node.subtitle ?? ''}/><div><span>124 字</span><button type="button"><Sparkles size={13}/> 优化提示词</button></div></div>}
      {node.type === 'generator' && <div className="generator-node-body"><label>模型<select defaultValue="seedream"><option value="seedream">Seedream 5.0 Pro</option><option>Gemini 3 Pro Image</option><option>GPT Image 2</option></select></label><div className="generator-fields"><label>比例<select defaultValue="1:1"><option>1:1</option><option>4:3</option><option>16:9</option></select></label><label>数量<select defaultValue="1"><option>1</option><option>2</option><option>4</option></select></label></div><button className="generate-button" onClick={onGenerate} type="button"><Play fill="currentColor" size={14}/> 生成图片</button></div>}
      {node.type === 'image' && <div className="image-node-body"><div className="generated-art"><span>AI</span><i/><b>DRAW CANVAS</b></div><div className="image-node-meta"><span>{node.subtitle}</span><button title="导出" type="button"><Download size={15}/></button></div></div>}
      {node.type === 'note' && <textarea aria-label="便签内容" className="note-node-body" onChange={(event) => onUpdate({ subtitle: event.target.value })} value={node.subtitle ?? ''}/>} 
      {node.type === 'chat' && <div className="chat-node-body"><div><Bot size={16}/><span>告诉我你想探索的创意方向</span></div><input placeholder="输入消息..." /></div>}
      {node.type === 'video' && <div className="video-node-body"><Video size={24}/><span>连接图片或提示词以生成视频</span><button type="button">选择模型</button></div>}
    </article>
  )
}

function nodeIcon(type: CanvasNodeType) {
  const Icon = nodeTypes.find((item) => item.type === type)?.icon ?? Type
  return <Icon size={15}/>
}

function nodeHeight(type: CanvasNodeType): number {
  if (type === 'generator') return 270
  if (type === 'image') return 285
  if (type === 'prompt') return 220
  return 160
}

function defaultSubtitle(type: CanvasNodeType): string {
  const subtitles: Record<CanvasNodeType, string> = {
    prompt: '在这里输入你的创意描述...',
    generator: 'Seedream 5.0 Pro · 2048 × 2048',
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

function screenCenterToWorld(element: HTMLDivElement | null, viewport: CanvasViewport): Readonly<{ x: number; y: number }> {
  const width = element?.clientWidth ?? 1200
  const height = element?.clientHeight ?? 760
  return { x: Math.round((width / 2 - viewport.x) / viewport.zoom - 130), y: Math.round((height / 2 - viewport.y) / viewport.zoom - 90) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
