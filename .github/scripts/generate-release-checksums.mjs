import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

const releaseAssetsDirectory = resolve(process.argv[2] ?? 'release-assets')
const outputPath = join(releaseAssetsDirectory, 'SHA256SUMS.txt')
const allowedExtensions = new Set(['.dmg', '.exe', '.msi', '.zip'])
const allowedNames = new Set()

async function collectReleaseAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedAssets = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) return collectReleaseAssets(entryPath)
    if (!entry.isFile()) return []
    if (!allowedNames.has(entry.name) && !allowedExtensions.has(extname(entry.name).toLowerCase())) {
      return []
    }
    return [entryPath]
  }))

  return nestedAssets.flat()
}

function sha256(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

const assets = (await collectReleaseAssets(releaseAssetsDirectory))
  .sort((left, right) => basename(left).localeCompare(basename(right), 'en'))

if (assets.length === 0) {
  throw new Error(`没有在 ${releaseAssetsDirectory} 中找到可校验的发布文件`)
}

const duplicateNames = assets
  .map((filePath) => basename(filePath))
  .filter((name, index, names) => names.indexOf(name) !== index)

if (duplicateNames.length > 0) {
  throw new Error(`发布文件存在重名，无法生成可靠校验表：${[...new Set(duplicateNames)].join(', ')}`)
}

const checksumLines = []
for (const filePath of assets) {
  checksumLines.push(`${await sha256(filePath)}  ${basename(filePath)}`)
}

await writeFile(outputPath, `${checksumLines.join('\n')}\n`, 'utf8')
console.log(`已为 ${assets.length} 个发布文件生成 ${outputPath}`)
