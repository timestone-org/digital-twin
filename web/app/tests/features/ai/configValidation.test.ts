/** @fileoverview 模块 schema 校验覆盖标量、嵌套、默认与删除语义。 */
import { describe, expect, it } from 'vitest'
import type { ConfigField, ModuleManifest } from '@dt/contracts'
import {
  checkedConfigPatch,
  validateConfigValue,
} from '@/features/ai/configValidation'

const fields: ConfigField[] = [
  { key: 'title', label: '标题', type: 'string', default: '默认' },
  { key: 'size', label: '尺寸', type: 'number', min: 1, max: 10 },
  {
    key: 'flags',
    label: '设置',
    type: 'object',
    fields: [{ key: 'on', label: '启用', type: 'boolean' }],
  },
  { key: 'font', label: '字体', type: 'font' },
  { key: 'style', label: '样式', type: 'style' },
  { key: 'free', label: '自由配置', type: 'json' },
  { key: 'scene', label: '场景', type: 'object' },
]
const manifest: ModuleManifest = {
  type: 'test',
  displayName: '测试',
  category: '测试',
  defaultSize: { width: 100, height: 100 },
  configSchema: fields,
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
  subEditor: { configKey: 'scene', routeName: 'scene', label: '场景' },
}

function field(
  type: ConfigField['type'],
  patch: Partial<ConfigField> = {},
): ConfigField {
  return { key: 'test', label: '测试', type, ...patch }
}

describe('字段取值校验', () => {
  it.each(['string', 'textarea', 'color', 'image', 'dashboard-ref'] as const)(
    '%s 拒绝非文本',
    (type) => {
      expect(() => validateConfigValue(field(type), 1)).toThrow()
      expect(() => validateConfigValue(field(type), '文本')).not.toThrow()
    },
  )
  it.each([NaN, Infinity, -1, 11, '2'])('拒绝无效数字 %s', (value) => {
    expect(() =>
      validateConfigValue(field('range', { min: 0, max: 10 }), value),
    ).toThrow()
  })
  it('布尔值、非字符串枚举和自由 JSON 保留原始类型', () => {
    expect(() => validateConfigValue(field('boolean'), false)).not.toThrow()
    expect(() => validateConfigValue(field('boolean'), 'false')).toThrow()
    expect(() =>
      validateConfigValue(
        field('enum', { options: [{ value: 1, label: '一' }] }),
        1,
      ),
    ).not.toThrow()
    expect(() =>
      validateConfigValue(
        field('enum', { options: [{ value: 1, label: '一' }] }),
        '1',
      ),
    ).toThrow()
    expect(() =>
      validateConfigValue(field('json'), { raw: [1, false] }),
    ).not.toThrow()
    expect(() => validateConfigValue(field('json'), undefined)).toThrow()
  })
  it('数组只收合法对象项并遵守长度限制', () => {
    const schema = field('array', {
      minItems: 1,
      maxItems: 2,
      itemSchema: [field('string')],
    })
    for (const value of [{}, [], [1], [{ wrong: 'x' }], [{}, {}, {}]])
      expect(() => validateConfigValue(schema, value)).toThrow()
    expect(() => validateConfigValue(schema, [{ test: '合法' }])).not.toThrow()
  })
  it('对象、字体与样式按声明校验', () => {
    expect(() =>
      checkedConfigPatch(manifest, {}, ['flags'], { on: true }),
    ).not.toThrow()
    expect(() => checkedConfigPatch(manifest, {}, ['flags'], 'on')).toThrow()
    expect(() =>
      checkedConfigPatch(manifest, {}, ['flags'], { invalid: 1 }),
    ).toThrow()
    expect(() =>
      checkedConfigPatch(manifest, {}, ['font'], {
        size: 24,
        family: 'sans-serif',
      }),
    ).not.toThrow()
    expect(() =>
      checkedConfigPatch(manifest, {}, ['style'], { opacity: 2 }),
    ).toThrow()
    expect(() =>
      checkedConfigPatch(manifest, {}, ['style', 'padding'], '4px'),
    ).not.toThrow()
    expect(() =>
      checkedConfigPatch(manifest, {}, ['flags', 'on'], false),
    ).not.toThrow()
    expect(() =>
      checkedConfigPatch(manifest, {}, ['flags', 'bad'], false),
    ).toThrow()
    expect(() => checkedConfigPatch(manifest, {}, ['size', 'bad'], 2)).toThrow()
  })
})

describe('配置补丁', () => {
  it('删除覆盖保留无关键和原对象', () => {
    const current = { title: '自定', flags: { on: true } }
    const next = checkedConfigPatch(manifest, current, ['flags', 'on'], null)
    expect(next).toEqual({ title: '自定', flags: {} })
    expect(current.flags.on).toBe(true)
    expect(
      checkedConfigPatch(manifest, {}, ['font', 'size'], null),
    ).not.toHaveProperty('font.size')
  })
  it('未知字段与子编辑器配置不可写入', () => {
    expect(() => checkedConfigPatch(manifest, {}, ['unknown'], 1)).toThrow()
    expect(() => checkedConfigPatch(manifest, {}, ['scene'], {})).toThrow(
      /子编辑器/,
    )
    expect(() =>
      checkedConfigPatch(manifest, {}, ['free', 'nested'], [1]),
    ).not.toThrow()
  })
})
