// @vitest-environment node
/** @fileoverview 正式 Vite 构建的带散列字体提供逐字可还原的 gzip 副本。 */
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { build } from 'vite'
import { expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))

it('构建带散列的 TTF 及其 gzip，保留原件，让已压缩格式直接发布', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dt-font-build-')))
  const original = Buffer.from('normal font . '.repeat(360))
  try {
    await writeFile(
      join(root, 'index.html'),
      '<link rel="stylesheet" href="./fonts.css">',
    )
    await writeFile(
      join(root, 'fonts.css'),
      `
      @font-face {font-family:test;src:url('./Reading.ttf')}
      @font-face {font-family:compact;src:url('./Reading.woff2')}
      @font-face {font-family:digits;src:url('./Digits.TTF')}
      body {font-family:test,compact,digits}
    `,
    )
    for (const name of ['Reading.ttf', 'Reading.woff2', 'Digits.TTF']) {
      await writeFile(
        join(root, name),
        Buffer.concat([original, Buffer.from(name)]),
      )
    }
    await build({
      root,
      configFile: CONFIG,
      logLevel: 'silent',
      publicDir: false,
      build: { assetsInlineLimit: 0, sourcemap: false },
    })
    const output = join(root, 'dist', 'assets')
    const names = await readdir(output)
    const fonts = names.filter((name) => /\.ttf$/i.test(name))
    expect(fonts).toHaveLength(2)
    for (const font of fonts) {
      const path = join(output, font)
      const packed = await readFile(path + '.gz')
      const bytes = await readFile(path)
      expect(gunzipSync(packed)).toEqual(bytes)
      expect(packed.byteLength).toBeLessThan(bytes.byteLength)
    }
    expect(names.some((name) => name.endsWith('.woff2'))).toBe(true)
    expect(names.some((name) => name.endsWith('.woff2.gz'))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)
