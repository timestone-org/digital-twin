/**
 * @fileoverview 运行态只读结构树的状态：展开、勾选显隐、点击定位。
 *
 * ⚠ 勾掉的显隐**只在当前会话存活**，绝不写回 `TwinConfig`：它是「我先把这层
 * 遮挡挪开看看里面」的临时动作，落库会让下一个人打开大屏时莫名少一堆东西。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { buildSceneTree, objectAtUid, type SceneTreeNode } from './sceneTree'
import { frameBox, type SceneCore } from './sceneCore'
import * as THREE from 'three'

export interface StructureTreeOptions {
  core: () => SceneCore | null
  /** 模型换了要重建树；宿主在装载完成后调 `rebuild`。 */
  enabled: () => boolean
}

export interface StructureTree {
  nodes: ComputedRef<readonly SceneTreeNode[]>
  /** 展开着的 uid。 */
  expanded: Ref<ReadonlySet<string>>
  /** 被手动勾掉的 uid；只在本次会话有效。 */
  hidden: Ref<ReadonlySet<string>>
  toggleExpand: (uid: string) => void
  /** 勾掉或勾回一支的显隐。 */
  toggleVisible: (uid: string) => void
  /** 把镜头飞到这一支上。 */
  locate: (uid: string) => void
  /** 模型换了：重建树并把手动显隐清干净（旧 uid 对不上新模型）。 */
  rebuild: () => void
}

/**
 * 装上结构树。
 * @param options 场景内核与开关
 */
export function useStructureTree(options: StructureTreeOptions): StructureTree {
  const version = ref(0)
  const expanded = ref<ReadonlySet<string>>(new Set())
  const hidden = ref<ReadonlySet<string>>(new Set())

  const nodes = computed<readonly SceneTreeNode[]>(() => {
    void version.value
    const core = options.core()
    // 关着就不建：这是一趟完整的场景遍历，没人看的时候不该付这个钱
    if (!options.enabled() || core === null) return []
    return buildSceneTree(core.modelRoot)
  })

  function toggleOn(set: ReadonlySet<string>, uid: string): Set<string> {
    const next = new Set(set)
    if (!next.delete(uid)) next.add(uid)
    return next
  }

  function toggleVisible(uid: string): void {
    const core = options.core()
    if (core === null) return
    const object = objectAtUid(core.modelRoot, uid)
    if (object === null) return
    const next = toggleOn(hidden.value, uid)
    object.visible = !next.has(uid)
    hidden.value = next
  }

  function locate(uid: string): void {
    const core = options.core()
    if (core === null) return
    const object = objectAtUid(core.modelRoot, uid)
    if (object === null) return
    frameBox(core, new THREE.Box3().setFromObject(object))
  }

  function restore(): void {
    const core = options.core()
    if (core === null) return
    for (const uid of hidden.value) {
      const object = objectAtUid(core.modelRoot, uid)
      if (object !== null) object.visible = true
    }
  }

  return {
    nodes,
    expanded,
    hidden,
    toggleExpand: (uid) => {
      expanded.value = toggleOn(expanded.value, uid)
    },
    toggleVisible,
    locate,
    rebuild: () => {
      // ⚠ 先把手动隐藏的恢复再清记录：换模型时不恢复的话，那些对象带着
      // `visible = false` 被留在旧场景里，而记录已经没了，谁也开不回来
      restore()
      hidden.value = new Set()
      expanded.value = new Set()
      version.value += 1
    },
  }
}
