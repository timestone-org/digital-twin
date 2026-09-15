/** @fileoverview 输入变化与关闭会使旧校验失效，禁止应用过期结果。 */
import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { usePointBatchCheck } from '@/pages/TwinEditor/scripts/usePointBatchCheck'
import {
  validateReplacementPoints,
  type PointValidation,
} from '@/pages/TwinEditor/scripts/pointBatchValidation'
vi.mock('@/pages/TwinEditor/scripts/pointBatchValidation', () => ({
  validateReplacementPoints: vi.fn(),
}))
const SOURCE = '0192f0aa-0000-7000-8000-000000000001'
it('慢校验返回不能批准已修改的替换计划', async () => {
  const plan = ref([
    {
      bindingId: 'b',
      fieldKey: 'x[0].value',
      label: '温度',
      before: `${SOURCE}:A`,
      after: `${SOURCE}:B`,
    },
  ])
  const open = ref(true)
  let finish: (value: PointValidation[]) => void = () => undefined
  vi.mocked(validateReplacementPoints).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const holder: { check: ReturnType<typeof usePointBatchCheck> | null } = {
    check: null,
  }
  const wrapper = mount(
    defineComponent({
      setup() {
        holder.check = usePointBatchCheck(
          () => plan.value,
          () => open.value,
        )
        return () => h('div')
      },
    }),
  )
  const check = holder.check
  if (check === null) throw new Error('missing check')
  const pending = check.check()
  plan.value = [
    {
      ...plan.value[0],
      bindingId: 'b',
      fieldKey: 'x[0].value',
      label: '温度',
      before: `${SOURCE}:A`,
      after: `${SOURCE}:C`,
    },
  ]
  await flushPromises()
  finish([{ key: `${SOURCE}:B`, valid: true, message: '旧结果' }])
  await pending
  expect(check.valid.value).toBe(false)
  vi.mocked(validateReplacementPoints).mockResolvedValueOnce([
    { key: `${SOURCE}:C`, valid: true, message: '已确认' },
  ])
  await check.check()
  expect(check.valid.value).toBe(true)
  open.value = false
  await flushPromises()
  expect(check.valid.value).toBe(false)
  open.value = true
  await flushPromises()
  vi.mocked(validateReplacementPoints).mockRejectedValueOnce(
    new Error('无法连接'),
  )
  await check.check()
  expect(check.error.value).toContain('无法连接')
  wrapper.unmount()
  vi.restoreAllMocks()
})
