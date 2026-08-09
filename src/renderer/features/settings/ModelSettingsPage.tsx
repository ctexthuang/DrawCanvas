import {
  AudioLines,
  Bot,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  Save,
  Star,
  Trash2,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ProviderConfig,
  ProviderConnectionTestResult,
  SaveProviderRequest,
  TestProviderRequest,
} from '../../../shared/contracts/desktop'
import {
  BUILTIN_PROVIDER_MODELS,
  createProviderModelKey,
  type ModelKind,
  type ProviderModelDefinition,
} from '../../../shared/domain/models'

type DefaultModelKeys = Readonly<Partial<Record<ModelKind, string>>>

type ModelSettingsPageProps = Readonly<{
  providers: ReadonlyArray<ProviderConfig>
  enabledModelKeys: ReadonlyArray<string>
  defaultModelKeys: DefaultModelKeys
  onSaveProvider: (request: SaveProviderRequest) => Promise<boolean>
  onTestProvider: (request: TestProviderRequest) => Promise<ProviderConnectionTestResult | null>
  onClearProviderApiKey: (id: string) => Promise<boolean>
  onSetProviderEnabled: (id: string, enabled: boolean) => Promise<boolean>
  onModelConfigChange: (
    enabledModelKeys: ReadonlyArray<string>,
    defaultModelKeys: DefaultModelKeys,
  ) => void
}>

const providerNames: Readonly<Record<string, Readonly<{ name: string; subtitle: string; mark: string }>>> = {
  // apimart: { name: 'APIMart', subtitle: 'Gemini 图像模型', mark: 'A' },
  volcengine: { name: '火山引擎', subtitle: '豆包全模态模型', mark: '火' },
  minimax: { name: 'MiniMax', subtitle: 'H3 / M3 / Speech', mark: 'M' },
  // comfly: { name: 'Comfly', subtitle: '接口发现模型', mark: 'C' },
  openai: { name: 'OpenAI', subtitle: '官方 API', mark: 'O' },
  'openai-sub2api': { name: 'OpenAI 中转', subtitle: 'sub2api 兼容站', mark: 'S' },
}

const disabledProviderIds = new Set(['apimart', 'comfly'])

const statusLabels = {
  untested: '未测试',
  connected: '已连接',
  failed: '连接失败',
} as const

const modelKindLabels: Readonly<Record<ModelKind, string>> = {
  image: '图像模型',
  video: '视频模型',
  chat: '对话模型',
  audio: '语音模型',
}

