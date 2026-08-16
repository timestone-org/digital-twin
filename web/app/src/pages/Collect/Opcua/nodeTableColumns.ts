/**
 * @fileoverview 已导入节点表的列配置。
 * 「选择」列只在有改点位权限时出现：多选唯一的用途是批量开关记录历史，
 * 只读账号勾一堆点位却什么都做不了，反而会以为批量条没加载出来。
 */
import type { DtDataColumn } from '@dt/contracts'

/**
 * 按权限拼出列配置。
 * @param canManage 有没有改点位的权限
 */
export function nodeTableColumns(canManage: boolean): readonly DtDataColumn[] {
  return [
    ...(canManage
      ? [{ key: 'select', label: '', width: '2.5rem' } satisfies DtDataColumn]
      : []),
    { key: 'name', label: '名称', width: '10rem', card: 'title' },
    { key: 'code', label: '编码', width: '10rem' },
    { key: 'address', label: '寻址串' },
    { key: 'type', label: '类型', width: '5rem' },
    { key: 'unit', label: '单位', width: '4rem' },
    { key: 'value', label: '实时值', width: '13rem', card: 'meta' },
    { key: 'archive', label: '记录历史', width: '6rem' },
    {
      key: 'actions',
      label: '操作',
      align: 'right',
      width: '11rem',
      card: 'actions',
    },
  ]
}
