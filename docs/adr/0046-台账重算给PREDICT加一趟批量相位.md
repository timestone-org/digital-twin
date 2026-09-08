---
status: deprecated
date: 2026-09-03
---

# ADR-0046：PREDICT 批量相位

这是 platform 内部的可逆求值算法，不再单独作为系统 ADR 维护。现行算法以 [建模平台设计 D11b](../MODELING_PLATFORM_DESIGN.md) 为准：本批只要有模型声明批量有收益，就空跑一次收集调用，按完整输入批量求值并写入备忘；正式求值未命中时逐行现算，保证优化不改变结果。
