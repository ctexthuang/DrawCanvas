import { Check, ChevronDown, Copy, Play, Plus, Sparkles, Workflow } from 'lucide-react'
import { useState } from 'react'
import type { PromptAsset, WorkflowAsset } from '../../../shared/contracts/desktop'
import { PageHeader } from '../../components/PageHeader'

type ResourcesPageProps = Readonly<{
  prompts: ReadonlyArray<PromptAsset>
  workflows: ReadonlyArray<WorkflowAsset>
  notify: (message: string) => void
  onUsePrompt: (prompt: string) => void
  onRunWorkflow: (id: string) => void
}>

export function ResourcesPage({ prompts, workflows, notify, onUsePrompt, onRunWorkflow }: ResourcesPageProps) {
  const [tab, setTab] = useState<'prompts' | 'workflows'>('prompts')
  const [expanded, setExpanded] = useState('p1')
  const [query, setQuery] = useState('')
  const visiblePrompts = prompts.filter((prompt) => `${prompt.title}${prompt.category}${prompt.body}`.includes(query))
  const visibleWorkflows = workflows.filter((workflow) => `${workflow.title}${workflow.description}`.includes(query))

  return (
    <div className="page content-page resources-page">
      <PageHeader
        actions={<button className="primary-button compact" type="button"><Plus size={16} /> 新建资源</button>}
        description="集中管理常用提示词与自动化工作流"
        onSearch={setQuery}
        search={query}
        title="资源管理器"
      />
      <div className="tab-bar">
        <button className={tab === 'prompts' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('prompts')} type="button"><Sparkles size={16} /> 提示词 <span>{prompts.length}</span></button>
        <button className={tab === 'workflows' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('workflows')} type="button"><Workflow size={16} /> 工作流 <span>{workflows.length}</span></button>
      </div>

      {tab === 'prompts' ? (
        <div className="prompt-list">
          {visiblePrompts.map((prompt) => {
            const isExpanded = expanded === prompt.id
            return <article className={isExpanded ? 'prompt-item is-expanded' : 'prompt-item'} key={prompt.id}>
              <button className="prompt-summary" onClick={() => setExpanded(isExpanded ? '' : prompt.id)} type="button">
                <div className="resource-icon"><Sparkles size={17} /></div>
                <div><strong>{prompt.title}</strong><span>{prompt.category} · {prompt.body.slice(0, 32)}...</span></div>
                <ChevronDown className="prompt-chevron" size={17} />
              </button>
              {isExpanded && <div className="prompt-detail"><p>{prompt.body}</p><div className="prompt-actions"><button onClick={() => void navigator.clipboard.writeText(prompt.body).then(() => notify('提示词已复制'))} type="button"><Copy size={15} /> 复制</button><button className="use-button" onClick={() => onUsePrompt(prompt.body)} type="button"><Check size={15} /> 在画布中使用</button></div></div>}
            </article>
          })}
        </div>
      ) : (
        <div className="workflow-grid">
          {visibleWorkflows.map((workflow) => <article className="workflow-card" key={workflow.id}>
            <div className="workflow-preview" style={{ '--workflow-accent': workflow.accent } as React.CSSProperties}>
              <span /><span /><span /><svg viewBox="0 0 280 120"><path d="M65 35 C120 35 90 82 145 82 M168 82 C210 82 205 38 238 38" /></svg>
            </div>
            <div className="workflow-info"><div><strong>{workflow.title}</strong><p>{workflow.description}</p></div><span>{workflow.nodes} 个节点</span></div>
            <button className="run-workflow" onClick={() => onRunWorkflow(workflow.id)} type="button"><Play size={15} fill="currentColor" /> 运行工作流</button>
          </article>)}
        </div>
      )}
    </div>
  )
}
