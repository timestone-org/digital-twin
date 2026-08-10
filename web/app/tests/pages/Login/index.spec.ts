/**
 * @fileoverview 登录页的行为契约：提交、失败文案按错误码归一、
 * 回跳只允许站内相对路径、大写锁定提示。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ERROR_CODES } from '@dt/contracts'

import { BizError, TransportError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import LoginPage from '@/pages/Login/index.vue'

const replace = vi.fn()
const query: Record<string, string> = {}

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace }),
  useRoute: () => ({ query }),
}))

function mountPage() {
  return mount(LoginPage, {
    global: { stubs: { LoginBrandPanel: true } },
  })
}

async function fillAndSubmit(
  wrapper: ReturnType<typeof mountPage>,
  username = 'admin',
  password = 'Admin123456',
): Promise<void> {
  const inputs = wrapper.findAll('input')
  await inputs[0]?.setValue(username)
  await inputs[1]?.setValue(password)
  await wrapper.find('form').trigger('submit')
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  replace.mockReset()
  for (const key of Object.keys(query)) delete query[key]
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('登录页', () => {
  it('渲染用户名与密码两个输入框', () => {
    const wrapper = mountPage()
    expect(wrapper.findAll('input')).toHaveLength(2)
  })

  it('未填写时提交按钮禁用', () => {
    const wrapper = mountPage()
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBe(
      '',
    )
  })

  it('登录成功后跳到首页', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({} as never)
    const wrapper = mountPage()
    await fillAndSubmit(wrapper)
    expect(auth.login).toHaveBeenCalledWith('admin', 'Admin123456')
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('带 returnUrl 时回跳原地址', async () => {
    query.returnUrl = '/profile'
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({} as never)
    await fillAndSubmit(mountPage())
    expect(replace).toHaveBeenCalledWith('/profile')
  })

  it('外部地址的 returnUrl 被拒，回落首页', async () => {
    query.returnUrl = '//evil.example.com'
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({} as never)
    await fillAndSubmit(mountPage())
    expect(replace).toHaveBeenCalledWith('/')
  })

  it.each([
    [ERROR_CODES.invalidCredentials, '用户名或密码错误'],
    [ERROR_CODES.accountDisabled, '账号已停用，请联系管理员'],
    [ERROR_CODES.tooManyLoginAttempts, '登录失败次数过多，请稍后再试'],
  ])('错误码 %i 归一为对应文案', async (code, expected) => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockRejectedValue(
      new BizError(code, '后端原文', 401, 'trace'),
    )
    const wrapper = mountPage()
    await fillAndSubmit(wrapper)
    expect(wrapper.find('[role="alert"]').text()).toContain(expected)
  })

  it('网络不可达时显示传输层文案', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockRejectedValue(
      new TransportError(0, '无法连接服务器，请检查网络'),
    )
    const wrapper = mountPage()
    await fillAndSubmit(wrapper)
    expect(wrapper.find('[role="alert"]').text()).toContain('无法连接服务器')
  })

  it('失败提示带 role=alert，读屏能感知', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockRejectedValue(
      new BizError(ERROR_CODES.invalidCredentials, '', 401, 't'),
    )
    const wrapper = mountPage()
    await fillAndSubmit(wrapper)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('大写锁定开启时给出提示', async () => {
    const wrapper = mountPage()
    const input = wrapper.findAll('input')[0]
    await input?.trigger('keyup', { getModifierState: () => true })
    expect(wrapper.text()).toContain('大写锁定已开启')
  })

  it('密码默认不可见，点显隐后变明文', async () => {
    const wrapper = mountPage()
    const reveal = wrapper.find('button[aria-label="显示密码"]')
    expect(wrapper.findAll('input')[1]?.attributes('type')).toBe('password')
    await reveal.trigger('click')
    expect(wrapper.findAll('input')[1]?.attributes('type')).toBe('text')
  })
})
