/**
 * @fileoverview 关标签页 / 刷新前的兜底拦截：文档脏着就让浏览器问一句。
 *
 * 站内跳转由 `onBeforeRouteLeave` 拦，这条只管**离开站点**那一半，两者缺一
 * 不可：孪生场景的改动只在内存里，没有本地草稿可恢复（大屏编辑器那边有，
 * 所以它不装这道闸），关掉标签页就是真没了，而且没有任何提示。
 */
import { onBeforeUnmount, watch } from 'vue'

/**
 * 装上关页拦截。
 * @param isDirty 取「此刻有没有未保存改动」
 */
export function useUnsavedGuard(isDirty: () => boolean): void {
  function block(event: BeforeUnloadEvent): void {
    // ⚠ 文案一律由浏览器出，自定义字符串早就被忽略了。现代浏览器只认
    // preventDefault，returnValue 是留给老 WebKit 的——少了它那些浏览器直接放行
    event.preventDefault()
    event.returnValue = ''
  }

  // ⚠ 只在脏着的时候挂：beforeunload 常驻会让页面进不了 bfcache，于是浏览器
  // 的前进后退都要整页重建，而这一页重建一次要重新拉场景与贴图
  watch(
    isDirty,
    (isBlocked) => {
      if (isBlocked) window.addEventListener('beforeunload', block)
      else window.removeEventListener('beforeunload', block)
    },
    { immediate: true },
  )

  // ⚠ 卸载必须摘：留着的话，离开编辑器之后整个站点都在被这一页拦
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', block)
  })
}
