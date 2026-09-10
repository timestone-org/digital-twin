"""python-docx 动态 XML 边界，立即收敛到使用的最小协议。"""

from collections.abc import MutableMapping
from typing import Protocol, cast

from docx.oxml import parse_xml
from docx.oxml.ns import qn


class XmlElement(Protocol):
    """本模块需要的 XML 写面。"""

    attrib: MutableMapping[str, str]

    def append(self, child: object) -> None: ...
    def set(self, key: str, value: str) -> None: ...
    def find(self, key: str) -> "XmlElement | None": ...
    def insert(self, index: int, child: object) -> None: ...
    def remove(self, child: object) -> None: ...


def append_xml(parent: object, xml: str, attribute: str = "_element") -> None:
    """向已知 python-docx 对象追加合法 XML。Args: parent, xml。"""
    # python-docx 的 XML 动态类无完整标注，边界收敛为两个方法。
    element = cast(XmlElement, vars(parent)[attribute])
    element.append(parse_xml(xml.encode()))


def append_property(
    parent: object, name: str, xml: str, attribute: str = "_element"
) -> None:
    """在唯一的属性节点中追加设置。Args: parent, name, xml, attribute。"""
    element = cast(XmlElement, vars(parent)[attribute])
    properties = element.find(qn(f"w:{name}"))
    if properties is None:
        properties = cast(
            XmlElement,
            parse_xml(
                f'<w:{name} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'.encode()
            ),
        )
        element.insert(0, properties)
    properties.append(parse_xml(xml.encode()))


def remove_property(parent: object, group: str, name: str) -> None:
    """移除内置样式残留的直接属性。Args: parent, group, name。"""
    element = cast(XmlElement, vars(parent)["_element"])
    properties = element.find(qn(f"w:{group}"))
    if properties is not None:
        child = properties.find(qn(f"w:{name}"))
        if child is not None:
            properties.remove(child)
