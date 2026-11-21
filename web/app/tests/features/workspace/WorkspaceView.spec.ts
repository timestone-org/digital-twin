/** @fileoverview 工作页签必须隔离资源路由并在切回编辑页时保留草稿。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { useConfirm, useToast } from '@dt/ui'
import { computed, defineComponent, h, onUnmounted, ref, watch } from 'vue'
import { createMemoryHistory, createRouter, useRoute } from 'vue-router'

import App from '@/App.vue'
import * as authApi from '@/api/auth'
import { AppShell } from '@/components/layout'
import { useAuthStore } from '@/stores/auth'
import { resetEmbedContext } from '@/features/embed/context'
import { useWorkspaceGuard } from '@/features/workspace/useWorkspaceGuard'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import { useWorkspace } from '@/features/workspace/context'

const confirmLeave = vi.fn<() => Promise<boolean>>()
const unmounted = vi.fn<(key: string) => void>()

function delayedGuard() {
  let finish: (approved: boolean) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  const result = new Promise<boolean>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  return { result, finish, fail }
}

const Editor = defineComponent({
  setup() {
    const route = useRoute()
    const draft = ref('')
    const id = computed(() => String(route.params['dashboardId']))
    const workspace = useWorkspace()
    useUnsavedGuard(() => draft.value !== '')
    useWorkspaceGuard(() => draft.value === '' || confirmLeave())
    onUnmounted(() => unmounted(id.value))
    watch(id, () => {
      draft.value = ''
    })
    return () =>
      h(
        AppShell,
        { title: `编辑 ${id.value}` },
        {
          default: () => [
            h('input', {
              'aria-label': '画面名称',
              value: draft.value,
              onInput: (event: Event) => {
                if (event.target instanceof HTMLInputElement)
                  draft.value = event.target.value
              },
            }),
            h(
              'button',
              {
                'data-test': 'load-version',
                onClick: () => workspace?.recordDashboard('a', 1, route.path),
              },
              '加载版本',
            ),
            h(
              'button',
              {
                'data-test': 'save-version',
                onClick: () => workspace?.recordDashboard('a', 2, route.path),
              },
              '模拟子编辑器保存',
            ),
          ],
        },
      )
  },
})

const guardedLeave = vi.fn<() => boolean>()

/** 不进缓存的页：离开时同样跑守卫。 */
const Guarded = defineComponent({
  setup() {
    useWorkspaceGuard(() => guardedLeave())
    return () => h(AppShell, { title: '受保护页' }, { default: () => 'x' })
  },
})

async function setup(withNavigation = false) {
  localStorage.clear()
  resetEmbedContext()
  confirmLeave.mockReset().mockResolvedValue(true)
  unmounted.mockReset()
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.accessToken = 'test-token'
  auth.user = {
    id: 'user-1',
    username: 'admin',
    email: '',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '',
    updated_at: '',
    role: { id: 'role-1', name: 'admin', description: null, is_builtin: true },
    role_permissions: [],
    direct_permissions: [],
    permissions: [],
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        name: 'home',
        component: { template: '<div>工作台</div>' },
        meta: { title: '工作台' },
      },
      {
        path: '/dashboards/:dashboardId/edit',
        name: 'dashboard-editor',
        component: Editor,
        meta: { title: '大屏编辑器' },
      },
      {
        path: '/dashboards/:dashboardId/edit/twin/:nodeId',
        name: 'twin-editor',
        component: Editor,
        meta: { title: '孪生编辑器' },
      },
      {
        path: '/login',
        name: 'login',
        component: { template: '<p>登录</p>' },
        meta: { anonymous: true },
      },
      {
        path: '/list',
        name: 'list',
        component: { template: '<p>管理列表</p>' },
        meta: { title: '列表' },
      },
      {
        path: '/secure/:dashboardId',
        name: 'report-editor',
        component: Editor,
        meta: { permissions: ['report:view'] },
      },
      {
        path: '/guarded',
        name: 'guarded-page',
        component: Guarded,
        meta: { title: '受保护页' },
      },
      {
        path: '/forbidden',
        name: 'forbidden',
        component: { template: '<p>无权访问</p>' },
      },
    ],
  })
  await router.push('/dashboards/a/edit')
  await router.isReady()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router],
      stubs: {
        AppNavRail: !withNavigation,
        AppCompactNav: true,
        AppTopbar: true,
        DtToastHost: true,
        DtTipHost: true,
        AiMcpWriteConfirmHost: true,
      },
    },
  })
  await flushPromises()
  return { wrapper, router, auth }
}

