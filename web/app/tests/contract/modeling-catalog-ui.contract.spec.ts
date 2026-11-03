/** @fileoverview 新鲜注册表的51算子配置可达，真实表单值经后端验证并执行。 */
import { DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as api from '@/api/modeling'
import SharedConfigForm from '@/features/modeling-config/components/ConfigForm.vue'
import InstanceNodeForm from '@/pages/Modeling/Instance/components/InstanceNodeForm.vue'
import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'
import FrameView from '@/pages/Modeling/Canvas/components/FrameView.vue'
import ModelView from '@/pages/Modeling/Canvas/components/ModelView.vue'
import MetricsView from '@/pages/Modeling/Canvas/components/MetricsView.vue'
import UnknownView from '@/pages/Modeling/Canvas/components/UnknownView.vue'
import { portPreviewsOf } from '@/pages/Modeling/Canvas/scripts/preview'
import {
  defaultsOf,
  fieldsOf,
  visibleFields,
} from '@/features/modeling-config/scripts/schemaForm'
import {
  configError,
  fieldValue,
} from '@/features/modeling-config/scripts/configValues'
import { backendResults, freshCatalog } from '@/testing/modelingCatalogProbe'
import type {
  CatalogEntry,
  ConfigSubmission,
} from '@/testing/modelingCatalogProbe'
import {
  branches,
  catalogDialog,
  editField,
  initialConfig,
  updateConfig,
} from '@/testing/modelingCatalogForms'

let catalog: CatalogEntry[] = []
beforeAll(async () => {
  catalog = await freshCatalog()
  vi.spyOn(api, 'getModelingBdmCapabilities').mockResolvedValue({
    is_configured: true,
    timezone: 'Asia/Shanghai',
    minute_intervals: [1, 5, 15, 30],
    max_identifiers: 10,
    max_formula_identifiers: 8,
    max_rows: 200000,
    load_timeout_s: 120,
  })
  vi.spyOn(api, 'listModelingBdmCatalog').mockImplementation((query) =>
    Promise.resolve({
      kind: query.kind,
      page: query.page,
      size: 50,
      total: 0,
      items: [],
      system_filter_available: null,
    }),
  )
  vi.spyOn(api, 'listModelingBdmSystems').mockResolvedValue({
    items: [],
    system_filter_available: false,
  })
}, 60_000)
afterAll(() => {
  vi.restoreAllMocks()
})

it('固定值填缺失仍能查看和修改全空列策略，避免隐藏skip造成静默不填', async () => {
  const entry = catalog.find((item) => item.operator.code === 'fill_missing')
  if (!entry) throw new Error('缺少填缺失算子')
  const fields = fieldsOf(entry.operator.config_schema)
  const config = { ...initialConfig(entry), on_all_null: 'skip' }
  const wrapper = catalogDialog(entry, config)
  const strategy = fields.find((field) => field.key === 'strategy')
  if (!strategy) throw new Error('缺少填法字段')
  await editField(wrapper, strategy, 'constant')
  await updateConfig(wrapper, { ...config, strategy: 'constant' })
  await flushPromises()
  const control = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === '整列全空时')
  expect(control, 'constant + skip仍然影响执行，因此必须可见').toBeDefined()
  expect(control?.props('modelValue')).toBe('skip')
  control?.vm.$emit('update:modelValue', 'error')
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['on_all_null', 'error'])
  wrapper.unmount()
})

