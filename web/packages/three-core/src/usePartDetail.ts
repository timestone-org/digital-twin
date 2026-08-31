/**
 * @fileoverview 部件详情弹窗的开关：现在弹的是哪个部件、装配栏里正看着它的哪个
 * 后代，以及换配置之后对账。
 *
 * ⚠ 这两样只有这一份：宿主要按它决定弹不弹、弹窗要按它建自己那块 3D，两边各存
 * 一份必然对不上。
 * ⚠ 弹窗自带一套场景，主画布不做任何让位，所以这里既不动相机也不动材质——
 * 关掉弹窗没有任何要还原的东西。
 */
import type { TwinPart } from '@dt/twin-config'
import { partAssembly } from '@dt/twin-config'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export interface PartDetail {
  /**
   * 当前弹出的部件，也是装配的顶；null = 没开。
   * ⚠ 浅引用：部件是归一化出来的不可变对象，深代理一整份配置只是白搭一层，
   * 而弹窗本来就按引用换整份重建。
   */
  part: ShallowRef<TwinPart | null>
  /** 装配栏里正看着谁；空串 = 看打开的那个自己。 */
  currentId: Ref<string>
  /** 弹出这个部件的详情。 */
  open: (part: TwinPart) => void
  /** 换成看装配里的另一个部件。 */
  select: (partId: string) => void
  close: () => void
  /**
   * 配置换了之后对一次账：这两个部件还在不在、弹窗还开不开得起来。
   * ⚠ 换成新那一份而不是留着旧的：主场景重建部件材质之后，旧引用里克隆进弹窗
   * 的那份材质已经作废，接着画就是一块黑。
   */
  sync: (parts: readonly TwinPart[]) => void
}

/** 装上部件详情。 */
export function usePartDetail(): PartDetail {
  const part = shallowRef<TwinPart | null>(null)
  const currentId = ref('')

  return {
    part,
    currentId,
    open: (next) => {
      part.value = next
      // ⚠ 每次打开都清空：留着上一次的选择，会让点开另一台设备时右边显示的是
      //   上一台里某个子件的读数，而标题看着一切正常
      currentId.value = ''
    },
    select: (partId) => {
      currentId.value = partId
    },
    close: () => {
      part.value = null
      currentId.value = ''
    },
    sync: (parts) => {
      const open = part.value
      if (open === null) return
      const next = parts.find((item) => item.id === open.id) ?? null
      part.value = next
      if (next === null) {
        currentId.value = ''
        return
      }
      // ⚠ 当前看的那个从装配里没了（被删、或改挂到别的父件下面）就退回根件：
      //   留着一个不在场的 id，弹窗会去克隆一份已经作废的材质，画出来是一块黑
      const inAssembly = partAssembly(parts, next.id).some(
        (node) => node.part.id === currentId.value,
      )
      if (!inAssembly) currentId.value = ''
    },
  }
}
