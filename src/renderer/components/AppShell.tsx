import {
  Boxes,
  Clock3,
  FolderKanban,
  Frame,
  History,
  Images,
  Layers3,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'

export type AppPage = 'home' | 'history' | 'gallery' | 'resources' | 'models' | 'settings' | 'canvas'

type AppShellProps = Readonly<{
  activePage: AppPage
  children: ReactNode
  generationHistoryCount: number
  onNavigate: (page: AppPage) => void
}>

const primaryItems = [
  { id: 'home' as const, label: '文件', icon: FolderKanban },
  { id: 'history' as const, label: '生成历史', icon: History },
  { id: 'gallery' as const, label: '图片库', icon: Images },
  { id: 'resources' as const, label: '资源管理器', icon: Boxes },
]

const settingsItems = [
  { id: 'models' as const, label: '模型设置', icon: SlidersHorizontal },
  { id: 'settings' as const, label: '系统设置', icon: Settings2 },
]

export function AppShell({ activePage, children, generationHistoryCount, onNavigate }: AppShellProps) {
  if (activePage === 'canvas') return <>{children}</>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <Frame size={20} strokeWidth={2.4} />
          </div>
          <div>
            <strong>Draw Canvas</strong>
            <span>AI Creative Studio</span>
          </div>
        </div>

        <button className="new-canvas-button" onClick={() => onNavigate('canvas')} type="button">
          <Sparkles size={17} />
          新建无限画布
        </button>

        <nav className="sidebar-nav" aria-label="主要导航">
          {primaryItems.map(({ id, label, icon: Icon }) => (
            <button
              className={activePage === id ? 'sidebar-item is-active' : 'sidebar-item'}
              key={id}
              onClick={() => onNavigate(id)}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'history' && generationHistoryCount > 0 && (
                <span className="nav-count">{generationHistoryCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label">偏好设置</div>
        <nav className="sidebar-nav" aria-label="设置导航">
          {settingsItems.map(({ id, label, icon: Icon }) => (
            <button
              className={activePage === id ? 'sidebar-item is-active' : 'sidebar-item'}
              key={id}
              onClick={() => onNavigate(id)}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="workspace-card">
          <div className="workspace-card-icon">
            <Layers3 size={18} />
          </div>
          <div>
            <strong>本地工作区</strong>
            <span><Clock3 size={12} /> 已开启自动保存</span>
          </div>
        </div>
        <div className="sidebar-version">Draw Canvas · v1.0.0</div>
      </aside>
      <main className="main-surface">{children}</main>
    </div>
  )
}
