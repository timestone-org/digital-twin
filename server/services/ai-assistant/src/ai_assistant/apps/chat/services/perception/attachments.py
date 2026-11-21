"""解析附件并隔离 CPU 密集的解码。"""

import asyncio
import base64
import binascii
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from contextlib import suppress
from multiprocessing import get_context
from multiprocessing.process import BaseProcess
from typing import cast

from ai_assistant.apps.chat.services.perception import (
    AsText,
    UnsupportedInput,
    decode,
)
from lib.errors import DependencyUnavailable, ValidationFailed

_PARSE_TIMEOUT_S = 15.0


class AttachmentParser:
    """一个进程池与一个解码执行槽。"""

    def __init__(self, *, timeout_s: float = _PARSE_TIMEOUT_S) -> None:
        self._timeout_s = timeout_s
        self._slot = asyncio.Lock()
        self._executor: ProcessPoolExecutor | None = None

    async def parse(self, filename: str, content_base64: str) -> AsText:
        """在同一预算内排队并解码。Args: filename, content_base64。"""
        try:
            async with asyncio.timeout(self._timeout_s):
                async with self._slot:
                    return await self._run(filename, content_base64)
        except TimeoutError as error:
            raise DependencyUnavailable(
                "附件解析超时，请缩小文件后重试"
            ) from error

    async def close(self) -> None:
        """释放附件解析进程。"""
        self._discard()

    async def _run(self, filename: str, content_base64: str) -> AsText:
        if self._executor is None:
            self._executor = ProcessPoolExecutor(
                max_workers=1, mp_context=get_context("spawn")
            )
        try:
            return await asyncio.get_running_loop().run_in_executor(
                self._executor, decode_attachment, filename, content_base64
            )
        except asyncio.CancelledError:
            self._discard()
            raise
        except BrokenProcessPool as error:
            self._discard()
            raise DependencyUnavailable("附件解析暂时不可用") from error

    def _discard(self) -> None:
        executor, self._executor = self._executor, None
        if executor is None:
            return
        # shutdown 无法中止正在运行的任务，先终止该独占槽中的进程。
        processes = cast(
            "dict[int, BaseProcess] | None",
            getattr(executor, "_processes", None),
        )
        for process in tuple((processes or {}).values()):
            with suppress(ProcessLookupError):
                process.kill()
        executor.shutdown(wait=False, cancel_futures=True)


def decode_attachment(filename: str, content_base64: str) -> AsText:
    """读取附件文本，并区分编码和格式错误。Args: filename, content_base64。"""
    try:
        content = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValidationFailed("文件内容不是合法的 base64") from error
    try:
        decoded = decode(filename, content)
    except UnsupportedInput as error:
        raise ValidationFailed(str(error)) from error
    if not isinstance(decoded, AsText):
        raise ValidationFailed("图片不走这条端点，随消息一起发就行")
    return decoded
