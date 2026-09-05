/**
 * @fileoverview data-table 的四套外观预设：密集矩阵、台账清单、大屏看板、前 N 名。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集比较、
 * 照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `precision` 与 `grouping` 两个键刻意一套都不写：它们摆在「数据」分段里，语义却是
 * 这块屏的数值口径（三位小数就是三位小数），一套观感把它们抹掉等于让用户配好的
 * 精度在换个样子时消失。
 * ⚠ `title` / `nameHeader` / `columns` / `rows` / `emptyText` / `rules` 六个内容键同理
 * 一个都不写：预设换的是观感，写了它们就会把用户配好的列与行整片抹掉。
 * ⚠ 截行的那一套要在 `hint` 里说清代价：`maxRows` 会让后面的行整片看不见，
 * 表下面虽有一句截断说明，但那一句本身也是要有人去读的。
 */
import type { ConfigPreset } from '@dt/contracts'

export const DATA_TABLE_PRESETS: ConfigPreset[] = [
  {
    id: 'dense-matrix',
    label: '密集矩阵',
    hint: '紧凑行高 + 斑马纹 + 钉住表头，十几台设备 × 五六列塞进一块中等大小的板子。',
    config: {
      density: 'compact',
      striped: true,
      showHeader: true,
      headerSticky: true,
      gridLines: 'horizontal',
      maxRows: 0,
      headSize: 11,
      nameSize: 12,
      valueSize: 13,
      nameTone: 'secondary',
      valueColor: '',
    },
  },
  {
    id: 'ledger',
    label: '台账清单',
    hint: '标准行高 + 横竖网格线，逐列读数的场合最清楚；不用斑马纹，靠线分格。',
    config: {
      density: 'normal',
      striped: false,
      showHeader: true,
      headerSticky: true,
      gridLines: 'both',
      maxRows: 0,
      headSize: 12,
      nameSize: 13,
      valueSize: 14,
      nameTone: 'primary',
      valueColor: '',
    },
  },
  {
    id: 'wall-board',
    label: '大屏看板',
    hint: '宽松行高 + 大号读数 + 不画线，远处看得清；行少的时候用它。',
    config: {
      density: 'loose',
      striped: true,
      showHeader: true,
      headerSticky: false,
      gridLines: 'none',
      maxRows: 0,
      headSize: 14,
      nameSize: 16,
      valueSize: 20,
      nameTone: 'title',
      valueColor: '',
    },
  },
  {
    id: 'top-ten',
    label: '前十行',
    hint: '紧凑 + 只画前 10 行：⚠ 第 11 行起在屏上看不见，只有表下面那一句截断说明会提到它们。',
    config: {
      density: 'compact',
      striped: true,
      showHeader: true,
      headerSticky: true,
      gridLines: 'horizontal',
      maxRows: 10,
      headSize: 11,
      nameSize: 12,
      valueSize: 13,
      nameTone: 'secondary',
      valueColor: '',
    },
  },
]
