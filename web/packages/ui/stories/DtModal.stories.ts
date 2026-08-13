/**
 * @fileoverview DtModal 的展示：基本开合、宽度、遮罩关闭开关、页脚与表单弹窗。
 * 焦点三条硬要求（进得去、跑不出、关了还回来）在组件里，story 里可以直接按 Tab 验。
 */
import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect } from '../src'

const meta = {
  title: '反馈/DtModal 对话框',
  component: DtModal,
  parameters: {
    docs: {
      description: {
        component:
          '对话框，`v-model` 收布尔值。Teleport 到 body，自带焦点陷阱与 Esc 关闭。' +
          '⚠ 三条无障碍硬要求：打开时焦点进入弹窗、Tab 不许跑出去、关闭后焦点归还' +
          '触发元素。少任何一条，键盘用户都会在弹窗打开后「焦点消失」。' +
          '组件在自己被卸载（路由切走）时也会把焦点还回去。' +
          '删除、停用这类二次确认不要自己摆弹窗，用 `useConfirm().ask()`。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text', description: '标题下的一行说明' },
    width: { control: 'text', description: '面板宽度，任意 CSS 长度' },
    closeOnBackdrop: { control: 'boolean', description: '点遮罩是否关闭' },
  },
  args: {
    modelValue: false,
    title: '编辑采集通道',
    description: '改动会在下一个采集周期生效',
    width: '30rem',
    closeOnBackdrop: true,
  },
} satisfies Meta<typeof DtModal>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton, DtModal },
    setup() {
      const open = ref(false)
      return { args, open }
    },
    template: `
      <div>
        <DtButton @click="open = true">打开对话框</DtButton>
        <DtModal v-bind="args" v-model="open">
          <p class="sb-label">
            弹窗正文。试着按 Tab：焦点只会在弹窗内部转圈；按 Esc 关闭后，
            焦点会回到刚才那个按钮上。
          </p>
        </DtModal>
      </div>
    `,
  }),
}

/** 页脚：主次操作放这里，主操作在右。 */
export const 页脚操作: Story = {
  render: (args) => ({
    components: { DtButton, DtModal },
    setup() {
      const open = ref(false)
      const result = ref('')
      return { args, open, result }
    },
    template: `
      <div class="sb-col">
        <DtButton @click="open = true">打开</DtButton>
        <p class="sb-note">上一次结果：{{ result || '（还没有）' }}</p>
        <DtModal v-bind="args" v-model="open" title="保存改动">
          <p class="sb-label">有 3 处改动尚未保存，是否立即下发到边缘网关？</p>
          <template #footer>
            <DtButton variant="ghost" intent="neutral" @click="open = false; result = '取消'">
              取消
            </DtButton>
            <DtButton @click="open = false; result = '已保存'">保存并下发</DtButton>
          </template>
        </DtModal>
      </div>
    `,
  }),
}

/** 宽度：任意 CSS 长度。表单弹窗通常 30–40rem，日志类可以更宽。 */
export const 宽度: Story = {
  render: (args) => ({
    components: { DtButton, DtModal },
    setup() {
      const width = ref('')
      const widths = ['22rem', '30rem', '48rem', '80vw']
      return { args, width, widths }
    },
    template: `
      <div class="sb-row">
        <DtButton v-for="w in widths" :key="w" variant="outline" intent="neutral" @click="width = w">
          {{ w }}
        </DtButton>
        <DtModal
          v-bind="args"
          :model-value="width !== ''"
          :width="width || '30rem'"
          :title="'width = ' + width"
          @update:model-value="width = ''"
        >
          <p class="sb-label">面板宽度由 width 决定，高度永远跟着内容走。</p>
        </DtModal>
      </div>
    `,
  }),
}

/** 点遮罩关不关：填了半天表单的弹窗建议关掉，免得手滑一点全没了。 */
export const 遮罩关闭: Story = {
  render: (args) => ({
    components: { DtButton, DtModal },
    setup() {
      const a = ref(false)
      const b = ref(false)
      return { args, a, b }
    },
    template: `
      <div class="sb-row">
        <DtButton variant="outline" intent="neutral" @click="a = true">点遮罩可关（缺省）</DtButton>
        <DtButton variant="outline" intent="neutral" @click="b = true">点遮罩不关</DtButton>
        <DtModal v-bind="args" v-model="a" title="点遮罩可关">
          <p class="sb-label">点弹窗外面就关了。</p>
        </DtModal>
        <DtModal v-bind="args" v-model="b" title="点遮罩不关" :close-on-backdrop="false">
          <p class="sb-label">只能按 Esc 或右上角的关闭按钮。</p>
        </DtModal>
      </div>
    `,
  }),
}

/** 表单弹窗：里面的下拉浮层会挂进弹窗面板，不会跑到焦点陷阱外面。 */
export const 表单弹窗: Story = {
  render: (args) => ({
    components: { DtButton, DtInput, DtModal, DtNotice, DtSelect },
    setup() {
      const open = ref(false)
      const name = ref('1 号进料泵')
      const protocol = ref('opcua')
      const options = [
        { value: 'opcua', label: 'OPC UA' },
        { value: 'modbus', label: 'Modbus TCP' },
        { value: 'mqtt', label: 'MQTT' },
      ]
      return { args, open, name, protocol, options }
    },
    template: `
      <div>
        <DtButton icon="pencil" @click="open = true">编辑通道</DtButton>
        <DtModal v-bind="args" v-model="open" width="34rem">
          <div class="sb-col sb-w-full">
            <DtNotice intent="info">通道名在同一条产线内不可重名。</DtNotice>
            <DtInput v-model="name" label="通道名称" required class="sb-w-full" />
            <DtSelect
              v-model="protocol"
              label="采集协议"
              :options="options"
              hint="⚠ 下拉浮层会挂进弹窗面板，不会掉出焦点陷阱"
            />
          </div>
          <template #footer>
            <DtButton variant="ghost" intent="neutral" @click="open = false">取消</DtButton>
            <DtButton @click="open = false">保存</DtButton>
          </template>
        </DtModal>
      </div>
    `,
  }),
}

/** 长内容：正文自己滚，头部与页脚钉住。 */
export const 长内容: Story = {
  render: (args) => ({
    components: { DtButton, DtModal },
    setup() {
      const open = ref(false)
      const lines = Array.from(
        { length: 40 },
        (_unused, i) =>
          `${String(i + 1).padStart(3, '0')} · 采集通道心跳正常，时延 ${10 + i} ms`,
      )
      return { args, open, lines }
    },
    template: `
      <div>
        <DtButton @click="open = true">查看运行日志</DtButton>
        <DtModal v-bind="args" v-model="open" title="运行日志" width="46rem">
          <p v-for="line in lines" :key="line" class="sb-note">{{ line }}</p>
          <template #footer>
            <DtButton variant="ghost" intent="neutral" @click="open = false">关闭</DtButton>
          </template>
        </DtModal>
      </div>
    `,
  }),
}
