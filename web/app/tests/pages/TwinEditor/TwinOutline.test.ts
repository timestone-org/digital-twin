/**
 * @fileoverview 大纲树的整树契约：场景区 + 六个实体分组（夹视图与散行）、搜索
 * （高亮/计数/不污染折叠态）、菜单动作分发、拖行入夹，以及删除的口径——有连带
 * 影响才就地二次确认，没有就直接删靠撤销兜底。
 * ⚠ 视点没有 visibility 所以那一行不许出显隐键，行序号恒为文档序（数组绑定按它对齐）。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinConfig } from '@dt/twin-config'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import TwinOutline from '@/pages/TwinEditor/components/TwinOutline.vue'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

function makeConfig(over: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    parts: [{ id: 'p1', name: '主机', nodes: ['n1'] }],
    anchors: [
      { id: 'a1', name: '进水温度' },
      { id: 'a2', name: '回水温度' },
      { id: 'a3', name: '流量' },
    ],
    cameras: [{ id: 'c1', name: '全景' }],
    viewpoints: { items: ['c1'] },
    panels: [{ id: 'pl1', name: '牌一', anchorId: 'a1', fields: [] }],
    arrows: [{ id: 'ar1', name: '流向' }],
    flows: [{ id: 'fl1', name: '蒸汽', pathAnchors: ['a1', 'a2'] }],
    folders: [
      { id: 'f1', kind: 'anchors', name: '温度组', itemIds: ['a1', 'a2'] },
      { id: 'f2', kind: 'anchors', name: '备用组', itemIds: [] },
    ],
    ...over,
  })
}

function mountOutline(
  config: TwinConfig = makeConfig(),
  selection: TwinSelection | null = null,
  flaggedIds: ReadonlySet<string> = new Set<string>(),
) {
  return mount(TwinOutline, {
    props: { config, selection, flaggedIds },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof mountOutline>

function rowOf(wrapper: Wrapper, id: string) {
  const row = wrapper
    .findAll('[data-test="outline-row"]')
    .find((item) => item.attributes('data-id') === id)
  if (row === undefined) throw new Error(`缺少行 ${id}`)
  return row
}

function sectionOf(wrapper: Wrapper, kind: string) {
  return wrapper.get(`[data-test="outline-section"][data-key="${kind}"]`)
}

function folderOf(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-test="outline-folder"][data-id="${id}"]`)
}

async function search(wrapper: Wrapper, query: string): Promise<void> {
  await wrapper.get('[data-test="outline-search"] input').setValue(query)
}

async function openMenuAt(trigger: ReturnType<Wrapper['get']>): Promise<void> {
  await trigger.trigger('click')
  await flushPromises()
}

function menuItem(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.includes(label) === true,
  )
}

async function clickMenu(
  trigger: ReturnType<Wrapper['get']>,
  label: string,
): Promise<void> {
  await openMenuAt(trigger)
  const item = menuItem(label)
  if (item === undefined) throw new Error(`菜单里没有「${label}」`)
  item.click()
  await flushPromises()
}

/** 行外那层拖拽壳。 */
function dragWrapOf(wrapper: Wrapper, id: string) {
  const host = rowOf(wrapper, id).element.parentElement
  if (host === null) throw new Error(`行 ${id} 外没有拖拽壳`)
  return new DOMWrapper(host)
}

