import {
  Check,
  ChevronDown,
  Copy,
  Edit3,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import { useState, type CSSProperties, type FormEvent } from 'react'
import type {
  CanvasDocument,
  CanvasNodeData,
  PromptAsset,
  SavePromptRequest,
  SaveWorkflowRequest,
  WorkflowAsset,
} from '../../../shared/contracts/desktop'
import { PageHeader } from '../../components/PageHeader'

// 工作流保存暂未开放；保留底层读写能力以兼容已经保存的本地工作流。
const WORKFLOW_SAVING_ENABLED = false

type ResourcesPageProps = Readonly<{
  currentCanvas: CanvasDocument | null
  prompts: ReadonlyArray<PromptAsset>
  workflows: ReadonlyArray<WorkflowAsset>
  notify: (message: string) => void
  onDeletePrompt: (id: string) => Promise<boolean>
  onDeleteWorkflow: (id: string) => Promise<boolean>
  onRunWorkflow: (id: string) => void
  onSavePrompt: (request: SavePromptRequest) => Promise<boolean>
  onSaveWorkflow: (request: SaveWorkflowRequest) => Promise<boolean>
  onUsePrompt: (prompt: string) => void
}>

export function ResourcesPage({
  currentCanvas,
  prompts,
  workflows,
  notify,
  onDeletePrompt,
  onDeleteWorkflow,
  onRunWorkflow,
  onSavePrompt,
  onSaveWorkflow,
  onUsePrompt,
}: ResourcesPageProps) {
  const [tab, setTab] = useState<'prompts' | 'workflows'>('prompts')
  const [expanded, setExpanded] = useState('')
  const [query, setQuery] = useState('')
  const [promptDraft, setPromptDraft] = useState<SavePromptRequest | null>(null)
  const [workflowDraft, setWorkflowDraft] = useState<SaveWorkflowRequest | null>(null)
  const [saving, setSaving] = useState(false)
  const normalizedQuery = query.trim().toLowerCase()
  const visiblePrompts = prompts.filter((prompt) =>
    `${prompt.title}${prompt.category}${prompt.body}`.toLowerCase().includes(normalizedQuery),
  )
  const visibleWorkflows = workflows.filter((workflow) =>
    `${workflow.title}${workflow.description}`.toLowerCase().includes(normalizedQuery),
  )

  function createResource(): void {
    if (tab === 'prompts') {
      setPromptDraft({ title: '', category: '通用', body: '' })
      return
    }
    if (!WORKFLOW_SAVING_ENABLED) {
      notify('工作流保存功能暂未开放')
      return
    }
    if (!currentCanvas) {
      notify('请先新建或打开一个画布，再保存为工作流')
      return
    }
    setWorkflowDraft({
      title: currentCanvas.name === '未命名画布' ? '新工作流' : currentCanvas.name,
      description: '',
      accent: currentCanvas.nodes.find((node) => node.color)?.color ?? '#ff5f77',
      document: currentCanvas,
    })
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!promptDraft || saving) return
    setSaving(true)
    try {
      if (await onSavePrompt(promptDraft)) setPromptDraft(null)
    } finally {
      setSaving(false)
    }
  }

  async function submitWorkflow(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!WORKFLOW_SAVING_ENABLED || !workflowDraft || saving) return
    setSaving(true)
    try {
      if (await onSaveWorkflow(workflowDraft)) setWorkflowDraft(null)
    } finally {
      setSaving(false)
    }
  }

  async function deletePrompt(prompt: PromptAsset): Promise<void> {
    if (!window.confirm(`确定删除提示词“${prompt.title}”吗？`)) return
    if (await onDeletePrompt(prompt.id)) setExpanded('')
  }

  async function deleteWorkflow(workflow: WorkflowAsset): Promise<void> {
    if (!window.confirm(`确定删除工作流“${workflow.title}”吗？`)) return
    await onDeleteWorkflow(workflow.id)
  }

  return (
    <div className="page content-page resources-page">
      <PageHeader
        actions={tab === 'prompts' || WORKFLOW_SAVING_ENABLED
          ? <button className="primary-button compact" disabled={tab === 'workflows' && !currentCanvas} onClick={createResource} type="button"><Plus size={16} /> {tab === 'prompts' ? '新建提示词' : '保存当前画布'}</button>
          : undefined}
        description="管理真实保存的提示词与画布工作流"
        onSearch={setQuery}
        search={query}
        title="资源管理器"
      />
      <div className="tab-bar">
        <button className={tab === 'prompts' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('prompts')} type="button"><Sparkles size={16} /> 提示词 <span>{prompts.length}</span></button>
        <button className={tab === 'workflows' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('workflows')} type="button"><Workflow size={16} /> 工作流 <span>{workflows.length}</span></button>
      </div>

      {tab === 'prompts' ? (
        visiblePrompts.length > 0 ? (
          <div className="prompt-list">
            {visiblePrompts.map((prompt) => {
              const isExpanded = expanded === prompt.id
              return <article className={isExpanded ? 'prompt-item is-expanded' : 'prompt-item'} key={prompt.id}>
                <button className="prompt-summary" onClick={() => setExpanded(isExpanded ? '' : prompt.id)} type="button">
                  <div className="resource-icon"><Sparkles size={17} /></div>
                  <div><strong>{prompt.title}</strong><span>{prompt.category} · {prompt.body.slice(0, 32)}{prompt.body.length > 32 ? '…' : ''}</span></div>
                  <ChevronDown className="prompt-chevron" size={17} />
                </button>
                {isExpanded && <div className="prompt-detail"><p>{prompt.body}</p><div className="prompt-actions"><button onClick={() => setPromptDraft(prompt)} type="button"><Edit3 size={14} /> 编辑</button><button onClick={() => void copyPrompt(prompt.body, notify)} type="button"><Copy size={14} /> 复制</button><button onClick={() => void deletePrompt(prompt)} type="button"><Trash2 size={14} /> 删除</button><button className="use-button" onClick={() => onUsePrompt(prompt.body)} type="button"><Check size={14} /> 在画布中使用</button></div></div>}
              </article>
            })}
          </div>
        ) : <ResourceEmptyState hasQuery={Boolean(normalizedQuery)} kind="提示词" onCreate={createResource} />
      ) : (
        visibleWorkflows.length > 0 ? (
          <div className="workflow-grid">
            {visibleWorkflows.map((workflow) => <article className="workflow-card" key={workflow.id}>
              <div className="workflow-preview" style={{ '--workflow-accent': workflow.accent } as CSSProperties}>
                {workflow.document?.nodes.slice(0, 12).map((node) => <span key={node.id} style={workflowNodeStyle(workflow.document?.nodes ?? [], node, workflow.accent)} />)}
              </div>
              <div className="workflow-info"><div><strong>{workflow.title}</strong><p>{workflow.description || '保存自本地画布'}</p></div><span>{workflow.nodes} 个节点</span></div>
              <div className="workflow-actions">{WORKFLOW_SAVING_ENABLED && <button onClick={() => workflow.document && setWorkflowDraft({ id: workflow.id, title: workflow.title, description: workflow.description, accent: workflow.accent, document: workflow.document })} type="button"><Edit3 size={14} /> 编辑</button>}<button onClick={() => void deleteWorkflow(workflow)} type="button"><Trash2 size={14} /> 删除</button></div>
              <button className="run-workflow" disabled={!workflow.document} onClick={() => onRunWorkflow(workflow.id)} type="button"><Play size={15} fill="currentColor" /> 运行工作流</button>
            </article>)}
          </div>
        ) : <ResourceEmptyState canCreate={WORKFLOW_SAVING_ENABLED} disabled={!currentCanvas} hasQuery={Boolean(normalizedQuery)} kind="工作流" onCreate={createResource} />
      )}

      {promptDraft && (
        <div className="modal-backdrop" onMouseDown={() => setPromptDraft(null)} role="presentation">
          <form className="resource-editor-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submitPrompt(event)}>
            <button aria-label="关闭" className="modal-close" onClick={() => setPromptDraft(null)} type="button"><X size={18} /></button>
            <h2>{promptDraft.id ? '编辑提示词' : '新建提示词'}</h2><p>内容会保存在本地数据目录。</p>
            <label>名称<input autoFocus maxLength={200} onChange={(event) => setPromptDraft({ ...promptDraft, title: event.target.value })} required value={promptDraft.title} /></label>
            <label>分类<input maxLength={100} onChange={(event) => setPromptDraft({ ...promptDraft, category: event.target.value })} required value={promptDraft.category} /></label>
            <label>提示词<textarea maxLength={20_000} onChange={(event) => setPromptDraft({ ...promptDraft, body: event.target.value })} required rows={8} value={promptDraft.body} /></label>
            <button className="primary-button" disabled={saving} type="submit"><Save size={16} /> {saving ? '保存中…' : '保存提示词'}</button>
          </form>
        </div>
      )}

      {WORKFLOW_SAVING_ENABLED && workflowDraft && (
        <div className="modal-backdrop" onMouseDown={() => setWorkflowDraft(null)} role="presentation">
          <form className="resource-editor-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submitWorkflow(event)}>
            <button aria-label="关闭" className="modal-close" onClick={() => setWorkflowDraft(null)} type="button"><X size={18} /></button>
            <h2>{workflowDraft.id ? '编辑工作流' : '保存为工作流'}</h2><p>将保存 {workflowDraft.document.nodes.length} 个节点、{workflowDraft.document.connections.length} 条连线和当前视口。</p>
            <label>名称<input autoFocus maxLength={200} onChange={(event) => setWorkflowDraft({ ...workflowDraft, title: event.target.value })} required value={workflowDraft.title} /></label>
            <label>说明<textarea maxLength={1000} onChange={(event) => setWorkflowDraft({ ...workflowDraft, description: event.target.value })} rows={4} value={workflowDraft.description} /></label>
            <label>标识颜色<input className="resource-color-input" onChange={(event) => setWorkflowDraft({ ...workflowDraft, accent: event.target.value })} type="color" value={workflowDraft.accent} /></label>
            <button className="primary-button" disabled={saving} type="submit"><Save size={16} /> {saving ? '保存中…' : '保存工作流'}</button>
          </form>
        </div>
      )}
    </div>
  )
}

