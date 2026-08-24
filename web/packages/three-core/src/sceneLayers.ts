/**
 * @fileoverview 覆盖层的合集：部件、锚点、箭头、信息牌、能量流、场景特效。
 *
 * 把它们收成一个对象，是为了让「建 / 喂值 / 换体量 / 推进一帧 / 释放」这五件事
 * 各只有一处写法。散在宿主组件里时，加一层就要在五个地方各补一行，
 * ⚠ 而漏掉的最常是 `dispose` 那一行——它不报错，只是越用越卡。
 */
import type {
  TwinAnchorValues,
  TwinArrowValues,
  TwinConfig,
  TwinFlowValues,
  TwinPanelValues,
  TwinPartValues,
  Vec3,
} from '@dt/twin-config'
import type * as THREE from 'three'

import { AnchorLayer } from './anchorLayer'
import { ArrowLayer } from './arrowLayer'
import type { DistanceContext } from './distanceContext'
import { FlowLayer } from './flowLayer'
import type { NodeIndex } from './nodeIndex'
import { PanelLayer } from './panelLayer'
import { PartsLayer } from './partsLayer'
import { SceneEffectsLayer } from './sceneEffects'

/** 六路实时值，缺席的那一路由调用方填空引用。 */
export interface SceneLayerValues {
  /** 部件状态染色用；只有配了染色的部件在里面。 */
  parts: TwinPartValues
  anchors: TwinAnchorValues
  arrows: TwinArrowValues
  panels: TwinPanelValues
  flows: TwinFlowValues
}

/** 一套覆盖层。宿主挂载时建一份，卸载时 `dispose`。 */
export class SceneLayers {
  readonly anchors: AnchorLayer
  readonly arrows: ArrowLayer
  readonly panels: PanelLayer
  readonly flows: FlowLayer
  readonly effects: SceneEffectsLayer
  /** 部件的显隐、透明度与染色；它不往场景里加对象，改的是模型自己的节点。 */
  readonly parts: PartsLayer

  /** 宿主元素，CSS2D 标签与主题色解析都要用它。 */
  private readonly host: HTMLElement | null

  constructor(host: HTMLElement | null) {
    this.host = host
    this.parts = new PartsLayer(host)
    this.anchors = new AnchorLayer(host)
    this.arrows = new ArrowLayer(host)
    this.panels = new PanelLayer()
    this.flows = new FlowLayer(host)
    this.effects = new SceneEffectsLayer()
  }

  /** 五个组一次性挂进场景。 */
  addTo(scene: THREE.Scene): void {
    scene.add(
      this.anchors.group,
      this.arrows.group,
      this.panels.group,
      this.flows.group,
      this.effects.group,
    )
  }

  /**
   * 按配置重建全部覆盖层，并立刻喂一次值。
   * @param config 归一化后的孪生配置
   * @param values 六路实时值
   */
  build(
    config: TwinConfig,
    values: SceneLayerValues,
    nodeIndex: NodeIndex,
  ): void {
    this.parts.build(nodeIndex, config.parts)
    this.anchors.build(config.anchors)
    this.arrows.build(config.arrows)
    this.panels.build(config.panels, config.anchors)
    this.flows.build(config.flows, config.anchors)
    this.effects.build(config.model.sceneEffects, this.host)
    this.setValues(values)
  }

  /**
   * 只换值不重建。
   * @param values 六路实时值
   */
  setValues(values: SceneLayerValues): void {
    this.parts.setValues(values.parts)
    this.anchors.setValues(values.anchors)
    this.arrows.setValues(values.arrows)
    this.panels.setValues(values.panels)
    this.flows.setValues(values.flows)
  }

  /**
   * 按这一帧的取景状态更新各处的距离显隐与淡出。
   *
   * ⚠ 每帧都调，故这里只算距离、不重建任何对象。配置变了走 `build`。
   * ⚠ 少调一处，那一类元素上配的距离规则就完全不生效——而它既不报错，
   * 也不会在别处露出任何痕迹。
   *
   * @param context 这一帧的相机与轨道中心
   */
  applyDistanceRules(context: DistanceContext): void {
    this.parts.apply(context)
    this.anchors.applyDistance(context)
    this.arrows.applyDistance(context)
    this.panels.applyDistance(context)
    this.flows.applyDistance(context)
  }

  /**
   * 坐标基准的原点变了。
   * ⚠ 只有场景特效吃它：锚点、箭头、信息牌、能量流存的都是世界坐标，
   * 再减一次原点就等于把它们整片挪走。
   * @param origin 基准原点，世界坐标
   */
  setFrameOrigin(origin: Vec3): void {
    this.effects.setOrigin(origin)
  }

  /**
   * 模型体量变了，跟着换尺寸。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    this.anchors.setWorldScale(modelDiagonal)
    this.arrows.setWorldScale(modelDiagonal)
    this.panels.setWorldScale(modelDiagonal)
    this.flows.setWorldScale(modelDiagonal)
    this.effects.setWorldScale(modelDiagonal)
  }

  /**
   * 推进一帧：会动的两层各走一步，信息牌按当前相机重摆朝向。
   *
   * ⚠ 朝向挂在这里而不是 `applyDistanceRules`：编辑视口**有意不套距离规则**
   * （编辑时镜头到处飞，套上规则会让刚配好的东西一转镜头就不见了），挂在那边
   * 的话编辑器里的牌永远不转，而它既不报错也没有别的痕迹。
   * ⚠ 时长为 0 也要走完：那是刚建完还没跑起来的第一帧，牌的朝向得先摆对。
   *
   * @param deltaSeconds 这一帧的时长，秒
   * @param camera 当前相机
   */
  update(deltaSeconds: number, camera: THREE.Camera): void {
    if (deltaSeconds > 0) {
      this.flows.update(deltaSeconds)
      this.effects.update(deltaSeconds)
    }
    this.panels.faceCamera(camera)
  }

  /** 六层全部释放。⚠ 少一行就是一处只在「用久了变卡」时才看得见的泄漏。 */
  dispose(): void {
    this.parts.dispose()
    this.anchors.dispose()
    this.arrows.dispose()
    this.panels.dispose()
    this.flows.dispose()
    this.effects.dispose()
  }
}
