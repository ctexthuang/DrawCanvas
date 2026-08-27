import {
  AudioLines,
  Bot,
  Check,
  Database,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Route,
  Save,
  Trash2,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AddProviderModelRequest,
  AppSettings,
  CreateProviderRequest,
  ProviderConfig,
  ProviderConnectionTestResult,
  UpdateProviderModelRequest,
  UpdateProviderRequest,
} from '../../../shared/contracts/desktop'
import type {
  ConfiguredProviderModel,
  ModelKind,
  ModelRoutes,
  ProviderAdapterId,
} from '../../../shared/domain/models'

type SettingsSection = 'defaults' | 'providers' | 'catalog'

type ModelSettingsPageProps = Readonly<{
  settings: Pick<AppSettings, 'models' | 'modelRoutes' | 'providers'>
  onAddModel: (request: AddProviderModelRequest) => Promise<boolean>
  onClearProviderApiKey: (id: string) => Promise<boolean>
  onCreateProvider: (request: CreateProviderRequest) => Promise<boolean>
  onDiscoverProviderModels: (id: string) => Promise<boolean>
  onModelRoutesChange: (routes: ModelRoutes) => void
  onRemoveModel: (key: string) => Promise<boolean>
  onRemoveProvider: (id: string) => Promise<boolean>
  onSetModelEnabled: (key: string, enabled: boolean) => Promise<boolean>
  onSetProviderEnabled: (id: string, enabled: boolean) => Promise<boolean>
  onTestProvider: (id: string) => Promise<ProviderConnectionTestResult | null>
  onUpdateModel: (request: UpdateProviderModelRequest) => Promise<boolean>
  onUpdateProvider: (request: UpdateProviderRequest) => Promise<boolean>
}>

const modelKinds: ReadonlyArray<ModelKind> = ['chat', 'image', 'video', 'audio']
const routeSlotLabels = ['主选模型', '第二选择', '第三选择'] as const
const adapterLabels: Readonly<Record<ProviderAdapterId, string>> = {
  openai: 'OpenAI 官方协议',
  'openai-sub2api': 'OpenAI 兼容 / Sub2API',
  volcengine: '火山方舟协议',
  minimax: 'MiniMax 协议',
}
const kindMeta: Readonly<Record<ModelKind, { label: string; icon: typeof Bot }>> = {
  chat: { label: '对话', icon: MessageSquareText },
  image: { label: '图片', icon: ImageIcon },
  video: { label: '视频', icon: Video },
  audio: { label: '音频', icon: AudioLines },
}

export function ModelSettingsPage({
  settings,
  onAddModel,
  onClearProviderApiKey,
  onCreateProvider,
  onDiscoverProviderModels,
  onModelRoutesChange,
  onRemoveModel,
  onRemoveProvider,
  onSetModelEnabled,
  onSetProviderEnabled,
  onTestProvider,
  onUpdateModel,
  onUpdateProvider,
}: ModelSettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('defaults')
  const [activeProviderId, setActiveProviderId] = useState(settings.providers[0]?.id ?? '')
  const [creatingProvider, setCreatingProvider] = useState(false)

  useEffect(() => {
    if (!creatingProvider && !settings.providers.some((provider) => provider.id === activeProviderId)) {
      setActiveProviderId(settings.providers[0]?.id ?? '')
    }
  }, [activeProviderId, creatingProvider, settings.providers])

  const activeProvider = settings.providers.find((provider) => provider.id === activeProviderId)

  return (
    <div className="settings-layout model-settings-layout">
      <aside className="settings-sidebar model-settings-sidebar">
        <div className="settings-sidebar-heading"><h1>模型设置</h1><p>默认路由、API 服务与模型目录</p></div>
        <nav className="model-settings-nav" aria-label="模型设置分类">
          <button className={section === 'defaults' ? 'is-active' : ''} onClick={() => setSection('defaults')} type="button"><Route size={16}/><span><strong>默认模型</strong><small>主选与安全回退</small></span></button>
          <button className={section === 'providers' ? 'is-active' : ''} onClick={() => setSection('providers')} type="button"><Plug size={16}/><span><strong>API 服务</strong><small>地址、凭证与连接</small></span></button>
          <button className={section === 'catalog' ? 'is-active' : ''} onClick={() => setSection('catalog')} type="button"><Database size={16}/><span><strong>模型目录</strong><small>发现、添加与分类</small></span></button>
        </nav>
        <div className="settings-help"><KeyRound size={17}/><div><strong>密钥保存在本机</strong><p>API Key 通过系统安全存储加密；界面和 IPC 都不会回传明文。</p></div></div>
      </aside>

      <main className="settings-content model-settings-content">
        {section === 'defaults' && <DefaultRoutesView models={settings.models} onChange={onModelRoutesChange} providers={settings.providers} routes={settings.modelRoutes}/>}
        {section === 'providers' && (
          <ProviderSettingsView
            activeProvider={creatingProvider ? undefined : activeProvider}
            activeProviderId={activeProviderId}
            creating={creatingProvider}
            onClearApiKey={onClearProviderApiKey}
            onCreate={onCreateProvider}
            onDiscover={onDiscoverProviderModels}
            onRemove={onRemoveProvider}
            onSelect={(id) => { setCreatingProvider(false); setActiveProviderId(id) }}
            onSetCreating={setCreatingProvider}
            onSetEnabled={onSetProviderEnabled}
            onTest={onTestProvider}
            onUpdate={onUpdateProvider}
            providers={settings.providers}
          />
        )}
        {section === 'catalog' && <ModelCatalogView models={settings.models} onAdd={onAddModel} onRemove={onRemoveModel} onSetEnabled={onSetModelEnabled} onUpdate={onUpdateModel} providers={settings.providers}/>}
      </main>
    </div>
  )
}

