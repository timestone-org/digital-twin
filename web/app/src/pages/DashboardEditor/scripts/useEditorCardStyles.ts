/**
 * @fileoverview 把用户存下来的卡片样式装进编辑器这棵树，外观面板的下拉据此多出
 * 一段「我的样式」。
 *
 * ⚠ 取不到就当没有，**不弹错也不拦住页面**：样式库是个可选的增强，
 * 打不开它不该让整张大屏编辑不了。
 * ⚠ 只在进页面时拉一次：样式是在另一张页面上编的，编辑器开着的时候它不会变；
 * 真变了刷新一下就有——为此挂一路订阅换不来什么。
 */
import type { CardStyle } from '@dt/contracts'
import { onMounted, shallowRef } from 'vue'

import { listCardStyles } from '@/api/cardStyles'
import { provideCardStyles } from '@/features/dashboard/cardStyleLibrary'

/** 一次拉多少条。⚠ 与样式库页面同值，超了那边也得改。 */
const LIST_SIZE = 200

/** 装上样式库。须在 setup 内调用。 */
export function useEditorCardStyles(): void {
  const styles = shallowRef<CardStyle[]>([])
  provideCardStyles(() => styles.value)
  onMounted(() => {
    void listCardStyles({ size: LIST_SIZE })
      .then((page) => {
        styles.value = page.items
      })
      .catch(() => {
        // 只读账号或样式库没起来：下拉里就只有内置那两档，这是诚实的降级
        styles.value = []
      })
  })
}
