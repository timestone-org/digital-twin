/**
 * @fileoverview 契约：画布尺寸跟着页面设置里的**草稿**走（改了当场看得见），
 * 且草稿里越界的宽高先夹回服务端收得下的区间。
 */
import type { DashboardPayload } from '@dt/contracts'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useEditorCanvasState } from '@/pages/DashboardEditor/scripts/useEditorCanvasState'
import { useEditorChrome } from '@/pages/DashboardEditor/scripts/useEditorChrome'
import { useEditorMeta } from '@/pages/DashboardEditor/scripts/useEditorMeta'

function payload(): DashboardPayload {
  return {
    id: 'db1',
    projectId: 'p1',
    name: '一号大屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '',
    updatedAt: 'v-1',
    nodes: [],
  }
}

function setup() {
  const dashboard = shallowRef<DashboardPayload | null>(payload())
  const meta = useEditorMeta(dashboard)
  const chrome = useEditorChrome(dashboard, meta)
  const canvas = useEditorCanvasState(dashboard, meta.draft)
  return { meta, chrome, canvas }
}

describe('画布尺寸', () => {
  it('改了草稿里的设计宽度，画布当场跟着变', () => {
    const { chrome, canvas } = setup()

    chrome.setField('designWidth', 2560)

    expect(canvas.design.value).toEqual({ width: 2560, height: 1080 })
  })

  it('越界的设计尺寸夹回 320–20000，不让保存吃一个笼统的 422', () => {
    const { chrome, meta } = setup()

    chrome.setField('designHeight', 300)
    chrome.setField('designWidth', 50000)

    expect(meta.draft.value?.designHeight).toBe(320)
    expect(meta.draft.value?.designWidth).toBe(20000)
  })
})
