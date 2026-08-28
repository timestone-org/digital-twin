/**
 * @fileoverview 画布尺寸那一簇：这张图与大屏格子对不对得上（1:1），画布四周还剩多少
 * 空白（裁到内容），以及两个把它们改过去的动作。
 *
 * ⚠ 两件事都只改**画布**，不改符号内部：`alignToCell` 换的是坐标系换算比例，
 * `cropToContent` 换的是画布尺寸加全图位移。想让符号自己随宽高变形是另一件事
 * （预置库按响应式重编），不在这里。
 * ⚠ 自己不碰文档态：算出整份新配置交给页面的 `commit`，撤销栈归它。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { Twin2dConfig } from '@dt/twin2d'
import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { twin2dContentFitOf, twin2dFitToContent } from './fitContent'
import type { Twin2dContentFit } from './fitContent'
import { twin2dCellOf, twin2dHostFitView, twin2dParityOf } from './hostFit'
import type { Twin2dParity } from './hostFit'

/** 这一簇交出去的东西。 */
export interface Twin2dSizing {
  /** 编辑的一像素是不是大屏上的一像素；这块在大屏上占多大还不知道时 null。 */
  parity: ComputedRef<Twin2dParity | null>
  /** 画布该怎么裁；一件都没画时 null。 */
  contentFit: ComputedRef<Twin2dContentFit | null>
  /** 把画布尺寸设成 1:1 的设计尺寸。 */
  alignToCell: () => void
  /**
   * 对齐这一下会不会把内容裁掉；会就一步都不许走。
   * ⚠ 这是一次真事故的补丁：按格子对齐会**缩小**画布，而画布是运行态的裁切框——
   * 缩下去之后落在外面的节点在大屏上一个都看不见，编辑器里却照画不误。
   */
  alignCrops: ComputedRef<boolean>
  /** 画布裁到内容，全图跟着挪。 */
  cropToContent: () => void
}

/**
 * 装上画布尺寸这一簇。
 * @param config 取当前整份配置
 * @param node 取被编辑的大屏节点
 * @param commit 落一步撤销
 */
export function useTwin2dSizing(
  config: () => Twin2dConfig | null,
  node: () => DashboardNodePayload | null,
  commit: (next: Twin2dConfig) => void,
): Twin2dSizing {
  /**
   * ⚠ 缩放档与留白从大屏节点上**读**出来（本页只读不写，见 `hostFit`）：按缺省值算的
   * 话，属性面板上调过留白的那些节点会被报成 1:1，而它们并不是。
   */
  const parity = computed<Twin2dParity | null>(() => {
    const canvas = config()?.canvas
    const at = node()
    const cell = twin2dCellOf(at)
    if (canvas === undefined || cell === null) return null
    return twin2dParityOf(cell, twin2dHostFitView(at?.configJson ?? {}), canvas)
  })

  const contentFit = computed<Twin2dContentFit | null>(() => {
    const current = config()
    return current === null ? null : twin2dContentFitOf(current)
  })

  /**
   * ⚠ 改的是**画布坐标系**，不是视口缩放：图上所有节点的坐标一个都不动，只是这张图与
   * 大屏格子之间的换算从此是 1。
   */
  const alignCrops = computed<boolean>(() => {
    const design = parity.value?.design
    const box = contentFit.value?.content
    if (design === undefined || box === undefined) return false
    return box.x + box.w > design.width || box.y + box.h > design.height
  })

  function alignToCell(): void {
    const current = config()
    const state = parity.value
    if (current === null || state === null || state.exact) return
    // ⚠ 裁得到内容就一步都不走：宁可这一枚键按不动，也不能悄悄让一批节点上了大屏就消失
    if (alignCrops.value) return
    commit({ ...current, canvas: { ...current.canvas, ...state.design } })
  }

  /**
   * ⚠ 这是画布卫生，不是「让图变清晰」的手段：`contain` 下裁掉空白只会让缩放倍率变大，
   * 而倍率大于 1 是把图放大重采样，字与细线反而更糊。清晰归「原尺寸」那一档。
   */
  function cropToContent(): void {
    const current = config()
    const fit = contentFit.value
    if (current === null || fit === null) return
    const next = twin2dFitToContent(current, fit)
    if (next !== current) commit(next)
  }

  return { parity, contentFit, alignToCell, alignCrops, cropToContent }
}
