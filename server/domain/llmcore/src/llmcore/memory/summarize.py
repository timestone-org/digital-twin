"""窗口外那一截怎么折成一段，以及折出来的那段挂在哪。

没有它，跑了几十轮的会话里最早那几十条的结论——查到的点位、定下的命名、
用户否掉的做法——就此消失，模型会把同一件事重新查一遍。

⚠ **摘要锚在与历史窗口同一个台阶上**（`history.split` 的切点）。同一个台阶内
它逐字不变，跨台阶才重折一次。不锚的话它每轮都变，而它排在历史区**前面**——
那就是 ADR-0025 之外的第五个前缀断点，后面十几 k 字符连同整段历史一起作废，
且没有任何运行期迹象，只有账单和延迟会慢慢变难看。

⚠ **折是一次模型调用，必须在事务之外**（database-standard：事务里禁止外部 IO）。
调用点在 `advance_service._summary_of`，读库与写库各自开短事务，中间那次调用
不占着数据库连接。

⚠ **折不出来就退回今天的行为**（那一截直接丢），绝不让一个回合因为摘要没折成
就发不出去——与模型不可用时 fail-open 同一口径（CONTEXT.md §3 不变式 4）。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast

from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from lib.logging import get_logger
from llmcore import (
    ModelChoice,
    ModelDisabled,
    ModelRejected,
    ModelUnavailable,
)
from llmcore.memory.ports import HistoryRow, Summary
from llmcore.turn.ports import Responder

# ⚠ 记作 `chat.summarize` 而不是 `assistant.summarize`：这一份被两个服务共用，
# 写死某一家的名字会让另一家的日志谎报出处（同 `turn/loop.py`）
_logger = get_logger("chat.summarize")

# 包住摘要的标记。⚠ 要说清它不是用户说的话：不说的话，模型会把这一段当成
# 用户刚敲进去的东西，然后回一句「你贴的这个是什么意思」（与状态块同一个坑）
_OPEN = '<早前对话摘要 说明="系统折叠的更早那一截，不是用户说的话">'
_CLOSE = "</早前对话摘要>"

# 喂给折叠那次调用的上限。⚠ 有上限：增量折之后正常情况远够用，而一次异常
# 的大脱落（改小了高水位、导入了一段长历史）不该把这次调用撑爆
MAX_FOLD_CHARS = 24_000
# 折出来的那段的上限。折不住就没有意义了——它要比它替代的那一截短得多
MAX_SUMMARY_CHARS = 2_000

_FOLD_PROMPT = """把下面这段更早的对话折成一段摘要，供后续对话接着用。

- 只留**结论与既定口径**：查到的点位与它们的编码、定下的命名与单位、用户
  明确要过或否过的做法、已经改完的那些。
- 过程一律删掉：调了哪个工具、试了几次、中间报了什么错。
- 用户说的与助手推断的分开写。把助手的猜测写成用户的要求，是这段摘要唯一
  真正有害的错法。
