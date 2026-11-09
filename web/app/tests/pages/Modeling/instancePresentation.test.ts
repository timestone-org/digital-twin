/**
 * @fileoverview 建模错误文案的契约：逐字段原因只拼一次。
 * ⚠ 通用的 describeError 对参数校验失败也会拼 details，这里若再拼一遍，
 * 同一串原因就在弹窗里出现两次。
 */
import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import { describeModelingError } from '@/pages/Modeling/scripts/instancePresentation'

describe('describeModelingError', () => {
  it('参数校验失败时逐字段原因只出现一次', () => {
    const caught = new BizError(
      ERROR_CODES.validationFailed,
      '参数校验失败',
      422,
      't',
      [{ field: 'configuration.nodes.n1', code: 'x', message: '缺少输入' }],
    )
    expect(describeModelingError(caught)).toBe('参数校验失败：n1：缺少输入')
  })

  it('建模专属码照样带出逐节点原因', () => {
    const caught = new BizError(41403, '配置不合法', 422, 't', [
      { field: 'configuration.nodes.n2', code: 'x', message: '列不存在' },
    ])
    expect(describeModelingError(caught)).toBe('配置不合法：n2：列不存在')
  })

  it('没有 details 时退回通用文案', () => {
    expect(describeModelingError(new Error('x'))).toBe('请求失败，请重试')
  })
})
