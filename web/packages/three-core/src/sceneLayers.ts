/**
 * @fileoverview 五个覆盖层的合集：锚点、箭头、信息牌、能量流、场景特效。
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
} from '@dt/twin-config'
import type * as THREE from 'three'

import { AnchorLayer } from './anchorLayer'
import { ArrowLayer } from './arrowLayer'
import { FlowLayer } from './flowLayer'
import { PanelLayer } from './panelLayer'
import { SceneEffectsLayer } from './sceneEffects'

/** 五路实时值，缺席的那一路由调用方填空引用。 */
export interface SceneLayerValues {
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

  /** 宿主元素，CSS2D 标签与主题色解析都要用它。 */
  private readonly host: HTMLElement | null

  constructor(host: HTMLElement | null) {
    this.host = host
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
   * @param values 五路实时值
   */
  build(config: TwinConfig, values: SceneLayerValues): void {
    this.anchors.build(config.anchors)
    this.arrows.build(config.arrows)
    this.panels.build(config.panels, config.anchors)
    this.flows.build(config.flows, config.anchors)
    this.effects.build(config.model.sceneEffects, this.host)
    this.setValues(values)
  }

  /**
   * 只换值不重建。
   * @param values 五路实时值
   */
  setValues(values: SceneLayerValues): void {
    this.anchors.setValues(values.anchors)
    this.arrows.setValues(values.arrows)
    this.panels.setValues(values.panels)
    this.flows.setValues(values.flows)
  }

  /**
   * 模型体量变了，跟着换尺寸。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    this.anchors.setWorldScale(modelDiagonal)
    this.arrows.setWorldScale(modelDiagonal)
    this.flows.setWorldScale(modelDiagonal)
    this.effects.setWorldScale(modelDiagonal)
  }

  /**
   * 推进一帧。只有会动的那两层要。
   * @param deltaSeconds 这一帧的时长，秒
   */
  update(deltaSeconds: number): void {
    this.flows.update(deltaSeconds)
    this.effects.update(deltaSeconds)
  }

  /** 五层全部释放。⚠ 少一行就是一处只在「用久了变卡」时才看得见的泄漏。 */
  dispose(): void {
    this.anchors.dispose()
    this.arrows.dispose()
    this.panels.dispose()
    this.flows.dispose()
    this.effects.dispose()
  }
}
