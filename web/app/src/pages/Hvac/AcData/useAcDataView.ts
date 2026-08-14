/**
 * @fileoverview 「表格 / 折线」的呈现方式，按页记住。
 *
 * ⚠ 不复用 `@/composables/useViewMode`：那个的取值域是 DtDataView 的
 * `table | card`，把「折线」塞进 `card` 会让存下来的偏好名不副实，
 * 而它的 `read()` 也会把 `chart` 判成非法值、每次进页面弹回表格。
 */
import { ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'dt.view-mode.hvac-ac-data'

export const AC_DATA_VIEWS = ['table', 'chart'] as const
export type AcDataView = (typeof AC_DATA_VIEWS)[number]

function isView(value: string | null): value is AcDataView {
  return value === 'table' || value === 'chart'
}

function read(): AcDataView {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把页面带崩
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isView(raw) ? raw : 'table'
  } catch {
    return 'table'
  }
}

export function useAcDataView(): Ref<AcDataView> {
  const view = ref<AcDataView>(read())
  watch(view, (next) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* 存不下就只在本次会话内有效 */
    }
  })
  return view
}
