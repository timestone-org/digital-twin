/**
 * @fileoverview 契约：已发布的权限码字面量与档位集合。
 * ⚠ 码是**落库的值**，改名不会动库里已授权的行——受影响的用户当场失权，
 * 而 typecheck 只看得见键名、看不见值，所以这里逐条手写字面量比对。
 */
import { describe, expect, it } from 'vitest'

import { PERMISSION_CODES, PERMISSION_KINDS } from '../src/index'
import type { PermissionKind } from '../src/index'

const PERMISSION_KIND_MEMBERS: Record<PermissionKind, true> = {
  view: true,
  manage: true,
  operate: true,
  admin: true,
}

// 手写一遍字面量：从 PERMISSION_CODES 自己推出来的期望只能证明它等于它自己
const PUBLISHED = {
  userView: 'user:view',
  userManage: 'user:manage',
  userDelete: 'user:delete',
  userGrant: 'user:grant',
  roleManage: 'role:manage',
  routeRuleView: 'route_rule:view',
  routeRuleManage: 'route_rule:manage',
  acView: 'ac:view',
  acManage: 'ac:manage',
  opcuaView: 'opcua:view',
  opcuaOperate: 'opcua:operate',
  opcuaManage: 'opcua:manage',
}

/**
 * 从码推出它该有的键名，`route_rule:view` → `routeRuleView`。
 * @param code 权限码
 */
function camelKeyOf(code: string): string {
  return code
    .split(/[:_]/)
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('')
}

describe('权限码', () => {
  it('大屏面是看、编辑、管理三档', () => {
    expect(PERMISSION_CODES.dashboardView).toBe('dashboard:view')
    expect(PERMISSION_CODES.dashboardEdit).toBe('dashboard:edit')
    expect(PERMISSION_CODES.dashboardManage).toBe('dashboard:manage')
  })

  it('采集面是看、操作、管理三档', () => {
    expect(PERMISSION_CODES.collectView).toBe('collect:view')
    expect(PERMISSION_CODES.collectOperate).toBe('collect:operate')
    expect(PERMISSION_CODES.collectManage).toBe('collect:manage')
  })

  // 素材是跨大屏的公共资源，故与大屏面分开成两档
  it('素材面是看、管理两档', () => {
    expect(PERMISSION_CODES.assetView).toBe('asset:view')
    expect(PERMISSION_CODES.assetManage).toBe('asset:manage')
  })

  // 台账的写码按**爆炸半径**切成四个，不是一个 manage 包干：改表结构影响往后
  // 每一行，改一行只影响那一行，改修正等同于篡改台账，回填与全表重算则吃满库
  it('台账面是一个读码加四个按爆炸半径切开的写码', () => {
    expect(PERMISSION_CODES.datasetView).toBe('dataset:view')
    expect(PERMISSION_CODES.datasetManage).toBe('dataset:manage')
    expect(PERMISSION_CODES.datasetRecordWrite).toBe('dataset:record:write')
    expect(PERMISSION_CODES.datasetOverride).toBe('dataset:override')
    expect(PERMISSION_CODES.datasetBackfill).toBe('dataset:backfill')
  })

  it('先前已发布的码一字未改', () => {
    expect(PERMISSION_CODES).toMatchObject(PUBLISHED)
  })

  it('每个键名由它的码派生，接错档位当场对不上', () => {
    const mismatched = Object.entries(PERMISSION_CODES).filter(
      ([key, code]) => camelKeyOf(code) !== key,
    )
    expect(mismatched).toEqual([])
  })

  it('没有两个键指向同一个码', () => {
    const codes = Object.values(PERMISSION_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('权限档位', () => {
  it('档位是看、管理、操作、超管四种', () => {
    expect([...PERMISSION_KINDS]).toEqual([
      'view',
      'manage',
      'operate',
      'admin',
    ])
  })

  it('档位的类型成员与运行时常量对齐', () => {
    expect(Object.keys(PERMISSION_KIND_MEMBERS).sort()).toEqual(
      [...PERMISSION_KINDS].sort(),
    )
  })
})
