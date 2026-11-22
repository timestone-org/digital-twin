"""附件队列取消、执行超时及损坏进程池的恢复。"""

import asyncio
import base64
from collections.abc import Callable
from concurrent.futures import Future
from concurrent.futures.process import BrokenProcessPool
from unittest.mock import Mock

import pytest

from ai_assistant.apps.chat.services.perception import attachments
from lib.errors import DependencyUnavailable, ValidationFailed


class ParkedExecutor:
    """已经接收任务但不会给结果的执行器。"""

    def __init__(self, *, is_broken: bool = False) -> None:
        self.ready = asyncio.Event()
        self.is_closed = False
        self.is_broken = is_broken

    def submit[**Params, Result](
        self,
        _task: Callable[Params, Result],
        /,
        *_args: Params.args,
        **_kwargs: Params.kwargs,
    ) -> Future[Result]:
        self.ready.set()
        result = Future[Result]()
        if self.is_broken:
            result.set_exception(BrokenProcessPool("worker failed"))
        return result

    def shutdown(self, **options: object) -> None:
        assert options == {"wait": False, "cancel_futures": True}
        self.is_closed = True


async def test_format_worker_timeout_discards_the_active_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = ParkedExecutor()
    monkeypatch.setattr(
        attachments, "ProcessPoolExecutor", Mock(return_value=pool)
    )

    parser = attachments.AttachmentParser(timeout_s=0.01)
    with pytest.raises(DependencyUnavailable, match="超时"):
        await parser.parse("点表.csv", "code,a")
    assert pool.is_closed


def test_attachment_worker_decodes_a_csv() -> None:
    content = base64.b64encode("code,name\na,出口温度\n".encode()).decode()
    parsed = attachments.decode_attachment("点表.csv", content)
    assert parsed.summary == "2 列 × 1 行"
    assert "出口温度" in parsed.text


@pytest.mark.parametrize(
    ("filename", "content", "hint"),
    [
        ("点表.csv", "%%%", "base64"),
        ("点表.pdf", "JVBERi0xLjQ=", r"\.csv"),
        ("现场.png", "iVBORw0KGgo=", "图片"),
    ],
)
def test_attachment_worker_keeps_validation_messages(
    filename: str, content: str, hint: str
) -> None:
    with pytest.raises(ValidationFailed, match=hint):
        attachments.decode_attachment(filename, content)


async def test_canceling_queued_parse_keeps_the_worker_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = ParkedExecutor()
    monkeypatch.setattr(
        attachments, "ProcessPoolExecutor", Mock(return_value=pool)
    )

    parser = attachments.AttachmentParser()
    first = asyncio.create_task(parser.parse("点表.csv", "code,a"))
    await pool.ready.wait()
    waiting = asyncio.create_task(parser.parse("巡检.csv", "code,b"))
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert not pool.is_closed

    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert pool.is_closed


async def test_broken_worker_pool_reports_unavailable_and_releases_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = ParkedExecutor(is_broken=True)
    monkeypatch.setattr(
        attachments, "ProcessPoolExecutor", Mock(return_value=pool)
    )

    parser = attachments.AttachmentParser()
    with pytest.raises(DependencyUnavailable, match="暂时不可用"):
        await parser.parse("点表.csv", "code,a")
    assert pool.is_closed
