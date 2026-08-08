import {
  ArrowRight,
  Clock3,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  Search,
  Sparkles,
} from 'lucide-react'
import type { CSSProperties } from 'react'

type HomePageProps = Readonly<{
  onNewCanvas: () => void
  onOpenFile: () => void
}>

const recentProjects = [
  {
    id: 'r1',
    title: '品牌视觉探索',
    modified: '12 分钟前',
    nodes: 18,
    palette: 'linear-gradient(140deg, #242a34, #6f4bf2 48%, #aaff00)',
  },
  {
    id: 'r2',
    title: '夏季海报方案',
    modified: '昨天 21:06',
    nodes: 12,
    palette: 'linear-gradient(135deg, #f8a74d, #fb596b 48%, #253c79)',
  },
  {
    id: 'r3',
    title: '角色概念设定',
    modified: '8月5日 16:42',
    nodes: 26,
    palette: 'linear-gradient(145deg, #d7ded1, #5f7b68 45%, #26362c)',
  },
]

export function HomePage({ onNewCanvas, onOpenFile }: HomePageProps) {
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
          <div className="mini-node node-a"><span>提示词</span><strong>未来主义城市...</strong></div>
          <div className="mini-node node-b"><span>图像模型</span><strong>Seedream 5.0</strong></div>
          <div className="mini-node node-c"><span>生成结果</span><i /></div>
          <svg viewBox="0 0 460 250"><path d="M130 75 C210 75 170 165 260 165"/><path d="M285 90 C335 90 315 150 360 150"/></svg>
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <div><h2>最近项目</h2><p>继续上次未完成的创作</p></div>
          <button className="text-button" type="button">查看全部 <ArrowRight size={14} /></button>
        </div>
        <div className="recent-grid">
          {recentProjects.map((project) => (
            <button className="project-card" key={project.id} onClick={onNewCanvas} type="button">
              <div className="project-cover" style={{ '--project-gradient': project.palette } as CSSProperties}>
                <div className="project-cover-grid" />
                <span className="project-node-preview" />
                <span className="project-node-preview second" />
              </div>
              <div className="project-info">
                <div><strong>{project.title}</strong><span><Clock3 size={12} /> {project.modified}</span></div>
                <div className="project-card-side"><span>{project.nodes} 个节点</span><MoreHorizontal size={17} /></div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

