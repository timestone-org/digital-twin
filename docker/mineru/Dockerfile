# MinerU 的解析服务：ADR-0043 说的「外部解析后端」那一路，用来吃 PDF 与扫描件。
#
# ⚠ 自己建而不是拉现成镜像。官方镜像走 vllm + CUDA（x86 + Volta 以上显卡），
# 而本部署是 arm64 且没有显卡；社区镜像没有可追溯的构建来源，而解析是每一份
# 文档的必经之路。
#
# ⚠ 装 `mineru[pipeline]` 而不是 `[core]` / `[all]`：pipeline 才是 CPU 那一档
# （torch + onnxruntime，aarch64 都有轮子），`core` 会把 vlm 与 gradio 一起拖
# 进来，而 vlm 那一路在没有显卡的机器上根本跑不了。`fastapi` / `uvicorn` 是基础
# 依赖，所以只装 pipeline 也有 `mineru-api`。
FROM python:3.12-slim-bookworm

# opencv 的运行期依赖。⚠ 少了它，`import cv2` 要到**第一次解析**才炸，
# 报的是 `libGL.so.1` 找不到——与「装没装 MinerU」看着毫无关系
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ⚠ **先按 CPU 轮子钉住 torch。** aarch64 上 PyPI 的默认 torch 是 CUDA 版
# （`2.14.0+cu130`），装完镜像 10.1 GB；先钉 CPU 版之后是 2.4 GB。没有显卡的
# 机器用不到那 7.7 GB，而且**一点报错都没有**——它只是白占磁盘。
# torchvision 的版本要与 torch 配套：2.14 ↔ 0.29。
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      "torch==2.14.0" \
      "torchvision==0.29.0"

# ⚠ 版本钉死，禁 `latest`（engineering-workflow）。升级要连着重抓一次线形夹具
# （`tests/fixtures/mineru_file_parse.json`）——回包的形状是唯一的契约。
# ⚠ `six` 是补上去的：`mineru==3.4.5` 的 OCR 那一路 import 了它却没声明依赖，
# 缺了的话服务照常起来、**第一次解析**才回一句 `No module named 'six'`，
# 而 HTTP 状态是 409。
RUN pip install --no-cache-dir \
      "mineru[pipeline]==3.4.5" \
      "six==1.17.0"

# ⚠ 装完当场断言 torch 不是 CUDA 版：上面那条 `--index-url` 一旦被别的依赖
# 顶掉（谁声明了 `torch>=…` 就会重装一次），镜像会悄悄胖回 10 GB
RUN python -c "import torch, six; assert '+cu' not in torch.__version__, torch.__version__"

# 非 root 运行。⚠ `/models` 要在镜像里先建好并归它：命名卷第一次挂载时**继承
# 镜像里那个目录的属主**，不先建的话卷是 root 的，而进程写不进去——表现是模型
# 下载作业当场失败，报的是权限而不是「卷没配好」
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /models \
 && chown -R app:app /models

# 模型缓存与 `mineru.json` 都落在挂载卷上。⚠ `HOME` 也指过去：
# `mineru-models-download` 会把模型路径写进 `$HOME/mineru.json`，写在容器根
# 文件系统上的话，容器一重建就没了
ENV HOME=/models \
    HF_HOME=/models/hf \
    MODELSCOPE_CACHE=/models/modelscope \
    MINERU_MODEL_SOURCE=modelscope

USER app
EXPOSE 8000

CMD ["mineru-api", "--host", "0.0.0.0", "--port", "8000"]
