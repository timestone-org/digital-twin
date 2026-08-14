/**
 * @fileoverview 配置控件的渲染分发表：`ConfigFieldType` → 控件组件。属性面板按表查，
 * 不写 switch——加一种控件 = 注册一个组件，不必同时改契约包与编辑器
 * （DASHBOARD_DESIGN §5.3 陷阱 ④）。控件本体归编辑器，本包只定这张表。
 */
import type { ConfigFieldType } from '@dt/contracts'
import { CONFIG_FIELD_TYPES } from '@dt/contracts'
import type { Component } from 'vue'

const controls = new Map<ConfigFieldType, Component>()

/**
 * 登记一档控件；同档后登记者生效。
 * @param type 配置字段类型
 * @param control 渲染该档的组件
 */
export function registerConfigControl(
  type: ConfigFieldType,
  control: Component,
): void {
  controls.set(type, control)
}

/**
 * 取某一档的控件。
 * ⚠ 返回 undefined 时属性面板必须画出「这档控件还没登记」：静默留白就是
 * 「我选了但没反应」，那是这套系统里最难查的一类故障（陷阱 ⑤）。
 * @param type 配置字段类型
 */
export function getConfigControl(type: ConfigFieldType): Component | undefined {
  return controls.get(type)
}

/** 已登记的档位，顺序即登记先后。 */
export function listConfigControls(): readonly ConfigFieldType[] {
  return [...controls.keys()]
}

/** 闭合联合里还没有控件的那些档；编辑器的契约测试断言它是空的。 */
export function missingConfigControls(): readonly ConfigFieldType[] {
  return CONFIG_FIELD_TYPES.filter((type) => !controls.has(type))
}

/** 清空分发表，供测试隔离。 */
export function __resetConfigControls(): void {
  controls.clear()
}
