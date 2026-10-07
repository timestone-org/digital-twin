"""受控 HTTPS 上游：临时证书、域名校验与可观测的持久连接。"""

import asyncio
import json
import ssl
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def certificate(
    directory: Path, hostnames: Sequence[str]
) -> tuple[ssl.SSLContext, Path]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostnames[0])])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=1))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName(host) for host in hostnames]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    certificate_path, key_path = directory / "cert.pem", directory / "key.pem"
    certificate_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate_path, key_path)
    return context, certificate_path


@dataclass
class TlsEndpoint:
    port: int = 0
    sni_names: list[str | None] = field(default_factory=list)
    requests: list[tuple[str, str]] = field(default_factory=list)
    request_headers: list[dict[str, str]] = field(default_factory=list)
    cookie_header: str | None = None

    def endpoint(self, hostname: str, path: str) -> str:
        return f"https://{hostname}:{self.port}{path}"

    def observe_sni(
        self,
        _socket: ssl.SSLSocket | ssl.SSLObject,
        server_name: str | None,
        _context: ssl.SSLContext,
    ) -> None:
        self.sni_names.append(server_name)

    async def serve(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            async with asyncio.timeout(5):
                while True:
                    header = await reader.readuntil(b"\r\n\r\n")
                    lines = header.decode().split("\r\n")
                    headers = {
                        key.casefold(): value
                        for key, value in (
                            line.split(": ", 1)
                            for line in lines[1:]
                            if ": " in line
                        )
                    }
                    count = int(headers.get("content-length", "0"))
                    if count:
                        await reader.readexactly(count)
                    path = lines[0].split()[1]
                    self.requests.append((headers["host"], path))
                    self.request_headers.append(headers)
                    writer.write(_response(path, self.cookie_header))
                    await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, TimeoutError):
            return
        finally:
            writer.close()
            await writer.wait_closed()


def _response(path: str, cookie_header: str | None = None) -> bytes:
    body = (
        {"access_token": "test-token", "token_type": "Bearer"}
        if path == "/token"
        else {"value": 42}
    )
    payload = json.dumps(body).encode()
    cookie = (
        f"Set-Cookie: {cookie_header}\r\n".encode("ascii")
        if path == "/token" and cookie_header is not None
        else b""
    )
    return (
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
        + str(len(payload)).encode()
        + b"\r\n"
        + cookie
        + b"\r\n"
        + payload
    )


@asynccontextmanager
async def local_tls(
    context: ssl.SSLContext, *, cookie_header: str | None = None
) -> AsyncIterator[TlsEndpoint]:
    endpoint = TlsEndpoint(cookie_header=cookie_header)
    context.set_servername_callback(endpoint.observe_sni)
    tasks: set[asyncio.Task[None]] = set()

    def connected(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        task = asyncio.create_task(endpoint.serve(reader, writer))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    server = await asyncio.start_server(connected, "127.0.0.1", 0, ssl=context)
    endpoint.port = server.sockets[0].getsockname()[1]
    try:
        yield endpoint
    finally:
        server.close()
        await server.wait_closed()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