export function ModelSettingsPage({
  providers,
  enabledModelKeys,
  defaultModelKeys,
  onSaveProvider,
  onTestProvider,
  onClearProviderApiKey,
  onSetProviderEnabled,
  onModelConfigChange,
}: ModelSettingsPageProps) {
  const visibleProviders = providers.filter((item) => !disabledProviderIds.has(item.id))
  const initialProviderId = visibleProviders.some((item) => item.id === 'openai')
    ? 'openai'
    : visibleProviders[0]?.id ?? 'openai'
  const [activeProvider, setActiveProvider] = useState(initialProviderId)
  const provider = visibleProviders.find((item) => item.id === activeProvider) ?? visibleProviders[0]
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [togglingProviderId, setTogglingProviderId] = useState<string | null>(null)
  const [modelKind, setModelKind] = useState<ModelKind>('image')
  const [testResult, setTestResult] = useState<ProviderConnectionTestResult | null>(null)

  useEffect(() => {
    setBaseUrl(provider?.baseUrl ?? '')
    setApiKey('')
    setShowKey(false)
    setTestResult(null)
  }, [provider?.baseUrl, provider?.id])

  const baseUrlError = getBaseUrlError(baseUrl, provider?.id)
  const isDirty = Boolean(provider && (baseUrl.trim().replace(/\/+$/, '') !== provider.baseUrl || apiKey.trim()))
  const busy = saving || testing || clearing || togglingProviderId === provider?.id
  const effectiveProvider = testResult?.provider ?? provider
  const currentStatus = effectiveProvider?.connectionStatus ?? 'untested'
  const availableModelIds = effectiveProvider?.availableModelIds ?? []
  const visibleModels = useMemo(() => {
    if (!effectiveProvider) return []
    const builtinModels = BUILTIN_PROVIDER_MODELS.filter((model) =>
      model.providerId === effectiveProvider.id && model.kind === modelKind,
    )
    const builtinKeys = new Set(builtinModels.map((model) => model.key))
    const discoveredModels: ReadonlyArray<ProviderModelDefinition> = availableModelIds
      .map((remoteModelId) => ({
        key: createProviderModelKey(effectiveProvider.id, remoteModelId),
        providerId: effectiveProvider.id,
        remoteModelId,
        displayName: remoteModelId,
        kind: inferModelKind(remoteModelId),
        description: '由当前服务商的模型列表接口发现',
      }))
      .filter((model) => model.kind === modelKind && !builtinKeys.has(model.key))
    return [...builtinModels, ...discoveredModels]
  }, [availableModelIds, effectiveProvider, modelKind])
  const providerEnabledCount = enabledModelKeys.filter((key) => key.startsWith(`${provider?.id}:`)).length

  async function saveProvider(): Promise<void> {
    if (!provider || baseUrlError) return
    setSaving(true)
    const saved = await onSaveProvider({
      id: provider.id,
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    })
    setSaving(false)
    if (saved) {
      setApiKey('')
      setShowKey(false)
      setTestResult(null)
    }
  }

  async function testProviderConnection(): Promise<void> {
    if (!provider || baseUrlError) return
    if (!apiKey.trim() && !provider.hasApiKey) {
      setTestResult({
        connected: false,
        provider,
        error: { code: 'AUTHENTICATION', message: '请先输入 API Key' },
      })
      return
    }
    setTesting(true)
    setTestResult(null)
    const result = await onTestProvider({
      id: provider.id,
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    })
    setTesting(false)
    setTestResult(result)
  }

  async function clearApiKey(): Promise<void> {
    if (!provider?.hasApiKey || !window.confirm('确定清除这个服务商保存在本机的 API Key 吗？')) return
    setClearing(true)
    const cleared = await onClearProviderApiKey(provider.id)
    setClearing(false)
    if (cleared) {
      setApiKey('')
      setTestResult(null)
    }
  }

  async function toggleProviderEnabled(item: ProviderConfig): Promise<void> {
    if (togglingProviderId) return
    setTogglingProviderId(item.id)
    try {
      await onSetProviderEnabled(item.id, !item.enabled)
    } finally {
      setTogglingProviderId(null)
    }
  }

  function toggleModel(model: ProviderModelDefinition): void {
    if (!provider?.enabled) return
    if (enabledModelKeys.includes(model.key)) {
      const nextEnabledModelKeys = enabledModelKeys.filter((key) => key !== model.key)
      const nextDefaultModelKeys = defaultModelKeys[model.kind] === model.key
        ? withoutDefaultModel(defaultModelKeys, model.kind)
        : defaultModelKeys
      onModelConfigChange(nextEnabledModelKeys, nextDefaultModelKeys)
      return
    }
    const nextEnabledModelKeys = [...enabledModelKeys, model.key]
    const nextDefaultModelKeys = defaultModelKeys[model.kind]
      ? defaultModelKeys
      : { ...defaultModelKeys, [model.kind]: model.key }
    onModelConfigChange(nextEnabledModelKeys, nextDefaultModelKeys)
  }

  function setDefaultModel(model: ProviderModelDefinition): void {
    if (!provider?.enabled) return
    const nextEnabledModelKeys = enabledModelKeys.includes(model.key)
      ? enabledModelKeys
      : [...enabledModelKeys, model.key]
    onModelConfigChange(nextEnabledModelKeys, { ...defaultModelKeys, [model.kind]: model.key })
  }

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-heading"><h1>模型设置</h1><p>配置服务商与可用模型</p></div>
        <span className="settings-label">服务商</span>
        <div className="provider-list">
          {visibleProviders.map((item) => {
            const display = providerNames[item.id] ?? { name: item.id, subtitle: '自定义服务', mark: item.id[0]?.toUpperCase() ?? '?' }
            return <div className={item.id === activeProvider ? 'provider-row is-active' : 'provider-row'} key={item.id}>
              <button className="provider-button" onClick={() => setActiveProvider(item.id)} type="button">
                <span className={`provider-mark mark-${item.id}`}>{display.mark}</span>
                <span><strong>{display.name}</strong><small>{item.enabled ? display.subtitle : '已停用'}</small></span>
                <ChevronRight size={15} />
              </button>
              <button
                aria-checked={item.enabled}
                aria-label={`${item.enabled ? '停用' : '启用'}${display.name}`}
                className={item.enabled ? 'provider-toggle is-enabled' : 'provider-toggle'}
                disabled={Boolean(togglingProviderId)}
                onClick={() => void toggleProviderEnabled(item)}
                role="switch"
                type="button"
              >
                <span />
              </button>
            </div>
          })}
        </div>
        <div className="settings-help"><KeyRound size={17} /><div><strong>密钥保存在本机</strong><p>API Key 使用系统安全存储加密，不会发送给 Draw Canvas。</p></div></div>
      </aside>

      <div className="settings-content">
        <section className="settings-panel provider-config-panel">
          <div className="panel-title"><div><h2>{providerNames[provider?.id ?? '']?.name ?? provider?.id}</h2><p>{provider?.id === 'openai' ? '使用 OpenAI 官方 API 与独立访问凭证' : provider?.id === 'openai-sub2api' ? '配置兼容 sub2api 的 OpenAI 中转站' : '配置服务商 API 根地址与访问凭证'}</p></div><span className={`connection-badge is-${provider?.enabled ? currentStatus : 'disabled'}`}><i />{provider?.enabled ? (testing ? '测试中' : statusLabels[currentStatus]) : '已停用'}</span></div>
          <div className="form-grid">
            <label><span>Base URL</span><input aria-invalid={Boolean(baseUrlError)} disabled={busy || provider?.id === 'openai'} onChange={(event) => { setBaseUrl(event.target.value); setTestResult(null) }} placeholder={provider?.id === 'openai-sub2api' ? 'https://your-sub2api.example.com' : 'https://api.example.com/v1'} value={baseUrl} />{baseUrlError && <small className="field-error">{baseUrlError}</small>}{provider?.id === 'openai' && <small className="field-hint">官方地址固定为 https://api.openai.com/v1</small>}{provider?.id === 'openai-sub2api' && <small className="field-hint">支持填写 sub2api 根地址或 /v1 地址；本机服务可使用 http://localhost。</small>}</label>
            <label><span>API Key</span><div className="password-field"><input autoComplete="off" disabled={busy} onChange={(event) => { setApiKey(event.target.value); setTestResult(null) }} placeholder={provider?.hasApiKey ? '已安全保存 · 输入新密钥可覆盖' : 'sk-...'} type={showKey ? 'text' : 'password'} value={apiKey} /><button aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} disabled={busy} onClick={() => setShowKey(!showKey)} type="button">{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
          </div>
          {testResult && <div className={`connection-result ${testResult.connected ? 'is-success' : 'is-error'}`} role="status">
            <span>{testResult.connected ? testResult.message : testResult.error.message}</span>
            {testResult.latencyMs !== undefined && <small>{testResult.latencyMs} ms</small>}
          </div>}
          <div className="provider-config-actions">
            {provider?.hasApiKey && <button className="text-danger-button" disabled={busy} onClick={() => void clearApiKey()} type="button"><Trash2 size={14}/>{clearing ? '清除中...' : '清除密钥'}</button>}
            <button className="secondary-button compact" disabled={busy || Boolean(baseUrlError) || !baseUrl.trim()} onClick={() => void testProviderConnection()} type="button">{testing && <LoaderCircle className="spin" size={14}/>} {testing ? '测试中...' : '测试连接'}</button>
            <button className="primary-button compact" disabled={busy || Boolean(baseUrlError) || !baseUrl.trim() || !isDirty} onClick={() => void saveProvider()} type="button"><Save size={15} />{saving ? '保存中...' : '保存配置'}</button>
          </div>
        </section>

        <section className="settings-panel model-selection-panel">
          <div className="panel-title"><div><h2>服务商模型</h2><p>当前只显示并运行所选服务商映射的模型</p></div><span className="selected-count">{provider?.enabled ? `当前服务商启用 ${providerEnabledCount} · 总计 ${enabledModelKeys.length}` : `已停用 · 保留 ${providerEnabledCount} 个模型`}</span></div>
          {!provider?.enabled && <div className="provider-disabled-notice">启用服务商后才能调整模型或设为默认运行模型，原有选择和 API Key 已保留。</div>}
          <div className="model-type-tabs">
            <button className={modelKind === 'image' ? 'is-active' : ''} onClick={() => setModelKind('image')} type="button"><ImageIcon size={16}/> 图像模型</button>
            <button className={modelKind === 'video' ? 'is-active' : ''} onClick={() => setModelKind('video')} type="button"><Video size={16}/> 视频模型</button>
            <button className={modelKind === 'chat' ? 'is-active' : ''} onClick={() => setModelKind('chat')} type="button"><MessageSquareText size={16}/> 对话模型</button>
            <button className={modelKind === 'audio' ? 'is-active' : ''} onClick={() => setModelKind('audio')} type="button"><AudioLines size={16}/> 语音模型</button>
          </div>
          <div className="model-groups">
            {visibleModels.length === 0 && <div className="model-empty"><Bot size={22}/><strong>该服务商暂无{modelKindLabels[modelKind]}</strong><p>测试连接后，接口发现的模型会自动映射到当前服务商。</p></div>}
            {visibleModels.length > 0 && <div className="model-group">
              <h3>{providerNames[provider?.id ?? '']?.name ?? provider?.id} · {modelKindLabels[modelKind]}</h3>
              {visibleModels.map((model) => {
                const enabled = enabledModelKeys.includes(model.key)
                const isDefault = defaultModelKeys[model.kind] === model.key
                return <div className={`${enabled ? 'model-option is-selected' : 'model-option'}${provider?.enabled ? '' : ' is-disabled'}`} key={model.key}>
                  <button className="model-option-toggle" disabled={!provider?.enabled} onClick={() => toggleModel(model)} type="button">
                    <span className="model-icon"><Bot size={19}/></span>
                    <span className="model-copy"><span><strong>{model.displayName}</strong>{isDefault ? <em>默认运行</em> : model.badge && <em>{model.badge}</em>}</span><small>{model.description}</small></span>
                    <span className="model-vendor">{providerNames[model.providerId]?.name ?? model.providerId}</span>
                    <span className="model-checkbox">{enabled && <Check size={14}/>}</span>
                  </button>
                  <button aria-label={`设为默认${modelKindLabels[model.kind]}`} className={isDefault ? 'model-default-button is-default' : 'model-default-button'} disabled={!provider?.enabled} onClick={() => setDefaultModel(model)} title={isDefault ? '当前默认运行模型' : '设为默认运行模型'} type="button"><Star fill={isDefault ? 'currentColor' : 'none'} size={14}/></button>
                </div>
              })}
            </div>}
          </div>
        </section>
      </div>
    </div>
  )
}

