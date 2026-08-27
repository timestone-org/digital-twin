/**
 * @fileoverview 部件详情字段的摊平，以及「详情 → 一张信息牌的形状」那一次换形：
 * 绑定行派发、运行时缝合读值、详情卡片与编辑器的字段列表四处共用同一套次序。
 */
import { ALWAYS_VISIBLE } from './normalizeRules'
import type { TwinPanel, TwinPanelField, TwinPart } from './types'

/** 一个详情字段在整份配置里的位置：部件 + 字段 + 实时值的键。 */
export interface FlatPartField {
  partId: string
  field: TwinPanelField
  /** `<部件 id>::<字段 key>`，实时值按它索引。 */
  valueKey: string
}

/**
 * 把所有部件的详情字段按**文档序**摊平。
 * ⚠ 与 `near` 配成什么无关：按动作过滤会让用户在下拉里翻一下就把这个部件后面
 * 每一行绑定都推错一格，而屏幕上只表现为读数接错了对象。
 * @param parts 归一化后的全部部件
 */
export function flattenPartFields(parts: readonly TwinPart[]): FlatPartField[] {
  return parts.flatMap((part) =>
    part.detail.fields.map((field) => ({
      partId: part.id,
      field,
      valueKey: `${part.id}::${field.key}`,
    })),
  )
}

/** 卡片不挂世界坐标，三个向量一律原点。 */
const ORIGIN: [number, number, number] = [0, 0, 0]

/**
 * 一个部件的详情摊成信息牌的形状，好让卡片与编辑器直接复用信息牌那一套字段。
 *
 * ⚠ 牌 id 必须**就是部件 id**：详情字段的实时值按 `<部件 id>::<字段 key>` 索引，
 * 与信息牌值的键法逐字相同，换个 id 就一路读数都对不上。
 * ⚠ 三维那几档（朝向、偏移、引线、世界尺度）在这里一律钉死：数据卡片是弹窗里的
 * 一张 DOM，不挂在世界坐标上，留活口只会让编辑器摆出一堆不生效的开关。
 * @param part 归一化后的部件
 */
export function detailPanelOf(part: TwinPart): TwinPanel {
  const { detail } = part
  return {
    id: part.id,
    // ⚠ 标题与副标题**不进卡片**：它们已经写在弹窗自己的头上，卡片再写一遍
    //   就是同一句话在弹窗里出现两次
    name: '',
    subtitle: '',
    footnote: '',
    anchorId: '',
    position: ORIGIN,
    offset: ORIGIN,
    rotation: ORIGIN,
    fields: detail.fields,
    billboard: 'face',
    style: {
      variant: detail.variant,
      // 居中档不画引线与锚点小环——这张卡片没有锚点可连
      orient: 'center',
      accent: detail.accent,
      background: '',
      width: 0,
      height: 0,
      columns: detail.columns,
      density: 'normal',
      scan: false,
      corners: false,
      grid: false,
      fontScale: 1,
      scale: 1,
      animate: false,
      pulse: false,
    },
    visibility: ALWAYS_VISIBLE,
  }
}
