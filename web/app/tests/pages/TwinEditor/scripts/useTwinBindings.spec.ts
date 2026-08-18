/**
 * @fileoverview 契约：页面这一层把绑定页的动作接到文档态上，
 * 并把挑点弹窗的开关与「挑到的点位写回哪一条绑定」串起来。
 *
 * ⚠ 落库的是 `node_key` 不是 `code`：写成 code 的表现是标签上有点位名、
 * 推送方却永远匹配不到这个键，读数一直是占位符。
 * ⚠ 文档还没读出来时全部动作都必须是空操作，而不是抛异常把整页带白。
 */
import type { CollectPoint } from '@dt/contracts'
import { __resetProviders } from '@dt/datasources'
import { normalizeTwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { defineComponent, h, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTwinDoc, type TwinDoc } from '@/pages/TwinEditor/scripts/twinDoc'
import {
  useTwinBindings,
  type TwinBindings,
} from '@/pages/TwinEditor/scripts/useTwinBindings'

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({ subscribe: () => () => undefined }),
}))

const CONFIG = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

const POINT: CollectPoint = {
  id: 'pt-1',
  source_id: 'src-1',
  node_key: 'ns=2;s=T1',
  code: 'T1',
  name: '1 号温度',
  address: 'ns=2;s=T1',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60_000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}

function mountBindings(doc: TwinDoc | null) {
  const held = shallowRef(doc)
  // ⚠ 存进对象而不是 let：赋值发生在 setup 的闭包里，TS 追不到，
  //   用 let 的话读回来的类型会塌成 never
  const holder: { api: TwinBindings | null } = { api: null }
  const host = defineComponent({
    setup() {
      holder.api = useTwinBindings(
        () => held.value,
        () => 'd1',
        () => 'n1',
        () => CONFIG,
      )
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  const api = holder.api
  if (api === null) throw new Error('composable 没装上')
  return { wrapper, api }
}

beforeEach(() => {
  __resetProviders()
})

describe('接到文档态上', () => {
  it('绑一个槽之后绑定表里就有它', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const { api } = mountBindings(doc)

    api.bind('anchorValues[0].value')

    expect(api.bindings.value.map((item) => item.fieldKey)).toEqual([
      'anchorValues[0].value',
    ])
  })

  it('解绑之后就没了', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const { api } = mountBindings(doc)
    api.bind('anchorValues[0].value')

    api.drop('anchorValues[0].value')

    expect(api.bindings.value).toEqual([])
  })
})

describe('挑点弹窗', () => {
  it('挑完把点位身份写进那一条绑定，并把弹窗关上', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const { api } = mountBindings(doc)
    api.bind('anchorValues[0].value')
    api.pickingFieldKey.value = 'anchorValues[0].value'

    api.pickPoint(POINT)

    expect(api.bindings.value[0]?.nodeKey).toBe('ns=2;s=T1')
    expect(api.pickingFieldKey.value).toBeNull()
  })

  it('弹窗没开时挑到的点位不写给任何人', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const { api } = mountBindings(doc)
    api.bind('anchorValues[0].value')

    api.pickPoint(POINT)

    expect(api.bindings.value[0]?.nodeKey).toBeNull()
  })

  it('关掉弹窗只清开关，不动绑定', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const { api } = mountBindings(doc)
    api.bind('anchorValues[0].value')
    api.pickingFieldKey.value = 'anchorValues[0].value'

    api.closePicker(false)

    expect(api.pickingFieldKey.value).toBeNull()
    expect(api.bindings.value).toHaveLength(1)
  })

  // 弹窗自己回报「我开着」时不许把挑点状态清掉，否则挑完写不回任何一条绑定
  it('弹窗回报开着时不动挑点状态', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const { api } = mountBindings(doc)
    api.pickingFieldKey.value = 'anchorValues[0].value'

    api.closePicker(true)

    expect(api.pickingFieldKey.value).toBe('anchorValues[0].value')
  })
})

describe('文档还没读出来', () => {
  it('绑定表是空的，动作全是空操作而不是抛异常', () => {
    const { api } = mountBindings(null)

    api.bind('anchorValues[0].value')
    api.drop('anchorValues[0].value')
    api.removeRow('anchorValues', 0)

    expect(api.bindings.value).toEqual([])
  })
})
