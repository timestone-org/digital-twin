/**
 * @fileoverview DtButton 的展示：variant × intent 两条正交轴，加统一 size，
 * 以及加载 / 禁用 / 图标位 / 块级这几个会改变外观的开关。
 */
import { DT_BUTTON_VARIANTS, DT_INTENTS, DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton } from '../src'

const meta = {
  title: '通用/DtButton 按钮',
  component: DtButton,
  parameters: {
    docs: {
      description: {
        component:
          '按钮有两条正交的轴：`variant` 决定填充方式（实心 / 柔和 / 幽灵 / 描边），' +
          '`intent` 决定语义色。两者随意组合，尺寸另有统一的三档。' +
          '`loading` 会自动禁用按钮并内建 spinner，不必再自己加 `disabled`。',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: DT_BUTTON_VARIANTS,
      description: '填充方式：实心 / 柔和 / 幽灵 / 描边',
    },
    intent: {
      control: 'inline-radio',
      options: DT_INTENTS,
      description: '语义色：主色 / 成功 / 警告 / 危险 / 信息 / 中性',
    },
    size: {
      control: 'inline-radio',
      options: DT_SIZES,
      description: '控件三档尺寸，与其它表单控件同高',
    },
    type: {
      control: 'inline-radio',
      options: ['button', 'submit', 'reset'],
      description: '原生 type。表单里要提交的按钮必须写 submit',
    },
    disabled: { control: 'boolean', description: '禁用' },
    loading: { control: 'boolean', description: '加载中，自动连带禁用' },
    block: { control: 'boolean', description: '铺满父容器宽度' },
    icon: {
      control: 'text',
      description: '文字前的图标名（须已在注册表登记）',
    },
    iconRight: { control: 'text', description: '文字后的图标名' },
  },
  args: {
    variant: 'solid',
    intent: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
  },
} satisfies Meta<typeof DtButton>

export default meta
type Story = StoryObj<typeof meta>

/** 右侧面板可以逐项改，改完的样子就是页面里的样子。 */
export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args }),
    template: `<DtButton v-bind="args">保存配置</DtButton>`,
  }),
}

/** 四种填充 × 六种语义色的全矩阵：任何一格都可以直接用。 */
export const 变体与语义色: Story = {
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args, variants: DT_BUTTON_VARIANTS, intents: DT_INTENTS }),
    template: `
      <div class="sb-col">
        <div v-for="variant in variants" :key="variant" class="sb-group">
          <p class="sb-group__title">variant = {{ variant }}</p>
          <div class="sb-row">
            <DtButton
              v-for="intent in intents"
              :key="intent"
              v-bind="args"
              :variant="variant"
              :intent="intent"
            >{{ intent }}</DtButton>
          </div>
        </div>
      </div>
    `,
  }),
}

/** 三档尺寸。同一档与 DtInput / DtSelect 等高，摆在一行不会参差。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-row">
        <DtButton v-for="size in sizes" :key="size" v-bind="args" :size="size">
          {{ size }} 档
        </DtButton>
      </div>
    `,
  }),
}

/** 图标可以在文字前、文字后，或者只有图标。 */
export const 带图标: Story = {
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <div class="sb-group">
          <p class="sb-group__title">文字前 / 文字后</p>
          <div class="sb-row">
            <DtButton v-bind="args" icon="plus">新建</DtButton>
            <DtButton v-bind="args" variant="outline" icon-right="arrow-right">
              下一步
            </DtButton>
            <DtButton v-bind="args" variant="soft" icon="upload" icon-right="check">
              上传并校验
            </DtButton>
          </div>
        </div>
        <div class="sb-group">
          <p class="sb-group__title">
            只有图标 —— 会压成正方形，必须给 aria-label
          </p>
          <div class="sb-row">
            <DtButton v-bind="args" icon="pencil" aria-label="编辑" />
            <DtButton v-bind="args" variant="ghost" icon="trash" intent="danger" aria-label="删除" />
            <DtButton v-bind="args" variant="outline" icon="settings" intent="neutral" aria-label="设置" />
            <DtButton v-bind="args" variant="soft" icon="search" aria-label="搜索" />
          </div>
        </div>
      </div>
    `,
  }),
}

/** loading 期间按钮不可点，spinner 顶掉前置图标的位置，宽度不跳。 */
export const 加载中: Story = {
  args: { loading: true },
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args, variants: DT_BUTTON_VARIANTS }),
    template: `
      <div class="sb-row">
        <DtButton
          v-for="variant in variants"
          :key="variant"
          v-bind="args"
          :variant="variant"
          icon="upload"
        >提交中</DtButton>
      </div>
    `,
  }),
}

/** 禁用态：四种填充各自都要看得出「点不动」，而不是只靠变浅。 */
export const 禁用: Story = {
  args: { disabled: true },
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args, variants: DT_BUTTON_VARIANTS }),
    template: `
      <div class="sb-row">
        <DtButton
          v-for="variant in variants"
          :key="variant"
          v-bind="args"
          :variant="variant"
        >{{ variant }}</DtButton>
      </div>
    `,
  }),
}

/** 块级：铺满父容器，用于窄栏与弹窗底部的单个主操作。 */
export const 块级铺满: Story = {
  args: { block: true },
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-sm">
        <DtButton v-bind="args">登录</DtButton>
        <DtButton v-bind="args" variant="ghost" intent="neutral">取消</DtButton>
      </div>
    `,
  }),
}

/** leading / trailing 插槽塞任意标记，用于状态点、快捷键提示这类图标画不出来的东西。 */
export const 前后插槽: Story = {
  render: (args) => ({
    components: { DtButton },
    setup: () => ({ args }),
    template: `
      <div class="sb-row">
        <DtButton v-bind="args" variant="outline" intent="neutral">
          <template #leading><span aria-hidden="true">●</span></template>
          在线
        </DtButton>
        <DtButton v-bind="args" variant="ghost" intent="neutral">
          搜索
          <template #trailing><span class="sb-label">Ctrl K</span></template>
        </DtButton>
      </div>
    `,
  }),
}