function DefaultRoutesView({ models, onChange, providers, routes }: Readonly<{
  models: ReadonlyArray<ConfiguredProviderModel>
  onChange: (routes: ModelRoutes) => void
  providers: ReadonlyArray<ProviderConfig>
  routes: ModelRoutes
}>) {
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  function setRouteSlot(kind: ModelKind, index: number, modelKey: string): void {
    const current = [...(routes[kind]?.modelKeys ?? [])]
    if (modelKey) current[index] = modelKey
    else current.splice(index, 1)
    const modelKeys = [...new Set(current.filter(Boolean))].slice(0, 3)
    const next: Partial<Record<ModelKind, { modelKeys: ReadonlyArray<string> }>> = { ...routes }
    if (modelKeys.length) next[kind] = { modelKeys }
    else delete next[kind]
    onChange(next)
  }

  return (
    <div className="model-settings-view">
      <header className="model-settings-header"><div><h2>默认模型</h2><p>节点选择“跟随默认”时按顺序调用；网络、超时、限流或服务端错误才会尝试下一项。</p></div></header>
      <div className="default-route-grid">
        {modelKinds.map((kind) => {
          const meta = kindMeta[kind]
          const Icon = meta.icon
          const options = models.filter((model) => model.kind === kind)
          const selected = routes[kind]?.modelKeys ?? []
          return <section className="default-route-section" key={kind}>
            <div className="default-route-title"><span><Icon size={17}/></span><div><h3>{meta.label}模型</h3><p>{selected.length ? `已配置 ${selected.length} 级路由` : '尚未设置默认模型'}</p></div></div>
            <div className="default-route-slots">
              {routeSlotLabels.map((label, index) => <label key={label}>
                <span>{label}</span>
                <select disabled={options.length === 0 || (index > 0 && !selected[index - 1])} onChange={(event) => setRouteSlot(kind, index, event.target.value)} value={selected[index] ?? ''}>
                  <option value="">未设置</option>
                  {options.map((model) => {
                    const provider = providerById.get(model.providerId)
                    const isUsable = model.enabled && model.available && provider?.enabled === true
                    const isUsedElsewhere = selected.some((key, slot) => key === model.key && slot !== index)
                    return <option disabled={!isUsable || isUsedElsewhere} key={model.key} value={model.key}>{model.displayName} · {provider?.name ?? model.providerId}{isUsable ? '' : '（不可用）'}</option>
                  })}
                </select>
              </label>)}
            </div>
          </section>
        })}
      </div>
    </div>
  )
}