- 已有摘要在最前面时，把新的这一截**并进去**，不要另起一段复述它。
- 中文，不超过 800 字，不要标题，不要开场白。"""


@dataclass(frozen=True)
class NullSummarizer:
    """不折。装不上摘要那一档模型时就是它——如实缺席，不是半个实现。"""

    async def fold(
        self,
        dropped: Sequence[HistoryRow],  # noqa: ARG002  # 理由：见下
        through_seq: int,  # noqa: ARG002  # 理由：见下
        previous: Summary | None,  # noqa: ARG002  # 理由：见下
    ) -> Summary | None:
        """恒给 `None`，调用方据此退回「那一截直接丢」。

        ⚠ 形参一个都不能改名或省掉：pyright 按名字判协议一致性，改了就不再是
        一个合法的 `Summarizer`，而报出来的错与「这个类没实现接口」对不上。

        Args: dropped, through_seq, previous。
        """
        return None


@dataclass(frozen=True)
class ModelSummarizer:
    """拿摘要那一档模型折。"""

    model: Responder
    # ⚠ 跟着会话的档位走：会话选了订阅账号那一路，摘要也该在那一路上折，
    # 否则一个只登录了订阅账号的部署永远折不出摘要，而它表现为「摘要偶尔没有」
    profile: str

    @property
    def choice(self) -> ModelChoice:
        """折叠用哪一次选择。摘要档单列，断路器因此与对话档分开。"""
        return ModelChoice(kind="summary", profile=self.profile)

    async def fold(
        self,
        dropped: Sequence[HistoryRow],
        through_seq: int,
        previous: Summary | None,
    ) -> Summary | None:
        """折一次；折不出来给 `None`。

        Args: dropped, through_seq, previous。
        """
        body = _fold_input(dropped, previous)
        if not body:
            return None
        try:
            answer = await self.model.respond(
                choice=self.choice,
                messages=[
                    SystemMessage(content=_FOLD_PROMPT),
                    HumanMessage(content=body),
                ],
                tools=(),
            )
        except (ModelDisabled, ModelUnavailable, ModelRejected) as error:
            # ⚠ 这一条只 warning 不抛：折不成是可接受的降级，而抛出去会让
            # 一个本来能跑完的回合发不出任何一句
            _logger.warning(
                "summary_fold_failed",
                extra={
                    "through_seq": through_seq,
                    "reason": type(error).__name__,
                },
            )
            return None
        text = _text_of(answer)[:MAX_SUMMARY_CHARS].strip()
        if not text:
            return None
        return Summary(
            through_seq=through_seq, text=text, model=stamp_of(self.choice)
        )


def stamp_of(choice: ModelChoice) -> str:
    """折这一段用的是哪一路哪一档。

    ⚠ 落进摘要里是为了让「换了模型就重折」判得出来：两截摘要由不同模型折出来
    时口径可以差很远，而拼在一起看不出接缝。

    Args: choice。
    """
    return f"{choice.profile}:{choice.kind}"


def reuse(
    stored: Summary | None, through_seq: int, stamp: str
) -> Summary | None:
    """这一段还能原样用吗；不能用给 `None`（该重折了）。

    ⚠ **同一个台阶内必须原样复用。** 重折出来的字句一定与上一轮不同，而摘要排在
    历史区前面——那就是一个新的前缀断点，后面整段历史跟着作废，且没有任何运行期
    迹象。这一条是本模块存在的全部理由，判据收在这一个函数里，不散在调用点。

    ⚠ 换了模型也要重折：两截摘要由不同模型折出来时口径可以差很远，
    而拼在一起看不出接缝。

    Args: stored（库里那一段）, through_seq（这一轮的台阶边界）, stamp
        （这一轮会用哪一路哪一档折）。
    """
    if stored is None:
        return None
    if stored.through_seq != through_seq or stored.model != stamp:
        return None
    return stored


def messages_of(summary: Summary | None) -> list[BaseMessage]:
    """摘要挂成的那一条；没有摘要就一条都不挂。

    ⚠ 位置是历史区的**最前面**——它代表的就是更早的那一截。挂到末尾去的话，
    模型会把它读成「刚刚发生的事」。

    Args: summary。
    """
    if summary is None:
        return []
    return [HumanMessage(content=f"{_OPEN}\n\n{summary.text}\n\n{_CLOSE}")]


def as_json(summary: Summary) -> dict[str, Any]:
    """落库的形状。

    Args: summary。
    """
    return {
        "through_seq": summary.through_seq,
        "text": summary.text,
        "model": summary.model,
    }


def stored_of(body: object) -> Summary | None:
    """从 `chat_sessions.summary_json` 还原；形状不对给 `None`。

    ⚠ 形状不对就当没有，而不是抛：JSONB 是无类型的，一行脏数据不该让这个会话
    从此发不出任何一句。

    Args: body（落库的那一段）。
    """
    if not isinstance(body, dict):
        return None
    # ⚠ 收窄一次而不是原样用：JSONB 出来的是 `Any`，直接取值会让整条摘要的
    # 类型退化成未知，而那会一路传染到拼装层（与 `history._calls_of` 同一手法）
    given = cast("dict[str, object]", body)
    through = given.get("through_seq")
    text = given.get("text")
    if not isinstance(through, int) or not isinstance(text, str) or not text:
        return None
    return Summary(
        through_seq=through, text=text, model=str(given.get("model") or "")
    )


def _fold_input(dropped: Sequence[HistoryRow], previous: Summary | None) -> str:
    """喂给折叠那次调用的正文：上一段摘要 + 这一截新脱落的。

    ⚠ 只带**上一段摘要之后**新脱落的那几条，不是从头再来一遍：从头带的话，
    会话越长这一次调用越贵，最后贵过它省下来的那点上下文。

    Args: dropped, previous。
    """
    edge = previous.through_seq if previous is not None else 0
    fresh = [row for row in dropped if row.seq >= edge]
    lines = [_line_of(row) for row in fresh]
    body = "\n".join(one for one in lines if one)
    if previous is not None:
        body = f"【已有摘要】\n{previous.text}\n\n【新的这一截】\n{body}"
    if not body.strip():
        return ""
    # 超长时留**尾部**：新的那一截比更早的那一截更可能还在被引用
    return body[-MAX_FOLD_CHARS:]


def _line_of(row: HistoryRow) -> str:
    """一条历史摊成一行。工具消息不进摘要——过程不是结论。

    Args: row。
    """
    if row.role == "tool":
        return ""
    text = str(row.content_json.get("text") or "").strip()
    if not text:
        return ""
    who = "用户" if row.role == "user" else "助手"
    return f"{who}：{text}"


def _text_of(answer: BaseMessage) -> str:
    """模型回的那段文字。

    Args: answer。
    """
    content = answer.content
    return content if isinstance(content, str) else ""
