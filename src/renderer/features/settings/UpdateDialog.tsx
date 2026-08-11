import { ArrowRight, ExternalLink, Sparkles, X } from 'lucide-react'
import { useEffect } from 'react'
import type { AppUpdateCheck } from '../../../shared/contracts/desktop'

type AvailableUpdate = Extract<AppUpdateCheck, { status: 'available' }>

type UpdateDialogProps = Readonly<{
  update: AvailableUpdate
  onClose: () => void
  onOpenRelease: () => void
}>

export function UpdateDialog({ update, onClose, onOpenRelease }: UpdateDialogProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop update-modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="update-dialog-title"
        aria-modal="true"
        className="update-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button aria-label="关闭更新提示" className="modal-close" onClick={onClose} type="button">
          <X size={17}/>
        </button>
        <span className="update-dialog-icon"><Sparkles size={24}/></span>
        <p className="update-dialog-eyebrow">发现新版本</p>
        <h2 id="update-dialog-title">Draw Canvas {update.latestTag}</h2>
        <p className="update-dialog-description">
          {update.releaseName === update.latestTag
            ? 'GitHub 上已有新版本，可以前往 Release 页面查看说明并下载安装包。'
            : update.releaseName}
        </p>
        <div className="update-version-row">
          <span>v{update.currentVersion}</span>
          <ArrowRight size={16}/>
          <strong>{update.latestTag}</strong>
        </div>
        {update.publishedAt && (
          <small className="update-published-at">
            发布于 {formatPublishedDate(update.publishedAt)}
          </small>
        )}
        <div className="update-dialog-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">稍后</button>
          <button className="primary-button compact" onClick={onOpenRelease} type="button">
            查看 GitHub Release <ExternalLink size={14}/>
          </button>
        </div>
      </section>
    </div>
  )
}

function formatPublishedDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
