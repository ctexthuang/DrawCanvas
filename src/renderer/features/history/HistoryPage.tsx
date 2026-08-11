import {
  AudioLines,
  Check,
  ChevronDown,
  Copy,
  Download,
  Image as ImageIcon,
  ImageOff,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GeneratedAudioAsset, GeneratedVideoAsset } from '../../../shared/contracts/desktop'
import { ArtworkCard } from '../../components/ArtworkCard'
import { PageHeader } from '../../components/PageHeader'
import type { Artwork } from '../../domain/catalog'

type HistoryPageProps = Readonly<{
  artworks: ReadonlyArray<Artwork>
  audios: ReadonlyArray<GeneratedAudioAsset>
  videos: ReadonlyArray<GeneratedVideoAsset>
  loadImage: (fileName: string) => Promise<string | null>
  notify: (message: string) => void
  onExportVideo: (id: string) => Promise<boolean>
  onExportAudio: (id: string) => Promise<boolean>
  onExportBatch: (media: MediaFilter, ids: ReadonlyArray<string>) => Promise<boolean>
  onNewCanvas: () => void
  onRemove: (id: string) => Promise<boolean>
  onRemoveVideo: (id: string) => Promise<boolean>
  onRemoveAudio: (id: string) => Promise<boolean>
}>

type DateFilter = 'all' | 'today' | 'week'
type MediaFilter = 'images' | 'videos' | 'audios'

