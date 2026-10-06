/** @fileoverview 真实导航完成、取消及中止后的页面标题契约。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
} from 'vue-router'

import { resetEmbedContext } from '@/features/embed/context'
import { installAuthGuard } from '@/router/guards'

function createTitleRouter() {
  const component = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/source',
        component,
        meta: { anonymous: true, title: '孪生编辑器' },
      },
      {
        path: '/target',
        component,
        meta: { anonymous: true, title: '大屏编辑器' },
      },
      { path: '/plain', component, meta: { anonymous: true } },
    ],
  })
  installAuthGuard(router)
  return router
}

function deferred() {
  let settle: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve() {
      if (settle === null) throw new Error('deferred 尚未初始化')
      settle()
    },
  }
}

const previousTitle = document.title

beforeEach(() => {
  setActivePinia(createPinia())
  resetEmbedContext()
  localStorage.clear()
})

afterEach(() => {
  document.title = previousTitle
  resetEmbedContext()
  localStorage.clear()
})

describe('导航后的页面标题', () => {
  it('离页守卫中止时保留当前页面标题', async () => {
    const router = createTitleRouter()
    await router.push('/source')
    router.beforeEach((to) => to.path !== '/target')

    const failure = await router.push('/target')

    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(
      true,
    )
    expect(router.currentRoute.value.path).toBe('/source')
    expect(document.title).toBe('孪生编辑器 · 数字孪生平台')
  })

  it('被后续导航取消的慢导航不能覆盖最终页面标题', async () => {
    const router = createTitleRouter()
    await router.push('/source')
    const entered = deferred()
    const release = deferred()
    router.beforeEach(async (to) => {
      if (to.path !== '/target') return true
      entered.resolve()
      await release.promise
      return true
    })

    const pending = router.push('/target')
    await entered.promise
    await router.push('/plain')
    release.resolve()
    const failure = await pending

    expect(isNavigationFailure(failure, NavigationFailureType.cancelled)).toBe(
      true,
    )
    expect(router.currentRoute.value.path).toBe('/plain')
    expect(document.title).toBe('数字孪生平台')
  })

  it('重复导航保留当前页面标题', async () => {
    const router = createTitleRouter()
    await router.push('/source')

    const failure = await router.push('/source')

    expect(isNavigationFailure(failure, NavigationFailureType.duplicated)).toBe(
      true,
    )
    expect(document.title).toBe('孪生编辑器 · 数字孪生平台')
  })

  it('成功导航应用目标标题，无标题路由回落平台名', async () => {
    const router = createTitleRouter()
    await router.push('/source')
    await router.push('/target')
    expect(document.title).toBe('大屏编辑器 · 数字孪生平台')

    await router.push('/plain')
    expect(document.title).toBe('数字孪生平台')
  })
})