/** 夹的整块落区（夹头 + 夹内行的容器）。 */
function folderZoneOf(wrapper: Wrapper, id: string) {
  const host = folderOf(wrapper, id).element.parentElement
  if (host === null) throw new Error(`夹 ${id} 外没有落区`)
  return new DOMWrapper(host)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('渲染', () => {
  it('实体段各成一节带 data-key，「场景」区三行带自己的 data-key', () => {
    const wrapper = mountOutline()

    expect(
      wrapper
        .findAll('[data-test="outline-section"]')
        .map((item) => item.attributes('data-key')),
    ).toEqual(['parts', 'anchors', 'cameras', 'panels', 'arrows', 'flows'])
    expect(
      wrapper
        .findAll('[data-test="outline-single"]')
        .map((item) => item.attributes('data-key')),
    ).toEqual(['model', 'viewpoints', 'roam'])
  })

  it('夹在前散行在后，夹内行按文档序', () => {
    const wrapper = mountOutline()
    const anchorRows = wrapper
      .findAll('[data-test="outline-row"]')
      .map((item) => item.attributes('data-id'))
      .filter((id) => ['a1', 'a2', 'a3'].includes(id ?? ''))

    expect(anchorRows).toEqual(['a1', 'a2', 'a3'])
    expect(
      wrapper.find('[data-test="outline-folder"][data-id="f1"]').exists(),
    ).toBe(true)
  })

  it('每一行标出文档序号，夹内也不重排', () => {
    expect(rowOf(mountOutline(), 'a2').text()).toContain('2')
    expect(rowOf(mountOutline(), 'a3').text()).toContain('3')
  })

  it('名字空着的行显示 id，不留白', () => {
    const config = makeConfig({
      anchors: [{ id: 'a1', name: '' }],
      folders: [],
    })

    expect(rowOf(mountOutline(config), 'a1').text()).toContain('a1')
  })

  it('组标题上带条数，夹内的也算', () => {
    expect(
      sectionOf(mountOutline(), 'anchors')
        .get('[data-test="section-count"]')
        .text(),
    ).toBe('3')
  })

  it('夹头带成员数，空夹写「空」', () => {
    const wrapper = mountOutline()

    expect(
      folderOf(wrapper, 'f1').get('[data-test="folder-count"]').text(),
    ).toBe('2')
    expect(
      folderOf(wrapper, 'f2').get('[data-test="folder-count"]').text(),
    ).toBe('空')
  })

  it('空的组给一句占位与新建入口', async () => {
    const wrapper = mountOutline(makeConfig({ arrows: [] }))

    expect(wrapper.text()).toContain('还没有箭头')
    await wrapper.get('[data-test="section-empty-add"]').trigger('click')
    expect(wrapper.emitted('add')?.[0]).toEqual(['arrows'])
  })

  it('选中的行挂上选中样式', () => {
    const wrapper = mountOutline(makeConfig(), { kind: 'anchors', id: 'a2' })

    expect(rowOf(wrapper, 'a2').classes()).toContain('bg-surface-raised')
    expect(rowOf(wrapper, 'a1').classes()).not.toContain('bg-surface-raised')
  })

  it('选中单例段时只有它高亮', () => {
    const wrapper = mountOutline(makeConfig(), { kind: 'model' })
    const singles = wrapper.findAll('[data-test="outline-single"]')

    expect(singles[0]?.classes()).toContain('bg-surface-raised')
    expect(singles[1]?.classes()).not.toContain('bg-surface-raised')
  })

  it('诊断点到的行打红点', () => {
    const wrapper = mountOutline(makeConfig(), null, new Set(['a1']))

    expect(rowOf(wrapper, 'a1').find('[data-test="row-flag"]').exists()).toBe(
      true,
    )
    expect(rowOf(wrapper, 'a2').find('[data-test="row-flag"]').exists()).toBe(
      false,
    )
  })

  it('视点行不出显隐键', () => {
    const wrapper = mountOutline()

    expect(
      rowOf(wrapper, 'c1').find('[data-test="row-visible"]').exists(),
    ).toBe(false)
    expect(
      rowOf(wrapper, 'a1').find('[data-test="row-visible"]').exists(),
    ).toBe(true)
  })

  // ⚠ 没登记的图标名不报错、只是什么都不画，只能靠这一条兜
  it('场景行与夹头的图标都真的画出来了', () => {
    const wrapper = mountOutline()
    const spots = [
      ...wrapper.findAll('[data-test="outline-single"]'),
      ...wrapper.findAll('[data-test="outline-folder"]'),
    ]

    expect(spots.length).toBeGreaterThan(0)
    expect(spots.every((spot) => spot.find('.dt-icon').exists())).toBe(true)
  })
})

describe('折叠', () => {
  it('折叠一组后它的夹与行都不再出现', async () => {
    const wrapper = mountOutline()
    const toggle = sectionOf(wrapper, 'anchors').get('button')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="outline-folder"]').exists()).toBe(false)
    expect(
      wrapper
        .findAll('[data-test="outline-row"]')
        .some((row) => row.attributes('data-id') === 'a1'),
    ).toBe(false)
  })

  it('折叠一个夹只藏它自己的行，散行还在', async () => {
    const wrapper = mountOutline()

    await folderOf(wrapper, 'f1')
      .get('[data-test="folder-toggle"]')
      .trigger('click')

    expect(wrapper.find('[data-id="a1"]').exists()).toBe(false)
    expect(wrapper.find('[data-id="a3"]').exists()).toBe(true)
  })
})

