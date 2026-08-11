import { readFile, writeFile } from 'node:fs/promises'

const tag = process.argv[2] ?? ''
const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)

if (!match) {
  throw new Error(`无效发布 tag：${tag || '(空)'}，应使用 v0.0.1 形式`)
}

const packageJsonUrl = new URL('../../package.json', import.meta.url)
const packageMetadata = JSON.parse(await readFile(packageJsonUrl, 'utf8'))
packageMetadata.version = match[1]

await writeFile(packageJsonUrl, `${JSON.stringify(packageMetadata, null, 2)}\n`, 'utf8')
console.log(`已将构建版本同步为 ${packageMetadata.version}`)
