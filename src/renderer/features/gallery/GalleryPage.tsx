import { Heart, ImagePlus, Library } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ArtworkCard } from '../../components/ArtworkCard'
import { PageHeader } from '../../components/PageHeader'
import type { Artwork } from '../../domain/catalog'

type GalleryPageProps = Readonly<{
  artworks: ReadonlyArray<Artwork>
  favoriteIds: ReadonlyArray<string>
  onFavorite: (id: string) => void
}>

export function GalleryPage({ artworks, favoriteIds, onFavorite }: GalleryPageProps) {
  const [tab, setTab] = useState<'favorites' | 'library'>('favorites')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Artwork | null>(null)
  const visible = useMemo(() => artworks.filter((item) =>
    (tab === 'library' || favoriteIds.includes(item.id)) &&
    `${item.title}${item.tags.join('')}`.toLowerCase().includes(query.toLowerCase()),
  ), [favoriteIds, query, tab])

  return (
    <div className="page content-page">
      <PageHeader description="收藏常用图片，管理本地创意素材" onSearch={setQuery} search={query} title="图片库" />
      <div className="tab-bar">
        <button className={tab === 'favorites' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('favorites')} type="button"><Heart size={16} /> 收藏图片 <span>{favoriteIds.length}</span></button>
        <button className={tab === 'library' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('library')} type="button"><Library size={16} /> 资源库 <span>{artworks.length}</span></button>
      </div>
      {visible.length ? (
        <div className="artwork-grid">
          {visible.map((artwork) => <ArtworkCard artwork={artwork} favorite={favoriteIds.includes(artwork.id)} key={artwork.id} onFavorite={onFavorite} onOpen={setSelected} />)}
        </div>
      ) : (
        <div className="empty-state"><ImagePlus size={30} /><h3>这里还没有图片</h3><p>在生成历史中点击心形按钮，即可加入收藏。</p></div>
      )}
      {selected && <button aria-label="关闭预览" className="quick-preview" onClick={() => setSelected(null)} style={{ background: selected.palette }} type="button"><span>{selected.title}</span></button>}
    </div>
  )
}