describe('选中与动作出口', () => {
  it('点单例段抛的是它自己的选中值', async () => {
    const wrapper = mountOutline()

    await wrapper.findAll('[data-test="outline-single"]')[1]?.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([{ kind: 'viewpoints' }])
  })

  it('点一行抛 select，带集合名与 id', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a2').find('[data-test="row-select"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'anchors', id: 'a2' },
    ])
  })

  it('组标题上的「+」抛 add，带集合名', async () => {
    const wrapper = mountOutline()

    await sectionOf(wrapper, 'panels')
      .get('[data-test="section-add"]')
      .trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual(['panels'])
  })

  it('切编辑视口显隐抛 toggleEditorVisible', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1')
      .find('[data-test="row-visible"]')
      .trigger('click')

    expect(wrapper.emitted('toggleEditorVisible')?.[0]).toEqual([
      { kind: 'anchors', id: 'a1' },
    ])
  })

  it('行菜单的上移抛 -1', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'a2').get('[data-test="row-menu"]'), '上移')

    expect(wrapper.emitted('move')?.[0]).toEqual([
      { kind: 'anchors', id: 'a2', delta: -1 },
    ])
  })

  it('行菜单的复制抛 duplicate', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'pl1').get('[data-test="row-menu"]'), '复制')

    expect(wrapper.emitted('duplicate')?.[0]).toEqual([
      { kind: 'panels', id: 'pl1' },
    ])
  })

  it('头一行的上移与末一行的下移在菜单里是禁用的', async () => {
    const wrapper = mountOutline()

    await openMenuAt(rowOf(wrapper, 'a1').get('[data-test="row-menu"]'))

    expect(menuItem('上移')?.hasAttribute('disabled')).toBe(true)
    expect(menuItem('下移')?.hasAttribute('disabled')).toBe(false)
  })
})

describe('批量建部件入口', () => {
  // 只有部件有「一个模型节点一个」的对应关系
  it('只有 parts 段菜单给批量入口', async () => {
    const wrapper = mountOutline()

    await openMenuAt(
      sectionOf(wrapper, 'anchors').get('[data-test="section-menu"]'),
    )
    expect(menuItem('从模型节点批量建')).toBeUndefined()
  })

  it('点了抛 bulkAdd，由页面去开挑选面', async () => {
    const wrapper = mountOutline()

    await clickMenu(
      sectionOf(wrapper, 'parts').get('[data-test="section-menu"]'),
      '从模型节点批量建',
    )

    expect(wrapper.emitted('bulkAdd')).toHaveLength(1)
  })
})

describe('文件夹动作', () => {
  it('段菜单的「新建文件夹」抛 addFolder 带集合名', async () => {
    const wrapper = mountOutline()

    await clickMenu(
      sectionOf(wrapper, 'anchors').get('[data-test="section-menu"]'),
      '新建文件夹',
    )

    expect(wrapper.emitted('addFolder')?.[0]).toEqual(['anchors'])
  })

  it('散行菜单的「移入某夹」抛 moveIntoFolder 带夹 id', async () => {
    const wrapper = mountOutline()

    await clickMenu(
      rowOf(wrapper, 'a3').get('[data-test="row-menu"]'),
      '移入「温度组」',
    )

    expect(wrapper.emitted('moveIntoFolder')?.[0]).toEqual([
      { folderId: 'f1', id: 'a3' },
    ])
  })

  it('夹内行的「移出文件夹」抛 removeFromFolder', async () => {
    const wrapper = mountOutline()

    await clickMenu(
      rowOf(wrapper, 'a1').get('[data-test="row-menu"]'),
      '移出文件夹',
    )

    expect(wrapper.emitted('removeFromFolder')?.[0]).toEqual(['a1'])
  })

  it('「新建文件夹并移入」抛 createFolderWithItem', async () => {
    const wrapper = mountOutline()

    await clickMenu(
      rowOf(wrapper, 'a3').get('[data-test="row-menu"]'),
      '新建文件夹并移入',
    )

    expect(wrapper.emitted('createFolderWithItem')?.[0]).toEqual([
      { kind: 'anchors', id: 'a3' },
    ])
  })

  it('夹头菜单的「删除文件夹」抛 removeFolder', async () => {
    const wrapper = mountOutline()

    await clickMenu(
      folderOf(wrapper, 'f1').get('[data-test="folder-menu"]'),
      '删除文件夹',
    )

    expect(wrapper.emitted('removeFolder')?.[0]).toEqual(['f1'])
  })

  it('上层置 renamingFolderId 后那个夹立刻进入就地重命名', async () => {
    const wrapper = mountOutline()

    await wrapper.setProps({ renamingFolderId: 'f2' })
    const input = folderOf(wrapper, 'f2').get('[data-test="folder-rename"]')
    await input.setValue('现场组')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('renameFolder')?.[0]).toEqual([
      { id: 'f2', name: '现场组' },
    ])
    expect(wrapper.find('[data-test="folder-rename"]').exists()).toBe(false)
  })

  it('重命名里 Esc 只收输入框，不抛 renameFolder', async () => {
    const wrapper = mountOutline()

    await wrapper.setProps({ renamingFolderId: 'f2' })
    await wrapper
      .get('[data-test="folder-rename"]')
      .trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('renameFolder')).toBeUndefined()
    expect(wrapper.find('[data-test="folder-rename"]').exists()).toBe(false)
  })
})