afterEach(resetEmbedContext)
afterEach(() => vi.restoreAllMocks())

it('切到其他页面再回来保留尚未保存的编辑内容', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('尚未保存的画面 A')
  await router.push('/')
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('尚未保存的画面 A')
  wrapper.unmount()
})

it('同一种编辑器的不同画面各自保留草稿', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('草稿 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('input').setValue('草稿 B')
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('草稿 A')
  wrapper.unmount()
})

it('主动退出时任一页签取消会保留会话和所有草稿', async () => {
  const revoke = vi.spyOn(authApi, 'revokeSession').mockResolvedValue()
  const { wrapper, router, auth } = await setup(true)
  auth.refreshToken = 'fixture-refresh'
  await wrapper.get('input').setValue('后台草稿 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('input').setValue('当前草稿 B')
  confirmLeave.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  await wrapper.get('[aria-label="退出登录"]').trigger('click')
  await flushPromises()
  expect(auth.isAuthenticated).toBe(true)
  expect(revoke).not.toHaveBeenCalled()
  expect(confirmLeave).toHaveBeenCalledTimes(2)
  expect(router.currentRoute.value.path).toBe('/dashboards/b/edit')
  expect(wrapper.get('input').element.value).toBe('当前草稿 B')
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('后台草稿 A')
  wrapper.unmount()
})

it('确认期间会话失效时清理提示并直接离开工作区', async () => {
  const { wrapper, router, auth } = await setup(true)
  await wrapper.get('input').setValue('会话到期前的草稿')
  confirmLeave.mockImplementationOnce(() =>
    useConfirm().ask({ title: '放弃此草稿？', message: '仍要退出吗？' }),
  )
  await wrapper.get('[aria-label="退出登录"]').trigger('click')
  await flushPromises()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    '放弃此草稿？',
  )
  auth.clear()
  await router.replace('/login')
  await flushPromises()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(wrapper.text()).toContain('登录')
  wrapper.unmount()
})

