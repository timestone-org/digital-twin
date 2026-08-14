/**
 * @fileoverview 守宿主注入接缝的契约：没注入时诚实给空串（不臆造后端前缀）、
 * 空引用不惊动宿主、复位后回到默认桩。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  configureTwinModelHost,
  resetTwinModelHost,
  resolveTwinModelUrl,
} from '../src/host'

afterEach(() => {
  resetTwinModelHost()
})

describe('模型地址解析接缝', () => {
  it('没注入宿主时解析出空串', () => {
    expect(
      resolveTwinModelUrl('asset:0192f0aa-0000-7000-8000-000000000001'),
    ).toBe('')
  })

  it('空引用与纯空白引用都不调用宿主', () => {
    const resolveModelUrl = vi.fn(() => '/models/x.glb')
    configureTwinModelHost({ resolveModelUrl })

    expect(resolveTwinModelUrl('')).toBe('')
    expect(resolveTwinModelUrl('   ')).toBe('')
    expect(resolveModelUrl).not.toHaveBeenCalled()
  })

  it('注入后按宿主的解析结果返回，并去掉两端空白', () => {
    configureTwinModelHost({ resolveModelUrl: (ref) => ` /assets/${ref}.glb ` })

    expect(resolveTwinModelUrl(' asset:abc ')).toBe('/assets/asset:abc.glb')
  })

  it('宿主解析不出时结果仍是空串', () => {
    configureTwinModelHost({ resolveModelUrl: () => '' })

    expect(resolveTwinModelUrl('asset:abc')).toBe('')
  })

  it('复位后回到默认桩', () => {
    configureTwinModelHost({ resolveModelUrl: () => '/models/x.glb' })
    resetTwinModelHost()

    expect(resolveTwinModelUrl('asset:abc')).toBe('')
  })
})
