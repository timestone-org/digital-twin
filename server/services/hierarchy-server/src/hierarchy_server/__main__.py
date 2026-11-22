"""层级图服务进程入口。"""

from hierarchy_server.app import build_app
from hierarchy_server.settings import Settings
from lib.config import load_settings_or_exit
from lib.web import serve_http


def main() -> None:
    settings = load_settings_or_exit(Settings)
    serve_http(build_app(settings), settings)


if __name__ == "__main__":
    main()