it('所有页签同意后只退出一次，等候确认时不重复提交', async () => {
  const revoke = vi.spyOn(authApi, 'revokeSession').mockResolvedValue()
  const { wrapper, router, auth } = await setup(true)
  auth.refreshToken = 'fixture-refresh'
  await wrapper.get('input').setValue('已确认的草稿 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('input').setValue('已确认的草稿 B')
  confirmLeave.mockImplementationOnce(() =>
    useConfirm().ask({ message: '是否离开？' }),
  )
  const logout = wrapper.get('[aria-label="退出登录"]')
  await logout.trigger('click')
  await logout.trigger('click')
  expect(logout.attributes('disabled')).toBeDefined()
  expect(wrapper.get('input').element.closest('[inert]')).not.toBeNull()
  expect(
    document.querySelector('[role="dialog"]')?.closest('[inert]'),
  ).toBeNull()
  expect(revoke).not.toHaveBeenCalled()
  useConfirm().resolve(true)
  await flushPromises()
  expect(confirmLeave).toHaveBeenCalledTimes(2)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('fixture-refresh')
  expect(auth.isAuthenticated).toBe(false)
  expect(router.currentRoute.value.path).toBe('/login')
  wrapper.unmount()
})

it('确认期间新增了页签时保留新页签与会话', async () => {
  const { wrapper, router, auth } = await setup(true)
  await wrapper.get('input').setValue('先打开的草稿')
  confirmLeave.mockImplementationOnce(() =>
    useConfirm().ask({ message: '是否离开？' }),
  )
  await wrapper.get('[aria-label="退出登录"]').trigger('click')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('input').setValue('后来打开的草稿')
  useConfirm().resolve(true)
  await flushPromises()
  expect(auth.isAuthenticated).toBe(true)
  expect(wrapper.get('input').element.value).toBe('后来打开的草稿')
  wrapper.unmount()
})

it('后续守卫等待保存时，已通过的干净页签出现草稿会取消退出', async () => {
  const { wrapper, router, auth } = await setup(true)
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('input').setValue('等待保存的后台草稿')
  await router.push('/dashboards/a/edit')
  await flushPromises()
  const pending = delayedGuard()
  confirmLeave.mockImplementationOnce(() => pending.result)
  await wrapper.get('[aria-label="退出登录"]').trigger('click')
  await flushPromises()
  expect(confirmLeave).toHaveBeenCalledOnce()
  await wrapper.get('input').setValue('确认期间制成的新草稿')
  pending.finish(true)
  await flushPromises()
  expect(auth.isAuthenticated).toBe(true)
  expect(wrapper.get('input').element.value).toBe('确认期间制成的新草稿')
  wrapper.unmount()
})

it('旧会话迟到的关闭结果不会解除新会话的退出确认', async () => {
  const { wrapper, router, auth } = await setup(true)
  await wrapper.get('input').setValue('旧账号草稿')
  const oldUser = auth.user
  if (oldUser === null) throw new Error('缺少账号夹具')
  const oldCheck = delayedGuard()
  confirmLeave.mockImplementationOnce(() => oldCheck.result)
  await wrapper.get('[aria-label="退出登录"]').trigger('click')
  await flushPromises()
  auth.clear()
  auth.user = { ...oldUser, id: 'replacement-user' }
  auth.accessToken = 'another-token'
  await router.push('/dashboards/b/edit')
  await flushPromises()
  expect(wrapper.get('input').element.closest('[inert]')).toBeNull()
  await wrapper.get('input').setValue('新账号草稿')
  const newCheck = delayedGuard()
  confirmLeave.mockImplementationOnce(() => newCheck.result)
  await wrapper.get('[aria-label="退出登录"]').trigger('click')
  oldCheck.fail(new Error('旧会话的迟到错误'))
  await flushPromises()
  expect(wrapper.get('input').element.closest('[inert]')).not.toBeNull()
  expect(
    useToast().toasts.value.some((item) => item.message === '旧会话的迟到错误'),
  ).toBe(false)
  newCheck.finish(false)
  await flushPromises()
  expect(auth.isAuthenticated).toBe(true)
  expect(wrapper.get('input').element.value).toBe('新账号草稿')
  wrapper.unmount()
})

it('关闭守卫失败时可保留草稿并重新发起退出', async () => {
  const { wrapper, router, auth } = await setup(true)
  await wrapper.get('input').setValue('未保存')
  confirmLeave.mockRejectedValueOnce(new Error('暂时无法确认'))
  const logout = wrapper.get('[aria-label="退出登录"]')
  await logout.trigger('click')
  await flushPromises()
  expect(auth.isAuthenticated).toBe(true)
  expect(wrapper.get('input').element.value).toBe('未保存')
  await logout.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/login')
  wrapper.unmount()
})

it('查询参数更新复用页签，导航取消不会增加页签', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('草稿')
  await router.replace('/dashboards/a/edit?panel=layers')
  await flushPromises()
  expect(wrapper.findAll('nav[aria-label="已打开页面"] a')).toHaveLength(1)
  expect(wrapper.get('input').element.value).toBe('草稿')
  const stop = router.beforeEach((to) => to.path !== '/dashboards/b/edit')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  expect(wrapper.findAll('nav[aria-label="已打开页面"] a')).toHaveLength(1)
  stop()
  wrapper.unmount()
})

