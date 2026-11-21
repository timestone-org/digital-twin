/** @fileoverview 配置预览的节点隔离和临时取景。 */
import type { TwinConfig, TwinFocusView } from '@dt/twin-config'
import type { Object3D } from 'three'
import type { NodeIndex } from './nodeIndex'
import type { TwinSceneSelection } from './pickTargets'
import { previewTargetBox } from './previewActions'
import { PreviewIsolation } from './previewIsolation'
import type { SceneCore } from './sceneCore'
import type { SceneCamera } from './useSceneCamera'

export interface ScenePreviewTarget {
  target: TwinSceneSelection | null
  context: string
}

interface ScenePreviewOptions {
  core: () => SceneCore | null
  config: () => TwinConfig
  root: () => Object3D | null
  index: () => NodeIndex
  nodes: () => readonly string[] | undefined
  target: () => TwinSceneSelection | null | undefined
  span: () => number
  camera: SceneCamera
}

/** 管理配置预览临时状态。 */
export function useScenePreview(options: ScenePreviewOptions) {
  const isolation = new PreviewIsolation()
  let previewKey = ''
  const target = targetPreviewOf(options)

  function clear(): void {
    isolation.restore()
    previewKey = ''
    target.clear()
  }

  function applyNodes(): void {
    const root = options.root()
    const core = options.core()
    if (root === null || core === null) return
    const names = options.nodes()
    if (names === undefined) {
      if (previewKey !== '') options.camera.applyInitial(root)
      previewKey = ''
      return
    }
    const box = isolation.apply(root, options.index(), names)
    const key = JSON.stringify(names)
    if (key !== previewKey && box !== null)
      options.camera.flight.flyToBox(core, box)
    previewKey = key
  }

  function reset(view: TwinFocusView | null | undefined): void {
    options.camera.flight.cancel()
    clear()
    const root = options.root()
    if (root === null) return
    options.camera.applyInitial(root)
    applyNodes()
    target.apply()
    options.camera.applyView(view)
  }

  return {
    clear,
    applyNodes,
    applyTarget: target.apply,
    reset,
    restore: () => isolation.restore(),
  }
}

/** 聚焦配置中的覆盖层对象，位置变化时才重新取景。 */
function targetPreviewOf(options: ScenePreviewOptions) {
  let key = ''
  return {
    clear: () => {
      key = ''
    },
    apply: () => {
      const core = options.core()
      if (core === null || options.root() === null) return
      const target = options.target()
      const box = previewTargetBox(options.config(), target, options.span())
      if (box === null) {
        key = ''
        return
      }
      const next = JSON.stringify([
        target,
        box.min.toArray(),
        box.max.toArray(),
      ])
      if (key !== next) options.camera.flight.flyToBox(core, box)
      key = next
    },
  }
}
