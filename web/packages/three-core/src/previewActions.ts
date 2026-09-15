/** @fileoverview 配置预览的聚焦与部件动作命令。 */
import { partFocusView, type TwinConfig, type TwinPart } from '@dt/twin-config'
import { resolveClickGate } from './distanceRules'
import { distanceContextOf, distanceResolver } from './distanceContext'
import type { SceneCore } from './sceneCore'
import type { PartsLayer } from './partsLayer'
import type { RoamTourController } from './useRoamTour'
import * as THREE from 'three'
import { entityPickPoints, type TwinSceneSelection } from './pickTargets'
export interface TwinPreviewAction {
  sequence: number
  partId: string
  kind: 'detail' | 'near' | 'far' | 'click' | 'roam-play' | 'roam-stop'
}
export function previewTargetBox(
  config: TwinConfig,
  target: TwinSceneSelection | null | undefined,
  span: number,
): THREE.Box3 | null {
  if (target === null || target === undefined || !('id' in target)) return null
  if (target.kind === 'flows') {
    const flow = config.flows.find((item) => item.id === target.id)
    const points = config.anchors
      .filter((anchor) => flow?.pathAnchors.includes(anchor.id))
      .map((anchor) => new THREE.Vector3(...anchor.position))
    return points.length < 2
      ? null
      : new THREE.Box3()
          .setFromPoints(points)
          .expandByScalar(Math.max(1, span * 0.01))
  }
  const point = entityPickPoints(config).find(
    (item) => item.kind === target.kind && item.id === target.id,
  )
  if (point === undefined) return null
  const size = Math.max(1, span * 0.05)
  return new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(...point.position),
    new THREE.Vector3(size, size, size),
  )
}

export interface PreviewActionDeps {
  config: TwinConfig
  core: SceneCore | null
  parts: PartsLayer | null
  ready: boolean
  near: (part: TwinPart) => void
  far: (part: TwinPart, box: THREE.Box3 | null) => void
  detail: (part: TwinPart) => void
  roam: RoamTourController
  result: (message: string) => void
}
export function executePreviewAction(
  action: TwinPreviewAction | null | undefined,
  deps: PreviewActionDeps,
): void {
  if (action == null) return
  if (action.kind === 'roam-play' || action.kind === 'roam-stop') {
    runRoamPreview(action.kind, deps)
    return
  }
  const part = deps.config.parts.find((item) => item.id === action.partId)
  if (
    !deps.ready ||
    deps.core === null ||
    deps.parts === null ||
    part === undefined
  ) {
    deps.result('模型尚未就绪或部件已不存在')
    return
  }
  if (action.kind === 'detail') {
    deps.detail(part)
    deps.result('已打开完整详情')
    return
  }
  if (action.kind === 'click') {
    testCurrentDistance(part, deps.core, deps.parts, deps)
    return
  }
  runPartAction(part, action.kind, deps)
}
function runPartAction(
  part: TwinPart,
  kind: 'near' | 'far',
  deps: PreviewActionDeps,
): void {
  if (kind === 'near') {
    deps.near(part)
    deps.result(
      part.click.near === 'detail'
        ? '近距动作：打开部件详情'
        : '近距动作：发出联动事件（预览不会触发其他模块）',
    )
    return
  }
  deps.far(part, deps.parts?.boxOf(part.id) ?? null)
  const message =
    part.click.far === 'none'
      ? '远距动作：不响应'
      : part.click.far === 'view' &&
          partFocusView(part, deps.config.cameras) !== null
        ? '远距动作：飞到指定取景'
        : '远距动作：框选部件'
  deps.result(
    part.clickDistance.farThreshold === null
      ? `${message}；未配置远近分界，运行时无法进入远距动作`
      : message,
  )
}

function testCurrentDistance(
  part: TwinPart,
  core: SceneCore,
  parts: PartsLayer,
  deps: PreviewActionDeps,
): void {
  const center = parts.centerOf(part.id)
  const gate = resolveClickGate(
    part.clickDistance,
    distanceResolver(distanceContextOf(core), center, center),
  )
  if (gate === 'block') {
    deps.result('当前视距被点击距离限制拦截')
    return
  }
  runPartAction(part, gate === 'approach' ? 'far' : 'near', deps)
}

function runRoamPreview(
  kind: 'roam-play' | 'roam-stop',
  deps: PreviewActionDeps,
): void {
  if (kind === 'roam-stop') {
    deps.roam.pause()
    return
  }
  if (!deps.ready) {
    deps.result('模型加载完成后开始漫游预览')
    return
  }
  if (!deps.roam.playing.value) deps.roam.toggle()
}
