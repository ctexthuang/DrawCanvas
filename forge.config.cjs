const path = require('node:path')
const packageMetadata = require('./package.json')

const appIconPath = path.resolve(__dirname, 'assets/icons/app-icon')

const ignoredRoots = [
  '/.agents',
  '/.git',
  '/.github',
  '/.pnpm-store',
  '/assets',
  '/dist',
  '/node_modules',
  '/release',
  '/src',
]

const ignoredFiles = new Set([
  '/.gitignore',
  '/README.md',
  '/TODO.md',
  '/electron.vite.config.ts',
  '/forge.config.cjs',
  '/pnpm-lock.yaml',
  '/pnpm-workspace.yaml',
  '/tsconfig.json',
])
const localElectronZipDirectory = process.env.DRAW_CANVAS_ELECTRON_ZIP_DIR?.trim()

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  outDir: 'dist',
  packagerConfig: {
    asar: true,
    prune: false,
    ...(localElectronZipDirectory
      ? { electronZipDir: localElectronZipDirectory }
      : {}),
    name: 'Draw Canvas',
    executableName: 'DrawCanvas',
    appBundleId: 'com.ctexthuang.drawcanvas',
    appCategoryType: 'public.app-category.graphics-design',
    icon: appIconPath,
    osxSign: {
      identity: '-',
      identityValidation: false,
      continueOnError: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({
        hardenedRuntime: false,
        timestamp: 'none',
      }),
    },
    win32metadata: {
      CompanyName: 'ctexthuang',
      FileDescription: packageMetadata.description,
      ProductName: packageMetadata.productName,
    },
    ignore(filePath) {
      const normalizedPath = filePath.replaceAll('\\', '/')
      return ignoredFiles.has(normalizedPath) || ignoredRoots.some((root) => (
        normalizedPath === root || normalizedPath.startsWith(`${root}/`)
      ))
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: (arch) => ({
        name: `Draw-Canvas-${packageMetadata.version}-${arch}`,
        format: 'ULFO',
        overwrite: true,
      }),
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'DrawCanvas',
        authors: packageMetadata.author,
        description: packageMetadata.description,
        setupIcon: `${appIconPath}.ico`,
        setupExe: `Draw-Canvas-${packageMetadata.version}-x64-Setup.exe`,
      },
    },
    {
      name: '@electron-forge/maker-wix',
      platforms: ['win32'],
      config: {
        name: packageMetadata.productName,
        shortName: 'DrawCanvas',
        manufacturer: packageMetadata.author,
        description: packageMetadata.description,
        exe: 'DrawCanvas.exe',
        icon: `${appIconPath}.ico`,
        arch: 'x64',
        defaultInstallMode: 'perMachine',
        programFilesFolderName: packageMetadata.productName,
        shortcutFolderName: packageMetadata.productName,
        upgradeCode: '9607665E-23C3-4BAF-97A7-AB14BA34A786',
        ui: {
          chooseDirectory: true,
        },
      },
    },
  ],
}

module.exports = config
