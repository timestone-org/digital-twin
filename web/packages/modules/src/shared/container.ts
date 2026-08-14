/**
 * @fileoverview 容器模块的内容区几何：标题条与内边距。容器组件与运行时读同一份，
 * 免得「面板里关了标题条、几何仍按有标题条算」——这种错位只在子节点位置上看得出来。
 */
import { readBoolean, readNumber, readRecord } from './config'

/** 容器内部布局所在的配置键。 */
export const CONTAINER_CONFIG_KEY = '__container'

/** 标题条开关所在的配置键。 */
export const SHOW_TITLE_CONFIG_KEY = 'showTitle'

/** 标题条高度（px）。 */
export const TITLE_BAR_HEIGHT_PX = 28

/** 容器内边距缺省（px）。 */
export const CONTAINER_PAD_DEFAULT_PX = 8

/** 容器内部布局。 */
export interface ContainerLayout {
  /** 内容区四边内边距（px）。 */
  pad: number
}

/** 内容区相对容器矩形的内缩（px）。 */
export interface ContentInset {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * 读容器内部布局，脏值一律回落缺省。
 * @param raw 配置里 `__container` 键的原值
 */
export function readContainerLayout(raw: unknown): ContainerLayout {
  return { pad: readNumber(readRecord(raw).pad, CONTAINER_PAD_DEFAULT_PX) }
}

/**
 * 内容区内缩。
 * ⚠ 缺 `showTitle` 一律按**没有**标题条算：回落成「有标题条」会凭空留 28px，
 * 把容器里所有子节点整体往下顶，而配置里根本没有这一项（DASHBOARD_DESIGN §5.3）。
 * ⚠ 内缩由容器组件自己以 padding 渲染，运行时拿它只用来夹取子节点尺寸——
 * 不许再把它加进子节点坐标，加两次与漏加一样看不出是谁干的。
 * @param config 容器节点的整份配置
 */
export function resolveContentInset(
  config: Record<string, unknown>,
): ContentInset {
  const { pad } = readContainerLayout(config[CONTAINER_CONFIG_KEY])
  const bar = readBoolean(config[SHOW_TITLE_CONFIG_KEY])
    ? TITLE_BAR_HEIGHT_PX
    : 0
  return { top: pad + bar, right: pad, bottom: pad, left: pad }
}
