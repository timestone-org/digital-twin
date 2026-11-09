/** @fileoverview 个人资料表单：进页对齐到服务端最新值后要重新回填，不能把缓存旧值写回去。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import ProfilePage from '@/pages/Profile/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function user(email: string) {
  return {
    username: 'alice',
    full_name: '爱丽丝',
    email,
    phone: '',
    is_active: true,
    role: { name: 'viewer' },
    role_permissions: [],
    direct_permissions: [],
    permissions: [],
  } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = user('old@x.com')
  auth.accessToken = 'token'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('个人资料表单回填', () => {
  it('对齐到新邮箱后表单跟着换，保存时提交的是新值', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(user('new@x.com'))
    const update = vi.spyOn(authApi, 'updateMe').mockResolvedValue({} as never)
    const wrapper = mount(ProfilePage)
    await flushPromises()
    expect(wrapper.findAll('input')[1]?.element.value).toBe('new@x.com')
    await wrapper.findAll('form')[0]?.trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@x.com' }),
    )
  })

  it('用户已经动过表单时不覆盖他的输入', async () => {
    let settle: (value: never) => void = () => undefined
    vi.spyOn(authApi, 'fetchMe').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const wrapper = mount(ProfilePage)
    await wrapper.findAll('input')[2]?.setValue('13800000000')
    settle(user('new@x.com'))
    await flushPromises()
    expect(wrapper.findAll('input')[2]?.element.value).toBe('13800000000')
  })
})

describe('改密码的本地校验', () => {
  async function submitPasswords(
    current: string,
    next: string,
    confirm: string,
  ) {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(user('old@x.com'))
    const change = vi.spyOn(authApi, 'changeMyPassword').mockResolvedValue()
    const wrapper = mount(ProfilePage)
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[3]?.setValue(current)
    await inputs[4]?.setValue(next)
    await inputs[5]?.setValue(confirm)
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()
    return { wrapper, change }
  }

  it('两次新密码不一致就不发', async () => {
    const { wrapper, change } = await submitPasswords(
      'Old1234567',
      'New1234567',
      'New7654321',
    )
    expect(change).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('两次输入的新密码不一致')
  })

  it('新旧相同就不发', async () => {
    const { wrapper, change } = await submitPasswords(
      'Same123456',
      'Same123456',
      'Same123456',
    )
    expect(change).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('新密码不能与当前密码相同')
  })

  it('成功提示在下一次改动时收掉', async () => {
    const { wrapper } = await submitPasswords(
      'Old1234567',
      'New1234567',
      'New1234567',
    )
    expect(wrapper.text()).toContain('密码已修改')
    await wrapper.findAll('input')[3]?.setValue('x')
    expect(wrapper.text()).not.toContain('密码已修改')
  })
})
