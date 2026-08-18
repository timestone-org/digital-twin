/**
 * @fileoverview 克隆角色的名称建议：后缀递增，且只跳过看得见的重名。
 */
import { describe, expect, it } from 'vitest'

import { suggestCloneName } from '@/pages/System/Roles/scripts/cloneName'

describe('suggestCloneName', () => {
  it('没人占用就直接加 _copy', () => {
    expect(suggestCloneName('admin', [])).toBe('admin_copy')
  })

  it('_copy 被占用就从 2 开始编号', () => {
    expect(suggestCloneName('admin', ['admin_copy'])).toBe('admin_copy2')
  })

  it('连续占用时继续递增', () => {
    const taken = ['admin_copy', 'admin_copy2', 'admin_copy3']
    expect(suggestCloneName('admin', taken)).toBe('admin_copy4')
  })

  it('只看重名不看顺序，中间空号也照样跳过已占的', () => {
    expect(suggestCloneName('admin', ['admin_copy', 'admin_copy3'])).toBe(
      'admin_copy2',
    )
  })

  it('别的角色名不影响判断', () => {
    expect(suggestCloneName('ops', ['admin_copy', 'viewer'])).toBe('ops_copy')
  })
})
