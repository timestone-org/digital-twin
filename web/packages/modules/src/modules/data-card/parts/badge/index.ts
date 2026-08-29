/**
 * @fileoverview 状态徽标部件：读 `state` 槽，画成一个圆点加一段文案。
 * ⚠ 归一化与配色整件走 `shared/status.ts` + `StatusBadge.vue`，与列表族同一份——
 * 各认一套「1 是不是运行」的话，同一台设备在两个模块里会是两种颜色。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'badge',
  label: '状态徽标',
  icon: 'activity',
  hint: '按 `state` 槽画运行 / 待机 / 报警 / 离线。没接这一槽时画「未知」，不隐藏——设备状态位空着本身就要看得见。',
  slots: ['state'],
  fields: [
    {
      key: 'style',
      label: '样式',
      type: 'enum',
      default: 'outline',
      span: 'half',
      options: [
        { value: 'outline', label: '描边' },
        { value: 'solid', label: '实心' },
        { value: 'dot', label: '只留圆点' },
      ],
    },
    {
      key: 'text',
      label: '覆盖文案',
      type: 'string',
      default: '',
      span: 'half',
      placeholder: '留空则按状态显示',
      help: '填了就固定显示这段字，圆点仍随状态变色。',
    },
  ],
  component: () => import('./Badge.vue'),
})
