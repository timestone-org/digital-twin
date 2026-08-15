/**
 * @fileoverview 模型装载的一整条链：解析地址、带进度拉取、挂进场景、报缺失节点，
 * 以及快速切模型时的竞态处理。宿主只负责在装好之后摆放与建层。
 */
import type { TwinPart } from '@dt/twin-config'
import type { Object3D } from 'three'
import { ref, type Ref } from 'vue'

import { resolveTwinModelUrl } from './host'
import { loadTwinModel, type TwinModelAsset } from './modelLoader'
import {
  EMPTY_NODE_INDEX,
  buildNodeIndex,
  unmatchedNodeNames,
  type NodeIndex,
} from './nodeIndex'
import { disposeSceneGraph, type SceneCore } from './sceneCore'

/** 装载状态；`empty` = 还没挑模型。 */
export type TwinModelStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface TwinModelLoadOptions {
  core: () => SceneCore | null
  /** 素材引用 `asset:<uuid>`；空串 = 还没挑。 */
  asset: () => string
  /** 部件清单，用来报「配了但模型里没有」的节点名。 */
  parts: () => readonly TwinPart[]
  /** 模型挂好了：宿主据此摆放、建层、取景、装动画。 */
  onReady: (asset: TwinModelAsset, index: NodeIndex) => void
}

export interface TwinModelLoad {
  status: Ref<TwinModelStatus>
  progressPercent: Ref<number>
  errorMessage: Ref<string>
  /** 部件里配了、模型里却没有的节点名。 */
  missingNodes: Ref<readonly string[]>
  /** 当前挂着的模型根；没有时 null。 */
  root: () => Object3D | null
  /** 当前模型的节点索引。 */
  index: () => NodeIndex
  load: () => Promise<void>
  /** 把状态打成错误态并清掉模型。 */
  fail: (message: string) => void
  /** 卸载前调用：让在途的那次作废，免得它回来往已释放的场景里挂东西。 */
  abort: () => void
}

const FULL_PERCENT = 100

/**
 * 装上模型装载链。
 * @param options 场景核心、素材引用、部件清单与装好后的回调
 */
export function useTwinModelLoad(options: TwinModelLoadOptions): TwinModelLoad {
  const status = ref<TwinModelStatus>('empty')
  const progressPercent = ref(0)
  const errorMessage = ref('')
  const missingNodes = ref<readonly string[]>([])

  let modelObject: Object3D | null = null
  let nodeIndex: NodeIndex = EMPTY_NODE_INDEX
  let loadSeq = 0
  let loadAbort: AbortController | null = null

  function clear(): void {
    const core = options.core()
    if (core !== null) disposeSceneGraph(core.modelRoot)
    modelObject = null
    nodeIndex = EMPTY_NODE_INDEX
    missingNodes.value = []
    errorMessage.value = ''
    status.value = 'empty'
  }

  function fail(message: string): void {
    clear()
    status.value = 'error'
    errorMessage.value = message
  }

  function mount(asset: TwinModelAsset): void {
    const core = options.core()
    if (core === null) return
    clear()
    modelObject = asset.root
    core.modelRoot.add(asset.root)
    nodeIndex = buildNodeIndex(asset.root)
    missingNodes.value = unmatchedNodeNames(nodeIndex, options.parts())
    status.value = 'ready'
    options.onReady(asset, nodeIndex)
  }

  function reportProgress(seq: number, loaded: number, total: number): void {
    if (seq !== loadSeq || total <= 0) return
    progressPercent.value = Math.round((loaded / total) * FULL_PERCENT)
  }

  async function load(): Promise<void> {
    const mine = ++loadSeq
    loadAbort?.abort()
    const controller = new AbortController()
    loadAbort = controller
    const asset = options.asset()
    if (asset === '') return clear()
    const url = resolveTwinModelUrl(asset)
    if (url === '') return fail('模型地址解析失败：素材引用无效或宿主未注入')
    status.value = 'loading'
    progressPercent.value = 0
    try {
      const asset = await loadTwinModel(url, {
        signal: controller.signal,
        onProgress: (loaded, total) => reportProgress(mine, loaded, total),
      })
      // ⚠ 慢的那次后返回时要连同它的 GPU 资源一起丢掉：只 return 是一次纯泄漏
      if (mine !== loadSeq) return disposeSceneGraph(asset.root)
      mount(asset)
    } catch (error) {
      if (mine !== loadSeq) return
      fail(error instanceof Error ? error.message : '模型加载失败')
    }
  }

  function abort(): void {
    // ⚠ 先递序号再中止：晚一步回来的那次靠序号对不上才认得出自己已经作废
    loadSeq += 1
    loadAbort?.abort()
    loadAbort = null
    modelObject = null
    nodeIndex = EMPTY_NODE_INDEX
  }

  return {
    status,
    progressPercent,
    errorMessage,
    missingNodes,
    root: () => modelObject,
    index: () => nodeIndex,
    load,
    fail,
    abort,
  }
}
