/**
 * @fileoverview 运行参数的档位/危险方向文案与危险判定。
 *
 * ⚠ 危险判定与后端 `is_dangerous_change` 同口径：危险性挂在**变更方向**上，
 * 安全方向不弹确认——每次都弹，用户会训练出无脑点确认的肌肉记忆。
 */

/** 用户必须原样输入的确认词。取一个不会下意识打出来的短句。 */
export const CONFIRM_WORD = '我已确认'

/** 生效档位的徽标文案。三档必须彼此可区分。 */
export const TIER_TEXT: Record<string, { label: string; title: string }> = {
  instant: {
    label: '即时生效',
    title:
      '不必重启进程；多快取决于消费它的那条循环的节拍（采集/归档随采集计划下发，最迟半分钟）',
  },
  reconnect: {
    label: '下次重连生效',
    title: '已建立的设备会话继续用旧值；对某台设备断开再连接即可立刻换新值',
  },
  restart: { label: '需重启进程', title: '本项在进程启动时读取一次' },
}

/**
 * 危险方向的确认提示。
 * ⚠ `on` 与 `off` 是**相反**的两侧，同为开关不等于同一个方向：采集类开关关掉
 * 才危险，清理类开关打开才危险。少一条的表现是那一项静默不弹确认，且提示语
 * 渲染成 `undefined`。
 */
export const DANGER_TEXT: Record<string, string> = {
  off: '关掉它之后完全没有报错，只是从此不再做这件事，没有任何告警会响。',
  on: '打开它之后会开始真实删除数据，删掉的行找不回来。',
  decrease: '调小它意味着更多数据会被丢掉或删掉，且不可恢复。',
}

/**
 * 这次改动是否落在该项的危险方向上。
 * @param danger 登记的危险方向
 * @param from 改动前的有效值
 * @param next 要写入的值
 */
export function isDangerousChange(
  danger: string | null,
  from: number | boolean,
  next: number | boolean,
): boolean {
  if (from === next) return false
  if (danger === 'off') return Boolean(from) && !next
  if (danger === 'on') return !from && Boolean(next)
  if (danger === 'decrease') return Number(next) < Number(from)
  return false
}
