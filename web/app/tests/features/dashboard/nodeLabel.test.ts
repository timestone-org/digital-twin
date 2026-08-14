/**
 * @fileoverview 节点显示名的回落链与别名写入口径：空白清键不存空串、
 * 未变化返回 null 免得压空撤销步骤。
 */
import { describe, expect, it } from 'vitest'
import type { ModuleManifest } from '@dt/contracts'

import {
  NODE_LABEL_KEY,
  configWithLabel,
  nodeLabelOf,
} from '@/features/dashboard/nodeLabel'

const MANIFEST: ModuleManifest = {
  type: 'text-block',
  displayName: '文本块',
  category: '装饰',
  defaultSize: { width: 320, height: 72 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: { name: 'stub' } }),
}

const getManifest = (type: string): ModuleManifest | undefined =>
  type === 'text-block' ? MANIFEST : undefined

describe('显示名回落链', () => {
  it('别名 > displayName > type', () => {
    expect(
      nodeLabelOf(
        { moduleType: 'text-block', configJson: { [NODE_LABEL_KEY]: '标语' } },
        getManifest,
      ),
    ).toBe('标语')
    expect(
      nodeLabelOf({ moduleType: 'text-block', configJson: {} }, getManifest),
    ).toBe('文本块')
    expect(
      nodeLabelOf({ moduleType: 'unknown', configJson: {} }, getManifest),
    ).toBe('unknown')
  })

  it('全空白别名视同未设置', () => {
    expect(
      nodeLabelOf(
        { moduleType: 'text-block', configJson: { [NODE_LABEL_KEY]: '   ' } },
        getManifest,
      ),
    ).toBe('文本块')
  })
})

describe('别名写入', () => {
  it('设置别名保留其余键', () => {
    const next = configWithLabel(
      { moduleType: 'text-block', configJson: { title: 'x' } },
      '大标题',
    )
    expect(next).toEqual({ title: 'x', [NODE_LABEL_KEY]: '大标题' })
  })

  it('空白 = 删键，不存空串', () => {
    const next = configWithLabel(
      {
        moduleType: 'text-block',
        configJson: { title: 'x', [NODE_LABEL_KEY]: '旧名' },
      },
      '  ',
    )
    expect(next).toEqual({ title: 'x' })
  })

  it('未变化返回 null', () => {
    expect(
      configWithLabel(
        { moduleType: 'text-block', configJson: { [NODE_LABEL_KEY]: '同名' } },
        ' 同名 ',
      ),
    ).toBeNull()
    expect(
      configWithLabel({ moduleType: 'text-block', configJson: {} }, ''),
    ).toBeNull()
  })
})
