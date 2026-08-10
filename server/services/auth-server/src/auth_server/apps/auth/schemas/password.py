"""口令强度约束。单独成文件，让「改一处即全部入口生效」成立。"""

from typing import Annotated

from pydantic import AfterValidator, Field

MIN_LENGTH = 10
MAX_LENGTH = 128


def _has_letter_and_digit(value: str) -> str:
    if not any(char.isalpha() for char in value):
        raise ValueError("口令必须包含字母")
    if not any(char.isdigit() for char in value):
        raise ValueError("口令必须包含数字")
    return value


RawPassword = Annotated[
    str,
    Field(min_length=MIN_LENGTH, max_length=MAX_LENGTH),
    AfterValidator(_has_letter_and_digit),
]
