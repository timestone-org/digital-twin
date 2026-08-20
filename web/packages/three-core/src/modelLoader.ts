/**
 * @fileoverview glTF/glb 装载：进度回传与取消丢弃，外加 Draco 解码。
 * ⚠ `GLTFLoader` 没有中止能力，取消只能在解析完成后把成果丢掉并**逐个释放**——
 * 丢而不释放就是一次纯泄漏，而快速切模型正是最容易触发它的路径。
 * ⚠ 解码器自托管在 `/draco/`，**不许走 CDN**：现场那台机器不一定有外网，
 * 而没有外网时的表现是「模型永远加载中」，控制台里只有一条被浏览器吞掉的
 * 跨域错误（ADR-0022）。
 */
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type * as THREE from 'three'

import { disposeSceneGraph } from './sceneCore'

/**
 * 解码器文件的取回路径，末尾必须带斜杠。
 * ⚠ 与 `web/app/public/draco/` 逐字对应：那几个文件随构建产物原样发出去。
 */
const DRACO_PATH = '/draco/'

// ⚠ 整个应用共用一个解码器：`DRACOLoader` 背后是一池 Web Worker，每次装载新造
// 一个就是每次多起一池——连开十几个模型之后线程数就失控了，而现象只是「越用越卡」
let shared: DRACOLoader | null = null

function dracoLoader(): DRACOLoader {
  if (shared === null) {
    shared = new DRACOLoader().setDecoderPath(DRACO_PATH)
  }
  return shared
}

/**
 * 释放共用的解码器（连同它那池 worker）。只在测试与整页卸载时调。
 * ⚠ 平时**不要**调：下一次装载会重新造一池，而造池本身有几十毫秒的开销。
 */
export function disposeGltfDecoders(): void {
  shared?.dispose()
  shared = null
}

/** `GLTFLoader` 的最小面，装载编排只依赖它，测试传替身。 */
export interface GltfSource {
  loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<{ scene: THREE.Object3D; animations?: THREE.AnimationClip[] }>
}

/**
 * 装载结果。
 * ⚠ 动画剪辑必须跟着场景一起交出来：`gltf.animations` 与 `gltf.scene` 是并列的两半，
 * 只取 scene 的话 GLB 里的内置动画就此丢失，而模型看着是正常加载出来的。
 */
export interface TwinModelAsset {
  root: THREE.Object3D
  /** GLB 自带的动画剪辑；没有动画的模型是空数组。 */
  clips: readonly THREE.AnimationClip[]
}

export interface TwinModelLoadOptions {
  /** 已下载字节 / 总字节；总字节为 0 表示服务端没给长度。 */
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

/**
 * 造一个真 `GLTFLoader`，并挂上 Draco 解码器。
 *
 * ⚠ 挂了解码器对**未压缩**的 glb 毫无影响：`GLTFLoader` 只在文件真的声明了
 * `KHR_draco_mesh_compression` 时才会去调它，故存量模型照常加载。
 */
export function createGltfSource(): GltfSource {
  return new GLTFLoader().setDRACOLoader(dracoLoader())
}

function abortError(): DOMException {
  return new DOMException('模型加载已取消', 'AbortError')
}

// ⚠ 必须绕一层函数读：直接连着判两次 `signal.aborted`，控制流分析会把它当常量收窄，
// 而它恰恰是这段代码里唯一会在 await 期间变掉的东西
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/**
 * 下载并解析一个模型；取消后抛 `AbortError` 且不留下半个场景。
 * @param url 模型地址
 * @param options 进度回调与取消信号
 * @param source 装载器，缺省是真 `GLTFLoader`
 */
export async function loadTwinModel(
  url: string,
  options: TwinModelLoadOptions = {},
  source: GltfSource = createGltfSource(),
): Promise<TwinModelAsset> {
  if (isAborted(options.signal)) throw abortError()
  const gltf = await source.loadAsync(url, (event) => {
    options.onProgress?.(event.loaded, event.lengthComputable ? event.total : 0)
  })
  if (isAborted(options.signal)) {
    disposeSceneGraph(gltf.scene)
    throw abortError()
  }
  return { root: gltf.scene, clips: gltf.animations ?? [] }
}
