"""python-docx 动态 XML 边界，立即收敛到使用的最小协议。"""

from typing import Protocol, cast

from docx.oxml import parse_xml


class XmlElement(Protocol):
    """本模块需要的 XML 写面。"""

    def append(self, child: object) -> None: ...
    def set(self, key: str, value: str) -> None: ...


def append_xml(parent: object, xml: str, attribute: str = "_element") -> None:
    """向已知 python-docx 对象追加合法 XML。Args: parent, xml。"""
    # python-docx 的 XML 动态类无完整标注，边界收敛为两个方法。
    element = cast(XmlElement, vars(parent)[attribute])
    element.append(parse_xml(xml.encode()))
