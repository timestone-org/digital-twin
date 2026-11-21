"""在回合异常或中止时交还已经执行的工具结果。"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

from llmcore.turn.types import TurnOutcome

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Awaitable, Callable, Sequence

    from langchain_core.messages import BaseMessage

    from llmcore.turn.types import TurnStep

type PersistPartial = Callable[[TurnOutcome], Awaitable[None]]


@dataclass
class TurnProgress:
    """保存本批已返回的工具及之前实际发生的步骤。"""

    seeded: int
    persist: PersistPartial | None
    snapshot: Callable[[], TurnOutcome] | None = None

    def completed(
        self,
        messages: Sequence[BaseMessage],
        previous: Sequence[TurnStep],
        outputs: list[BaseMessage],
        steps: list[TurnStep],
    ) -> None:
        if self.persist is not None:
            self.snapshot = lambda: TurnOutcome(
                messages=[*messages[self.seeded :], *outputs],
                steps=[*previous, *steps],
            )

    @asynccontextmanager
    async def preserve(self) -> AsyncGenerator[None]:
        try:
            yield
        except (Exception, asyncio.CancelledError):
            if self.persist is not None and self.snapshot is not None:
                await self.persist(self.snapshot())
            raise
