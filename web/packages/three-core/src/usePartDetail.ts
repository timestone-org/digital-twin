/**
 * @fileoverview 部件详情弹窗的开关：现在弹的是哪个部件，以及换配置之后对账。
 *
 * ⚠ 「当前弹的是哪个部件」只有这一份：宿主要按它决定弹不弹、弹窗要按它建自己
 * 那块 3D，两边各存一份必然对不上。
 * ⚠ 弹窗自带一套场景，主画布不做任何让位，所以这里既不动相机也不动材质——
 * 关掉弹窗没有任何要还原的东西。
 */
import type { TwinPart } from '@dt/twin-config'
import { shallowRef, type ShallowRef } from 'vue'

export interface PartDetail {
  /**
   * 当前弹出的部件；null = 没开。
   * ⚠ 浅引用：部件是归一化出来的不可变对象，深代理一整份配置只是白搭一层，
   * 而弹窗本来就按引用换整份重建。
   */
  part: ShallowRef<TwinPart | null>
  /** 弹出这个部件的详情。 */
  open: (part: TwinPart) => void
  close: () => void
  /**
   * 配置换了之后对一次账：这个部件还在不在、弹窗还开不开得起来。
   * ⚠ 换成新那一份而不是留着旧的：主场景重建部件材质之后，旧引用里克隆进弹窗
   * 的那份材质已经作废，接着画就是一块黑。
   */
  sync: (parts: readonly TwinPart[]) => void
}

/** 装上部件详情。 */
export function usePartDetail(): PartDetail {
  const part = shallowRef<TwinPart | null>(null)

  return {
    part,
    open: (next) => {
      part.value = next
    },
    close: () => {
      part.value = null
    },
    sync: (parts) => {
      const open = part.value
      if (open === null) return
      part.value = parts.find((item) => item.id === open.id) ?? null
    },
  }
}