describe('搜索', () => {
  it('命中的行留下并高亮命中段，没命中的段整个隐藏', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '回水')

    expect(
      wrapper
        .findAll('[data-test="outline-row"]')
        .map((row) => row.attributes('data-id')),
    ).toEqual(['a2'])
    expect(rowOf(wrapper, 'a2').get('mark').text()).toBe('回水')
    expect(wrapper.find('[data-test="outline-single"]').exists()).toBe(false)
  })

  it('段计数变成「命中/总数」，夹计数也是', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '回水')

    expect(
      sectionOf(wrapper, 'anchors').get('[data-test="section-count"]').text(),
    ).toBe('1/3')
    expect(
      folderOf(wrapper, 'f1').get('[data-test="folder-count"]').text(),
    ).toBe('1/2')
  })

  it('夹名命中整夹放行', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '温度组')

    expect(
      wrapper
        .findAll('[data-test="outline-row"]')
        .map((row) => row.attributes('data-id')),
    ).toEqual(['a1', 'a2'])
    expect(folderOf(wrapper, 'f1').get('mark').text()).toBe('温度组')
  })

  it('段标题命中整段放行', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '锚点')

    expect(
      wrapper
        .findAll('[data-test="outline-row"]')
        .map((row) => row.attributes('data-id')),
    ).toEqual(['a1', 'a2', 'a3'])
  })

  // 展开态只算不写：搜索一律按展开渲染，清词后用户自己的折叠状态原样回来
  it('搜索不污染折叠态：搜时全展开，清词逐项复原', async () => {
    const wrapper = mountOutline()
    await sectionOf(wrapper, 'parts').get('button').trigger('click')
    await folderOf(wrapper, 'f1')
      .get('[data-test="folder-toggle"]')
      .trigger('click')
    expect(wrapper.find('[data-id="p1"]').exists()).toBe(false)
    expect(wrapper.find('[data-id="a1"]').exists()).toBe(false)

    await search(wrapper, '主')
    expect(wrapper.find('[data-id="p1"]').exists()).toBe(true)
    await search(wrapper, '进水')
    expect(wrapper.find('[data-id="a1"]').exists()).toBe(true)

    await search(wrapper, '')
    expect(wrapper.find('[data-id="p1"]').exists()).toBe(false)
    expect(wrapper.find('[data-id="a1"]').exists()).toBe(false)
    expect(wrapper.find('[data-id="a3"]').exists()).toBe(true)
  })

  it('谁都不命中时给空态，一键清词恢复', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '不存在的东西')
    expect(wrapper.find('[data-test="outline-search-empty"]').exists()).toBe(
      true,
    )

    const clear = wrapper
      .findAll('button')
      .find((button) => button.text() === '清除搜索')
    await clear?.trigger('click')

    expect(wrapper.find('[data-test="outline-search-empty"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-id="a1"]').exists()).toBe(true)
  })

  it('搜索框里 Esc 清词', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '回水')
    await wrapper
      .get('[data-test="outline-search"] input')
      .trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('[data-id="a1"]').exists()).toBe(true)
  })

  it('搜索态行菜单的上移禁用并点明原因', async () => {
    const wrapper = mountOutline()

    await search(wrapper, '回水')
    await openMenuAt(rowOf(wrapper, 'a2').get('[data-test="row-menu"]'))

    const item = menuItem('上移（搜索中不能重排）')
    expect(item?.hasAttribute('disabled')).toBe(true)
  })
})

