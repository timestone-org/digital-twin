"""hierarchy-server 进程通过共享 HTTP 入口启动其正式应用。"""

from unittest.mock import Mock

import pytest
from fastapi import FastAPI

from hierarchy_server import __main__ as entry


def test_http_entrypoint_passes_its_application_and_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Mock(app_role="api", is_worker=False)
    application = FastAPI()
    build = Mock(return_value=application)
    listen = Mock()
    monkeypatch.setattr(entry, "load_settings_or_exit", lambda _type: settings)
    monkeypatch.setattr(entry, "build_app", build)
    monkeypatch.setattr(entry, "serve_http", listen)
    entry.main()
    build.assert_called_once_with(settings)
    listen.assert_called_once_with(application, settings)
