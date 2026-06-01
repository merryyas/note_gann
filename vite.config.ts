import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

// public 폴더의 파일들을 dist 로 복사하는 플러그인
function copyPublicPlugin() {
  return {
    name: 'copy-public',
    closeBundle() {
      const src  = join(__dirname, 'public')
      const dest = join(__dirname, 'dist')
      copyDirSync(src, dest)
    }
  }
}

function copyDirSync(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  for (const item of readdirSync(src)) {
    const srcPath  = join(src, item)
    const destPath = join(dest, item)
    if (statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    }),
    copyPublicPlugin()
  ]
})
