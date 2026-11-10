/** @fileoverview Modbus 连接参数提交前校验，与采集驱动同口径。 */
import { expect, it } from 'vitest'
import { validateModbusOptions } from '@/pages/Collect/scripts/modbusOptions'

it('认得驱动支持的全部参数，含 max_requests_per_cycle', () => {
  expect(
    validateModbusOptions({
      device_id: '1',
      byte_order: 'big',
      word_order: 'little',
      max_registers_per_request: '125',
      max_bits_per_request: '2000',
      max_requests_per_cycle: '8',
    }),
  ).toBeNull()
})

it.each([
  [{ byte_oder: 'big' }, '不支持的连接参数 byte_oder'],
  [{ word_order: 'LE' }, 'word_order 只能是 big 或 little'],
  [{ device_id: '248' }, 'device_id 须是 0–247 的整数'],
  [{ max_registers_per_request: '126' }, '1–125'],
  [{ max_requests_per_cycle: '1.5' }, '1–8'],
])('%o 被拦下', (options, message) => {
  expect(validateModbusOptions(options)).toContain(message)
})