function getBaseUrlError(value: string, providerId: string | undefined): string | null {
  if (!value.trim()) return '请输入接口地址'
  try {
    const url = new URL(value.trim())
    if (url.username || url.password || url.search || url.hash) {
      return '地址不能包含账号、查询参数或片段'
    }
    const normalized = url.toString().replace(/\/+$/, '')
    if (providerId === 'openai') {
      return normalized === 'https://api.openai.com/v1' ? null : 'OpenAI 官方地址不可修改'
    }
    const isLoopbackRelay = providerId === 'openai-sub2api' &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    return url.protocol === 'https:' || isLoopbackRelay
      ? null
      : '仅支持 HTTPS；本机中转可使用 HTTP'
  } catch {
    return '接口地址格式无效'
  }
}

function inferModelKind(remoteModelId: string): ModelKind {
  const value = remoteModelId.toLowerCase()
  if (/(speech|audio|voice|tts|music)/.test(value)) return 'audio'
  if (/(video|veo|sora|seedance|kling|wan.*video)/.test(value)) return 'video'
  if (/(image|seedream|flux|dall|midjourney|recraft|ideogram)/.test(value)) return 'image'
  return 'chat'
}

function withoutDefaultModel(defaults: DefaultModelKeys, kind: ModelKind): DefaultModelKeys {
  return Object.fromEntries(Object.entries(defaults).filter(([entryKind]) => entryKind !== kind))
}
