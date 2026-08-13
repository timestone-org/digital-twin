/**
 * @fileoverview DtSelect 的展示：搜索、禁用项、展开方向、三档尺寸与四种状态。
 * 浮层 teleport 到 body（在弹窗里则挂进弹窗面板），所以 story 里给足了上下空间。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { DtSelectOption } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtSelect } from '../src'

const PROTOCOLS: DtSelectOption[] = [
  { value: 'opcua', label: 'OPC UA' },
  { value: 'modbus', label: 'Modbus TCP' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 's7', label: 'S7（暂未开通）', disabled: true },
]

const CHANNELS: DtSelectOption[] = Array.from({ length: 24 }, (_unused, i) => ({
  value: `ch-${String(i + 1).padStart(2, '0')}`,
  label: `采集通道 ${String(i + 1).padStart(2, '0')}`,
}))

const meta = {
  title: '表单/DtSelect 下拉选择',
  component: DtSelect,
  parameters: {
    docs: {
      description: {
        component:
          '自定义 listbox 下拉，`v-model` 收字符串。不用原生 `<select>`：' +
          '它的选项列表由系统绘制，皮肤跟不上深色工业风，也塞不进搜索框。' +
          '代价是键盘与读屏要自己实现完整（↑↓ 移动、Home/End 跳转、Enter 选中、Esc 收起）。' +
          '「怎么显示」的四项聚在 `display` 对象里：占位符、搜索、空态文案与展开方向。' +
          '`searchable: "auto"`（缺省）在选项 ≥ 8 条时自动给出搜索框。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    ariaLabel: { control: 'text', description: '无可见 label 时给触发器命名' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
    display: {
      control: 'object',
      description: '占位 / 搜索 / 空态 / 展开方向',
    },
  },
  args: {
    modelValue: 'opcua',
    options: PROTOCOLS,
    label: '采集协议',
    hint: '改协议会让已绑定的点位重新校验',
    size: 'md',
    disabled: false,
    required: false,
  },
} satisfies Meta<typeof DtSelect>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup() {
      const value = ref('opcua')
      return { args, value }
    },
    template: `
      <div class="sb-w-md">
        <DtSelect v-bind="args" v-model="value" />
        <p class="sb-note">当前取值：{{ value || '（未选）' }}</p>
      </div>
    `,
  }),
}

/** 三档尺寸。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-grid">
        <DtSelect
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
          hint=""
        />
      </div>
    `,
  }),
}

/** 状态：未选（显示占位）、必填、禁用、出错。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid">
        <DtSelect v-bind="args" label="未选" model-value="" hint="" />
        <DtSelect v-bind="args" label="必填" model-value="" required hint="" />
        <DtSelect v-bind="args" label="禁用" disabled hint="" />
        <DtSelect v-bind="args" label="出错" model-value="" required error="请选择采集协议" hint="" />
      </div>
    `,
  }),
}

/** 自定义占位与空态文案，都在 `display` 里。 */
export const 占位与空态: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup: () => ({ args, empty: [] as DtSelectOption[] }),
    template: `
      <div class="sb-grid">
        <DtSelect
          v-bind="args"
          label="自定义占位"
          model-value=""
          hint=""
          :display="{ placeholder: '请选择一种协议…' }"
        />
        <DtSelect
          v-bind="args"
          label="没有任何选项"
          model-value=""
          hint=""
          :options="empty"
          :display="{ searchable: true, emptyText: '当前边缘网关没有可用协议' }"
        />
      </div>
    `,
  }),
}

/** 搜索框：默认按选项数量自动决定（≥8 条给），也可以强制开或强制关。 */
export const 搜索: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup() {
      const auto = ref('ch-01')
      const forced = ref('opcua')
      const off = ref('ch-01')
      return { args, auto, forced, off, channels: CHANNELS }
    },
    template: `
      <div class="sb-grid">
        <DtSelect
          v-bind="args"
          v-model="auto"
          label="auto · 24 条，自动给搜索框"
          hint=""
          :options="channels"
        />
        <DtSelect
          v-bind="args"
          v-model="forced"
          label="强制开 · 只有 4 条也给"
          hint=""
          :display="{ searchable: true, searchPlaceholder: '输入协议名…' }"
        />
        <DtSelect
          v-bind="args"
          v-model="off"
          label="强制关 · 24 条也不给"
          hint=""
          :options="channels"
          :display="{ searchable: false }"
        />
      </div>
    `,
  }),
}

/** 禁用项：不可选、键盘移动时自动跳过。 */
export const 禁用选项: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-md">
        <DtSelect
          v-bind="args"
          label="含禁用项（S7）"
          hint="↑↓ 移动时会直接跳过它"
          model-value=""
        />
      </div>
    `,
  }),
}

/** 展开方向：首选 `top` 时向上展开；空间不足会在运行时自己翻到对侧。 */
export const 展开方向: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup() {
      const down = ref('opcua')
      const up = ref('mqtt')
      return { args, down, up }
    },
    template: `
      <div class="sb-stage sb-stage--tall">
        <div class="sb-row sb-row--top">
          <div class="sb-w-sm">
            <DtSelect v-bind="args" v-model="down" label="向下（缺省）" hint="" />
          </div>
          <div class="sb-w-sm">
            <DtSelect
              v-bind="args"
              v-model="up"
              label="向上"
              hint=""
              :display="{ placement: 'top' }"
            />
          </div>
        </div>
      </div>
    `,
  }),
}

/** 紧凑工具条：没有可见 label，用 `ariaLabel` 给触发器命名。 */
export const 工具条里的紧凑用法: Story = {
  render: (args) => ({
    components: { DtSelect },
    setup() {
      const channel = ref('ch-03')
      const protocol = ref('modbus')
      return { args, channel, protocol, channels: CHANNELS }
    },
    template: `
      <div class="sb-row">
        <div class="sb-w-sm">
          <DtSelect
            v-bind="args"
            v-model="channel"
            :label="undefined"
            hint=""
            size="sm"
            aria-label="采集通道"
            :options="channels"
          />
        </div>
        <div class="sb-w-sm">
          <DtSelect
            v-bind="args"
            v-model="protocol"
            :label="undefined"
            hint=""
            size="sm"
            aria-label="采集协议"
          />
        </div>
      </div>
    `,
  }),
}