it('取消关闭后台草稿保留页签，确认关闭才销毁实例', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('草稿 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  confirmLeave.mockResolvedValueOnce(false)
  await wrapper.get('[aria-label="关闭 编辑 a"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('nav[aria-label="已打开页面"]').text()).toContain('编辑 a')
  expect(unmounted).not.toHaveBeenCalled()
  await wrapper.get('[aria-label="关闭 编辑 a"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('nav[aria-label="已打开页面"]').text()).not.toContain(
    '编辑 a',
  )
  expect(unmounted).toHaveBeenCalledWith('a')
  expect(router.currentRoute.value.path).toBe('/dashboards/b/edit')
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('')
  wrapper.unmount()
})

it('关闭当前页切到相邻页，最后一个业务页关闭后回工作台', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('保留 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('[aria-label="关闭 编辑 b"]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/dashboards/a/edit')
  expect(wrapper.get('input').element.value).toBe('保留 A')
  await wrapper.get('[aria-label="关闭 编辑 a"]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/')
  expect(wrapper.text()).toContain('工作台')
  wrapper.unmount()
})

it('关闭时相邻页被路由守卫拒绝则保留当前页与草稿', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('保留 A')
  router.beforeEach((to) => to.path !== '/')
  await wrapper.get('[aria-label="关闭 编辑 a"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('保留 A')
  expect(wrapper.findAll('nav[aria-label="已打开页面"] a')).toHaveLength(1)
  wrapper.unmount()
})

it('关闭当前的非缓存页只跑一次离开守卫', async () => {
  const { wrapper, router } = await setup()
  guardedLeave.mockReset().mockReturnValue(true)
  await router.push('/guarded')
  await flushPromises()
  await wrapper.get('[aria-label="关闭 受保护页"]').trigger('click')
  await flushPromises()
  expect(guardedLeave).toHaveBeenCalledTimes(1)
  expect(router.currentRoute.value.path).toBe('/dashboards/a/edit')
  wrapper.unmount()
})

it('非缓存页的守卫拒绝关闭时页签与路由都不动', async () => {
  const { wrapper, router } = await setup()
  guardedLeave.mockReset().mockReturnValue(false)
  await router.push('/guarded')
  await flushPromises()
  await wrapper.get('[aria-label="关闭 受保护页"]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/guarded')
  expect(wrapper.get('nav[aria-label="已打开页面"]').text()).toContain(
    '受保护页',
  )
  wrapper.unmount()
})

it('切换不会确认丢弃，刷新仍保护后台页签未保存的内容', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('草稿 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  expect(confirmLeave).not.toHaveBeenCalled()
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  wrapper.unmount()
})

it('账号退出会销毁缓存，再次登录不能恢复上一会话草稿', async () => {
  const { wrapper, router, auth } = await setup()
  await wrapper.get('input').setValue('账号 A 草稿')
  auth.clear()
  await router.push('/login')
  await flushPromises()
  expect(confirmLeave).not.toHaveBeenCalled()
  expect(wrapper.find('[aria-label="已打开页面"]').exists()).toBe(false)
  auth.accessToken = 'another-token'
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('')
  wrapper.unmount()
})

function chooseConfirmation(label: string): void {
  const dialog = document.querySelector('[role="dialog"]')
  const button = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (item) => item.textContent?.trim() === label,
  )
  if (button === undefined) throw new Error(`没有确认按钮 ${label}`)
  button.click()
}

it('关闭全部必须先确认，取消确认不关闭任何页签', async () => {
  const { wrapper, router } = await setup()
  await router.push('/dashboards/b/edit')
  await flushPromises()
  await wrapper.get('[aria-label="关闭全部页签"]').trigger('click')
  await flushPromises()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    '关闭所有已打开的页面',
  )
  expect(document.querySelector('.dt-modal__backdrop')).toBeNull()
  expect(unmounted).not.toHaveBeenCalled()
  chooseConfirmation('取消')
  await flushPromises()
  expect(wrapper.findAll('nav[aria-label="已打开页面"] a')).toHaveLength(2)
  await wrapper.get('[aria-label="关闭全部页签"]').trigger('click')
  await flushPromises()
  chooseConfirmation('关闭全部')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/')
  expect(unmounted).toHaveBeenCalledWith('a')
  expect(unmounted).toHaveBeenCalledWith('b')
  wrapper.unmount()
})

