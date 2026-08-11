import { Download, Heart, MoreHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Artwork } from '../domain/catalog'

type ArtworkCardProps = Readonly<{
  actionsMode?: 'inline' | 'menu'
  artwork: Artwork
  downloadDisabled?: boolean
  favorite?: boolean
  imageUrl?: string
  onDownload?: (artwork: Artwork) => void
  onFavorite?: (id: string) => void
  onOpen: (artwork: Artwork) => void
  onRemove?: (artwork: Artwork) => void
}>

export function ArtworkCard({
  actionsMode = 'inline',
  artwork,
  downloadDisabled = false,
  favorite = false,
  imageUrl,
  onDownload,
  onFavorite,
  onOpen,
  onRemove,
}: ArtworkCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const showMenuActions = actionsMode === 'menu' && Boolean(onDownload || onRemove)

  return (
    <article className={menuOpen ? 'artwork-card is-menu-open' : 'artwork-card'}>
      <button className="artwork-preview" onClick={() => onOpen(artwork)} type="button">
        {imageUrl ? (
          <img alt={artwork.title} className="artwork-image" src={imageUrl} />
        ) : (
          <div className="artwork-gradient" style={{ '--artwork-gradient': artwork.palette } as CSSProperties}>
            <div className="artwork-grain" />
            <span className="artwork-monogram">DC</span>
          </div>
        )}
        <span className="artwork-hover-action">查看详情</span>
      </button>
      <div className="artwork-info">
        <div className="artwork-title-row">
          <div>
            <strong>{artwork.title}</strong>
            <span>{artwork.model}</span>
          </div>
          {showMenuActions ? (
            <div className="artwork-menu-wrap" ref={menuRef}>
              <button
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={`${artwork.title}的更多操作`}
                className="icon-button"
                onClick={() => setMenuOpen((current) => !current)}
                type="button"
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="artwork-card-menu" role="menu">
                  {onDownload && (
                    <button
                      disabled={downloadDisabled}
                      onClick={() => { setMenuOpen(false); onDownload(artwork) }}
                      role="menuitem"
                      type="button"
                    >
                      <Download size={14} /> 下载图片
                    </button>
                  )}
                  {onRemove && (
                    <button
                      className="is-danger"
                      onClick={() => { setMenuOpen(false); onRemove(artwork) }}
                      role="menuitem"
                      type="button"
                    >
                      <Trash2 size={14} /> 删除记录
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : onFavorite || onRemove ? (
            <div className="artwork-actions">
              {onFavorite && (
                <button
                  aria-label={favorite ? '取消收藏' : '收藏'}
                  className={favorite ? 'icon-button heart-button is-active' : 'icon-button heart-button'}
                  onClick={() => onFavorite(artwork.id)}
                  type="button"
                >
                  <Heart fill={favorite ? 'currentColor' : 'none'} size={17} />
                </button>
              )}
              {onRemove && <button aria-label="删除本地图片" className="icon-button" onClick={() => onRemove(artwork)} type="button"><Trash2 size={16} /></button>}
            </div>
          ) : (
            <button aria-label="更多操作" className="icon-button" type="button">
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
        <div className="artwork-meta">
          <span>{artwork.size}</span>
          <span>{formatCreatedAt(artwork.createdAt)}</span>
          {onDownload ? (
            <button
              aria-label={`下载${artwork.title}`}
              className="artwork-download-button"
              disabled={downloadDisabled}
              onClick={() => onDownload(artwork)}
              type="button"
            >
              <Download size={13} />
            </button>
          ) : <Download aria-hidden="true" size={13} />}
        </div>
      </div>
    </article>
  )
}

function formatCreatedAt(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}
