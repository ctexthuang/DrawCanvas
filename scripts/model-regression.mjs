import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'drawcanvas-model-regression-'))
const requests = []
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6RF8AAAAASUVORK5CYII=', 'base64')
let responseStatus = 200
const electron = {
  app: {
    isPackaged: false,
    getPath: () => temporaryDirectory,
    getAppPath: () => temporaryDirectory,
  },
  safeStorage: {},
  net: {
    fetch: async (url, options) => {
      assert.equal(new URL(url).hostname, 'models.example', 'Only mocked endpoints are allowed')
      requests.push({ url, ...options })
      return Response.json(responseStatus === 200
        ? { data: [{ b64_json: pngBytes.toString('base64') }] }
        : { error: { message: 'Simulated provider rejection' } }, { status: responseStatus })
    },
  },
}

// Use Vite's existing TS loader and replace Electron before loading application code.
globalThis.__modelRegressionElectron = electron
let server
try {
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    ssr: { noExternal: ['electron'] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [{
      name: 'model-regression-electron',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'electron/main') return '\0model-regression-electron'
      },
      load(id) {
        if (id === '\0model-regression-electron') {
          return 'export const { app, safeStorage, net } = globalThis.__modelRegressionElectron'
        }
      },
    }],
  })
  const domain = await server.ssrLoadModule('/src/shared/domain/models.ts')
  const { AppState } = await server.ssrLoadModule('/src/main/application/app-state.ts')
  const { ImageGenerationService } = await server.ssrLoadModule('/src/main/application/image-generation-service.ts')
  const { generateOpenAiCompatibleImage } = await server.ssrLoadModule('/src/main/infrastructure/image-generation-client.ts')
  const aliases = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']
  const modelIds = aliases.flatMap((id) => [id, `${id}-2026-09-08`])
  const expectedSizes = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840']
  assert.equal(domain.DEFAULT_IMAGE_MODEL_KEY, 'openai:gpt-image-2')
  assert.equal(domain.findBuiltinModelByKey('openai:gpt-image-2.5'), undefined)
  for (const adapterId of ['openai', 'openai-sub2api']) {
    for (const id of modelIds) {
      const key = domain.createProviderModelKey('custom-provider', id)
      const model = domain.findBuiltinModelByKey(key, adapterId)
      assert.equal(model?.kind, 'image')
      assert.equal(model.remoteModelId, id)
      assert.equal(domain.inferModelKind(id), 'image')
      assert.deepEqual(domain.imageGenerationSizeOptionsForModel(key, adapterId).map((option) => option.value), expectedSizes)
      for (const size of expectedSizes) {
        assert.ok(domain.isImageGenerationSizeSupported(key, size, adapterId))
        assert.equal(domain.normalizeImageGenerationSize(key, size, adapterId), size)
      }
      for (const mapping of model.imageSizeMappings) {
        const [width, height] = mapping.value.split('x').map(Number)
        assert.equal(width % 16, 0)
        assert.equal(height % 16, 0)
        assert.ok(Math.max(width, height) <= 3840)
        assert.ok(Math.max(width, height) / Math.min(width, height) <= 3)
        assert.ok(width * height >= 655_360 && width * height <= 8_294_400)
      }
      assert.equal(domain.isImageGenerationSizeSupported(key, '720x1280', adapterId), false)
      assert.equal(domain.normalizeImageGenerationSize(key, '720x1280', adapterId), '2160x3840')
      assert.equal(domain.findBuiltinModelByKey(key, 'minimax'), undefined)
      assert.equal(domain.isImageGenerationSizeSupported(key, 'auto', 'apimart'), false)
    }
  }
  assert.equal(domain.isImageGenerationSizeSupported('custom:unknown-image', 'auto', 'openai'), false)
  assert.equal(domain.isImageGenerationSizeSupported('custom:gpt-image-1', '3840x2160', 'openai'), false)
  console.log('PASS: model aliases, snapshots, adapter isolation and image sizes')

  let state = new AppState()
  assert.deepEqual((await state.loadSettings()).models, [])
  const providers = []
  for (const adapterId of ['openai', 'openai-sub2api']) {
    const settings = await state.createProvider({
      name: adapterId, adapterId, baseUrl: 'https://models.example/v1',
    })
    const provider = settings.providers.find((item) => item.name === adapterId)
    assert.ok(provider)
    providers.push(provider)
    assert.equal(settings.models.filter((model) => model.providerId === provider.id).length, 0)
    await state.syncProviderModels(provider.id, modelIds.map((remoteModelId) => ({ remoteModelId })), new Date().toISOString())
  }
  state = new AppState()
  let settings = await state.loadSettings()
  assert.equal(settings.models.length, modelIds.length * providers.length)
  assert.deepEqual(settings.modelRoutes, {})
  for (const model of settings.models) {
    assert.ok(model.key.startsWith(`${model.providerId}:`))
    assert.equal(model.kind, 'image')
    assert.equal(model.source, 'discovered')
    assert.equal(model.supportsAutomaticImageSize, true)
    assert.equal(model.imageSizeMappings.length, expectedSizes.length - 1)
  }
  const customKey = domain.createProviderModelKey(providers[0].id, aliases[0])
  await state.updateProviderModel({ key: customKey, displayName: 'Custom image name', kind: 'image' })
  await state.setProviderModelEnabled({ key: customKey, enabled: false })
  await state.syncProviderModels(providers[0].id, modelIds.map((remoteModelId) => ({ remoteModelId })), new Date().toISOString())
  const preserved = (await new AppState().loadSettings()).models.find((model) => model.key === customKey)
  assert.equal(preserved.displayName, 'Custom image name')
  assert.equal(preserved.enabled, false)
  await state.setProviderModelEnabled({ key: customKey, enabled: true })
  const manualSettings = await state.createProvider({
    name: 'manual', adapterId: 'openai-sub2api', baseUrl: 'https://models.example/v1',
  })
  const manualProvider = manualSettings.providers.find((provider) => provider.name === 'manual')
  assert.ok(manualProvider)
  await state.addProviderModel({
    providerId: manualProvider.id, remoteModelId: aliases[0], displayName: 'Manual Flare', kind: 'image',
  })
  const manual = (await new AppState().loadSettings()).models.find((model) => model.providerId === manualProvider.id)
  assert.equal(manual.source, 'manual')
  assert.equal(manual.displayName, 'Manual Flare')
  assert.equal(manual.supportsAutomaticImageSize, true)
  assert.equal(manual.imageSizeMappings.length, expectedSizes.length - 1)
  console.log('PASS: empty catalog, discovery, manual models and reload preserve capabilities and user choices')

  const references = [{ fileName: 'reference.png', bytes: pngBytes, mediaType: 'image/png' }]
  for (const profile of ['openai', 'sub2api']) {
    for (const id of modelIds) {
      for (const referenceImages of [[], references]) {
        const result = await generateOpenAiCompatibleImage(
          'https://models.example/v1', 'test-only-key', id, 'Test image', '1536x1024', profile, referenceImages,
        )
        assert.deepEqual(Buffer.from(result.bytes), pngBytes)
        const request = requests.at(-1)
        const editing = referenceImages.length > 0
        assert.equal(new URL(request.url).pathname, editing ? '/v1/images/edits' : '/v1/images/generations')
        assert.equal(request.bypassCustomProtocolHandlers, true)
        const body = editing ? Object.fromEntries(request.body) : JSON.parse(request.body)
        assert.equal(body.model, id, 'The upstream model ID must be sent unchanged')
        assert.equal(body.size, '1536x1024')
        assert.equal(body.response_format, undefined)
        if (editing) {
          const image = request.body.get('image[]')
          assert.equal(image.name, 'reference.png')
          assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngBytes)
        }
      }
    }
  }
  for (const referenceImages of [[], references]) {
    await generateOpenAiCompatibleImage(
      'https://models.example/v1', 'test-only-key', 'dall-e-2', 'Test image', '1024x1024', 'sub2api', referenceImages,
    )
    const request = requests.at(-1)
    const body = referenceImages.length > 0 ? Object.fromEntries(request.body) : JSON.parse(request.body)
    assert.equal(body.response_format, 'b64_json', 'Legacy compatible models retain response_format')
  }
  console.log('PASS: generation and multipart edits preserve exact IDs and omit unsupported GPT Image parameters')

  settings = await state.loadSettings()
  let saved
  const routedSettings = {
    ...settings,
    providers: settings.providers.map((provider) => ({ ...provider, hasApiKey: true })),
    modelRoutes: {
      image: { modelKeys: [
        domain.createProviderModelKey(providers[0].id, aliases[0]),
        domain.createProviderModelKey(providers[1].id, aliases[1]),
      ] },
    },
  }
  const service = new ImageGenerationService({
    loadSettings: async () => routedSettings,
    loadProviderApiKey: async () => 'test-only-key',
    loadStoredImages: async () => [],
    saveGeneratedImage: async (input) => {
      saved = input
      return { id: 'test-image', imageFileName: 'test.png', ...input }
    },
  })
  for (const adapterId of ['openai', 'openai-sub2api']) {
    const provider = providers.find((item) => item.adapterId === adapterId)
    for (const id of aliases) {
      const key = domain.createProviderModelKey(provider.id, id)
      await service.generate({ modelKey: key, prompt: 'Test image', size: '3840x2160' })
      assert.equal(saved.modelKey, key)
      assert.equal(saved.size, '3840x2160')
    }
  }
  const fetch = electron.net.fetch
  let firstRequest = true
  electron.net.fetch = async (...args) => {
    responseStatus = firstRequest ? 503 : 200
    firstRequest = false
    return fetch(...args)
  }
  await service.generate({ prompt: 'Test fallback', size: '1536x1024' })
  assert.equal(saved.modelKey, routedSettings.modelRoutes.image.modelKeys[1])
  electron.net.fetch = fetch
  responseStatus = 401
  const before = requests.length
  await assert.rejects(service.generate({ prompt: 'Test rejection', size: '1024x1024' }), { code: 'PROVIDER_AUTHENTICATION' })
  assert.equal(requests.length - before, 1)
  responseStatus = 200
  console.log('PASS: main-process validation, default fallback route and authentication errors')

  const olderModelKey = domain.createProviderModelKey(providers[0].id, 'gpt-image-1')
  const olderModel = {
    ...domain.createConfiguredModel(domain.findBuiltinModelByKey(olderModelKey, 'openai'), 'manual'),
    key: olderModelKey,
    providerId: providers[0].id,
  }
  routedSettings.models = [...routedSettings.models, olderModel]
  const primaryKey = routedSettings.modelRoutes.image.modelKeys[0]
  const thirdKey = routedSettings.modelRoutes.image.modelKeys[1]
  routedSettings.modelRoutes.image.modelKeys = [primaryKey, olderModelKey, thirdKey]
  for (const size of ['auto', '3840x2160']) {
    const requestCount = requests.length
    firstRequest = true
    electron.net.fetch = async (...args) => {
      responseStatus = firstRequest ? 503 : 200
      firstRequest = false
      return fetch(...args)
    }
    await service.generate({ prompt: 'Test size-compatible fallback', size })
    assert.equal(saved.modelKey, thirdKey, 'A size-incompatible second choice must not block the third model')
    assert.equal(saved.size, size, 'Fallback must not silently downgrade the requested size')
    assert.equal(requests.length - requestCount, 2, 'Size-incompatible models must not receive paid requests')
  }
  electron.net.fetch = fetch
  responseStatus = 200
  const beforeUnsupported = requests.length
  await assert.rejects(
    service.generate({ modelKey: olderModelKey, prompt: 'Fixed model', size: '3840x2160' }),
    { code: 'PROVIDER_REQUEST' },
  )
  assert.equal(requests.length, beforeUnsupported, 'An explicit incompatible model must fail without fallback or network I/O')
  routedSettings.modelRoutes.image.modelKeys = [olderModelKey]
  await assert.rejects(service.generate({ prompt: 'No size-compatible model', size: 'auto' }), { code: 'PROVIDER_REQUEST' })
  assert.equal(requests.length, beforeUnsupported)
  routedSettings.modelRoutes.image.modelKeys = [primaryKey, olderModelKey, thirdKey]
  for (const status of [400, 401, 403]) {
    responseStatus = status
    const requestCount = requests.length
    await assert.rejects(service.generate({ prompt: 'Do not retry rejection', size: '3840x2160' }), {
      code: status === 400 ? 'PROVIDER_REMOTE' : 'PROVIDER_AUTHENTICATION',
    })
    assert.equal(requests.length - requestCount, 1)
  }
  responseStatus = 200
  console.log('PASS: incompatible sizes skip to the third choice without downgrading or retrying rejected requests')
} finally {
  await server?.close()
  delete globalThis.__modelRegressionElectron
  await rm(temporaryDirectory, { recursive: true, force: true })
}
