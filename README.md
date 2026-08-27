# Draw Canvas

基于 Electron、React、TypeScript 和 electron-vite 的本地 AI 创意画布。

## 本项目运行环境

项目使用 Volta 固定以下版本，不会修改系统或全局默认配置：

- Node.js `22.23.1`
- pnpm `11.7.0`
- Electron `43.3.0`

Electron 43 的最低 Node.js 要求是 `>=22.12.0`，当前 Volta 版本满足要求。

## 开发与构建

```bash
pnpm install
pnpm dev
```

类型检查与生产构建：

```bash
pnpm typecheck
pnpm build
pnpm preview
```

生成当前系统的安装包：

```bash
pnpm make
```

打包使用 Electron Forge，产物写入 `dist/`。本地命令只负责当前操作系统；正式的多平台产物由 GitHub Actions 分别在对应系统 runner 上构建。

## Tag 自动发布

推送 `v0.0.1` 形式的语义化 tag 后，`.github/workflows/release.yml` 会自动执行：

1. 在 `macos-15` Apple Silicon runner 构建 arm64 DMG/ZIP。
2. 在 `macos-15-intel` runner 构建 x64 DMG/ZIP。
3. 在 `windows-2022` runner 同时构建可选择安装目录和盘符的 x64 NSIS EXE，以及适合企业部署的 WiX MSI 安装程序。
4. 查找当前 tag 可达的上一个语义化 tag，收集该 tag 之后到当前 tag 的全部 commit。
5. 严格验证 macOS `.app` 的 ad-hoc 签名，并为全部安装包生成 `SHA256SUMS.txt`。
6. 创建或更新同名 GitHub Release，写入增量提交记录并上传全部安装包与校验文件。

首次发布示例：

```bash
git tag -a v0.0.1 -m "Draw Canvas v0.0.1"
git push origin v0.0.1
```

后续推送 `v0.0.2` 时，Release 会包含 `v0.0.1..v0.0.2` 的全部提交。tag 中的版本会在 runner 内同步到 `package.json`，因此安装包元数据、左下角版本号和系统设置版本号保持一致。

发布说明默认保留 commit 原文。若希望自动生成简体中文翻译，在仓库 `Settings → Secrets and variables → Actions` 中添加 Repository secret `OPENAI_API_KEY`；可选添加 Repository variable `OPENAI_RELEASE_NOTES_MODEL`，默认使用 `gpt-4o-mini`。翻译调用失败或没有配置密钥时不会中断打包和发布。

当前 macOS 安装包使用免费的 ad-hoc 签名，Action 会在发布前执行 `codesign --verify --deep --strict`；所有平台的发布文件都会写入 `SHA256SUMS.txt`。当前没有配置 Apple Developer ID、公证或 Windows 代码签名证书，因此下载后仍可能出现 Gatekeeper 或 SmartScreen 提示。

macOS 用户首次双击若被 Gatekeeper 拦截，可在尝试启动后的约一小时内进入“系统设置 → 隐私与安全性”，在“安全性”区域选择“仍要打开”。只应对从本仓库 Release 下载且 SHA-256 与 `SHA256SUMS.txt` 一致的文件执行此操作；默认不要求运行 `xattr`。

### Windows 兼容性

当前项目使用 Electron 43，只支持 Windows 10 及以上版本，无法生成兼容 Windows 7/8/8.1 的安全受支持安装包。Electron 官方说明 [Electron 22 是最后一个支持 Windows 7～8.1 的版本](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice)，且 Electron 22 已停止维护。若业务必须支持 Windows 7，应单独维护锁定 Electron 22 的 legacy 分支，不与当前主线安装包混发。

## 功能

- 文件首页：新建无限画布、打开本地项目、最近项目
- 生成历史：模型/时间筛选、搜索、详情、复制提示词、导出图片
- 图片库：收藏图片、资源库、搜索和预览
- 资源管理器：提示词复用、工作流载入画布
- 模型设置：服务商配置、API Key 安全存储、启用模型选择
- 系统设置：本地数据目录、存储统计、主题与强调色
- 无限画布：平移、缩放、节点拖动、节点创建、连线、图片生成演示、自动保存、项目导入导出

## Electron 分层

- `src/main`：窗口、IPC、文件系统、系统对话框和安全存储
- `src/preload`：通过 `contextBridge` 暴露固定的类型化桌面接口
- `src/renderer`：React UI 与画布交互，不直接访问 Node.js 或 Electron 模块
- `src/shared/contracts`：main、preload、renderer 共用的 IPC 数据契约

窗口默认启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，并限制新窗口、导航、权限请求和 IPC 调用来源。

## 本地数据存储

当前阶段不引入数据库依赖，主进程以“内存缓存 + 版本化 JSON 文件”作为唯一可信数据源。所有业务文件统一位于系统设置所显示的数据根目录：

- `settings/app-settings.json`：主题、强调色和收藏偏好
- `settings/model-config.json`：服务商、加密 API Key、连接状态、发现的模型、已启用模型和各类型默认模型
- `projects/`：画布自动保存和项目文件的默认保存位置
- `history/generation-history.json`：生成历史
- `library/catalog.json` 与 `library/images/`：图片库元数据和图片文件
- `resources/prompts.json` 与 `resources/workflows.json`：提示词和工作流
- `database/`、`cache/`：后续数据库与应用缓存的固定位置

默认目录按平台处理：macOS 和 Linux 使用 Electron `userData/Draw Canvas Data`；Windows 优先使用安装目录下的 `Draw Canvas Data`，无写权限时回退到 `userData/Draw Canvas Data`。Electron `userData` 中只额外保留一个很小的 `draw-canvas-data-location.json` 定位文件，用于下次启动找到用户选择的数据根目录；Chromium 自身的运行缓存仍由 Electron 管理。

更改数据目录由主进程执行：迁移期间暂停业务数据写入，复制到目标目录后校验文件数量和字节数，确认无误才更新定位文件并切换；目标目录含 Draw Canvas 数据时拒绝覆盖；失败时清理未提交副本并继续使用原目录。存储统计直接扫描真实目录，按项目、历史、图片库、资源、设置、数据库、缓存和其他分类，不使用占位容量。

所有 JSON 更新在主进程串行执行，并通过临时文件替换完成原子写入，避免并发请求相互覆盖。旧版散落在 Electron `userData` 根目录的文件会自动迁入统一目录；API Key 使用操作系统安全存储加密，renderer 和 preload 都不会接收已保存的明文密钥。

模型使用 `providerId:remoteModelId` 作为唯一键，例如 `openai-relay:gpt-image-2`。内置映射按服务商隔离；OpenAI Relay 映射 `gpt-image-2`、`gpt-image-1.5` 和 `gpt-image-1`，默认图像模型为 `gpt-image-2`；同时内置常用 GPT 对话模型，默认对话模型为 `gpt-5.6-sol`。接口发现的模型同样归属于执行发现请求的服务商，不会跨服务商混用。
