/**
 * @fileoverview 展开态侧栏里各分组的开合，跨页面、跨会话记住。
 * 每一页都各套一层 AppShell，切页即整条侧栏重挂——开合若只放在组件里，
 * 点进别的菜单时刚摊开的那组就合回去了。
 */

import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

const STORAGE_KEY = 'dt.nav.openGroups'

function readOpenKeys(): Set<string> {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把页面带崩；
  // 存储被手改坏的 JSON 同样走这条兜底
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    const list: unknown[] = Array.isArray(parsed) ? parsed : []
    return new Set(list.filter((key): key is string => typeof key === 'string'))
  } catch {
    return new Set()
  }
}

/** 读—改—写：每个分组只动自己那个键，各组实例之间不会互相盖掉对方的改动。 */
function persist(key: string, open: boolean): void {
  const keys = readOpenKeys()
  if (open) keys.add(key)
  else keys.delete(key)
  // ⚠ 同上：写入也会抛
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    /* 存不下就只在本次会话内有效 */
  }
}

/**
 * 一个分组的开合态，写回 localStorage。记过「开」的组压过初值；
 * 记过「合」的组退回初值——路由落在组内时仍会摊开，进这一页才看得到自己在哪。
 * @param key 分组的 key
 * @param fallback 没记过时的初值
 */
export function useNavGroupOpen(
  key: MaybeRefOrGetter<string>,
  fallback: boolean,
): Ref<boolean> {
  const isOpen = ref(readOpenKeys().has(toValue(key)) || fallback)
  // immediate：初值来自 fallback 时也要落盘，否则离开组后一重挂就合上了
  watch(isOpen, (next) => persist(toValue(key), next), { immediate: true })
  return isOpen
}
