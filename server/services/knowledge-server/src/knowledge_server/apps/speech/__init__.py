"""语音输入：浏览器的麦克风音频经本服务中继到自建 FunASR，转写回浏览器。

没有 crud/models——它不落库。消息契约在 `services/protocol.py`，设计与
部署步骤见 docs/adr/0038-语音输入走自建FunASR经知识库服务中继.md。
"""
