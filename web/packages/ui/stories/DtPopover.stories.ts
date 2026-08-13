/**
 * @fileoverview DtPopover 的展示：非受控 / 受控两种用法、方向 × 对齐矩阵、
 * 触发器插槽拿到的那几个参数，以及面板里放可聚焦内容。
 */
import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DT_OVERLAY_SIDES, DtButton, DtInput, DtPopover } from '../src'

const ALIGNS = ['start', 'center', 'end'] as const

const meta = {
  title: '浮层/DtPopover 浮层原语',
  component: DtPopover,
  parameters: {
    docs: {
      description: {
        component:
          '点击展开的锚定浮层原语，DtDropdownMenu 与 DtHelpTip 都建在它上面。' +
          '默认插槽是触发器，拿到 `toggle` / `open` / `close` / `isOpen` / `panelId`；' +
          '`content` 插槽是面板内容，拿到 `close`。' +
          '开合可以自己管（不传 `open`），也可以受控（传 `open` 并接 `update:open`）。' +
          '⚠ `open` 的缺省值必须是 `undefined` 而不是 `false`：Boolean 型 prop 缺省会被 ' +
          'Vue 强制成 `false`，那样「没传 open」和「传了 false」就分不开，受控判定永远为真。' +
          '打开时焦点进入面板，关闭时还给触发器——不还的话焦点会掉回 body，Tab 从头开始。',
      },
    },
  },
  argTypes: {
    open: { control: 'boolean', description: '受控开合；不传就由组件自己管' },
    side: { control: 'inline-radio', options: DT_OVERLAY_SIDES },
    align: { control: 'inline-radio', options: ALIGNS },
    disabled: { control: 'boolean' },
  },
  args: { side: 'bottom', align: 'center', disabled: false },
} satisfies Meta<typeof DtPopover>

export default meta
type Story = StoryObj<typeof meta>

/** 非受控：开合由组件自己管，点外面 / 按 Esc 都会收起。 */
export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton, DtPopover },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <DtPopover v-bind="args" :open="undefined">
          <template #default="{ toggle, isOpen }">
            <DtButton variant="outline" intent="neutral" @click="toggle">
              {{ isOpen ? '收起' : '展开' }}面板
            </DtButton>
          </template>
          <template #content="{ close }">
            <div class="sb-col" style="min-width: 220px">
              <p class="sb-label">面板内容，可以放任何东西。</p>
              <DtButton size="sm" variant="ghost" intent="neutral" @click="close">关掉</DtButton>
            </div>
          </template>
        </DtPopover>
      </div>
    `,
  }),
}

/** 方向 × 对齐：四方向各三种对齐。 */
export const 方向与对齐: Story = {
  render: (args) => ({
    components: { DtButton, DtPopover },
    setup: () => ({ args, sides: DT_OVERLAY_SIDES, aligns: ALIGNS }),
    template: `
      <div class="sb-col">
        <div v-for="side in sides" :key="side" class="sb-group">
          <p class="sb-group__title">side = {{ side }}</p>
          <div class="sb-row">
            <DtPopover
              v-for="align in aligns"
              :key="align"
              v-bind="args"
              :open="undefined"
              :side="side"
              :align="align"
            >
              <template #default="{ toggle }">
                <DtButton size="sm" variant="outline" intent="neutral" @click="toggle">
                  {{ align }}
                </DtButton>
              </template>
              <template #content>
                <div style="min-width: 160px">
                  <p class="sb-label">side={{ side }} align={{ align }}</p>
                </div>
              </template>
            </DtPopover>
          </div>
        </div>
      </div>
    `,
  }),
}

/** 受控：开合状态由父组件持有，浮层只负责通知。 */
export const 受控: Story = {
  render: (args) => ({
    components: { DtButton, DtPopover },
    setup() {
      const open = ref(false)
      return { args, open }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtButton size="sm" variant="outline" intent="neutral" @click="open = true">从外面打开</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="open = false">从外面关掉</DtButton>
          <span class="sb-label">open = {{ open }}</span>
        </div>
        <div class="sb-stage">
          <DtPopover v-bind="args" :open="open" @update:open="open = $event">
            <template #default="{ toggle }">
              <DtButton variant="outline" intent="neutral" @click="toggle">受控触发器</DtButton>
            </template>
            <template #content="{ close }">
              <div class="sb-col" style="min-width: 240px">
                <p class="sb-label">
                  点外面、按 Esc 也会走同一条关闭路径，父组件的 open 会被回写。
                </p>
                <DtButton size="sm" variant="ghost" intent="neutral" @click="close">关闭</DtButton>
              </div>
            </template>
          </DtPopover>
        </div>
      </div>
    `,
  }),
}

/** 面板里放可聚焦内容：打开时焦点会落到第一个可聚焦元素上。 */
export const 面板里的表单: Story = {
  render: (args) => ({
    components: { DtButton, DtInput, DtPopover },
    setup() {
      const keyword = ref('')
      const applied = ref('')
      return { args, keyword, applied }
    },
    template: `
      <div class="sb-col">
        <div class="sb-stage">
          <DtPopover v-bind="args" :open="undefined">
            <template #default="{ toggle }">
              <DtButton variant="outline" intent="neutral" icon="search" @click="toggle">
                快速筛选
              </DtButton>
            </template>
            <template #content="{ close }">
              <div class="sb-col" style="min-width: 260px">
                <DtInput v-model="keyword" label="按名称筛选" size="sm" />
                <div class="sb-row">
                  <DtButton size="sm" @click="applied = keyword; close()">应用</DtButton>
                  <DtButton size="sm" variant="ghost" intent="neutral" @click="close">取消</DtButton>
                </div>
              </div>
            </template>
          </DtPopover>
        </div>
        <p class="sb-note">已应用的筛选：{{ applied || '（无）' }}</p>
      </div>
    `,
  }),
}

/** 禁用：触发器点不开。 */
export const 禁用: Story = {
  args: { disabled: true },
  render: (args) => ({
    components: { DtButton, DtPopover },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <DtPopover v-bind="args" :open="undefined">
          <template #default="{ toggle }">
            <DtButton variant="outline" intent="neutral" disabled @click="toggle">点不开</DtButton>
          </template>
          <template #content>
            <p class="sb-label">看不到我。</p>
          </template>
        </DtPopover>
      </div>
    `,
  }),
}
