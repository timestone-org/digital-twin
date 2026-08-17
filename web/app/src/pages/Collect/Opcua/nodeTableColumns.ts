/**
 * @fileoverview 已导入节点表的列配置。
 * 「选择」列只在有改点位权限时出现：多选唯一的用途是批量开关记录历史，
 * 只读账号勾一堆点位却什么都做不了，反而会以为批量条没加载出来。
 */
import type { DtDataColumn } from '@dt/contracts'

/**
 * 按权限拼出列配置。
 *
 * ⚠ 只有「寻址串」一列不写宽度，这是有意的：表格开着 `fixedLayout`，没写宽度
 * 的列平分剩余空间，只留它一列不写，剩余空间就全归它。寻址串是这张表里唯一
 * 长到读不完的字段（`ns=2;s=DLS01.IFIX.Server.Tags.Analog Input.….Value.F_CV`
 * 要 556px 才摆得下），给固定宽度等于永远截在同一个位置。
 * ⚠ 再给任何一列去掉宽度，寻址串就要跟它对半分——这条约束由
 * tests/pages/Collect/nodeTableColumns.test.ts 守着。
 * @param canManage 有没有改点位的权限
 */
export function nodeTableColumns(canManage: boolean): readonly DtDataColumn[] {
  return [
    ...(canManage
      ? [{ key: 'select', label: '', width: '2.5rem' } satisfies DtDataColumn]
      : []),
    { key: 'name', label: '名称', width: '9rem', card: 'title' },
    // 13rem 是量出来的：`K01_START_TIME_FORECAST` 这类 23 字符编码在 12rem 上
    // 还差 8px，会被徽标截掉尾巴
    { key: 'code', label: '编码', width: '13rem' },
    { key: 'address', label: '寻址串' },
    { key: 'type', label: '类型', width: '4.5rem' },
    { key: 'unit', label: '单位', width: '3.5rem' },
    { key: 'value', label: '实时值', width: '9rem', card: 'meta' },
    { key: 'archive', label: '记录历史', width: '5rem' },
    {
      key: 'actions',
      label: '操作',
      align: 'right',
      width: '9rem',
      card: 'actions',
    },
  ]
}