async function configure(entry: CatalogEntry): Promise<ConfigSubmission> {
  const config = initialConfig(entry)
  const fields = fieldsOf(entry.operator.config_schema)
  const wrapper = catalogDialog(entry, config)
  try {
    for (const [key, value] of Object.entries(entry.seed)) {
      const field = fields.find((item) => item.key === key)
      if (!field) throw new Error(`${entry.operator.code} 缺少 ${key}`)
      await editField(wrapper, field, value)
      expect(
        wrapper.emitted('change')?.at(-1),
        `${entry.operator.code}.${key}`,
      ).toEqual([key, value])
      config[key] = value
      await updateConfig(wrapper, config)
    }
    await flushPromises()
    expect(
      wrapper.get('.dt-ml-dialog-footer [role="status"]').text(),
      entry.operator.code,
    ).toContain('参数已更新到画布草稿')
    return { code: entry.operator.code, config, run: true }
  } finally {
    wrapper.unmount()
  }
}
async function consume(
  entry: CatalogEntry,
  result: Awaited<ReturnType<typeof backendResults>>['results'][number],
) {
  const ports = portPreviewsOf(result.payload)
  expect(ports.map((item) => item.port).sort()).toEqual(
    entry.operator.outputs.map((item) => item.name).sort(),
  )
  for (const item of ports) {
    expect(item.preview.kind, `${result.code}.${item.port}`).not.toBe('unknown')
    if (item.preview.kind === 'unknown') throw new Error('未知结果类型')
    const wrapper = mount(ResultView, {
      props: {
        payload: { [item.port]: result.payload[item.port] },
        report: result.report,
        operator: entry.operator,
        code: result.code,
        config: result.config,
      },
    })
    try {
      const toggle = wrapper.find('.dt-ml-result__toggle')
      if (toggle.exists()) await toggle.trigger('click')
      expect(wrapper.findComponent(UnknownView).exists()).toBe(false)
      const expected = {
        frame: FrameView,
        model: ModelView,
        metrics: MetricsView,
      }[item.preview.kind]
      expect(
        wrapper.findComponent(expected).exists(),
        `${result.code}.${item.port}`,
      ).toBe(true)
      expect(wrapper.text()).not.toContain('[object Object]')
      expect(wrapper.text()).not.toContain('NaN')
    } finally {
      wrapper.unmount()
    }
  }
}
it('51个算子的必填选择和默认值经真实Modal事件后能校验、执行、展示每路结果', async () => {
  expect(catalog).toHaveLength(51)
  const submissions: ConfigSubmission[] = []
  for (const entry of catalog) submissions.push(await configure(entry))
  const checked = await backendResults(submissions)
  expect(checked.errors).toEqual([])
  expect(checked.results).toHaveLength(51)
  for (const result of checked.results) {
    const entry = catalog.find((item) => item.operator.code === result.code)
    if (!entry) throw new Error(`缺少结果算子 ${result.code}`)
    await consume(entry, result)
  }
}, 60_000)

it('49个模型选项在Modal和实例页均可切换，前后端接受同份schema初值', async () => {
  const submissions: ConfigSubmission[] = []
  for (const entry of catalog) {
    const fields = fieldsOf(entry.operator.config_schema)
    const algorithm = fields.find((field) => field.key === 'algorithm')
    if (!algorithm) continue
    for (const option of algorithm.options) {
      const config = defaultsOf(fields)
      const wrapper = catalogDialog(entry, config)
      await editField(wrapper, algorithm, option.value)
      expect(wrapper.emitted('change')?.at(-1)).toEqual([
        'algorithm',
        option.value,
      ])
      const next = { ...config, algorithm: option.value }
      await updateConfig(wrapper, next)
      expect(
        wrapper.get('.dt-ml-dialog-footer [role="status"]').text(),
      ).toContain('参数已更新到画布草稿')
      const instance = mount(InstanceNodeForm, {
        props: {
          node: {
            id: 'm',
            alias: '',
            operator: entry.operator,
            config: next,
            known_columns: entry.columns.map((column) => column.key),
          },
          config: next,
          disabled: false,
        },
      })
      expect(instance.findAll('.dt-ml-form__row')).toHaveLength(
        visibleFields(fields, next).length,
      )
      expect(instance.emitted('error')?.at(-1)).toEqual(['m.__form', ''])
      submissions.push({ code: entry.operator.code, config: next })
      instance.unmount()
      wrapper.unmount()
    }
  }
  expect(submissions).toHaveLength(49)
  expect((await backendResults(submissions)).errors).toEqual([])
}, 60_000)

