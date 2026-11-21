"""实例通告地址与 opc.tcp URL。"""

import re
from ipaddress import IPv6Address, ip_address

_DNS_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
_MAX_DNS_LENGTH = 253
_IPV4_OCTETS = 4


def advertised_hostname(value: str | None) -> str | None:
    """解析可选的 DNS 名或 IP 地址。Args: value。"""
    if value is None or not value.strip():
        return None
    host = value.strip()
    if "%" in host:
        raise ValueError("通告地址不能包含接口作用域")
    if host.startswith("[") and host.endswith("]"):
        try:
            address = IPv6Address(host[1:-1])
        except ValueError as exc:
            raise ValueError("方括号只用于 IPv6 通告地址") from exc
    else:
        try:
            address = ip_address(host)
        except ValueError:
            return _dns_hostname(host)
    if address.is_unspecified:
        raise ValueError("通告地址必须是客户端可连接的主机")
    return str(address)


def _dns_hostname(host: str) -> str:
    try:
        dns = host.removesuffix(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("通告主机名无效") from exc
    labels = dns.split(".")
    if (
        len(dns) > _MAX_DNS_LENGTH
        or not all(_DNS_LABEL.fullmatch(label) for label in labels)
        or (
            len(labels) == _IPV4_OCTETS
            and all(label.isdecimal() for label in labels)
        )
    ):
        raise ValueError("通告地址只接受 DNS 名或 IP，不包含协议、端口或路径")
    return dns


def endpoint_url(host: str, port: int, path: str) -> str:
    """用主机、端口与绝对路径组成连接地址。Args: host, port, path。"""
    authority = f"[{host}]" if ":" in host else host
    return f"opc.tcp://{authority}:{port}{path}"
