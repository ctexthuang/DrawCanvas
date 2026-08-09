import { Heart, ImagePlus, Library, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ArtworkCard } from '../../components/ArtworkCard'
import { PageHeader } from '../../components/PageHeader'
import type { Artwork } from '../../domain/catalog'

type GalleryPageProps = Readonly<{
  artworks: ReadonlyArray<Artwork>
  favoriteIds: ReadonlyArray<string>
  importedImageIds: ReadonlyArray<string>
  loadImage: (fileName: string) => Promise<string | null>
  onFavorite: (id: string) => void
  onImport: () => void
  onRemove: (id: string) => void
}>

export function GalleryPage({ artworks, favoriteIds, importedImageIds, loadImage, onFavorite, onImport, onRemove }: GalleryPageProps) {
  const [tab, setTab] = useState<'favorites' | 'library'>('favorites')
  const [query, setQuery] = useState('')
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({})
  const [selected, setSelected] = useState<Artwork | null>(null)
  const favoriteCount = useMemo(
    () => artworks.filter((artwork) => favoriteIds.includes(artwork.id)).length,
    [artworks, favoriteIds],
  )
  const visible = useMemo(() => artworks.filter((item) =>
    (tab === 'library' || favoriteIds.includes(item.id)) &&
    `${item.title}${item.tags.join('')}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [artworks, favoriteIds, query, tab])

  useEffect(() => {
    let cancelled = false
    const storedArtworks = artworks.filter(
      (artwork): artwork is Artwork & { imageFileName: string } => Boolean(artwork.imageFileName),
    )
    void Promise.all(storedArtworks.map(async (artwork) => ({
      id: artwork.id,
      url: await loadImage(artwork.imageFileName),
    }))).then((loadedImages) => {
      if (cancelled) return
      setImageUrls(Object.fromEntries(
        loadedImages
          .filter((image): image is { id: string; url: string } => Boolean(image.url))
          .map((image) => [image.id, image.url]),
      ))
    })
    return () => { cancelled = true }
  }, [artworks, loadImage])

  function requestRemove(artwork: Artwork): void {
    if (!window.confirm(`确定从资源库删除“${artwork.title}”吗？本地图片文件也会被删除。`)) return
    setSelected(null)
    onRemove(artwork.id)
  }

  return (
    <div className="page content-page">
      <PageHeader actions={<button className="primary-button compact" onClick={onImport} type="button"><Upload size={15} /> 导入本地图片</button>} description="收藏生成结果，管理本地创意素材" onSearch={setQuery} search={query} title="图片库" />
      <div className="tab-bar">
        <button className={tab === 'favorites' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('favorites')} type="button"><Heart size={16} /> 收藏图片 <span>{favoriteCount}</span></button>
        <button className={tab === 'library' ? 'tab-button is-active' : 'tab-button'} onClick={() => setTab('library')} type="button"><Library size={16} /> 资源库 <span>{artworks.length}</span></button>
      </div>
      {visible.length ? (
        <div className="artwork-grid">
          {visible.map((artwork) => <ArtworkCard artwork={artwork} favorite={favoriteIds.includes(artwork.id)} imageUrl={imageUrls[artwork.id]} key={artwork.id} onFavorite={onFavorite} onOpen={setSelected} onRemove={importedImageIds.includes(artwork.id) ? requestRemove : undefined} />)}
        </div>
      ) : (
        <div className="empty-state gallery-empty"><ImagePlus size={30} /><h3>{tab === 'favorites' ? '还没有收藏图片' : '资源库还是空的'}</h3><p>{tab === 'favorites' ? '切换到资源库，将喜欢的真实图片加入收藏。' : '生成图片或导入本地图片后，素材会显示在这里。'}</p>{tab === 'library' && <button className="primary-button compact" onClick={onImport} type="button"><Upload size={15} /> 导入本地图片</button>}</div>
      )}
      {selected && <button aria-label="关闭预览" className="quick-preview" onClick={() => setSelected(null)} style={imageUrls[selected.id] ? undefined : { background: selected.palette }} type="button">{imageUrls[selected.id] && <img alt={selected.title} src={imageUrls[selected.id]} />}<span>{selected.title}</span><X className="quick-preview-close" size={18} /></button>}
    </div>
  )
}