it('每个条件字段都存在可见分支，所有枚举选项分支回传后端可验证', async () => {
  const submissions: ConfigSubmission[] = []
  for (const entry of catalog) {
    if (['bdm_source', 'energy_rules'].includes(entry.operator.code)) continue
    const fields = fieldsOf(entry.operator.config_schema)
    const states = branches(entry)
    const reached = new Set<string>()
    for (const config of states) {
      for (const field of visibleFields(fields, config)) {
        reached.add(field.key)
        expect(
          configError(field, fieldValue(field, config)),
          `${entry.operator.code}.${field.key}`,
        ).toBe('')
      }
      const form = mount(SharedConfigForm, {
        props: {
          fields,
          config,
          options: {
            tables: [{ code: 'energy_h', name: '测试台账' }],
            tablesState: 'ready',
            tablesNote: '',
            columns: entry.columns,
            columnsNote: '',
          },
          isReadonly: false,
        },
      })
      expect(
        form.findAll('.dt-ml-form__row'),
        entry.operator.code,
      ).toHaveLength(visibleFields(fields, config).length)
      form.unmount()
      submissions.push({ code: entry.operator.code, config })
    }
    expect([...reached].sort(), entry.operator.code).toEqual(
      fields
        .filter((field) =>
          Object.entries(field.visibleWhen ?? {}).every(([key, values]) => {
            const controller = fields.find((candidate) => candidate.key === key)
            return (
              !controller?.options.length ||
              controller.options.some((option) => values.includes(option.value))
            )
          }),
        )
        .map((field) => field.key)
        .sort(),
    )
  }
  expect(submissions.length).toBeGreaterThan(200)
  expect((await backendResults(submissions)).errors).toEqual([])
}, 60_000)

it('8种能源规则使用新鲜嵌套schema，在真实Modal中均有可用表单配置', async () => {
  const entry = catalog.find((item) => item.operator.code === 'energy_rules')
  if (!entry) throw new Error('缺少能源规则')
  const fields = fieldsOf(entry.operator.config_schema)
  const kind = fields.find((field) => field.key === 'kind')
  if (!kind) throw new Error('缺少规则选择')
  const submissions: ConfigSubmission[] = []
  for (const option of kind.options) {
    const config = initialConfig(entry)
    const wrapper = catalogDialog(entry, config)
    await editField(wrapper, kind, option.value)
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['kind', option.value])
    const next = { ...config, kind: option.value, fields: {} }
    await updateConfig(wrapper, next)
    expect(
      wrapper.get('.dt-ml-dialog-footer [role="status"]').text(),
      option.value,
    ).toContain('参数已更新到画布草稿')
    expect(wrapper.find('textarea').exists(), option.value).toBe(false)
    submissions.push({ code: entry.operator.code, config: next })
    wrapper.unmount()
  }
  expect(submissions).toHaveLength(8)
  expect((await backendResults(submissions)).errors).toEqual([])
}, 60_000)

it('能管三类来源和四种公式粒度的配置可达，分钟控件发出真实数值', async () => {
  const entry = catalog.find((item) => item.operator.code === 'bdm_source')
  if (!entry) throw new Error('缺少能管来源')
  const submissions: ConfigSubmission[] = []
  const modes = [
    ['point', 'day'],
    ['raw', 'day'],
    ...['day', 'month', 'hour', 'minute'].map((value) => ['formula', value]),
  ]
  for (const [kind, granularity] of modes) {
    const config = { ...initialConfig(entry), ...entry.seed, kind, granularity }
    const wrapper = catalogDialog(entry, config)
    await flushPromises()
    const controls = wrapper.findAllComponents(DtSelect)
    expect(controls.some((item) => item.props('label') === '公式粒度')).toBe(
      kind === 'formula',
    )
    expect(controls.some((item) => item.props('label') === '分钟间隔')).toBe(
      kind === 'formula' && granularity === 'minute',
    )
    if (granularity === 'minute') {
      const interval = controls.find(
        (item) => item.props('label') === '分钟间隔',
      )
      if (!interval) throw new Error('缺少分钟间隔')
      interval.vm.$emit('update:modelValue', '15')
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('change')?.at(-1)).toEqual([
        'interval_minutes',
        15,
      ])
      submissions.push({
        code: entry.operator.code,
        config: { ...config, interval_minutes: 15 },
      })
    } else submissions.push({ code: entry.operator.code, config })
    expect(
      wrapper.get('.dt-ml-dialog-footer [role="status"]').text(),
    ).toContain('参数已更新到画布草稿')
    wrapper.unmount()
  }
  expect(submissions).toHaveLength(6)
  expect((await backendResults(submissions)).errors).toEqual([])
}, 60_000)