function ProviderSettingsView({ activeProvider, activeProviderId, creating, onClearApiKey, onCreate, onDiscover, onRemove, onSelect, onSetCreating, onSetEnabled, onTest, onUpdate, providers }: Readonly<{
  activeProvider?: ProviderConfig
  activeProviderId: string
  creating: boolean
  onClearApiKey: (id: string) => Promise<boolean>
  onCreate: (request: CreateProviderRequest) => Promise<boolean>
  onDiscover: (id: string) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onSelect: (id: string) => void
  onSetCreating: (value: boolean) => void
  onSetEnabled: (id: string, enabled: boolean) => Promise<boolean>
  onTest: (id: string) => Promise<ProviderConnectionTestResult | null>
  onUpdate: (request: UpdateProviderRequest) => Promise<boolean>
  providers: ReadonlyArray<ProviderConfig>
}>) {
  const [name, setName] = useState('')
  const [adapterId, setAdapterId] = useState<ProviderAdapterId>('openai-sub2api')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ProviderConnectionTestResult | null>(null)

  useEffect(() => {
    setName(activeProvider?.name ?? '')
    setAdapterId(activeProvider?.adapterId ?? 'openai-sub2api')
    setBaseUrl(activeProvider?.baseUrl ?? '')
    setApiKey('')
    setShowKey(false)
    setTestResult(null)
  }, [activeProvider, creating])

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  const baseUrlError = getBaseUrlError(normalizedBaseUrl, adapterId)
  const isDirty = creating || Boolean(activeProvider && (name.trim() !== activeProvider.name || adapterId !== activeProvider.adapterId || normalizedBaseUrl !== activeProvider.baseUrl || apiKey.trim()))

  async function save(): Promise<void> {
    if (!name.trim() || baseUrlError) return
    setBusy('save')
    const request = { name: name.trim(), adapterId, baseUrl: normalizedBaseUrl, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }
    const saved = creating
      ? await onCreate(request)
      : activeProvider
        ? await onUpdate({ id: activeProvider.id, ...request })
        : false
    setBusy(null)
    if (saved) { setApiKey(''); setShowKey(false); onSetCreating(false) }
  }

  async function runProviderAction(action: 'test' | 'discover'): Promise<void> {
    if (!activeProvider) return
    setBusy(action)
    if (action === 'test') setTestResult(await onTest(activeProvider.id))
    else await onDiscover(activeProvider.id)
    setBusy(null)
  }

  return (
    <div className="model-settings-view">
      <header className="model-settings-header"><div><h2>API 服务</h2><p>服务实例可以自由新增、修改和删除；协议适配器决定实际请求格式。</p></div><button className="primary-button compact" onClick={() => onSetCreating(true)} type="button"><Plus size={15}/>新增服务</button></header>
      <div className="provider-workspace">
        <div className="provider-directory">
          {providers.map((provider) => <button className={provider.id === activeProviderId && !creating ? 'is-active' : ''} key={provider.id} onClick={() => onSelect(provider.id)} type="button"><span className="provider-mark">{provider.name.slice(0, 1).toUpperCase()}</span><span><strong>{provider.name}</strong><small>{adapterLabels[provider.adapterId]} · {provider.modelCount} 个模型</small></span><i className={provider.connectionStatus === 'connected' ? 'is-connected' : provider.connectionStatus === 'failed' ? 'is-failed' : ''}/></button>)}
          {providers.length === 0 && <div className="model-empty"><Plug size={22}/><strong>还没有 API 服务</strong><p>新增服务后即可连接并获取模型。</p></div>}
        </div>
        <section className="provider-editor">
          <div className="panel-title"><div><h3>{creating ? '新增 API 服务' : activeProvider?.name ?? '选择 API 服务'}</h3><p>{creating ? '选择协议适配器并填写服务地址' : activeProvider ? `${adapterLabels[activeProvider.adapterId]} · ${activeProvider.enabled ? '已启用' : '已停用'}` : '从左侧选择一个服务进行编辑'}</p></div>{activeProvider && <button aria-checked={activeProvider.enabled} className={activeProvider.enabled ? 'provider-toggle standalone is-enabled' : 'provider-toggle standalone'} disabled={Boolean(busy)} onClick={() => void onSetEnabled(activeProvider.id, !activeProvider.enabled)} role="switch" type="button"><span/></button>}</div>
          {(creating || activeProvider) && <>
            <div className="provider-form-grid">
              <label><span>服务名称</span><input disabled={Boolean(busy)} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="例如：团队中转站" value={name}/></label>
              <label><span>协议适配器</span><select disabled={Boolean(busy)} onChange={(event) => { const next = event.target.value as ProviderAdapterId; setAdapterId(next); if (next === 'openai') setBaseUrl('https://api.openai.com/v1') }} value={adapterId}>{Object.entries(adapterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="span-two"><span>Base URL</span><input aria-invalid={Boolean(baseUrlError)} disabled={Boolean(busy) || adapterId === 'openai'} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" value={baseUrl}/>{baseUrlError && <small className="field-error">{baseUrlError}</small>}</label>
              <label className="span-two"><span>API Key</span><div className="password-field"><input autoComplete="off" disabled={Boolean(busy)} onChange={(event) => setApiKey(event.target.value)} placeholder={activeProvider?.hasApiKey ? '已安全保存，输入新密钥可覆盖' : 'sk-...'} type={showKey ? 'text' : 'password'} value={apiKey}/><button aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)} type="button">{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
            </div>
            {testResult && <div className={`connection-result ${testResult.connected ? 'is-success' : 'is-error'}`} role="status"><span>{testResult.connected ? testResult.message : testResult.error.message}</span>{testResult.latencyMs !== undefined && <small>{testResult.latencyMs} ms</small>}</div>}
            <div className="provider-config-actions">
              {activeProvider && <button className="text-danger-button" disabled={Boolean(busy)} onClick={async () => { if (!window.confirm(`确定删除“${activeProvider.name}”及其全部模型吗？`)) return; setBusy('remove'); await onRemove(activeProvider.id); setBusy(null) }} type="button"><Trash2 size={14}/>删除服务</button>}
              {activeProvider?.hasApiKey && <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => void onClearApiKey(activeProvider.id)} type="button"><KeyRound size={14}/>清除密钥</button>}
              {activeProvider && <button className="secondary-button compact" disabled={Boolean(busy) || isDirty || !activeProvider.hasApiKey} onClick={() => void runProviderAction('test')} type="button">{busy === 'test' ? <LoaderCircle className="spin" size={14}/> : <Plug size={14}/>}测试连接</button>}
              {activeProvider && <button className="secondary-button compact" disabled={Boolean(busy) || isDirty || !activeProvider.hasApiKey} onClick={() => void runProviderAction('discover')} type="button">{busy === 'discover' ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}获取模型</button>}
              <button className="primary-button compact" disabled={Boolean(busy) || !name.trim() || Boolean(baseUrlError) || !isDirty} onClick={() => void save()} type="button"><Save size={15}/>{busy === 'save' ? '保存中...' : '保存'}</button>
            </div>
          </>}
        </section>
      </div>
    </div>
  )
}

