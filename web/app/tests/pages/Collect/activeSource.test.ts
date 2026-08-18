/**
 * @fileoverview 契约：选中哪个数据源写在地址栏上，两个方向都同步。
 *
 * ⚠ 用真路由而不是假件：这条口径的全部价值就在「地址栏真的变了」与「地址栏
 * 变了页面真的跟着走」，假件把这两件事都替换掉之后，测的就只剩自己了。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'

import {
  SOURCE_QUERY_KEY,
  useActiveSource,
  type ActiveSource,
} from '@/pages/Collect/Opcua/scripts/useActiveSource'

const PAGE = '/collect/opcua'

function must(api: ActiveSource | null): ActiveSource {
  if (api === null) throw new Error('composable 还没装起来')
  return api
}

async function mountActive(initial: string = PAGE) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: PAGE, component: { template: '<div />' } }],
  })
  await router.push(initial)
  await router.isReady()

  let created: ActiveSource | null = null
  const host = defineComponent({
    setup() {
      created = useActiveSource()
      return () => h('div')
    },
  })
  mount(host, { global: { plugins: [router] } })
  return { router, api: () => must(created) }
}

function queryId(router: Router): unknown {
  return router.currentRoute.value.query[SOURCE_QUERY_KEY]
}

describe('从地址栏读', () => {
  it('带着 source 进来就认它，不再落到第一个', async () => {
    const { api } = await mountActive(`${PAGE}?${SOURCE_QUERY_KEY}=src-9`)

    expect(api().activeId.value).toBe('src-9')
  })

  it('没带就是没选中', async () => {
    const { api } = await mountActive()

    expect(api().activeId.value).toBeNull()
  })

  it('同名参数出现两次时按没给处理，不猜是哪一个', async () => {
    const { api } = await mountActive(
      `${PAGE}?${SOURCE_QUERY_KEY}=a&${SOURCE_QUERY_KEY}=b`,
    )

    expect(api().activeId.value).toBeNull()
  })

  it('地址栏变了页面跟着走：粘一条链接进来 / 前进后退都靠它', async () => {
    const { router, api } = await mountActive()

    await router.push(`${PAGE}?${SOURCE_QUERY_KEY}=src-2`)
    await flushPromises()

    expect(api().activeId.value).toBe('src-2')
  })
})

describe('往地址栏写', () => {
  it('选一个源就写进地址栏', async () => {
    const { router, api } = await mountActive()

    api().select('src-1')
    await flushPromises()

    expect(queryId(router)).toBe('src-1')
    expect(api().activeId.value).toBe('src-1')
  })

  it('用 replace 不用 push：否则点过五个源要按五次返回才走得掉', async () => {
    const { router, api } = await mountActive()
    const replace = vi.spyOn(router, 'replace')
    const push = vi.spyOn(router, 'push')

    api().select('src-1')
    await flushPromises()

    expect(replace).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('选中没变就不写：轮询每 10 秒对一次账，不该刷出一串历史', async () => {
    const { router, api } = await mountActive(
      `${PAGE}?${SOURCE_QUERY_KEY}=src-1`,
    )
    const replace = vi.spyOn(router, 'replace')

    api().reconcile(['src-1', 'src-2'])
    api().reconcile(['src-1', 'src-2'])
    await flushPromises()

    expect(replace).not.toHaveBeenCalled()
  })

  it('其余参数原样留着，不许被这一个键顺手抹掉', async () => {
    const { router, api } = await mountActive(`${PAGE}?tab=points`)

    api().select('src-1')
    await flushPromises()

    expect(router.currentRoute.value.query.tab).toBe('points')
  })
})

describe('列表到货后的对账', () => {
  it('地址栏指的源不在列表里就落到第一个（链接过期或源被删）', async () => {
    const { router, api } = await mountActive(
      `${PAGE}?${SOURCE_QUERY_KEY}=gone`,
    )

    api().reconcile(['src-1', 'src-2'])
    await flushPromises()

    expect(api().activeId.value).toBe('src-1')
    expect(queryId(router)).toBe('src-1')
  })

  it('列表空了就把这个键清掉，不留一条打不开的链接', async () => {
    const { router, api } = await mountActive(
      `${PAGE}?${SOURCE_QUERY_KEY}=src-1`,
    )

    api().reconcile([])
    await flushPromises()

    expect(api().activeId.value).toBeNull()
    expect(queryId(router)).toBeUndefined()
  })
})
