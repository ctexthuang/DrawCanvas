import { Download, Heart, MoreHorizontal, Trash2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Artwork } from '../domain/catalog'

type ArtworkCardProps = Readonly<{
  artwork: Artwork
  favorite?: boolean
  imageUrl?: string
  onFavorite?: (id: string) => void
  onOpen: (artwork: Artwork) => void
  onRemove?: (artwork: Artwork) => void
}>

export function ArtworkCard({ artwork, favorite = false, imageUrl, onFavorite, onOpen, onRemove }: ArtworkCardProps) {
  return (
    <article className="artwork-card">
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
          {onFavorite || onRemove ? (
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
          <Download size={13} />
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
