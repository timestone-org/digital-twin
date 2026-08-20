/**
 * @fileoverview 模型装载的一整条链：解析地址、带进度拉取、挂进场景、报缺失节点，
 * 以及快速切模型时的竞态处理。宿主只负责在装好之后摆放与建层。
 */
import type { TwinPart } from '@dt/twin-config'
import type { Object3D } from 'three'
import { ref, type Ref } from 'vue'

import type { ModelVariant } from '@dt/contracts'

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
  /** 用哪一档压缩产物。不给按原件。 */
  variant?: () => ModelVariant
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

/** 装载过程里的可变状态；提出来是为了让下面几支不必挤在一个函数里。 */
interface LoadState {
  status: Ref<TwinModelStatus>
  progressPercent: Ref<number>
  errorMessage: Ref<string>
  missingNodes: Ref<readonly string[]>
  root: Object3D | null
  index: NodeIndex
  seq: number
  abort: AbortController | null
}

/** 把模型与索引清干净，状态回到空态。 */
function clearModel(state: LoadState, core: SceneCore | null): void {
  if (core !== null) disposeSceneGraph(core.modelRoot)
  state.root = null
  state.index = EMPTY_NODE_INDEX
  state.missingNodes.value = []
  state.errorMessage.value = ''
  state.status.value = 'empty'
}

/** 把模型挂进场景，建索引并报出配了却找不到的节点名。 */
function mountModel(
  state: LoadState,
  options: TwinModelLoadOptions,
  asset: TwinModelAsset,
): void {
  const core = options.core()
  if (core === null) return
  clearModel(state, core)
  state.root = asset.root
  core.modelRoot.add(asset.root)
  state.index = buildNodeIndex(asset.root)
  state.missingNodes.value = unmatchedNodeNames(state.index, options.parts())
  state.status.value = 'ready'
  options.onReady(asset, state.index)
}

/**
 * 素材引用 → 地址；空引用给 null（还没挑模型），解析不出来给空串。
 * ⚠ 两者要分开：前者是空态，后者是配错了要报出来的错。
 */
function urlOf(asset: string, variant: ModelVariant): string | null {
  return asset === '' ? null : resolveTwinModelUrl(asset, variant)
}

/** 进度只认当前这一次装载的序号，晚到的那次不许改百分比。 */
function reportProgress(
  state: LoadState,
  seq: number,
  loaded: number,
  total: number,
): void {
  if (seq !== state.seq || total <= 0) return
  state.progressPercent.value = Math.round((loaded / total) * FULL_PERCENT)
}

/** 让在途的那次作废；⚠ 先递序号再中止，晚一步回来的那次靠序号才认得出自己已废。 */
function abortLoad(state: LoadState): void {
  state.seq += 1
  state.abort?.abort()
  state.abort = null
  state.root = null
  state.index = EMPTY_NODE_INDEX
}

/** 打成错误态并清掉模型。 */
function failWith(
  state: LoadState,
  core: SceneCore | null,
  message: string,
): void {
  clearModel(state, core)
  state.status.value = 'error'
  state.errorMessage.value = message
}

/**
 * 装上模型装载链。
 * @param options 场景核心、素材引用、部件清单与装好后的回调
 */
export function useTwinModelLoad(options: TwinModelLoadOptions): TwinModelLoad {
  const state: LoadState = {
    status: ref<TwinModelStatus>('empty'),
    progressPercent: ref(0),
    errorMessage: ref(''),
    missingNodes: ref<readonly string[]>([]),
    root: null,
    index: EMPTY_NODE_INDEX,
    seq: 0,
    abort: null,
  }
  const fail = (message: string): void =>
    failWith(state, options.core(), message)

  async function load(): Promise<void> {
    const mine = ++state.seq
    state.abort?.abort()
    const controller = new AbortController()
    state.abort = controller
    const url = urlOf(options.asset(), options.variant?.() ?? 'original')
    if (url === null) return clearModel(state, options.core())
    if (url === '') return fail('模型地址解析失败：素材引用无效或宿主未注入')
    state.status.value = 'loading'
    state.progressPercent.value = 0
    try {
      const asset = await loadTwinModel(url, {
        signal: controller.signal,
        onProgress: (loaded, total) =>
          reportProgress(state, mine, loaded, total),
      })
      // ⚠ 慢的那次后返回时要连同它的 GPU 资源一起丢掉：只 return 是一次纯泄漏
      if (mine !== state.seq) return disposeSceneGraph(asset.root)
      mountModel(state, options, asset)
    } catch (error) {
      if (mine !== state.seq) return
      fail(error instanceof Error ? error.message : '模型加载失败')
    }
  }

  return {
    status: state.status,
    progressPercent: state.progressPercent,
    errorMessage: state.errorMessage,
    missingNodes: state.missingNodes,
    root: () => state.root,
    index: () => state.index,
    load,
    fail,
    abort: () => abortLoad(state),
  }
}
