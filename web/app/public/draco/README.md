# Draco 解码器（glTF 版）

从 `three/examples/jsm/libs/draco/gltf/` 原样拷来，随构建产物一起发。

⚠ **不许走 CDN**：现场那台机器不一定有外网，而没有外网时的表现是「模型永远
加载中」，控制台里只有一条被浏览器吞掉的跨域错误（ADR-0022）。

⚠ **解码器与 three 的版本是配套的**。升 three 之后必须重新拷一遍，否则表现是
压缩过的模型解不开——而两边的代码单看都对。这一条由
`packages/three-core/tests/dracoDecoder.contract.spec.ts` 钉住：漂了它会红，
并告诉你重拷的命令。

只要解码用的三件，不要 `draco_encoder.js`：编码在服务端做（`platform-worker`）。
