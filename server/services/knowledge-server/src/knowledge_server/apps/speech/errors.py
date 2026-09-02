"""语音输入域的异常。错误码沿用知识库的领域号 23，从 42340 起与对话那一段分开。

⚠ 在 WebSocket 上它们以 `{"type":"error","code":…,"message":…}` 一帧发出、随后
关连接；`http_status` 只守「首位一致」的契约（check_api_contract），握手前的
拒绝走关闭码不走它。
"""

from lib.errors import AppError


class SpeechBadFrame(AppError):
    """客户端发来认不出的文本帧：不是 JSON 对象，或 action 不在闭合集合里。"""

    code = 42340
    http_status = 400


class AsrUnavailable(AppError):
    """FunASR 连不上、握手被拒或中途断。

    ⚠ 可重试，但**中继一次都不重**：一条链路只有一层负责重试，这条链上那一层
    是用户再按一次麦克风。
    """

    code = 52340
    http_status = 503
    is_retryable = True


class SpeechRelayFailed(AppError):
    """中继自己出错了，与两头都无关。"""

    code = 52341
    http_status = 500
