import {
  ArrowRight,
  Clock3,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { RecentCanvasProject } from '../../../shared/contracts/desktop'

type HomePageProps = Readonly<{
  onDeleteRecentProject: (project: RecentCanvasProject) => void
  onNewCanvas: () => void
  onOpenFile: () => void
  onOpenRecentProject: (id: string) => void
  recentProjects: ReadonlyArray<RecentCanvasProject>
}>

export function HomePage({ onDeleteRecentProject, onNewCanvas, onOpenFile, onOpenRecentProject, recentProjects }: HomePageProps) {
  const visibleProjects = recentProjects.slice(0, 3)
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null)

  useEffect(() => {
    if (!openProjectMenuId) return
    const closeMenu = () => setOpenProjectMenuId(null)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [openProjectMenuId])

  return (
    <div className="page home-page">
      <header className="home-topbar">
        <label className="home-search">
          <Search size={18} />
          <input aria-label="搜索项目" placeholder="搜索项目、图片和工作流" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="profile-chip">
          <span>DC</span>
          <div><strong>本地创作者</strong><small>个人工作区</small></div>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> AI 创意工作台</div>
          <h1>把灵感放进无限画布</h1>
          <p>连接提示词、模型与图片，在一个自由画布里完成从想法到成品的全过程。</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onNewCanvas} type="button">
              <FilePlus2 size={18} /> 新建无限画布 <ArrowRight size={16} />
            </button>
            <button className="secondary-button" onClick={onOpenFile} type="button">
              <FolderOpen size={18} /> 打开本地文件
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-grid" />
          <div className="hero-flow">
            <div className="mini-node node-a"><span>提示词</span><strong>未来主义城市...</strong></div>
            <div className="mini-node node-b"><span>图像模型</span><strong>Seedream 5.0</strong></div>
            <div className="mini-node node-c"><span>生成结果</span><i /></div>
            <svg viewBox="0 0 660 325">
              <path d="M190 83 C230 83 210 199 250 199"/>
              <path d="M410 199 C465 199 445 126 500 126"/>
            </svg>
          </div>
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <div><h2>最近项目</h2><p>继续上次未完成的创作</p></div>
          <span className="recent-project-count">{recentProjects.length} 个本地项目</span>
        </div>
        <div className="recent-grid">
          {visibleProjects.map((project) => (
            <article className="project-card" key={project.id}>
              <button className="project-card-open" onClick={() => onOpenRecentProject(project.id)} type="button">
                <div className="project-cover" style={{ '--project-gradient': projectGradient(project.colors) } as CSSProperties}>
                  <div className="project-cover-grid" />
                  <span className="project-node-preview" />
                  <span className="project-node-preview second" />
                </div>
                <div className="project-info">
                  <div><strong>{project.name}</strong><span><Clock3 size={12} /> {formatModifiedAt(project.updatedAt)}</span></div>
                  <div className="project-card-side"><span>{project.nodeCount} 个节点</span><small>{project.location === 'file' ? '项目文件' : '自动保存'}</small></div>
                </div>
              </button>
              <div className="project-card-menu-wrap" onPointerDown={(event) => event.stopPropagation()}>
                <button
                  aria-expanded={openProjectMenuId === project.id}
                  aria-haspopup="menu"
                  aria-label={`${project.name}的更多操作`}
                  className="project-menu-trigger"
                  onClick={() => setOpenProjectMenuId((current) => current === project.id ? null : project.id)}
                  type="button"
                >
                  <MoreHorizontal size={17} />
                </button>
                {openProjectMenuId === project.id && (
                  <div className="project-card-menu" role="menu">
                    <button onClick={() => { setOpenProjectMenuId(null); onDeleteRecentProject(project) }} role="menuitem" type="button">
                      <Trash2 size={14} /> 删除项目
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {visibleProjects.length === 0 && (
            <div className="recent-empty">
              <span><FilePlus2 size={20}/></span>
              <div><strong>还没有最近项目</strong><p>新建画布或打开本地项目后会显示在这里。</p></div>
              <button className="secondary-button" onClick={onNewCanvas} type="button">新建画布</button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function projectGradient(colors: ReadonlyArray<string>): string {
  const [first = '#2b2f36', second = '#ff5f77', third = '#7c5cff'] = colors
  return `linear-gradient(140deg, ${first}, ${second} 52%, ${third})`
}

function formatModifiedAt(value: string): string {
  const modifiedAt = new Date(value)
  if (Number.isNaN(modifiedAt.getTime())) return '时间未知'
  const elapsedMs = Math.max(0, Date.now() - modifiedAt.getTime())
  const elapsedMinutes = Math.floor(elapsedMs / 60_000)
  if (elapsedMinutes < 1) return '刚刚'
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} 小时前`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays} 天前`
  return new Intl.DateTimeFormat('zh-CN', {
    ...(modifiedAt.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(modifiedAt)
}
