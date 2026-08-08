import { Check, ChevronDown, Copy, Download, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ArtworkCard } from '../../components/ArtworkCard'
import { PageHeader } from '../../components/PageHeader'
import type { Artwork } from '../../domain/catalog'

type HistoryPageProps = Readonly<{
  artworks: ReadonlyArray<Artwork>
  notify: (message: string) => void
}>

export function HistoryPage({ artworks, notify }: HistoryPageProps) {
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('全部模型')
  const [selected, setSelected] = useState<Artwork | null>(null)
  const visible = useMemo(
    () => artworks.filter((item) =>
      (model === '全部模型' || item.model.includes(model)) &&
      `${item.title}${item.prompt}${item.model}`.toLowerCase().includes(query.toLowerCase()),
    ),
    [model, query],
  )

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
          <option>全部模型</option><option>Seedream</option><option>Gemini</option><option>GPT Image</option>
        </select><ChevronDown size={14} /></label>
        <button className="filter-chip is-active" type="button">全部</button>
        <button className="filter-chip" type="button">今天</button>
        <button className="filter-chip" type="button">本周</button>
        <span className="filter-result">共 {visible.length} 个结果</span>
      </div>
      <div className="artwork-grid">
        {visible.map((artwork) => <ArtworkCard artwork={artwork} key={artwork.id} onOpen={setSelected} />)}
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <section aria-label="生成详情" className="detail-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} type="button"><X size={18} /></button>
            <div className="detail-image" style={{ background: selected.palette }}><span>DRAW<br/>CANVAS</span></div>
            <div className="detail-content">
              <div className="detail-heading"><span className="status-dot"><Check size={12} /></span><div><h2>{selected.title}</h2><p>{selected.createdAt}</p></div></div>
              <div className="detail-section"><label>提示词</label><div className="prompt-box"><p>{selected.prompt}</p><button onClick={() => void copyText(selected.prompt, notify)} type="button"><Copy size={15} />复制</button></div></div>
              <div className="detail-facts"><div><span>模型</span><strong>{selected.model}</strong></div><div><span>尺寸</span><strong>{selected.size}</strong></div><div><span>生成耗时</span><strong>18.4 秒</strong></div><div><span>种子</span><strong>843291</strong></div></div>
              <div className="detail-tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <button className="primary-button detail-download" onClick={() => downloadArtwork(selected, notify)} type="button"><Download size={17} /> 下载图片</button>
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

function downloadArtwork(artwork: Artwork, notify: (message: string) => void): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#202637"/><stop offset=".55" stop-color="#7b4be6"/><stop offset="1" stop-color="#aaff00"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#g)"/><text x="70" y="1080" fill="white" font-family="Arial" font-size="72" font-weight="700">${artwork.title}</text></svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${artwork.title}.svg`
  anchor.click()
  URL.revokeObjectURL(url)
  notify('图片已导出')
}
