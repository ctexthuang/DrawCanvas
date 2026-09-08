import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Reuse an installed Playwright runtime; this test does not install dependencies.
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const outputDirectory = process.env.CANVAS_TEST_OUTPUT || join(tmpdir(), 'drawcanvas-regression')
await mkdir(outputDirectory, { recursive: true })
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  define: { __APP_VERSION__: '"regression"' },
  plugins: [
    react(),
    {
      name: 'canvas-regression-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__canvas_test', (_request, response, next) => {
          void vite.transformIndexHtml('/__canvas_test', '<div id="root"></div><script type="module" src="/scripts/fixtures/canvas-regression.tsx"></script>').then((html) => {
            response.setHeader('Content-Type', 'text/html')
            response.end(html)
          }).catch(next)
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/__canvas_test`)
  await page.locator('.image-layer-preview-stage img').waitFor()
  const initial = await page.evaluate(() => window.regressionDocument)

  async function reset(zoom, patch = {}) {
    await page.evaluate(({ initial, zoom, patch }) => window.setRegressionDocument({
      ...initial, id: `regression-${zoom}-${Math.random()}`,
      viewport: { x: 40, y: 30, zoom },
      nodes: initial.nodes.map((node) => node.id === 'split' ? { ...node, ...patch } : node),
    }), { initial, zoom, patch })
    await page.waitForTimeout(100)
  }

  for (const zoom of [0.5, 0.75, 1, 1.5]) {
    await reset(zoom)
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('article[data-node-id="split"]')
      const rect = card.getBoundingClientRect()
      const port = card.querySelector('[data-port="output"]').getBoundingClientRect()
      const line = document.querySelector('.is-layer-split-output .connection-line')
      const start = line.getPointAtLength(0)
      const screen = new DOMPoint(start.x, start.y).matrixTransform(line.getScreenCTM())
      return {
        width: rect.width,
        error: Math.hypot(screen.x - port.left - port.width / 2, screen.y - port.top - port.height / 2),
      }
    })
    assert.ok(Math.abs(geometry.width - 430 * zoom) < 0.1, `Card width differs from graph width at ${zoom}: ${JSON.stringify(geometry)}`)
    assert.ok(geometry.error < 0.1, `Detached output port at ${zoom}: ${geometry.error}`)

    // Select only the right edge; this fails when the drawn and hit-test widths disagree.
    const box = await page.locator('article[data-node-id="split"]').boundingBox()
    const x = box.x + box.width - 4 * zoom
    await page.mouse.move(x, box.y - 15)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 15, box.y + 60 * zoom, { steps: 8 })
    await page.mouse.up()
    assert.equal(await page.locator('article[data-node-id="split"].is-selected').count(), 1, `Right-edge marquee misses at ${zoom}`)

    await page.mouse.move(box.x + box.width + 20, box.y - 15)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 45, box.y + 60 * zoom, { steps: 8 })
    await page.mouse.up()
    assert.equal(await page.locator('article[data-node-id="split"].is-selected').count(), 0, `Empty-space marquee selects card at ${zoom}`)
    console.log(`PASS: port alignment and marquee selection at ${zoom * 100}%`)
  }

  for (const zoom of [0.2, 0.45]) {
    await reset(zoom)
    const contentVisibility = await page.locator('article[data-node-id="split"] .image-layer-node-body').evaluate((element) => ({
      display: getComputedStyle(element).display,
      visibility: getComputedStyle(element).visibility,
    }))
    assert.notEqual(contentVisibility.display, 'none', `Node content display is hidden at ${zoom}`)
    assert.notEqual(contentVisibility.visibility, 'hidden', `Node content visibility is hidden at ${zoom}`)
    console.log(`PASS: node content remains visible at ${zoom * 100}%`)
  }

  for (const width of [220, 430, 700]) {
    await reset(0.75, { width })
    const stage = await page.locator('.image-layer-preview-stage').boundingBox()
    assert.ok(Math.abs(stage.width - stage.height) < 0.1, `Square preview distorted at card width ${width}`)
    const before = await page.evaluate(() => window.regressionDocument.nodes.find((node) => node.id === 'split').imageLayers[0].bounds)
    const layerBox = await page.locator('.image-layer-box').first().boundingBox()
    await page.mouse.move(layerBox.x + layerBox.width / 2, layerBox.y + layerBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(layerBox.x + layerBox.width / 2 + stage.width * 0.05, layerBox.y + layerBox.height / 2 + stage.height * 0.04, { steps: 10 })
    await page.mouse.up()
    const after = await page.evaluate(() => window.regressionDocument.nodes.find((node) => node.id === 'split').imageLayers[0].bounds)
    assert.ok(Math.abs(after.x - before.x - 50) <= 1, `Layer x drifts at width ${width}`)
    assert.ok(Math.abs(after.y - before.y - 40) <= 1, `Layer y drifts at width ${width}`)
    console.log(`PASS: undistorted preview and crop drag at width ${width}`)
  }

  await reset(0.75)
  await page.getByRole('button', { name: '生成 2 个图片节点' }).click()
  await page.waitForFunction(() => window.regressionFiles?.length === 2)
  const crops = await page.evaluate(async () => {
    return Promise.all(window.regressionFiles.map(async (file) => {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data]
      return {
        width: canvas.width,
        height: canvas.height,
        corner: pixel(0, 0),
        center: pixel(40, 40),
        detachedAccent: pixel(23, 368),
      }
    }))
  })
  assert.equal(crops[0].width, 330)
  assert.equal(crops[1].width, 220)
  for (const crop of crops) {
    assert.equal(crop.corner[3], 0)
    assert.equal(crop.center[3], 255)
  }
  assert.equal(crops[0].detachedAccent[3], 255, 'Detached illustration details must not be discarded')
  console.log('PASS: independent PNG crop sizes and transparent backgrounds')
  await reset(0.75)
  await page.screenshot({ path: join(outputDirectory, 'canvas-connections.png') })
  const sample = await page.evaluate(() => {
    const line = document.querySelector('.is-layer-split-output .connection-line')
    const local = line.getPointAtLength(0)
    const point = new DOMPoint(local.x, local.y).matrixTransform(line.getScreenCTM())
    return { x: point.x, y: point.y }
  })
  await page.screenshot({
    path: join(outputDirectory, 'connection-port.png'),
    clip: { x: sample.x - 20, y: sample.y - 65, width: 200, height: 130 },
  })
  assert.deepEqual(errors, [])
  console.log(`PASS: no browser exceptions; screenshots in ${outputDirectory}`)
} finally {
  await browser?.close()
  await server.close()
}
