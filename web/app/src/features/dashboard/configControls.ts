/**
 * @fileoverview 把每一档 `ConfigFieldType` 的控件登记进 `@dt/modules` 的分发表。
 * ⚠ 这张表是**闭合联合逐档铺满**的：`CONFIG_FIELD_TYPES` 里加一档而这里没铺，
 * `missingConfigControls()` 就非空，契约测试当场红——不铺的后果是属性面板上
 * 那个字段静默不出控件，用户看到的是「这一项没法改」而没有任何提示。
 */
import type { ConfigFieldType } from '@dt/contracts'
import { CONFIG_FIELD_TYPES } from '@dt/contracts'
import { registerConfigControl } from '@dt/modules'
import type { Component } from 'vue'

import ArrayControl from './controls/ArrayControl.vue'
import BooleanControl from './controls/BooleanControl.vue'
import ColorControl from './controls/ColorControl.vue'
import DashboardRefControl from './controls/DashboardRefControl.vue'
import EnumControl from './controls/EnumControl.vue'
import FontControl from './controls/FontControl.vue'
import ImageControl from './controls/ImageControl.vue'
import JsonControl from './controls/JsonControl.vue'
import NumberControl from './controls/NumberControl.vue'
import ObjectControl from './controls/ObjectControl.vue'
import RangeControl from './controls/RangeControl.vue'
import StringControl from './controls/StringControl.vue'
import StyleControl from './controls/StyleControl.vue'

const CONTROLS: Record<ConfigFieldType, Component> = {
  string: StringControl,
  number: NumberControl,
  boolean: BooleanControl,
  enum: EnumControl,
  color: ColorControl,
  range: RangeControl,
  array: ArrayControl,
  object: ObjectControl,
  font: FontControl,
  style: StyleControl,
  image: ImageControl,
  json: JsonControl,
  'dashboard-ref': DashboardRefControl,
}

/** 登记全部控件。重复调用是幂等的（同档后登记者生效，组件是同一个）。 */
export function installConfigControls(): void {
  for (const type of CONFIG_FIELD_TYPES) {
    registerConfigControl(type, CONTROLS[type])
  }
}
