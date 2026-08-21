/**
 * @fileoverview 契约：模块系统的几个闭合集合，运行时常量与类型成员必须逐一对齐。
 * ⚠ 「类型改了而常量没改」typecheck 抓不到——属性面板会渲染不出控件、
 * 状态会掉进一个谁也不认识的档，全程无报错。
 */
import { describe, expect, it } from 'vitest'

import {
  BINDING_DATA_TYPES,
  CONFIG_FIELD_SPANS,
  CONFIG_FIELD_TYPES,
  INTERACTION_EVENTS,
  MODULE_CHROMES,
  MODULE_CONNECTION_STATES,
  MODULE_REGIONS,
  MODULE_STATUSES,
} from '../src/index'
import type {
  BindingDataType,
  ConfigFieldSpan,
  ConfigFieldType,
  InteractionEventName,
  ModuleChrome,
  ModuleConnectionState,
  ModuleRegion,
  ModuleStatus,
} from '../src/index'

// 类型层把成员枚举一遍：多一个或少一个都过不了 typecheck
const CONFIG_FIELD_TYPE_MEMBERS: Record<ConfigFieldType, true> = {
  string: true,
  textarea: true,
  number: true,
  boolean: true,
  enum: true,
  color: true,
  range: true,
  array: true,
  object: true,
  font: true,
  style: true,
  image: true,
  json: true,
  'dashboard-ref': true,
}
const CONFIG_FIELD_SPAN_MEMBERS: Record<ConfigFieldSpan, true> = {
  half: true,
  full: true,
}
const BINDING_DATA_TYPE_MEMBERS: Record<BindingDataType, true> = {
  number: true,
  boolean: true,
  string: true,
  enum: true,
}
const MODULE_CHROME_MEMBERS: Record<ModuleChrome, true> = {
  card: true,
  bare: true,
}
const MODULE_REGION_MEMBERS: Record<ModuleRegion, true> = {
  header: true,
  footer: true,
}
const MODULE_STATUS_MEMBERS: Record<ModuleStatus, true> = {
  loading: true,
  connected: true,
  empty: true,
  unbound: true,
  error: true,
}
const MODULE_CONNECTION_STATE_MEMBERS: Record<ModuleConnectionState, true> = {
  connecting: true,
  open: true,
  reconnecting: true,
  closed: true,
  error: true,
}
const INTERACTION_EVENT_MEMBERS: Record<InteractionEventName, true> = {
  click: true,
  change: true,
  select: true,
}

describe('配置字段', () => {
  it('控件类型是这十四档', () => {
    expect([...CONFIG_FIELD_TYPES]).toEqual([
      'string',
      'textarea',
      'number',
      'boolean',
      'enum',
      'color',
      'range',
      'array',
      'object',
      'font',
      'style',
      'image',
      'json',
      'dashboard-ref',
    ])
  })

  it('控件类型的类型成员与运行时常量对齐', () => {
    expect(Object.keys(CONFIG_FIELD_TYPE_MEMBERS).sort()).toEqual(
      [...CONFIG_FIELD_TYPES].sort(),
    )
  })

  it('栅格占位只有半行与整行两档', () => {
    expect([...CONFIG_FIELD_SPANS]).toEqual(['half', 'full'])
    expect(Object.keys(CONFIG_FIELD_SPAN_MEMBERS).sort()).toEqual(
      [...CONFIG_FIELD_SPANS].sort(),
    )
  })
})

describe('绑定槽', () => {
  it('槽的数据类型是这四档', () => {
    expect([...BINDING_DATA_TYPES]).toEqual([
      'number',
      'boolean',
      'string',
      'enum',
    ])
  })

  it('槽数据类型的类型成员与运行时常量对齐', () => {
    expect(Object.keys(BINDING_DATA_TYPE_MEMBERS).sort()).toEqual(
      [...BINDING_DATA_TYPES].sort(),
    )
  })
})

describe('模块清单', () => {
  it('卡片框只有套框与裸渲染两档', () => {
    expect([...MODULE_CHROMES]).toEqual(['card', 'bare'])
    expect(Object.keys(MODULE_CHROME_MEMBERS).sort()).toEqual(
      [...MODULE_CHROMES].sort(),
    )
  })

  it('钉位区域只有页头与页脚两档', () => {
    expect([...MODULE_REGIONS]).toEqual(['header', 'footer'])
    expect(Object.keys(MODULE_REGION_MEMBERS).sort()).toEqual(
      [...MODULE_REGIONS].sort(),
    )
  })
})

describe('模块状态', () => {
  it('五档各自对应一种「现在为什么长这样」', () => {
    expect([...MODULE_STATUSES]).toEqual([
      'loading',
      'connected',
      'empty',
      'unbound',
      'error',
    ])
  })

  it('状态的类型成员与运行时常量对齐', () => {
    expect(Object.keys(MODULE_STATUS_MEMBERS).sort()).toEqual(
      [...MODULE_STATUSES].sort(),
    )
  })

  it('「还没收到值」与「取不到」是两档，不许合并', () => {
    // 合并了就分不清「配好了在等第一帧」和「这个点位根本读不到」
    expect(MODULE_STATUSES).toContain('empty')
    expect(MODULE_STATUSES).toContain('error')
  })

  it('连接态的类型成员与运行时常量对齐', () => {
    expect(Object.keys(MODULE_CONNECTION_STATE_MEMBERS).sort()).toEqual(
      [...MODULE_CONNECTION_STATES].sort(),
    )
  })
})

describe('节点联动', () => {
  it('联动事件的类型成员与运行时常量对齐', () => {
    expect(Object.keys(INTERACTION_EVENT_MEMBERS).sort()).toEqual(
      [...INTERACTION_EVENTS].sort(),
    )
  })
})
