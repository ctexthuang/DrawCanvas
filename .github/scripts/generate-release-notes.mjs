import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const currentTag = process.env.TAG_NAME ?? process.argv[2] ?? ''
const repository = process.env.GITHUB_REPOSITORY ?? ''
const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
const outputPath = process.env.RELEASE_NOTES_PATH ?? 'release-notes.md'

if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(currentTag)) {
  throw new Error(`无效发布 tag：${currentTag || '(空)'}`)
}

if (!repository) {
  throw new Error('缺少 GITHUB_REPOSITORY，无法生成提交链接')
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function previousReachableTag() {
  const tags = git(['tag', '--merged', currentTag, '--sort=-version:refname'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(tag))

  return tags.find((tag) => tag !== currentTag) ?? null
}

function readCommits(range) {
  const output = git([
    'log',
    range,
    '--reverse',
    '--format=%H%x1f%h%x1f%s%x1e',
  ])

  if (!output) return []
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, ...subjectParts] = record.split('\x1f')
      return {
        hash,
        shortHash,
        subject: subjectParts.join('\x1f').trim(),
      }
    })
    .filter((commit) => commit.hash && commit.shortHash && commit.subject)
}

function outputText(responseBody) {
  if (typeof responseBody.output_text === 'string') return responseBody.output_text
  if (!Array.isArray(responseBody.output)) return ''

  return responseBody.output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
}

async function translateSubjects(subjects) {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey || subjects.length === 0) return null

  const model = process.env.OPENAI_RELEASE_NOTES_MODEL?.trim() || 'gpt-4o-mini'
  try {
    const translatedSubjects = []
    for (let offset = 0; offset < subjects.length; offset += 40) {
      const batch = subjects.slice(offset, offset + 40)
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          instructions: [
            '你是软件发布说明翻译器。',
            '将每条 Git commit 标题翻译为简洁、准确的简体中文。',
            '保留 Conventional Commit 类型、作用域、模型名、API 名、文件名和代码标识。',
            '不得合并、删减、重排或补充提交。',
            '只返回 JSON：{"translations":["..."]}，数组长度和顺序必须与输入完全一致。',
          ].join('\n'),
          input: JSON.stringify(batch),
          max_output_tokens: Math.max(1_000, batch.length * 80),
        }),
        signal: AbortSignal.timeout(60_000),
      })

      if (!response.ok) {
        throw new Error(`OpenAI Responses API 返回 HTTP ${response.status}`)
      }

      const responseBody = await response.json()
      const rawText = outputText(responseBody)
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
      const parsed = JSON.parse(rawText)
      const translations = parsed.translations

      if (
        !Array.isArray(translations) ||
        translations.length !== batch.length ||
        translations.some((subject) => typeof subject !== 'string' || !subject.trim())
      ) {
        throw new Error('翻译结果数量或格式不正确')
      }

      translatedSubjects.push(...translations.map((subject) => subject.trim()))
    }

    console.log(`已使用 ${model} 翻译 ${translatedSubjects.length} 条提交`)
    return translatedSubjects
  } catch (error) {
    console.warn(`提交翻译失败，将保留原文：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function categoryFor(subject) {
  if (/^feat(?:\([^)]*\))?!?:/i.test(subject)) return 'features'
  if (/^fix(?:\([^)]*\))?!?:/i.test(subject)) return 'fixes'
  if (/^perf(?:\([^)]*\))?!?:/i.test(subject)) return 'performance'
  if (/^(?:docs|chore\(docs\))(?:\([^)]*\))?!?:/i.test(subject)) return 'documentation'
  return 'other'
}

function escapeMarkdown(value) {
  return value.replace(/([\\[\]*_`])/g, '\\$1')
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const previousTag = previousReachableTag()
const range = previousTag ? `${previousTag}..${currentTag}` : currentTag
const commits = readCommits(range)
const translations = await translateSubjects(commits.map((commit) => commit.subject))
const repositoryUrl = `${serverUrl}/${repository}`
const compareUrl = previousTag
  ? `${repositoryUrl}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(currentTag)}`
  : `${repositoryUrl}/commits/${encodeURIComponent(currentTag)}`
const categories = [
  ['features', '新增功能'],
  ['fixes', '问题修复'],
  ['performance', '性能优化'],
  ['documentation', '文档'],
  ['other', '其他变更'],
]

const lines = [
  `# Draw Canvas ${currentTag}`,
  '',
  '## 更新范围',
  '',
  previousTag
    ? `- ${previousTag} → ${currentTag}`
    : '- 首次发布：收录当前 tag 可达的全部提交',
  `- 共 ${commits.length} 个提交`,
  `- [查看完整差异](${compareUrl})`,
  '',
]

if (commits.length === 0) {
  lines.push('## 提交记录', '', '- 此版本没有新增提交。', '')
} else {
  for (const [category, heading] of categories) {
    const entries = commits
      .map((commit, index) => ({
        ...commit,
        translatedSubject: translations?.[index] ?? commit.subject,
      }))
      .filter((commit) => categoryFor(commit.subject) === category)
    if (entries.length === 0) continue

    lines.push(`## ${heading}`, '')
    for (const commit of entries) {
      const commitUrl = `${repositoryUrl}/commit/${commit.hash}`
      lines.push(`- ${escapeMarkdown(commit.translatedSubject)} ([\`${commit.shortHash}\`](${commitUrl}))`)
      if (commit.translatedSubject !== commit.subject) {
        lines.push(`  <sub>原文：${escapeHtml(commit.subject)}</sub>`)
      }
    }
    lines.push('')
  }
}

lines.push(
  '## 安装包',
  '',
  '- macOS Apple Silicon（M 系列，arm64）：DMG / ZIP',
  '- macOS Intel（x64）：DMG / ZIP',
  '- Windows（x64）：Squirrel 安装程序',
  '- `SHA256SUMS.txt`：全部发布文件的 SHA-256 校验值',
  '',
  '> macOS 应用使用经过构建验证的 ad-hoc 签名，但尚未配置 Apple Developer ID 与公证；Windows 安装包也尚未配置代码签名证书，因此系统可能显示安全提醒。',
  '',
  '### macOS 首次打开',
  '',
  '首次双击若被 Gatekeeper 拦截，请在尝试启动后的约一小时内打开“系统设置 → 隐私与安全性”，在“安全性”区域选择“仍要打开”。仅应对从本仓库 Release 下载且 SHA-256 校验一致的安装包执行此操作。',
  '',
)

await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`发布说明已写入 ${outputPath}（范围：${range}）`)
