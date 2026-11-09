/** @fileoverview 一次性口令弹窗：误点遮罩或误按一次 Esc 不许把唯一的明文关掉。 */
import { afterEach, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import IssuedPasswordDialog from '@/pages/Tools/OpcuaServerDetail/components/IssuedPasswordDialog.vue'

enableAutoUnmount(afterEach)

it('点遮罩、按一次 Esc 都不关，只有「我已抄走」才关', async () => {
  const wrapper = mount(IssuedPasswordDialog, {
    props: { issued: { username: 'scada', password: 'p@ss-once' } },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  await wrapper.find('.dt-modal__backdrop').trigger('click')
  await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.text()).toContain('p@ss-once')
  await wrapper
    .findAll('button')
    .find((one) => one.text() === '我已抄走')
    ?.trigger('click')
  expect(wrapper.emitted('close')).toHaveLength(1)
})
