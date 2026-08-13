/**
 * @fileoverview DtColorInput 的展示：取色块 + 文本 + 预设色板三件套，
 * 以及「取值可以是 token」这条本组件独有的能力。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtColorInput } from '../src'

const TOKEN_SWATCHES = [
  '--accent-primary',
  '--accent-secondary',
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--text-secondary',
]

const HEX_SWATCHES = [
  '#00cefc',
  '#45d3fd',
  '#14e144',
  '#ffe400',
  '#ff4d4f',
  '#7aa7be',
]

const meta = {
  title: '表单/DtColorInput 颜色取值',
  component: DtColorInput,
  parameters: {
    docs: {
      description: {
        component:
          '颜色取值，`v-model` 收字符串。**纯受控**：组件自己不规范化取值，' +
          '你给什么它显示什么——`#00cefc`、`rgb(...)`、颜色名，以及 `--accent-primary` ' +
          '这样的 token 引用都收。' +
          '⚠ 原生取色器只吃 `#rrggbb`，所以组件会先把当前取值解析成 hex 再喂给它；' +
          '解析不出来就用黑色兜底——那表示的是「没解析出来」，用主题色会让人以为' +
          '当前值就是那个色。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    placeholder: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
    swatches: { control: 'object', description: '预设色板；空数组不渲染' },
    allowText: {
      control: 'boolean',
      description: '关掉右侧文本框，只留取色块',
    },
  },
  args: {
    modelValue: '#00cefc',
    label: '曲线颜色',
    hint: '支持 #hex、rgb() 与 --token',
    size: 'md',
    disabled: false,
    required: false,
    allowText: true,
    swatches: TOKEN_SWATCHES,
  },
} satisfies Meta<typeof DtColorInput>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtColorInput },
    setup() {
      const color = ref('#00cefc')
      return { args, color }
    },
    template: `
      <div class="sb-w-md">
        <DtColorInput v-bind="args" v-model="color" />
        <p class="sb-note">当前取值：<code>{{ color }}</code></p>
      </div>
    `,
  }),
}

/** 预设色板：给 token 名的话，换肤时这块颜色会跟着主题走。 */
export const 预设色板: Story = {
  render: (args) => ({
    components: { DtColorInput },
    setup() {
      const byToken = ref('--accent-primary')
      const byHex = ref('#14e144')
      const none = ref('#ff4d4f')
      return { args, byToken, byHex, none, TOKEN_SWATCHES, HEX_SWATCHES }
    },
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtColorInput
          v-bind="args"
          v-model="byToken"
          label="token 色板（跟着换肤走）"
          hint=""
          :swatches="TOKEN_SWATCHES"
        />
        <DtColorInput
          v-bind="args"
          v-model="byHex"
          label="固定 hex 色板"
          hint=""
          :swatches="HEX_SWATCHES"
        />
        <DtColorInput
          v-bind="args"
          v-model="none"
          label="不给色板"
          hint=""
          :swatches="[]"
        />
      </div>
    `,
  }),
}

/** 各种取值写法都收：hex、简写 hex、rgb()、颜色名、token。 */
export const 取值写法: Story = {
  render: (args) => ({
    components: { DtColorInput },
    setup: () => ({
      args,
      samples: [
        ['#00cefc', '标准 hex'],
        ['#0cf', '简写 hex'],
        ['rgb(20, 225, 68)', 'rgb()'],
        ['tomato', 'CSS 颜色名'],
        ['--state-warning', 'token 引用'],
        ['不是颜色', '⚠ 解析不出来：预览块空着，取色器回落到黑'],
      ],
    }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtColorInput
          v-for="[value, label] in samples"
          :key="value"
          v-bind="args"
          :model-value="value"
          :label="label"
          hint=""
          :swatches="[]"
        />
      </div>
    `,
  }),
}

/** 关掉文本框：只留取色块与色板，用于窄栏里的一列颜色。 */
export const 只留取色块: Story = {
  render: (args) => ({
    components: { DtColorInput },
    setup() {
      const rows = ref([
        { id: 'temp', name: '温度', color: '--state-danger' },
        { id: 'flow', name: '流量', color: '--accent-primary' },
        { id: 'press', name: '压力', color: '--state-warning' },
      ])
      return { args, rows, TOKEN_SWATCHES }
    },
    template: `
      <div class="sb-col sb-w-sm">
        <div v-for="row in rows" :key="row.id" class="sb-row" style="justify-content: space-between; width: 100%">
          <span class="sb-label">{{ row.name }}</span>
          <DtColorInput
            v-bind="args"
            v-model="row.color"
            :label="undefined"
            hint=""
            size="sm"
            :allow-text="false"
            :swatches="TOKEN_SWATCHES"
          />
        </div>
      </div>
    `,
  }),
}

/** 三档尺寸。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtColorInput },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtColorInput
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
          hint=""
          :swatches="[]"
        />
      </div>
    `,
  }),
}

/** 状态：必填、禁用、出错。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtColorInput },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtColorInput v-bind="args" label="必填" required model-value="" hint="" :swatches="[]" />
        <DtColorInput v-bind="args" label="禁用" disabled hint="" />
        <DtColorInput
          v-bind="args"
          label="出错"
          model-value="不是颜色"
          hint=""
          error="解析不出颜色，请给 #hex 或 --token"
          :swatches="[]"
        />
      </div>
    `,
  }),
}
