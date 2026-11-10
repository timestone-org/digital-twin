/**
 * @fileoverview 一块可收起面板的开合，跨会话记住用户最后一次的选择。
 */
import { ref, watch, type Ref } from 'vue'

/**
 * 读存过的开合；没存过、存坏了或存储不可用时给缺省。
 * @param key 存储键
 * @param fallback 缺省开合
 */
function readOpen(key: string, fallback: boolean): boolean {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把页面带崩
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

/**
 * 记住开合的那个 ref；改它即写回存储。
 * @param key 存储键
 * @param fallback 没存过时的开合
 */
export function useRememberedOpen(
  key: string,
  fallback: boolean,
): Ref<boolean> {
  const open = ref(readOpen(key, fallback))
  watch(open, (value) => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      /* 存不下就只在本次会话内有效 */
    }
  })
  return open
}
