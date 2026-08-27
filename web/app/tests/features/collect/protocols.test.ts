/**
 * @fileoverview 契约：协议标签只翻译认得出的那几种，认不出的原样回。
 *
 * ⚠ 后端接进第二种驱动而这里还没跟上时，「显示成空白」会被读成
 * 「这个数据源没配协议」——原样回才看得出是前端没跟上。
 */
import { describe, expect, it } from 'vitest'

import { COLLECT_PROTOCOLS } from '@dt/contracts'
import { protocolLabel } from '@/features/collect/protocols'

describe('协议标签', () => {
  it('已实现的每一种协议都有一句人话，且不是原样回', () => {
    for (const protocol of COLLECT_PROTOCOLS) {
      expect(protocolLabel(protocol)).not.toBe(protocol)
    }
    expect(protocolLabel('opcua')).toBe('OPC UA')
  })

  it('认不出的协议原样回，不吞成空白', () => {
    expect(protocolLabel('modbus')).toBe('modbus')
    expect(protocolLabel('')).toBe('')
  })
})
