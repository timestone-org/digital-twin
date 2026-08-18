/**
 * @fileoverview 表单「有没有被改过」：打开那一刻拍一张快照，之后拿它比。
 *
 * ⚠ 给弹窗表单判误关用（`DtModal` 的 `dirty`）。一屏十几个字段，误点一下遮罩
 * 就全没了，而「有没有填过」是决定要不要拦的唯一依据。
 * ⚠ 快照按值比对而不是逐字段挂 watch：字段是一组独立的 ref，挂 watch 要写
 * 十几行且加一个字段就会漏一个，而漏掉的那个字段填了也不算数。
 */
import {
  computed,
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

export interface FormDirty {
  isDirty: ComputedRef<boolean>
  /** 把此刻当成「干净」的基准。不给 `isOpen` 时由调用方在回填完调它。 */
  markClean: () => void
}

/**
 * 装上脏值判定。
 * @param values 一串字段 ref，或一个取全部取值的函数（取值散在别处时用后者）
 * @param isOpen 取弹窗开着没有；给了就在每次打开时自动拍快照。⚠ 只认开合跳变：
 *   表单在**开着的时候**被换成另一条记录，得由调用方自己调 `markClean()`
 */
export function useFormDirty(
  values: (() => unknown) | readonly Ref<unknown>[],
  isOpen?: () => boolean,
): FormDirty {
  const cleanAs = ref('')

  function snapshot(): string {
    return JSON.stringify(
      typeof values === 'function' ? values() : values.map((one) => one.value),
    )
  }

  function markClean(): void {
    cleanAs.value = snapshot()
  }

  if (isOpen !== undefined) {
    // ⚠ 必须 flush: 'post'：表单自己的回填 watcher 是默认的 'pre'，先它一步拍
    // 快照拍到的是上一次的取值，于是弹窗一打开就被判成「脏的」，谁都关不掉
    watch(
      isOpen,
      (open) => {
        if (open) markClean()
      },
      { flush: 'post' },
    )
    // 挂载时就开着的那种（多数弹窗测试如此）没有这次跳变，补一刀
    onMounted(() => {
      if (isOpen()) markClean()
    })
  }

  return {
    isDirty: computed(() => snapshot() !== cleanAs.value),
    markClean,
  }
}
