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
import * as THREE from 'three'

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
  /**
   * 五个组的共同父节点，**CSS2D 与 CSS3D 两个渲染器只遍历它**。
   *
   * ⚠ 这不是收纳：那两个渲染器每帧都会把传进去的那棵树整个走一遍（还各自
   * 再 `updateMatrixWorld` 一次）。传整个 scene 的话，一棵几千节点的模型每帧
   * 要被白走四遍——而它只在「模型一大就掉帧」时才看得出来，看不出是谁干的。
   * ⚠ 类型是 `Scene` 不是 `Group`：三方那两个渲染器的签名要 `Scene`，而运行期
   * 它们只当普通 `Object3D` 用。嵌在主场景里的 `Scene` 对 WebGL 渲染器也只是
   * 一个节点（背景与雾只认最外层那一份），所以这样接得上、也不用写断言。
   */
  readonly root = new THREE.Scene()

  readonly anchors: AnchorLayer
  readonly arrows: ArrowLayer
  readonly panels: PanelLayer
  readonly flows: FlowLayer
  readonly effects: SceneEffectsLayer
  /** 部件的显隐、透明度与染色；它不往场景里加对象，改的是模型自己的节点。 */
  readonly parts: PartsLayer

  /** 宿主元素，CSS2D 标签与主题色解析都要用它。 */
  private readonly host: HTMLElement | null

  /**
   * 上一次真算过距离规则时的取景状态。镜头没动、值也没变的那些帧整帧跳过。
   * ⚠ 初值是 NaN：NaN 与谁比都不等，所以第一帧一定会算。
   */
  private readonly lastCamera = new THREE.Vector3(NaN, NaN, NaN)
  private readonly lastTarget = new THREE.Vector3(NaN, NaN, NaN)
  /** 配置或实时值刚变过，下一帧必须算一次，与镜头动没动无关。 */
  private distanceDirty = true

  constructor(host: HTMLElement | null) {
    this.root.name = 'twin-overlays'
    this.host = host
    this.parts = new PartsLayer(host)
    this.anchors = new AnchorLayer(host)
    this.arrows = new ArrowLayer(host)
    this.panels = new PanelLayer()
    this.flows = new FlowLayer(host)
    this.effects = new SceneEffectsLayer()
  }

  /** 五个组一次性挂进场景，共用一个覆盖层根。 */
  addTo(scene: THREE.Scene): void {
    this.root.add(
      this.anchors.group,
      this.arrows.group,
      this.panels.group,
      this.flows.group,
      this.effects.group,
    )
    scene.add(this.root)
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
    this.distanceDirty = true
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
    // ⚠ 部件的染色是从值来的，不是从距离来的：漏了这一句，镜头停着不动时
    //   点位再怎么变，部件的颜色都不会跟着走
    this.distanceDirty = true
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
   * ⚠ 镜头没动且值没变的那些帧整帧跳过：结果与上一帧逐字相同，算了也是原样
   * 写回去。判据里的「值没变」一条不能少，否则镜头停着时染色就冻住了。
   *
   * @param context 这一帧的相机与轨道中心
   */
  applyDistanceRules(context: DistanceContext): void {
    // ⚠ 镜头没动、值也没变时这一整趟的结果与上一帧逐字相同：几百个部件各算一遍
    //   显隐与外观，算完再原样写回去。跳过它不改变任何一帧的画面
    const still =
      !this.distanceDirty &&
      this.lastCamera.equals(context.cameraPosition) &&
      this.lastTarget.equals(context.orbitTarget)
    if (still) return
    this.lastCamera.copy(context.cameraPosition)
    this.lastTarget.copy(context.orbitTarget)
    this.distanceDirty = false
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
