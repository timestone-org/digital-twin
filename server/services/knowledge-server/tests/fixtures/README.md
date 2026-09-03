# 解析后端的线形夹具

这里放的是**外部解析服务真实回包的样子**，不是我们造的样例。

ADR-0043 明写了不许凭空写客户端：

> 没有真实端点可验，写出来的是一份猜的线形；而半吊子实现会让能力面报「接了」，
> 比缺席更难查。

所以每接一路外部后端，先把它真实的回包抓下来存在这里，再照着它写实现与契约测试。
升级那一路的版本时**要重抓一次**——回包的形状是我们与它之间唯一的契约。

## `mineru_file_parse.json`

`mineru==3.4.5` 的 `POST /file_parse`，2026-09-03 在本机 Docker（linux/arm64、
纯 CPU）上抓的。原件是一份**每页内容已知**的三页 A4 PDF：第一页两段文字，
第二页一张四列五行的表，第三页一张图带图注。每页各埋一个哨兵串
（`SENTINEL-PAGE-ONE/TWO/THREE`），页码对不对就靠它验。

抓法：

```sh
curl -X POST http://<mineru>:8000/file_parse \
  -F 'files=@spec.pdf' \
  -F 'backend=pipeline' \        # ⚠ 必须显式给，服务端默认的 hybrid-engine 要 GPU
  -F 'lang_list=ch' \
  -F 'return_md=true' \
  -F 'return_content_list=true' \  # ⚠ 默认 false
  -F 'return_images=true'          # ⚠ 默认 false
```

⚠ 存进来之前把 `images` 里的 base64 换成了一张 1×1 的 JPEG 占位：夹具钉的是
**形状**，不是那几万个字符。其余一个字节没动。

### 这份夹具钉住的几件事

- 顶层是**任务信封**：`task_id` / `status` / `backend` / `error` /
  `status_url` / `result_url` / `version` / `results`。
- `results` 按**文件名（去掉后缀）**索引，每份是
  `{md_content, content_list, images}`。
- ⚠ **`content_list` 是一个 JSON 字符串，不是数组**——要再 `json.loads` 一次。
  当成数组用的话，拿到的是 3522 个单字符。
- ⚠ **`images` 的值是 `data:image/jpeg;base64,…` 完整 data URI**，键是
  `<sha256>.jpg`，而 `content_list` 里的 `img_path` 是 `images/<同一个>.jpg`——
  两边靠**basename** 对上。
- 每一条都带 `page_idx`（从 0 起）与 `bbox`（归一化到 0–1000 的
  `[x0,y0,x1,y1]`），**一条不缺**。
- `text` 条目的 `text_level` 只有标题才有；正文那一格干脆没有这个键。
- `table` 给 `table_body`（带 `rowspan`/`colspan` 的 HTML）+ `table_caption` +
  `table_footnote`，并且**另出一张表格截图**。
- `image` 给 `image_caption` / `image_footnote` 数组。
