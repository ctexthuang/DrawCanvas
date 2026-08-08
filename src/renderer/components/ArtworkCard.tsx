import { Download, Heart, MoreHorizontal } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Artwork } from '../domain/catalog'

type ArtworkCardProps = Readonly<{
  artwork: Artwork
  favorite?: boolean
  onFavorite?: (id: string) => void
  onOpen: (artwork: Artwork) => void
}>

export function ArtworkCard({ artwork, favorite = false, onFavorite, onOpen }: ArtworkCardProps) {
  return (
    <article className="artwork-card">
      <button className="artwork-preview" onClick={() => onOpen(artwork)} type="button">
        <div className="artwork-gradient" style={{ '--artwork-gradient': artwork.palette } as CSSProperties}>
          <div className="artwork-grain" />
          <span className="artwork-monogram">DC</span>
        </div>
        <span className="artwork-hover-action">查看详情</span>
      </button>
      <div className="artwork-info">
        <div className="artwork-title-row">
          <div>
            <strong>{artwork.title}</strong>
            <span>{artwork.model}</span>
          </div>
          {onFavorite ? (
            <button
              aria-label={favorite ? '取消收藏' : '收藏'}
              className={favorite ? 'icon-button heart-button is-active' : 'icon-button heart-button'}
              onClick={() => onFavorite(artwork.id)}
              type="button"
            >
              <Heart fill={favorite ? 'currentColor' : 'none'} size={17} />
            </button>
          ) : (
            <button aria-label="更多操作" className="icon-button" type="button">
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
        <div className="artwork-meta">
          <span>{artwork.size}</span>
          <span>{artwork.createdAt}</span>
          <Download size={13} />
        </div>
      </div>
    </article>
  )
}

