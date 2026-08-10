/**
 * @fileoverview 列表页「表格 / 卡片」的展示方式，按页记住。
 * 不记住的话每次进页面都弹回默认视图，切换器就成了摆设。
 */

import { ref, watch, type Ref } from 'vue'
import type { DtDataViewMode } from '@dt/contracts'

const PREFIX = 'dt.view-mode.'

function read(key: string, fallback: DtDataViewMode): DtDataViewMode {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把页面带崩
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`)
    return raw === 'table' || raw === 'card' ? raw : fallback
  } catch {
    return fallback
  }
}

/**
 * @param key 页面标识，作为存储键的后缀
 * @param fallback 没有存过时用哪种
 */
export function useViewMode(
  key: string,
  fallback: DtDataViewMode = 'table',
): Ref<DtDataViewMode> {
  const mode = ref<DtDataViewMode>(read(key, fallback))
  watch(mode, (next) => {
    // ⚠ 同上：写入也会抛
    try {
      localStorage.setItem(`${PREFIX}${key}`, next)
    } catch {
      /* 存不下就只在本次会话内有效 */
    }
  })
  return mode
}
