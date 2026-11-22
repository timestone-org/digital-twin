"""在 PostgreSQL 聚合整列，保留与当前编辑行相同的数值转换口径。"""

import sys
import unicodedata
import uuid
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.formula.context import WholeStats
from platform_server.settings import DB_SCHEMA

# Python str.strip 与 float 所采用的空白字符和非 ASCII 十进制数字起点。
_UCD15_WHITESPACE = (
    "\u0009\u000a\u000b\u000c\u000d"
    "\u001c\u001d\u001e\u001f\u0020"
    "\u0085\u00a0\u1680\u2000\u2001"
    "\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028"
    "\u2029\u202f\u205f\u3000"
)

_UCD15_DECIMAL_ZEROES = (
    "\u0660\u06f0\u07c0\u0966\u09e6"
    "\u0a66\u0ae6\u0b66\u0be6\u0c66"
    "\u0ce6\u0d66\u0de6\u0e50\u0ed0"
    "\u0f20\u1040\u1090\u17e0\u1810"
    "\u1946\u19d0\u1a80\u1a90\u1b50"
    "\u1bb0\u1c40\u1c50\ua620\ua8d0"
    "\ua900\ua9d0\ua9f0\uaa50\uabf0"
    "\uff10\U000104a0\U00010d30\U00011066\U000110f0"
    "\U00011136\U000111d0\U000112f0\U00011450\U000114d0"
    "\U00011650\U000116c0\U00011730\U000118e0\U00011950"
    "\U00011c50\U00011d50\U00011da0\U00011f50\U00016a60"
    "\U00016ac0\U00016b50\U0001d7ce\U0001d7d8\U0001d7e2"
    "\U0001d7ec\U0001d7f6\U0001e140\U0001e2f0\U0001e4f0"
    "\U0001e950\U0001fbf0"
)


def _character_classes() -> tuple[str, str]:
    """取得当前 Python 识别的空白与十进制数字起点。"""
    if unicodedata.unidata_version == "15.0.0":
        return _UCD15_WHITESPACE, _UCD15_DECIMAL_ZEROES
    # 新 Unicode 版本一次性从标准库取表，避免升级后漏计新增数位。
    whitespace: list[str] = []
    zeroes: list[str] = []
    for codepoint in range(sys.maxunicode + 1):
        character = chr(codepoint)
        if character.isspace():
            whitespace.append(character)
        if not character.isascii() and unicodedata.decimal(character, -1) == 0:
            zeroes.append(character)
    return "".join(whitespace), "".join(zeroes)


_WHITESPACE, _DECIMAL_ZEROES = _character_classes()


def _number_pattern(digit: str) -> str:
    """十进制文本语法，允许数字之间的下划线。Args: digit。"""
    run = rf"{digit}(?:_?{digit})*"
    return rf"^[+-]?(?:{run}(?:\.(?:{run})?)?|\.{run})(?:[eE][+-]?{run})?$"


_ASCII_DECIMAL = _number_pattern("[0-9]")
_NON_ASCII_DIGIT = (
    "["
    + "".join(zero + "-" + chr(ord(zero) + 9) for zero in _DECIMAL_ZEROES)
    + "]"
)
_FETCH_GROUPS = 128

# 来源依次为公式、人工修正和记录。显式 JSON null 也占据该层。
_CELLS = f"""
WITH cells AS (
  SELECT ckey, CASE
      WHEN r.computed_json -> ckey IS NOT NULL THEN r.computed_json -> ckey
      WHEN r.overrides_json -> ckey ->> 'v' IS NOT NULL
          THEN r.overrides_json -> ckey -> 'v'
      ELSE r.values_json -> ckey END AS cell
  FROM {DB_SCHEMA}.dataset_records AS r
  CROSS JOIN unnest(CAST(:keys AS text[])) AS ckey
  WHERE r.table_id = CAST(:table_id AS uuid)"""  # noqa: S608
_EXCLUDE = " AND r.row_id <> CAST(:exclude_row_id AS uuid)"

# 短 JSON 数可直接转成 float8。下溢和含非 ASCII 数位的文本按原文分组处理。
_AGGREGATE = """
), inputs AS MATERIALIZED (
  SELECT ckey, jsonb_typeof(cell) AS kind,
         CASE WHEN jsonb_typeof(cell)='string'
              THEN nullif(btrim(cell #>> '{}', :whitespace),'')
              ELSE cell #>> '{}' END AS raw
  FROM cells
), parsed AS MATERIALIZED (
  SELECT ckey, raw, CASE
      WHEN kind='number' AND length(raw)<=32 AND raw !~ '[eE]'
          THEN raw::float8
      WHEN kind='boolean' THEN
          CASE WHEN raw='true' THEN 1::float8 ELSE 0::float8 END
      WHEN raw ~ :ascii_decimal
           AND pg_input_is_valid(replace(raw,'_',''), 'double precision')
          THEN replace(raw,'_','')::float8 END AS amount
  FROM inputs
), grouped AS (
  SELECT ckey, raw, amount,
         CASE WHEN amount IS NULL AND
             (raw ~ :ascii_decimal OR
              (octet_length(raw)<>length(raw) AND raw ~ :non_ascii_digit))
             THEN raw END AS exceptional
  FROM parsed
)
SELECT ckey, exceptional, min(amount) AS minimum, max(amount) AS maximum,
       sum(CAST(CAST(amount AS text) AS numeric)) AS total,
       count(amount) AS number_count, count(raw) AS present_count
FROM grouped
GROUP BY ckey, exceptional
"""


async def read_whole_stats(
    session: AsyncSession,
    table_id: uuid.UUID,
    keys: Sequence[str],
    exclude_row_id: uuid.UUID | None,
) -> dict[str, WholeStats]:
    """一次扫描所选列，分批读取聚合结果。

    Args: session, table_id, keys, exclude_row_id。
    """
    if not keys:
        return {}
    before = _CELLS if exclude_row_id is None else _CELLS + _EXCLUDE
    params = {
        "keys": sorted(set(keys)),
        "table_id": str(table_id),
        "exclude_row_id": str(exclude_row_id),
        "whitespace": _WHITESPACE,
        "ascii_decimal": _ASCII_DECIMAL,
        "non_ascii_digit": _NON_ASCII_DIGIT,
    }
    rows = await session.stream(
        text(before + _AGGREGATE),
        params,
        execution_options={"yield_per": _FETCH_GROUPS},
    )
    found: dict[str, WholeStats] = {}
    try:
        async for row in rows:
            present = int(row.present_count)
            if row.exceptional is not None:
                group = WholeStats().fold(
                    str(row.exceptional), occurrences=present
                )
            else:
                numbers = int(row.number_count)
                group = WholeStats(
                    row.minimum,
                    row.maximum,
                    row.total,
                    numbers,
                    present - numbers,
                )
            key = str(row.ckey)
            found[key] = found[key].merge(group) if key in found else group
    finally:
        await rows.close()
    return found
