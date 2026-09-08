# 字体资源

本应用使用 HarmonyOS Sans SC。仓库内的
`harmonyos-sans-sc/HarmonyOS_Sans_SC_Regular.ttf` 是来自
[OpenHarmony 官方系统资源仓库](https://github.com/openharmony/utils_system_resources/blob/master/fonts/HarmonyOS_Sans_SC_Regular.ttf)
的未修改原件；版权归 Huawei Device Co., Ltd.，授权全文见同目录
`LICENSE.txt`。当前只随包提供 Regular，以避免六个简体中文字重约 50 MB
全部进入发布物；浏览器会为其余字重合成字形。

大屏读数使用的 `ds-digital/DS-DIGI.TTF` 与 `DIGITAL.TXT` 来自作者
Dusit Supasawat 发布的原始 DS-Digital 1.0 压缩包，均保持未修改。该字体是
shareware：授权文本列出的费用是个人使用 20 美元、商业使用 45 美元；正式交付前
必须由使用方完成对应授权。字体只覆盖有限字符，缺少的中文、单位或符号会逐字
回退到 HarmonyOS Sans SC。

后续增加其他大屏读数字体时，在 `@dt/contracts` 的
`DASHBOARD_DIGIT_FONT_OPTIONS` 增加一项，并加载对应的已授权字体资源。
