/**
 * @fileoverview 侧栏形态（展开 / 折叠），跨会话记住。
 * 不记住的话每次进页面都弹回默认形态，折叠按钮就成了摆设。
 */

import { ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'dt.sidebar.collapsed'

function read(fallback: boolean): boolean {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把页面带崩
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

export interface SidebarHandle {
  isCollapsed: Ref<boolean>
  toggle: () => void
}

/**
 * 侧栏展开态与折叠态之间的切换，写回 localStorage。
 * @param fallback 没有存过时的初始形态
 */
export function useSidebar(fallback = false): SidebarHandle {
  const isCollapsed = ref(read(fallback))

  watch(isCollapsed, (next) => {
    // ⚠ 同上：写入也会抛
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* 存不下就只在本次会话内有效 */
    }
  })

  function toggle(): void {
    isCollapsed.value = !isCollapsed.value
  }

  return { isCollapsed, toggle }
}
