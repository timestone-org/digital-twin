"""点位值类型的线上口径：platform 按它入库，collector 的驱动按它翻现场类型。

⚠ 两侧共用一份而不是各写各的：驱动认得现场的类型系统、platform 认得库里的
CHECK 约束，各留一份的表现是「驱动多翻出来的那个字面量一路走到落库前才被
CHECK 挡下」，而那时错误已经离现场很远了。
"""

from typing import Literal

# 协议无关的值类型。取值是字符串，禁数字枚举（api-contract §6）
DataType = Literal["bool", "float", "int", "string"]

# ⚠ 顺序即库里 CHECK 约束的字面量顺序，与初始迁移逐字一致
DATA_TYPES: tuple[str, ...] = ("bool", "float", "int", "string")
