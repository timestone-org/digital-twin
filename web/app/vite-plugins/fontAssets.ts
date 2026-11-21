/** @fileoverview 为构建后的 TrueType 字体预生成 HTTP gzip 表示。 */
import { gzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

const HASHED_TTF = /^assets\/[^/]+-[A-Za-z0-9_-]{8,64}\.ttf$/i

export function fontAssets(): Plugin {
  return {
    name: 'dt-font-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !HASHED_TTF.test(file.fileName)) continue
        this.emitFile({
          type: 'asset',
          fileName: file.fileName + '.gz',
          source: gzipSync(file.source, { level: 9 }),
        })
      }
    },
  }
}
