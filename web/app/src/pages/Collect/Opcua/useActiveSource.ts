/**
 * @fileoverview 「此刻在看哪个数据源」这件事同步进地址栏。
 *
 * ⚠ 不放进 URL 就拿不到三件事：刷新之后回到原来那个源、把链接发给同事打开的
 * 是同一个源、浏览器前进后退按预期走。这一页是配置动作最密集的地方，配到一半
 * 刷一下就得从头再找一遍。
 * ⚠ 用 `replace` 不用 `push`：选中是页面内的视图状态，不是一次导航。用 push
 * 的话，点过五个源之后要按五次返回才离得开这一页。
 * ⚠ 渲染读的是 ref、地址栏是它的镜像，两个方向都同步：真源换成地址栏的话，
 * 一次被守卫拦下的导航会让点击「看起来没反应」。
 */
import { ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/** 选中的数据源在地址栏里的参数名。 */
export const SOURCE_QUERY_KEY = 'source'

export interface ActiveSource {
  /** 此刻选中的源；没选中为 null。 */
  activeId: Ref<string | null>
  select: (id: string) => void
  /** 列表到货后对一次账：地址栏指的源不在列表里就落到第一个。 */
  reconcile: (ids: readonly string[]) => void
}

/**
 * 把地址栏上的取值读成一个源 id。
 *
 * ⚠ 同名参数出现两次时 vue-router 给的是数组：这种地址是手拼出来的，按「没给」
 * 处理，不去猜用户想要哪一个。
 * @param raw 地址栏上的原始取值
 */
function readId(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null
}

/** 装上「选中态 ↔ 地址栏」的双向同步。 */
export function useActiveSource(): ActiveSource {
  const route = useRoute()
  const router = useRouter()
  const activeId = ref<string | null>(readId(route.query[SOURCE_QUERY_KEY]))

  function write(id: string | null): void {
    if (readId(route.query[SOURCE_QUERY_KEY]) === id) return
    const query = { ...route.query }
    if (id === null) delete query[SOURCE_QUERY_KEY]
    else query[SOURCE_QUERY_KEY] = id
    void router.replace({ query })
  }

  function select(id: string | null): void {
    activeId.value = id
    write(id)
  }

  function reconcile(ids: readonly string[]): void {
    if (activeId.value !== null && ids.includes(activeId.value)) return
    select(ids[0] ?? null)
  }

  // 地址栏变了就跟过去：粘贴一条链接进来、前进后退，都走这一条
  watch(
    () => route.query[SOURCE_QUERY_KEY],
    (raw) => {
      activeId.value = readId(raw)
    },
  )

  return { activeId, select, reconcile }
}
