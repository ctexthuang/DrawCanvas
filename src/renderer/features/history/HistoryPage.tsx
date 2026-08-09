import { Check, ChevronDown, Copy, Download, ImageOff, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ArtworkCard } from '../../components/ArtworkCard'
import { PageHeader } from '../../components/PageHeader'
import type { Artwork } from '../../domain/catalog'

type HistoryPageProps = Readonly<{
  artworks: ReadonlyArray<Artwork>
  loadImage: (fileName: string) => Promise<string | null>
  notify: (message: string) => void
  onNewCanvas: () => void
}>

type DateFilter = 'all' | 'today' | 'week'

export function HistoryPage({ artworks, loadImage, notify, onNewCanvas }: HistoryPageProps) {
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('全部模型')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({})
  const [selected, setSelected] = useState<Artwork | null>(null)
  const modelOptions = useMemo(
    () => [...new Set(artworks.map((item) => item.model))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [artworks],
  )
  const visible = useMemo(
    () => artworks.filter((item) =>
      (model === '全部模型' || item.model === model) &&
      matchesDateFilter(item.createdAt, dateFilter) &&
      `${item.title}${item.prompt}${item.model}`.toLowerCase().includes(query.trim().toLowerCase()),
    ),
    [artworks, dateFilter, model, query],
  )

  useEffect(() => {
    let cancelled = false
    const storedArtworks = artworks.filter(
      (artwork): artwork is Artwork & { imageFileName: string } => Boolean(artwork.imageFileName),
    )
    if (storedArtworks.length === 0) {
      setImageUrls({})
      return () => { cancelled = true }
    }

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

  return (
    <div className="page content-page">
      <PageHeader
        description="查看、筛选并复用所有生成结果"
        onSearch={setQuery}
        search={query}
        title="生成历史"
      />
      <div className="filter-row">
        <label className="select-control"><SlidersHorizontal size={15} /><select onChange={(event) => setModel(event.target.value)} value={model}>
          <option>全部模型</option>
          {modelOptions.map((modelName) => <option key={modelName}>{modelName}</option>)}
        </select><ChevronDown size={14} /></label>
        <button className={dateFilter === 'all' ? 'filter-chip is-active' : 'filter-chip'} onClick={() => setDateFilter('all')} type="button">全部</button>
        <button className={dateFilter === 'today' ? 'filter-chip is-active' : 'filter-chip'} onClick={() => setDateFilter('today')} type="button">今天</button>
        <button className={dateFilter === 'week' ? 'filter-chip is-active' : 'filter-chip'} onClick={() => setDateFilter('week')} type="button">本周</button>
        <span className="filter-result">共 {visible.length} 个结果</span>
      </div>
      {visible.length > 0 ? (
        <div className="artwork-grid">
          {visible.map((artwork) => (
            <ArtworkCard artwork={artwork} imageUrl={imageUrls[artwork.id]} key={artwork.id} onOpen={setSelected} />
          ))}
        </div>
      ) : artworks.length === 0 ? (
        <div className="empty-state history-empty">
          <ImageOff size={32} />
          <h3>还没有生成记录</h3>
          <p>从无限画布生成图片后，真实结果会自动保存到这里。</p>
          <button className="primary-button compact" onClick={onNewCanvas} type="button"><Sparkles size={15} /> 新建无限画布</button>
        </div>
      ) : (
        <div className="empty-state history-empty">
          <ImageOff size={32} />
          <h3>没有符合条件的结果</h3>
          <p>请调整搜索词、模型或时间范围。</p>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <section aria-label="生成详情" className="detail-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} type="button"><X size={18} /></button>
            <div className="detail-image" style={imageUrls[selected.id] ? undefined : { background: selected.palette }}>
              {imageUrls[selected.id] ? <img alt={selected.title} src={imageUrls[selected.id]} /> : <span>DRAW<br/>CANVAS</span>}
            </div>
            <div className="detail-content">
              <div className="detail-heading"><span className="status-dot"><Check size={12} /></span><div><h2>{selected.title}</h2><p>{formatCreatedAt(selected.createdAt)}</p></div></div>
              <div className="detail-section"><label>提示词</label><div className="prompt-box"><p>{selected.prompt}</p><button onClick={() => void copyText(selected.prompt, notify)} type="button"><Copy size={15} />复制</button></div></div>
              <div className="detail-facts"><div><span>模型</span><strong>{selected.model}</strong></div><div><span>尺寸</span><strong>{selected.size}</strong></div></div>
              <div className="detail-tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <button className="primary-button detail-download" onClick={() => void downloadArtwork(selected, imageUrls[selected.id], loadImage, notify)} type="button"><Download size={17} /> 下载图片</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

async function copyText(value: string, notify: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notify('提示词已复制')
  } catch {
    notify('当前环境无法访问剪贴板')
  }
}

async function downloadArtwork(
  artwork: Artwork,
  cachedImageUrl: string | undefined,
  loadImage: (fileName: string) => Promise<string | null>,
  notify: (message: string) => void,
): Promise<void> {
  if (!artwork.imageFileName) {
    notify('该记录没有关联的本地图片文件')
    return
  }
  const imageUrl = cachedImageUrl ?? await loadImage(artwork.imageFileName)
  if (!imageUrl) {
    notify('本地图片文件不存在或无法读取')
    return
  }
  const anchor = document.createElement('a')
  anchor.href = imageUrl
  anchor.download = `${safeFileName(artwork.title)}.${fileExtension(artwork.imageFileName)}`
  anchor.click()
  notify('图片已导出')
}

function matchesDateFilter(value: string, filter: DateFilter): boolean {
  if (filter === 'all') return true
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return false
  const createdAt = new Date(timestamp)
  const now = new Date()
  if (filter === 'today') return createdAt.toDateString() === now.toDateString()
  const weekAgo = new Date(now)
  weekAgo.setDate(now.getDate() - 7)
  return createdAt >= weekAgo && createdAt <= now
}

function formatCreatedAt(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[\\/:*?"<>|]/g, '-').trim()
  return normalized || 'Draw Canvas 生成图片'
}

function fileExtension(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'png'
}