function ModelCatalogView({ models, onAdd, onRemove, onSetEnabled, onUpdate, providers }: Readonly<{
  models: ReadonlyArray<ConfiguredProviderModel>
  onAdd: (request: AddProviderModelRequest) => Promise<boolean>
  onRemove: (key: string) => Promise<boolean>
  onSetEnabled: (key: string, enabled: boolean) => Promise<boolean>
  onUpdate: (request: UpdateProviderModelRequest) => Promise<boolean>
  providers: ReadonlyArray<ProviderConfig>
}>) {
  const [kind, setKind] = useState<ModelKind>('chat')
  const [providerId, setProviderId] = useState('all')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [remoteModelId, setRemoteModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [editKind, setEditKind] = useState<ModelKind>('chat')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const visibleModels = models.filter((model) => model.kind === kind && (providerId === 'all' || model.providerId === providerId))
  const editingModel = models.find((model) => model.key === editingKey)

  useEffect(() => {
    if (!editingModel) return
    setDisplayName(editingModel.displayName)
    setEditKind(editingModel.kind)
  }, [editingModel])

  async function saveManualModel(): Promise<void> {
    const targetProviderId = providerId === 'all' ? providers[0]?.id : providerId
    if (!targetProviderId || !remoteModelId.trim() || !displayName.trim()) return
    setBusyKey('add')
    const saved = await onAdd({ providerId: targetProviderId, remoteModelId: remoteModelId.trim(), displayName: displayName.trim(), kind: editKind })
    setBusyKey(null)
    if (saved) { setAdding(false); setRemoteModelId(''); setDisplayName('') }
  }

  return (
    <div className="model-settings-view">
      <header className="model-settings-header"><div><h2>模型目录</h2><p>从服务端获取的模型和手动模型都可修改分类、显示名及启用状态。</p></div><button className="primary-button compact" disabled={providers.length === 0} onClick={() => { setAdding(true); setEditingKey(null); setEditKind(kind); setDisplayName('') }} type="button"><Plus size={15}/>添加模型</button></header>
      <div className="model-catalog-toolbar">
        <div className="model-type-tabs">{modelKinds.map((entry) => { const Icon = kindMeta[entry].icon; return <button className={entry === kind ? 'is-active' : ''} key={entry} onClick={() => setKind(entry)} type="button"><Icon size={15}/>{kindMeta[entry].label}</button> })}</div>
        <select aria-label="筛选 API 服务" onChange={(event) => setProviderId(event.target.value)} value={providerId}><option value="all">全部 API 服务</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
      </div>
      {(adding || editingModel) && <section className="model-editor-strip">
        <div><strong>{adding ? '添加手动模型' : '修改模型'}</strong><small>{adding ? '模型 ID 会与 API 服务组成唯一键' : editingModel?.remoteModelId}</small></div>
        {adding && <select aria-label="API 服务" onChange={(event) => setProviderId(event.target.value)} value={providerId === 'all' ? providers[0]?.id ?? '' : providerId}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>}
        {adding && <input maxLength={200} onChange={(event) => setRemoteModelId(event.target.value)} placeholder="远端模型 ID" value={remoteModelId}/>}
        <input maxLength={200} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" value={displayName}/>
        <select aria-label="模型类型" onChange={(event) => setEditKind(event.target.value as ModelKind)} value={editKind}>{modelKinds.map((entry) => <option key={entry} value={entry}>{kindMeta[entry].label}</option>)}</select>
        <button className="secondary-button compact" onClick={() => { setAdding(false); setEditingKey(null) }} type="button">取消</button>
        <button className="primary-button compact" disabled={Boolean(busyKey) || !displayName.trim() || (adding && !remoteModelId.trim())} onClick={async () => { if (adding) return saveManualModel(); if (!editingModel) return; setBusyKey(editingModel.key); await onUpdate({ key: editingModel.key, displayName: displayName.trim(), kind: editKind }); setBusyKey(null); setEditingKey(null) }} type="button"><Save size={14}/>保存</button>
      </section>}
      <div className="model-catalog-list">
        {visibleModels.map((model) => {
          const provider = providers.find((item) => item.id === model.providerId)
          return <div className={`${model.enabled ? 'model-catalog-row is-enabled' : 'model-catalog-row'}${model.available ? '' : ' is-unavailable'}`} key={model.key}>
            <span className="model-icon"><Bot size={18}/></span>
            <span className="model-copy"><span><strong>{model.displayName}</strong>{model.badge && <em>{model.badge}</em>}{!model.available && <em>当前未发现</em>}</span><small>{model.remoteModelId}</small></span>
            <span className="model-source">{provider?.name ?? model.providerId}<small>{model.source === 'manual' ? '手动' : model.source === 'discovered' ? '已获取' : '内置映射'}</small></span>
            <button aria-label={`编辑 ${model.displayName}`} className="icon-button" onClick={() => { setAdding(false); setEditingKey(model.key) }} title="编辑模型" type="button"><Pencil size={14}/></button>
            <button aria-label={`删除 ${model.displayName}`} className="icon-button danger" disabled={busyKey === model.key} onClick={async () => { if (!window.confirm(`确定删除模型“${model.displayName}”吗？`)) return; setBusyKey(model.key); await onRemove(model.key); setBusyKey(null) }} title="删除模型" type="button"><Trash2 size={14}/></button>
            <button aria-checked={model.enabled} aria-label={`${model.enabled ? '停用' : '启用'} ${model.displayName}`} className={model.enabled ? 'provider-toggle standalone is-enabled' : 'provider-toggle standalone'} disabled={busyKey === model.key} onClick={async () => { setBusyKey(model.key); await onSetEnabled(model.key, !model.enabled); setBusyKey(null) }} role="switch" type="button"><span/>{model.enabled && <Check className="visually-hidden" size={1}/>}</button>
          </div>
        })}
        {visibleModels.length === 0 && <div className="model-empty"><Database size={22}/><strong>没有符合条件的模型</strong><p>可在 API 服务中获取模型，或手动添加模型 ID。</p></div>}
      </div>
    </div>
  )
}

function getBaseUrlError(value: string, adapterId: ProviderAdapterId): string | null {
  if (!value) return '请输入接口地址'
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return '地址不能包含账号、查询参数或片段'
    if (adapterId === 'openai' && value !== 'https://api.openai.com/v1') return 'OpenAI 官方地址不可修改'
    const isLoopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return url.protocol === 'https:' || (adapterId === 'openai-sub2api' && isLoopback)
      ? null
      : '仅支持 HTTPS；本机 OpenAI 中转可使用 HTTP'
  } catch {
    return '接口地址格式无效'
  }
}