function ResourceEmptyState({ canCreate = true, disabled = false, hasQuery, kind, onCreate }: Readonly<{ canCreate?: boolean; disabled?: boolean; hasQuery: boolean; kind: '提示词' | '工作流'; onCreate: () => void }>) {
  const description = hasQuery
    ? '请更换搜索词后重试。'
    : kind === '提示词'
      ? '创建后可以一键复用到无限画布。'
      : canCreate
        ? '把当前画布的节点和连线保存为可重复使用的工作流。'
        : '工作流保存功能暂未开放，已有工作流仍可继续使用。'
  return <div className="empty-state resource-empty"><Workflow size={31} /><h3>{hasQuery ? `没有匹配的${kind}` : `还没有${kind}`}</h3><p>{description}</p>{!hasQuery && canCreate && <button className="primary-button compact" disabled={disabled} onClick={onCreate} type="button"><Plus size={15} /> {kind === '提示词' ? '新建提示词' : '保存当前画布'}</button>}</div>
}

async function copyPrompt(body: string, notify: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(body)
    notify('提示词已复制')
  } catch {
    notify('当前环境无法访问剪贴板')
  }
}

function workflowNodeStyle(
  nodes: ReadonlyArray<CanvasNodeData>,
  node: CanvasNodeData,
  fallbackColor: string,
): CSSProperties {
  const xValues = nodes.map((item) => item.x)
  const yValues = nodes.map((item) => item.y)
  const minX = Math.min(...xValues)
  const minY = Math.min(...yValues)
  const width = Math.max(1, Math.max(...xValues) - minX)
  const height = Math.max(1, Math.max(...yValues) - minY)
  return {
    '--workflow-accent': node.color ?? fallbackColor,
    left: `${8 + ((node.x - minX) / width) * 70}%`,
    top: `${14 + ((node.y - minY) / height) * 55}%`,
  } as CSSProperties
}