describe('删除的口径', () => {
  it('有连带影响才就地问一句，文案点名会悬空的信息牌与能量流', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'a1').get('[data-test="row-menu"]'), '删除')

    expect(wrapper.emitted('remove')).toBeUndefined()
    const text = wrapper.get('[data-test="row-remove-confirm"]').text()
    expect(text).toContain('1 张信息牌')
    expect(text).toContain('1 条能量流')
  })

  it('确认之后才抛 remove，确认条收起', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'a1').get('[data-test="row-menu"]'), '删除')
    await wrapper.get('[data-test="row-remove-yes"]').trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual([
      { kind: 'anchors', id: 'a1' },
    ])
    expect(wrapper.find('[data-test="row-remove-confirm"]').exists()).toBe(
      false,
    )
  })

  it('取消之后确认条收起，一条 remove 都不抛', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'a1').get('[data-test="row-menu"]'), '删除')
    await wrapper.get('[data-test="row-remove-no"]').trigger('click')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.find('[data-test="row-remove-confirm"]').exists()).toBe(
      false,
    )
  })

  it('同一时刻只问一行', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'a1').get('[data-test="row-menu"]'), '删除')
    await clickMenu(rowOf(wrapper, 'c1').get('[data-test="row-menu"]'), '删除')

    expect(wrapper.findAll('[data-test="row-remove-confirm"]')).toHaveLength(1)
  })

  // 无连带的删除不吓唬用户：直接删，撤销兜底
  it('没人引用的实体直接删，不出确认条', async () => {
    const wrapper = mountOutline()

    await clickMenu(rowOf(wrapper, 'a3').get('[data-test="row-menu"]'), '删除')

    expect(wrapper.emitted('remove')?.[0]).toEqual([
      { kind: 'anchors', id: 'a3' },
    ])
    expect(wrapper.find('[data-test="row-remove-confirm"]').exists()).toBe(
      false,
    )
  })
})

describe('拖行入夹', () => {
  it('拖散行悬到同段的夹上亮环，落下抛 moveIntoFolder', async () => {
    const wrapper = mountOutline()
    const zone = folderZoneOf(wrapper, 'f1')

    await dragWrapOf(wrapper, 'a3').trigger('dragstart')
    await zone.trigger('dragover')
    expect(zone.classes()).toContain('ring-accent-primary')

    await zone.trigger('drop')
    expect(wrapper.emitted('moveIntoFolder')?.[0]).toEqual([
      { folderId: 'f1', id: 'a3' },
    ])
  })

  it('别的段的行悬上去不亮环、落下不抛', async () => {
    const wrapper = mountOutline()
    const zone = folderZoneOf(wrapper, 'f1')

    await dragWrapOf(wrapper, 'p1').trigger('dragstart')
    await zone.trigger('dragover')
    expect(zone.classes()).not.toContain('ring-accent-primary')

    await zone.trigger('drop')
    expect(wrapper.emitted('moveIntoFolder')).toBeUndefined()
  })

  it('拖回原夹是空操作，拖去别的夹照常落', async () => {
    const wrapper = mountOutline()

    await dragWrapOf(wrapper, 'a1').trigger('dragstart')
    await folderZoneOf(wrapper, 'f1').trigger('drop')
    expect(wrapper.emitted('moveIntoFolder')).toBeUndefined()

    await dragWrapOf(wrapper, 'a1').trigger('dragstart')
    await folderZoneOf(wrapper, 'f2').trigger('drop')
    expect(wrapper.emitted('moveIntoFolder')?.[0]).toEqual([
      { folderId: 'f2', id: 'a1' },
    ])
  })

  it('dragend 后再落不借用上一次的起点', async () => {
    const wrapper = mountOutline()

    await dragWrapOf(wrapper, 'a3').trigger('dragstart')
    await dragWrapOf(wrapper, 'a3').trigger('dragend')
    await folderZoneOf(wrapper, 'f1').trigger('drop')

    expect(wrapper.emitted('moveIntoFolder')).toBeUndefined()
  })
})
