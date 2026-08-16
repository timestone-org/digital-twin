/**
 * @fileoverview 场景工具的运行态：搜索定位、截图、剖切、两点测量的状态与动作。
 * 纯算的那一半在 `@dt/twin-config/sceneTools`，这里只做与 three 和 DOM 的绑定。
 */
import type { TwinConfig, TwinSearchHit } from '@dt/twin-config'
import {
  clipPlaneFor,
  collectSceneLegend,
  measureDistance,
  screenshotFileName,
  screenshotStamp,
  searchSceneEntities,
  type TwinClipAxis,
} from '@dt/twin-config'
import * as THREE from 'three'
import {
  computed,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

import type { NodeIndex } from './nodeIndex'
import { pickIntersection } from './partPicking'
import { frameBox, type SceneCore } from './sceneCore'

/**
 * 工具条从宿主取这套状态。
 * ⚠ 走 provide 而不是 prop：里面几个 ref 是**给人改的**（搜索词、剖切轴），
 * 当成 prop 传下去，改它长得跟改 prop 一模一样，人和 lint 都分不出来。
 */
export const SCENE_TOOLS_KEY: InjectionKey<SceneTools> = Symbol('twin:tools')

/** 搜索结果最多列这么多条；超出的部分如实告知，不静默砍。 */
const SEARCH_LIMIT = 12

export interface SceneToolsOptions {
  core: () => SceneCore | null
  /** 视口元素，射线拾取要拿它换算屏幕坐标。 */
  element: () => HTMLElement | null
  config: () => TwinConfig
  /** 当前模型的节点索引，搜索取材与定位都要它。 */
  nodeIndex: () => NodeIndex
  /** 截图文件名用的标题。 */
  title: () => string
}

export interface SceneTools {
  query: Ref<string>
  /** 搜索命中，已截断。 */
  hits: ComputedRef<readonly TwinSearchHit[]>
  /** 命中总数；大于 `hits.length` 时界面上要说还有多少条没显示。 */
  total: ComputedRef<number>
  legend: ComputedRef<ReturnType<typeof collectSceneLegend>>
  clipAxis: Ref<TwinClipAxis>
  /** 沿轴的归一化位置 [0,1]。 */
  clipRatio: Ref<number>
  measuring: Ref<boolean>
  /** 图例浮层开着没有。 */
  legendOpen: Ref<boolean>
  /** 两点测量的结果距离；还没测满两点时是 NaN。 */
  measured: ComputedRef<number>
  /** 把镜头飞到这条命中的几何上。 */
  locate: (hit: TwinSearchHit) => void
  /** 导出当前画面为 PNG。 */
  screenshot: () => void
  toggleMeasure: () => void
  /**
   * 测量模式下把这一下收成一个测点，并告诉宿主「这一下我截走了」。
   * ⚠ 没打中模型也算截获：测量开着时点空白处不该顺手触发部件联动。
   */
  interceptClick: (event: PointerEvent) => boolean
}

type Point = [number, number, number]

/**
 * 装上场景工具。
 * @param options 场景内核、配置、节点索引与标题
 */
export function useSceneTools(options: SceneToolsOptions): SceneTools {
  const query = ref('')
  const clipAxis = ref<TwinClipAxis>('none')
  const clipRatio = ref(0.5)
  const measuring = ref(false)
  const legendOpen = ref(false)
  const points = ref<readonly Point[]>([])

  const result = computed(() => search(options, query.value))
  const measured = computed(() =>
    measureDistance(points.value[0] ?? null, points.value[1] ?? null),
  )

  // ⚠ 轴或位置一改就重算：交给宿主去调的话，漏一处的表现是「拖了滑块没反应」
  watch([clipAxis, clipRatio], () =>
    applyClipping(options.core(), clipAxis.value, clipRatio.value),
  )

  return {
    query,
    legendOpen,
    hits: computed(() => result.value.hits),
    total: computed(() => result.value.total),
    legend: computed(() => collectSceneLegend(options.config().flows)),
    clipAxis,
    clipRatio,
    measuring,
    measured,
    locate: (hit) => {
      const core = options.core()
      const box = boxOfNames(options.nodeIndex(), hit.nodes)
      // 命中的实体在模型里找不到对应几何：不动镜头，也不报错——那是配置与
      // 模型对不上，由诊断面板去说，这里乱飞一下只会让人更糊涂
      if (core === null || box === null) return
      frameBox(core, box)
    },

    screenshot: () => saveScreenshot(options.core(), options.title()),

    toggleMeasure: () => {
      measuring.value = !measuring.value
      // 关掉测量就清点：留着上一次的两点，下次打开会看到一条来历不明的距离
      points.value = []
    },

    interceptClick: (event) => {
      const core = options.core()
      const element = options.element()
      if (!measuring.value || core === null || element === null) return false
      const hit = pickIntersection(event, element, core.camera, core.modelRoot)
      // 已经有两点了就从头开始量，而不是往后堆
      if (hit !== null) {
        const next: Point = [hit.point.x, hit.point.y, hit.point.z]
        points.value =
          points.value.length >= 2 ? [next] : [...points.value, next]
      }
      return true
    },
  }
}

/** 按当前取材搜一遍；取材含模型索引里的节点名，那一路断了就搜不到未登记的几何。 */
function search(
  options: SceneToolsOptions,
  query: string,
): { hits: TwinSearchHit[]; total: number } {
  return searchSceneEntities(
    query,
    {
      parts: options.config().parts,
      hierNodes: options.config().hierNodes,
      namedNodes: options.nodeIndex().namedNodes,
    },
    SEARCH_LIMIT,
  )
}

/** 把一组节点名并成一个包围盒；一个都找不到时给 null。 */
function boxOfNames(
  index: NodeIndex,
  names: readonly string[],
): THREE.Box3 | null {
  const box = new THREE.Box3()
  let found = false
  for (const name of names) {
    for (const object of index.byName.get(name) ?? []) {
      box.expandByObject(object)
      found = true
    }
  }
  return found ? box : null
}

/** 导出当前画面。 */
function saveScreenshot(core: SceneCore | null, title: string): void {
  if (core === null || typeof document === 'undefined') return
  // ⚠ 必须先画一帧再取：WebGL 的后备缓冲在下一帧就被清了，
  // 直接 toDataURL 多半拿到一张全黑
  core.renderer.render(core.scene, core.camera)
  let url = ''
  try {
    url = core.renderer.domElement.toDataURL('image/png')
  } catch {
    // 画布被跨域素材污染时 toDataURL 抛错——放弃，不给用户一个坏文件
    return
  }
  const link = document.createElement('a')
  link.href = url
  link.download = screenshotFileName(
    title,
    screenshotStamp(new Date().toISOString()),
  )
  link.click()
}

/** 按当前轴与位置重算剖切面并套到渲染器。 */
function applyClipping(
  core: SceneCore | null,
  axis: TwinClipAxis,
  ratio: number,
): void {
  if (core === null) return
  const box = new THREE.Box3().setFromObject(core.modelRoot)
  const along = axis === 'none' ? 'x' : axis
  const lo = box.isEmpty() ? Number.NaN : box.min[along]
  const hi = box.isEmpty() ? Number.NaN : box.max[along]
  const plane = clipPlaneFor(axis, ratio, lo, hi)
  core.renderer.clippingPlanes =
    plane === null
      ? []
      : [new THREE.Plane(new THREE.Vector3(...plane.normal), plane.constant)]
}
