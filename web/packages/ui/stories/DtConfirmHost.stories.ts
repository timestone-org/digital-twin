/**
 * @fileoverview DtConfirmHost 与 useConfirm 的展示：危险确认、普通确认、
 * 自定义按钮文案，以及「除确定外的所有关闭路径都 resolve 为 false」这条契约。
 */
import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtConfirmHost, DtNotice, useConfirm } from '../src'

const meta = {
  title: '反馈/DtConfirmHost 二次确认',
  component: DtConfirmHost,
  parameters: {
    docs: {
      description: {
        component:
          '删除、停用这类**不可逆或影响他人**的操作走它：`await useConfirm().ask({...})`。' +
          '宿主全应用挂一次（App.vue），业务侧只管 await。' +
          '⚠ 除「确定」外的所有关闭路径（取消、Esc、遮罩、关闭按钮）都 resolve 为 ' +
          '`false`：漏掉任何一条，调用方的 await 就永远挂着，删除流程静默停在半截。' +
          '⚠ 确认文案要写清**会发生什么、能不能撤销**——「确认删除？」等于没写。' +
          '⚠ 不许用 `window.confirm`：它是浏览器皮肤，也塞不下后果说明。',
      },
    },
  },
} satisfies Meta<typeof DtConfirmHost>

export default meta
type Story = StoryObj<typeof meta>

/** 危险操作：确认键转危险色。 */
export const 危险操作: Story = {
  render: () => ({
    components: { DtButton, DtConfirmHost, DtNotice },
    setup() {
      const { ask } = useConfirm()
      const result = ref('')
      async function remove(): Promise<void> {
        const confirmed = await ask({
          title: '删除采集通道 CH-04',
          message:
            '删除后该通道下的 16 个点位绑定会一并失效，已采集的历史数据保留。此操作不可撤销。',
          confirmText: '删除通道',
          danger: true,
        })
        result.value = confirmed ? '用户点了「删除通道」' : '用户放弃了'
      }
      return { remove, result }
    },
    template: `
      <div class="sb-col">
        <DtButton intent="danger" icon="trash" @click="remove">删除通道</DtButton>
        <DtNotice v-if="result" intent="neutral">{{ result }}</DtNotice>
        <DtConfirmHost />
      </div>
    `,
  }),
}

/** 普通确认：不开 `danger`，确认键是主色。 */
export const 普通确认: Story = {
  render: () => ({
    components: { DtButton, DtConfirmHost, DtNotice },
    setup() {
      const { ask } = useConfirm()
      const result = ref('')
      async function publish(): Promise<void> {
        const confirmed = await ask({
          title: '下发到边缘网关',
          message:
            '会把当前 12 处改动一次性下发到 EG-02，下发期间该网关的采集会暂停约 5 秒。',
          confirmText: '立即下发',
          cancelText: '再看看',
        })
        result.value = confirmed ? '已下发' : '已取消'
      }
      return { publish, result }
    },
    template: `
      <div class="sb-col">
        <DtButton icon="upload" @click="publish">下发配置</DtButton>
        <DtNotice v-if="result" intent="success">{{ result }}</DtNotice>
        <DtConfirmHost />
      </div>
    `,
  }),
}

/** 关闭路径：取消 / Esc / 点遮罩 / 右上角关闭，四条都 resolve 为 false。 */
export const 关闭路径: Story = {
  render: () => ({
    components: { DtButton, DtConfirmHost, DtNotice },
    setup() {
      const { ask } = useConfirm()
      const log = ref<string[]>([])
      async function tryIt(): Promise<void> {
        const confirmed = await ask({
          title: '试试各种关闭方式',
          message:
            '点「取消」、按 Esc、点遮罩、点右上角的关闭键——四条路径都会让 await 拿到 false。',
          confirmText: '确定（→ true）',
          cancelText: '取消（→ false）',
        })
        log.value = [`resolve 为 ${String(confirmed)}`, ...log.value].slice(
          0,
          6,
        )
      }
      return { tryIt, log }
    },
    template: `
      <div class="sb-col">
        <DtButton variant="outline" intent="neutral" @click="tryIt">弹一次</DtButton>
        <DtNotice v-for="(line, index) in log" :key="index" intent="neutral">{{ line }}</DtNotice>
        <DtConfirmHost />
      </div>
    `,
  }),
}

/** 连着弹两次：前一个还没结就被顶掉，并被判为「取消」。 */
export const 连续弹出: Story = {
  render: () => ({
    components: { DtButton, DtConfirmHost, DtNotice },
    setup() {
      const { ask } = useConfirm()
      const log = ref<string[]>([])
      function askTwice(): void {
        void ask({ title: '第一个', message: '这个会被下面那个顶掉。' }).then(
          (confirmed) => {
            log.value = [`第一个 → ${String(confirmed)}`, ...log.value]
          },
        )
        void ask({
          title: '第二个',
          message:
            '顶掉前一个之后弹出的就是它。前一个被判为取消，它的 await 不会挂着。',
        }).then((confirmed) => {
          log.value = [`第二个 → ${String(confirmed)}`, ...log.value]
        })
      }
      return { askTwice, log }
    },
    template: `
      <div class="sb-col">
        <DtButton variant="outline" intent="neutral" @click="askTwice">连着弹两次</DtButton>
        <DtNotice v-for="(line, index) in log" :key="index" intent="neutral">{{ line }}</DtNotice>
        <DtConfirmHost />
      </div>
    `,
  }),
}