it('确认关闭全部之后仍保护脏草稿，取消丢弃时停止关闭', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('input').setValue('草稿 A')
  await router.push('/dashboards/b/edit')
  await flushPromises()
  confirmLeave.mockResolvedValueOnce(false)
  await wrapper.get('[aria-label="关闭全部页签"]').trigger('click')
  await flushPromises()
  chooseConfirmation('关闭全部')
  await flushPromises()
  expect(wrapper.findAll('nav[aria-label="已打开页面"] a')).toHaveLength(2)
  wrapper.unmount()
})

it('离开当前页或再次点触发按钮会取消气泡确认', async () => {
  const { wrapper, router } = await setup()
  const trigger = wrapper.get('[aria-label="关闭全部页签"]')
  await trigger.trigger('click')
  await flushPromises()
  expect(document.querySelector('.dt-confirm-bubble')).not.toBeNull()
  await trigger.trigger('click')
  await flushPromises()
  expect(document.querySelector('.dt-confirm-bubble')).toBeNull()
  await trigger.trigger('click')
  await router.push('/list')
  await flushPromises()
  expect(document.querySelector('.dt-confirm-bubble')).toBeNull()
  expect(router.currentRoute.value.path).toBe('/list')
  wrapper.unmount()
})

it('超过最大宽度时将纵向滚轮转换为横向滚动', async () => {
  const { wrapper } = await setup()
  const strip = wrapper.get('nav[aria-label="已打开页面"]')
  Object.defineProperties(strip.element, {
    scrollWidth: { value: 900 },
    clientWidth: { value: 500 },
  })
  await strip.trigger('wheel', { deltaY: 80, deltaX: 0 })
  expect(strip.element.scrollLeft).toBe(80)
  await strip.trigger('wheel', { deltaY: 0, deltaX: 40 })
  expect(strip.element.scrollLeft).toBe(80)
  wrapper.unmount()
})

it('同屏子编辑器保存后淘汰没有改动的旧编辑器缓存', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('[data-test="load-version"]').trigger('click')
  await router.push('/dashboards/a/edit/twin/node-1')
  await flushPromises()
  await wrapper.get('[data-test="save-version"]').trigger('click')
  await flushPromises()
  expect(unmounted).toHaveBeenCalledWith('a')
  expect(wrapper.findAll('nav[aria-label="已打开页面"] a')).toHaveLength(2)
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('')
  wrapper.unmount()
})

it('同屏保存不能淘汰其他页签的未保存草稿', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('[data-test="load-version"]').trigger('click')
  await wrapper.get('input').setValue('另一个画面仍在编辑')
  await router.push('/dashboards/a/edit/twin/node-1')
  await flushPromises()
  await wrapper.get('[data-test="save-version"]').trigger('click')
  await router.push('/dashboards/a/edit')
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('另一个画面仍在编辑')
  expect(unmounted).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('直接切换账号也会重新创建当前页面', async () => {
  const { wrapper, auth } = await setup()
  await wrapper.get('input').setValue('旧账号草稿')
  if (auth.user === null) throw new Error('测试账号未初始化')
  auth.user = { ...auth.user, id: 'user-2' }
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('')
  wrapper.unmount()
})

it('同一账号刷新资料不会清空正在编辑的页签', async () => {
  const { wrapper, auth } = await setup()
  await wrapper.get('input').setValue('刷新登录态仍保留的草稿')
  if (auth.user === null) throw new Error('测试账号未初始化')
  auth.user = { ...auth.user, full_name: '新的显示名称' }
  await flushPromises()
  expect(wrapper.get('input').element.value).toBe('刷新登录态仍保留的草稿')
  expect(unmounted).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('权限撤销会销毁对应缓存并显示无权访问', async () => {
  const { wrapper, router, auth } = await setup()
  if (auth.user === null) throw new Error('测试账号未初始化')
  auth.user = { ...auth.user, permissions: ['report:view'] }
  await router.push('/secure/secret')
  await flushPromises()
  await wrapper.get('input').setValue('受保护的内容')
  auth.user = { ...auth.user, permissions: [] }
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/forbidden')
  expect(wrapper.text()).toContain('无权访问')
  expect(wrapper.find('input').exists()).toBe(false)
  expect(unmounted).toHaveBeenCalledWith('secret')
  wrapper.unmount()
})