export function HistoryPage({ artworks, audios, videos, loadImage, notify, onExportAudio, onExportBatch, onExportVideo, onNewCanvas, onRemove, onRemoveAudio, onRemoveVideo }: HistoryPageProps) {
  const [media, setMedia] = useState<MediaFilter>('images')
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('全部模型')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({})
  const [selected, setSelected] = useState<Artwork | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [exportingVideoId, setExportingVideoId] = useState<string | null>(null)
  const [exportingAudioId, setExportingAudioId] = useState<string | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const modelOptions = useMemo(
    () => [...new Set((media === 'images' ? artworks : media === 'videos' ? videos : audios).map((item) => item.model))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [artworks, audios, media, videos],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const visibleImages = useMemo(
    () => artworks.filter((item) =>
      (model === '全部模型' || item.model === model) &&
      matchesDateFilter(item.createdAt, dateFilter) &&
      `${item.title}${item.prompt}${item.model}`.toLowerCase().includes(normalizedQuery),
    ),
    [artworks, dateFilter, model, normalizedQuery],
  )
  const visibleVideos = useMemo(
    () => videos.filter((item) =>
      (model === '全部模型' || item.model === model) &&
      matchesDateFilter(item.createdAt, dateFilter) &&
      `${item.title}${item.prompt}${item.model}`.toLowerCase().includes(normalizedQuery),
    ),
    [dateFilter, model, normalizedQuery, videos],
  )
  const visibleAudios = useMemo(
    () => audios.filter((item) =>
      (model === '全部模型' || item.model === model) &&
      matchesDateFilter(item.createdAt, dateFilter) &&
      `${item.title}${item.text}${item.model}${item.voiceId}`.toLowerCase().includes(normalizedQuery),
    ),
    [audios, dateFilter, model, normalizedQuery],
  )

  useEffect(() => {
    setModel('全部模型')
    setSelectedIds(new Set())
  }, [media])

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

  async function requestDownload(artwork: Artwork): Promise<void> {
    if (downloadingId) return
    setDownloadingId(artwork.id)
    try {
      await downloadArtwork(artwork, imageUrls[artwork.id], loadImage, notify)
    } finally {
      setDownloadingId(null)
    }
  }

  async function requestRemove(artwork: Artwork): Promise<void> {
    if (!window.confirm(`确定删除生成记录“${artwork.title}”吗？对应的本地图片文件也会被删除。`)) return
    const removed = await onRemove(artwork.id)
    if (removed) setSelected((current) => current?.id === artwork.id ? null : current)
  }

  async function requestVideoExport(video: GeneratedVideoAsset): Promise<void> {
    if (exportingVideoId) return
    setExportingVideoId(video.id)
    try {
      await onExportVideo(video.id)
    } finally {
      setExportingVideoId(null)
    }
  }

  async function requestVideoRemove(video: GeneratedVideoAsset): Promise<void> {
    if (!window.confirm(`确定删除视频记录“${video.title}”吗？未被画布或工作流引用的本地视频文件也会删除。`)) return
    await onRemoveVideo(video.id)
  }

  async function requestAudioExport(audio: GeneratedAudioAsset): Promise<void> {
    if (exportingAudioId) return
    setExportingAudioId(audio.id)
    try {
      await onExportAudio(audio.id)
    } finally {
      setExportingAudioId(null)
    }
  }

  async function requestAudioRemove(audio: GeneratedAudioAsset): Promise<void> {
    if (!window.confirm(`确定删除语音记录“${audio.title}”吗？未被画布或工作流引用的本地音频文件也会删除。`)) return
    await onRemoveAudio(audio.id)
  }

  function toggleSelected(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function visibleIds(): ReadonlyArray<string> {
    return media === 'images'
      ? visibleImages.map((item) => item.id)
      : media === 'videos'
        ? visibleVideos.map((item) => item.id)
        : visibleAudios.map((item) => item.id)
  }

  async function exportSelected(): Promise<void> {
    if (selectedIds.size === 0 || batchBusy) return
    setBatchBusy(true)
    try {
      await onExportBatch(media, [...selectedIds])
    } finally {
      setBatchBusy(false)
    }
  }

  async function removeSelected(): Promise<void> {
    if (selectedIds.size === 0 || batchBusy) return
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 条生成记录吗？未被项目引用的本地文件也会删除。`)) return
    setBatchBusy(true)
    try {
      for (const id of selectedIds) {
        if (media === 'images') await onRemove(id)
        else if (media === 'videos') await onRemoveVideo(id)
        else await onRemoveAudio(id)
      }
      setSelectedIds(new Set())
    } finally {
      setBatchBusy(false)
    }
  }

  const visibleCount = media === 'images' ? visibleImages.length : media === 'videos' ? visibleVideos.length : visibleAudios.length
  const totalCount = media === 'images' ? artworks.length : media === 'videos' ? videos.length : audios.length

  return (
    <div className="page content-page">
      <PageHeader
        description="查看、筛选并复用所有图片、视频和语音生成结果"
        onSearch={setQuery}
        search={query}
        title="生成历史"
      />
      <div className="tab-bar history-media-tabs">
        <button className={media === 'images' ? 'tab-button is-active' : 'tab-button'} onClick={() => setMedia('images')} type="button"><ImageIcon size={16}/> 图片 <span>{artworks.length}</span></button>
        <button className={media === 'videos' ? 'tab-button is-active' : 'tab-button'} onClick={() => setMedia('videos')} type="button"><Video size={16}/> 视频 <span>{videos.length}</span></button>
        <button className={media === 'audios' ? 'tab-button is-active' : 'tab-button'} onClick={() => setMedia('audios')} type="button"><AudioLines size={16}/> 语音 <span>{audios.length}</span></button>
      </div>
      <div className="filter-row">
        <label className="select-control"><SlidersHorizontal size={15}/><select onChange={(event) => setModel(event.target.value)} value={model}>
          <option>全部模型</option>
          {modelOptions.map((modelName) => <option key={modelName}>{modelName}</option>)}
        </select><ChevronDown size={14}/></label>
        <button className={dateFilter === 'all' ? 'filter-chip is-active' : 'filter-chip'} onClick={() => setDateFilter('all')} type="button">全部</button>
        <button className={dateFilter === 'today' ? 'filter-chip is-active' : 'filter-chip'} onClick={() => setDateFilter('today')} type="button">今天</button>
        <button className={dateFilter === 'week' ? 'filter-chip is-active' : 'filter-chip'} onClick={() => setDateFilter('week')} type="button">本周</button>
        <button className={batchMode ? 'filter-chip is-active' : 'filter-chip'} onClick={() => { setBatchMode((value) => !value); setSelectedIds(new Set()) }} type="button">批量管理</button>
        <span className="filter-result">共 {visibleCount} 个结果</span>
      </div>

      {batchMode && totalCount > 0 && (
        <div className="history-batch-bar">
          <strong>已选择 {selectedIds.size} 项</strong>
          <button onClick={() => setSelectedIds(new Set(visibleIds()))} type="button">选择当前结果</button>
          <button onClick={() => setSelectedIds(new Set())} type="button">清空选择</button>
          <span/>
          <button disabled={selectedIds.size === 0 || batchBusy} onClick={() => void exportSelected()} type="button"><Download size={14}/>批量导出</button>
          <button className="is-danger" disabled={selectedIds.size === 0 || batchBusy} onClick={() => void removeSelected()} type="button"><Trash2 size={14}/>批量删除</button>
        </div>
      )}

      {media === 'images' && visibleImages.length > 0 && (
        <div className="artwork-grid">
          {visibleImages.map((artwork) => (
            <div className={`history-selectable${selectedIds.has(artwork.id) ? ' is-selected' : ''}`} key={artwork.id}>
              {batchMode && <button className="history-select-check" onClick={() => toggleSelected(artwork.id)} title="选择" type="button">{selectedIds.has(artwork.id) ? <Check size={13}/> : null}</button>}
              <ArtworkCard
                actionsMode="menu"
                artwork={artwork}
                downloadDisabled={downloadingId !== null}
                imageUrl={imageUrls[artwork.id]}
                onDownload={(item) => void requestDownload(item)}
                onOpen={setSelected}
                onRemove={(item) => void requestRemove(item)}
              />
            </div>
          ))}
        </div>
      )}

      {media === 'videos' && visibleVideos.length > 0 && (
        <div className="video-history-grid">
          {visibleVideos.map((video) => (
            <article className={`video-history-card history-selectable${selectedIds.has(video.id) ? ' is-selected' : ''}`} key={video.id}>
              {batchMode && <button className="history-select-check" onClick={() => toggleSelected(video.id)} title="选择" type="button">{selectedIds.has(video.id) ? <Check size={13}/> : null}</button>}
              <div className="video-history-preview">
                <video controls playsInline preload="metadata" src={videoSource(video.videoFileName)}/>
              </div>
              <div className="video-history-info">
                <div><strong>{video.title}</strong><span>{video.model}</span></div>
                <p>{video.prompt}</p>
                <div className="video-history-meta"><span>{video.duration} 秒</span><span>{video.resolution}</span><span>{video.ratio}</span><time>{formatCreatedAt(video.createdAt)}</time></div>
                <div className="video-history-actions">
                  <button disabled={exportingVideoId !== null} onClick={() => void requestVideoExport(video)} type="button"><Download size={14}/>{exportingVideoId === video.id ? '导出中…' : '下载视频'}</button>
                  <button className="is-danger" onClick={() => void requestVideoRemove(video)} type="button"><Trash2 size={14}/>删除记录</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {media === 'audios' && visibleAudios.length > 0 && (
        <div className="audio-history-list">
          {visibleAudios.map((audio) => (
            <article className={`audio-history-card history-selectable${selectedIds.has(audio.id) ? ' is-selected' : ''}`} key={audio.id}>
              {batchMode && <button className="history-select-check" onClick={() => toggleSelected(audio.id)} title="选择" type="button">{selectedIds.has(audio.id) ? <Check size={13}/> : null}</button>}
              <span className="audio-history-icon"><AudioLines size={20}/></span>
              <div className="audio-history-content">
                <div><strong>{audio.title}</strong><span>{audio.model} · {audio.voiceId}</span></div>
                <p>{audio.text}</p>
                <audio controls preload="metadata" src={audioSource(audio.audioFileName)}/>
                <div className="audio-history-meta"><span>{formatAudioDuration(audio.durationMs)}</span><span>{audio.speed}×</span><span>音调 {audio.pitch > 0 ? `+${audio.pitch}` : audio.pitch}</span>{audio.emotion && <span>{audio.emotion}</span>}<time>{formatCreatedAt(audio.createdAt)}</time></div>
              </div>
              <div className="audio-history-actions">
                <button disabled={exportingAudioId !== null} onClick={() => void requestAudioExport(audio)} type="button"><Download size={14}/>{exportingAudioId === audio.id ? '导出中…' : '下载'}</button>
                <button className="is-danger" onClick={() => void requestAudioRemove(audio)} type="button"><Trash2 size={14}/>删除</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {visibleCount === 0 && totalCount === 0 && (
        <div className="empty-state history-empty">
          {media === 'images' ? <ImageOff size={32}/> : media === 'videos' ? <Video size={32}/> : <AudioLines size={32}/>}<h3>{media === 'images' ? '还没有图片生成记录' : media === 'videos' ? '还没有视频生成记录' : '还没有语音生成记录'}</h3>
          <p>{media === 'images' ? '从无限画布生成图片后，真实结果会自动保存到这里。' : media === 'videos' ? '从视频节点完成生成后，本地视频会自动保存到这里。' : '从语音节点完成生成后，本地音频会自动保存到这里。'}</p>
          <button className="primary-button compact" onClick={onNewCanvas} type="button"><Sparkles size={15}/> 新建无限画布</button>
        </div>
      )}

      {visibleCount === 0 && totalCount > 0 && (
        <div className="empty-state history-empty"><ImageOff size={32}/><h3>没有符合条件的结果</h3><p>请调整搜索词、模型或时间范围。</p></div>
      )}

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <section aria-label="生成详情" className="detail-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} type="button"><X size={18}/></button>
            <div className="detail-image" style={imageUrls[selected.id] ? undefined : { background: selected.palette }}>
              {imageUrls[selected.id] ? <img alt={selected.title} src={imageUrls[selected.id]}/> : <span>DRAW<br/>CANVAS</span>}
            </div>
            <div className="detail-content">
              <div className="detail-heading"><span className="status-dot"><Check size={12}/></span><div><h2>{selected.title}</h2><p>{formatCreatedAt(selected.createdAt)}</p></div></div>
              <div className="detail-section"><label>提示词</label><div className="prompt-box"><p>{selected.prompt}</p><button onClick={() => void copyText(selected.prompt, notify)} type="button"><Copy size={15}/>复制</button></div></div>
              <div className="detail-facts"><div><span>模型</span><strong>{selected.model}</strong></div><div><span>尺寸</span><strong>{selected.size}</strong></div></div>
              <div className="detail-tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <button className="primary-button detail-download" disabled={downloadingId !== null} onClick={() => void requestDownload(selected)} type="button"><Download size={17}/> {downloadingId === selected.id ? '正在导出…' : '下载图片'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function videoSource(fileName: string): string {
  return `drawcanvas-media://video/${encodeURIComponent(fileName)}`
}

function audioSource(fileName: string): string {
  return `drawcanvas-media://audio/${encodeURIComponent(fileName)}`
}

function formatAudioDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '时长未知'
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds} 秒`
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
  anchor.style.display = 'none'
  document.body.append(anchor)
  try {
    anchor.click()
    notify('图片已导出')
  } finally {
    anchor.remove()
  }
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
