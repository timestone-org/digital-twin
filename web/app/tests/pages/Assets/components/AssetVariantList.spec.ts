/** @fileoverview 压缩档列表：几档同一个失败原因只说一次，原因里的不可见字符剥掉。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { AssetVariant } from '@/api/assets'
import AssetVariantList from '@/pages/Assets/components/AssetVariantList.vue'

function failed(
  variant: 'high' | 'medium' | 'low',
  label: string,
): AssetVariant {
  return {
    variant,
    label,
    hint: '',
    status: 'failed',
    sizeBytes: null,
    checksum: null,
    error: 'Unexpected token \u0001g\u0000, "glTF" is not valid JSON',
  }
}

describe('AssetVariantList 的失败原因', () => {
  it('同一句原因合成一条，并点名是哪几档', () => {
    const wrapper = mount(AssetVariantList, {
      props: {
        variants: [
          failed('high', '高'),
          failed('medium', '中'),
          failed('low', '轻'),
        ],
        originalBytes: 100,
        canManage: false,
        isBusy: false,
      },
    })
    const notices = wrapper.findAll('.dt-notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.text()).toContain('高、中、轻')
    const codes = Array.from(notices[0]?.text() ?? '').map(
      (char) => char.codePointAt(0) ?? 0,
    )
    expect(codes.every((code) => code >= 0x20)).toBe(true)
  })
})
