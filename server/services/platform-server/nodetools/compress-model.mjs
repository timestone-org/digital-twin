/**
 * 把一个 glb 压成指定档：焊接 → 按比例简化 → Draco 编码。
 *
 * 用法：node compress-model.mjs <输入.glb> <输出.glb> <简化比例>
 * 简化比例 1 = 不减面（只做无损几何压缩），0.5 = 面数减半。
 *
 * ⚠ `weld` 不能省：导出的 glb 常把每个三角形的顶点各存一份，不先焊接的话
 * simplify 看到的是一堆互不相连的三角形，减面之后模型会碎成雪花。
 * ⚠ 出错一律非零退出并把原因打到 stderr：调用方按退出码判成败，
 * 打到 stdout 的话会和正常输出混在一起。
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco, simplify, weld } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptSimplifier } from 'meshoptimizer'

/** 简化的容差。太小则减不动面，太大则形状塌掉 */
const SIMPLIFY_ERROR = 0.001
const ARG_COUNT = 3

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== ARG_COUNT) {
    throw new Error('用法：compress-model.mjs <输入> <输出> <简化比例>')
  }
  const [input, output, rawRatio] = args
  const ratio = Number(rawRatio)
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error(`简化比例必须落在 (0,1]：${rawRatio}`)
  }

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    })

  const document = await io.read(input)
  await MeshoptSimplifier.ready

  // ⚠ 顺序不能换：不焊接就简化会把网格撕碎，先编码再简化则简化看不见几何
  const steps = [weld()]
  if (ratio < 1) {
    steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR }))
  }
  steps.push(draco())
  await document.transform(...steps)

  await io.write(output, document)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
