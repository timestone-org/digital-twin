/**
 * @fileoverview 契约：自托管的 Draco 解码器必须与装着的 three 逐字节一致。
 *
 * ⚠ 解码器与 `DRACOLoader` 是**配套**的。升 three 之后忘了重拷解码器，表现是
 * 压缩过的模型解不开——而两边的代码单看都对，控制台里也只有一句语焉不详的
 * 解析失败。这份用例是那条唯一会红的线。
 * ⚠ 放在 three-core 而不是 app：只有依赖了 three 的包才解析得到它的文件路径。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 解码用的三件。⚠ 不含 `draco_encoder.js`：编码在服务端做。 */
const FILES = [
  'draco_decoder.js',
  'draco_decoder.wasm',
  'draco_wasm_wrapper.js',
] as const

const require = createRequire(import.meta.url)
/**
 * three 包里 glTF 版解码器的所在。⚠ 是 `gltf/` 子目录那一份，不是上一层——
 * 上一层那份解不开 glTF 里的量化属性。
 * ⚠ 从 `DRACOLoader.js` 反推而不是解析 `three/package.json`：后者不在 three 的
 * `exports` 映射里，解析不出来。
 */
const UPSTREAM = join(
  dirname(require.resolve('three/examples/jsm/loaders/DRACOLoader.js')),
  '../libs/draco/gltf',
)
/** 随构建产物发出去的那一份。 */
const VENDORED = join(process.cwd(), 'app', 'public', 'draco')

describe('自托管的 Draco 解码器', () => {
  it.each(FILES)('%s 与 three 里那份逐字节一致', (name) => {
    const upstream = readFileSync(join(UPSTREAM, name))
    const vendored = readFileSync(join(VENDORED, name))

    // 红了就重拷一遍：
    //   cp node_modules/.pnpm/three@*/node_modules/three/examples/jsm/libs/\
    //      draco/gltf/{draco_decoder.js,draco_decoder.wasm,draco_wasm_wrapper.js} \
    //      app/public/draco/
    expect(vendored.equals(upstream)).toBe(true)
  })

  it('不许把编码器也发出去——那是服务端的活，且它有 900KB', () => {
    expect(() => readFileSync(join(VENDORED, 'draco_encoder.js'))).toThrow()
  })
})
