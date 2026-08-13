/**
 * @fileoverview DtTextarea 的展示：自适应高度、等宽字形、剩余字数与四种状态。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtTextarea } from '../src'

const SAMPLE_JSON = `{
  "channel": "CH-07",
  "interval_ms": 1000,
  "nodes": ["ns=2;s=Line1.Pump.Speed"]
}`

const meta = {
  title: '表单/DtTextarea 多行文本',
  component: DtTextarea,
  parameters: {
    docs: {
      description: {
        component:
          '多行文本输入，`v-model` 收字符串，外壳复用 DtField。' +
          '`rows` / `placeholder` / `readonly` 这些原生属性经 `$attrs` 直落 textarea。' +
          '`autosize` 开着时高度跟着内容长，同时去掉手动拖拽把手；' +
          '`maxlength` 给了就显示剩余字数，剩 10 个字以内才播报给读屏——' +
          '每敲一个字朗读一个数字比不播报更难用。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
    maxlength: { control: 'number', description: '给了才显示剩余字数' },
    autosize: { control: 'boolean', description: '高度随内容长' },
    mono: { control: 'boolean', description: '等宽字形，JSON / 表达式用' },
  },
  args: {
    modelValue: '',
    label: '备注',
    size: 'md',
    disabled: false,
    required: false,
    autosize: false,
    mono: false,
  },
} satisfies Meta<typeof DtTextarea>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtTextarea },
    setup() {
      const value = ref('')
      return { args, value }
    },
    template: `
      <div class="sb-w-md">
        <DtTextarea v-bind="args" v-model="value" :rows="4" placeholder="写点什么…" />
      </div>
    `,
  }),
}

/** 自适应高度：一直敲，框会跟着长；关掉后回到 `rows` 说了算。 */
export const 自适应高度: Story = {
  render: (args) => ({
    components: { DtTextarea },
    setup() {
      const grow = ref('这一栏开了 autosize，\n多敲几行试试。')
      const fixed = ref('这一栏没开，\n超出部分自己滚。')
      return { args, grow, fixed }
    },
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtTextarea v-bind="args" v-model="grow" label="autosize 开" autosize :rows="2" />
        <DtTextarea v-bind="args" v-model="fixed" label="autosize 关（rows=2）" :rows="2" />
      </div>
    `,
  }),
}

/** 等宽：JSON、表达式、日志这类要对齐缩进的内容必须开。 */
export const 等宽字形: Story = {
  render: (args) => ({
    components: { DtTextarea },
    setup() {
      const value = ref(SAMPLE_JSON)
      return { args, value }
    },
    template: `
      <div class="sb-w-lg">
        <DtTextarea
          v-bind="args"
          v-model="value"
          label="通道配置"
          hint="缩进对不齐就说明没开 mono"
          mono
          autosize
        />
      </div>
    `,
  }),
}

/** 字数上限：右下角显示剩余，超长时截到 0 而不是露出负数。 */
export const 字数上限: Story = {
  render: (args) => ({
    components: { DtTextarea },
    setup() {
      const short = ref('还剩很多')
      const almost = ref('这一栏只剩几个字了，注意右下角')
      return { args, short, almost }
    },
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtTextarea v-bind="args" v-model="short" label="上限 200" :maxlength="200" :rows="3" />
        <DtTextarea v-bind="args" v-model="almost" label="上限 30（快满了）" :maxlength="30" :rows="3" />
      </div>
    `,
  }),
}

/** 三档尺寸只改字号与内边距，行数仍由 `rows` 决定。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtTextarea },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtTextarea
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
          model-value="示例文本"
          :rows="3"
        />
      </div>
    `,
  }),
}

/** 状态：必填、只读、禁用、出错。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtTextarea },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtTextarea v-bind="args" label="必填" required :rows="3" model-value="" />
        <DtTextarea v-bind="args" label="只读" readonly :rows="3" model-value="只读但可复制" />
        <DtTextarea v-bind="args" label="禁用" disabled :rows="3" model-value="不可编辑" />
        <DtTextarea
          v-bind="args"
          label="出错"
          :rows="3"
          model-value="{ 不合法的 JSON"
          error="解析失败：第 1 行缺少引号"
        />
      </div>
    `,
  }),
}
