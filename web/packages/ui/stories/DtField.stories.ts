/**
 * @fileoverview DtField 的展示：表单字段的外壳（标签 / 提示 / 错误 / a11y 关联）。
 * 库里的输入类组件都套着它，这里单独摆出来是给「库里没有的控件」当模板用。
 */
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtField } from '../src'

const meta = {
  title: '表单/DtField 字段外壳',
  component: DtField,
  parameters: {
    docs: {
      description: {
        component:
          '只管标签、提示、错误与三者的无障碍关联，不管控件本身。' +
          '默认插槽拿到 `id` / `describedby` / `invalid`，由控件自己绑到元素上——' +
          '这样读屏才会在读出控件名称之后接着读提示或错误。' +
          '⚠ `error` 与 `hint` 同时给时只渲染 error：两条都挂上去的话，' +
          '`aria-describedby` 会指向一个没被渲染出来的节点，读屏读出一段空。' +
          'DtInput / DtSelect / DtTextarea 等已经套好了它，日常不必直接用。',
      },
    },
  },
  argTypes: {
    label: { control: 'text' },
    hint: { control: 'text', description: '常态提示；有 error 时让位' },
    error: { control: 'text', description: '错误文案，非空即进入错误态' },
    required: { control: 'boolean', description: '标签后加必填标记' },
    size: { control: 'inline-radio', options: DT_SIZES },
  },
  args: {
    label: '采样周期',
    hint: '留空表示跟随通道默认值',
    required: false,
    size: 'md',
  },
} satisfies Meta<typeof DtField>

export default meta
type Story = StoryObj<typeof meta>

/** 默认插槽里放什么都行，这里放一个原生 `<input>` 演示三个插槽参数怎么用。 */
export const 演练场: Story = {
  render: (args) => ({
    components: { DtField },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-md">
        <DtField v-bind="args">
          <template #default="{ id, describedby, invalid }">
            <input
              :id="id"
              class="sb-w-full"
              :aria-describedby="describedby"
              :aria-invalid="invalid"
              placeholder="例如 1000"
            />
          </template>
        </DtField>
      </div>
    `,
  }),
}

/** 常态 / 必填 / 出错三种，出错时 hint 让位给 error。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtField },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid">
        <DtField v-bind="args">
          <template #default="{ id, describedby }">
            <input :id="id" class="sb-w-full" :aria-describedby="describedby" />
          </template>
        </DtField>
        <DtField v-bind="args" required>
          <template #default="{ id, describedby }">
            <input :id="id" class="sb-w-full" :aria-describedby="describedby" />
          </template>
        </DtField>
        <DtField v-bind="args" required error="必须是 100–60000 之间的整数">
          <template #default="{ id, describedby, invalid }">
            <input
              :id="id"
              class="sb-w-full"
              value="0"
              :aria-describedby="describedby"
              :aria-invalid="invalid"
            />
          </template>
        </DtField>
      </div>
    `,
  }),
}

/** 三档尺寸只影响标签与提示的字号，控件自己的高度由控件决定。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtField },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-grid">
        <DtField v-for="size in sizes" :key="size" v-bind="args" :size="size" :label="'size = ' + size">
          <template #default="{ id, describedby }">
            <input :id="id" class="sb-w-full" :aria-describedby="describedby" />
          </template>
        </DtField>
      </div>
    `,
  }),
}

/** 不给 label 也成立：外壳退化成「只有提示或错误」，控件仍拿得到 id。 */
export const 无标签: Story = {
  args: { label: undefined },
  render: (args) => ({
    components: { DtField },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-md">
        <DtField v-bind="args" hint="没有可见标签时，控件自己要有 aria-label">
          <template #default="{ id, describedby }">
            <input :id="id" class="sb-w-full" aria-label="采样周期" :aria-describedby="describedby" />
          </template>
        </DtField>
      </div>
    `,
  }),
}
