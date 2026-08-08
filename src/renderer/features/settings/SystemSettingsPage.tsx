import {
  Check,
  Database,
  ExternalLink,
  Folder,
  HardDrive,
  Info,
  Monitor,
  Moon,
  Palette,
  Sun,
} from 'lucide-react'
import type {
  AppSettings,
  StorageCategory,
  StorageStats,
  ThemeMode,
} from '../../../shared/contracts/desktop'

type SystemSettingsPageProps = Readonly<{
  settings: AppSettings
  stats: StorageStats
  changingDirectory: boolean
  onAccentChange: (color: string) => void
  onThemeChange: (theme: ThemeMode) => void
  onChooseDirectory: () => void
  onOpenDirectory: () => void
}>

const accentColors = ['#7c5cff', '#ff5f77', '#ff9f1c', '#23c8ff', '#aaff00']

const storageCategories: ReadonlyArray<Readonly<{
  id: StorageCategory
  label: string
  color: string
}>> = [
  { id: 'projects', label: '项目文件', color: '#ff5f77' },
  { id: 'library', label: '图片资源', color: '#7c5cff' },
  { id: 'history', label: '生成历史', color: '#ff9f1c' },
  { id: 'resources', label: '资源管理器', color: '#23c8ff' },
  { id: 'settings', label: '设置数据', color: '#5d7df7' },
  { id: 'database', label: '数据库', color: '#aaff00' },
  { id: 'cache', label: '缓存', color: '#9ca3af' },
  { id: 'other', label: '其他', color: '#d5d8db' },
]

export function SystemSettingsPage({ settings, stats, changingDirectory, onAccentChange, onThemeChange, onChooseDirectory, onOpenDirectory }: SystemSettingsPageProps) {
  const total = Math.max(stats.totalBytes, 1)
  const projectPercent = Math.min(100, (stats.categories.projects.bytes / total) * 100)
  const libraryPercent = Math.min(100 - projectPercent, (stats.categories.library.bytes / total) * 100)

  return (
    <div className="page system-settings-page">
      <header className="simple-heading"><h1>系统设置</h1><p>管理存储、外观与应用信息</p></header>
      <div className="system-settings-grid">
        <section className="settings-panel storage-panel">
          <div className="panel-title-icon"><span><Database size={19}/></span><div><h2>本地存储</h2><p>应用业务数据统一保存和迁移的位置</p></div></div>
          <label className="setting-field-label">数据目录</label>
          <div className="directory-field"><Folder size={17}/><span title={settings.storageDirectory}>{settings.storageDirectory}</span><button disabled={changingDirectory} onClick={onChooseDirectory} type="button">{changingDirectory ? '迁移中…' : '更改'}</button></div>
          <button className="inline-link" onClick={onOpenDirectory} type="button"><ExternalLink size={14}/> 在文件管理器中打开</button>
          <div className="storage-summary"><div><HardDrive size={20}/><span><strong>{formatBytes(stats.totalBytes)}</strong><small>已使用空间</small></span></div><span>{stats.totalFileCount} 个文件</span></div>
          <div className="storage-bar"><i style={{ width: `${projectPercent}%` }}/><i className="library-part" style={{ left: `${projectPercent}%`, width: `${libraryPercent}%` }}/></div>
          <div className="storage-legend">{storageCategories.map((category) => <span key={category.id} style={{ '--legend-color': category.color } as React.CSSProperties}><i/>{category.label}<strong>{formatBytes(stats.categories[category.id].bytes)} · {stats.categories[category.id].fileCount} 个</strong></span>)}</div>
        </section>

        <section className="settings-panel appearance-panel">
          <div className="panel-title-icon"><span><Palette size={19}/></span><div><h2>外观</h2><p>调整界面主题与强调色</p></div></div>
          <label className="setting-field-label">界面主题</label>
          <div className="theme-options">
            <button className={settings.theme === 'light' ? 'theme-option is-active' : 'theme-option'} onClick={() => onThemeChange('light')} type="button"><span><Sun size={20}/></span><strong>浅色</strong>{settings.theme === 'light' && <Check size={15}/>}</button>
            <button className={settings.theme === 'dark' ? 'theme-option is-active' : 'theme-option'} onClick={() => onThemeChange('dark')} type="button"><span><Moon size={20}/></span><strong>深色</strong>{settings.theme === 'dark' && <Check size={15}/>}</button>
            <button className={settings.theme === 'system' ? 'theme-option is-active' : 'theme-option'} onClick={() => onThemeChange('system')} type="button"><span><Monitor size={20}/></span><strong>跟随系统</strong>{settings.theme === 'system' && <Check size={15}/>}</button>
          </div>
          <label className="setting-field-label accent-label">强调色</label>
          <div className="accent-options">{accentColors.map((color) => <button aria-label={`选择强调色 ${color}`} className={settings.accentColor === color ? 'accent-swatch is-active' : 'accent-swatch'} key={color} onClick={() => onAccentChange(color)} style={{ '--swatch': color } as React.CSSProperties} type="button">{settings.accentColor === color && <Check size={16}/>}</button>)}</div>
          <div className="accent-preview"><span style={{ background: settings.accentColor }} /><div><strong>界面预览</strong><small>强调色会应用到按钮、选中状态与画布节点。</small></div><button style={{ background: settings.accentColor }} type="button">主要按钮</button></div>
        </section>

        <section className="settings-panel about-panel">
          <div className="about-logo">DC</div><div className="about-copy"><h2>Draw Canvas</h2><p>Version 1.0.0 · Electron Desktop</p></div><span className="up-to-date"><Check size={13}/> 已是最新版本</span>
          <div className="about-links"><button type="button">使用文档 <ExternalLink size={13}/></button><button type="button">隐私政策 <ExternalLink size={13}/></button><button type="button">开源许可 <ExternalLink size={13}/></button></div>
          <div className="about-footnote"><Info size={14}/> 所有项目数据默认保存在本机，你可以随时更改数据目录。</div>
        </section>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
