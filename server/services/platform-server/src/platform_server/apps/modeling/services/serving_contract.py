"""模型任务到公开服务地址的映射。"""

from platform_server.apps.modeling.protocols import ModelTask
from platform_server.settings import API_PREFIX


def signature_url(code: str) -> str:
    return f"{API_PREFIX}/open-models/{code}"


def invoke_url(code: str, task: ModelTask) -> str:
    """给出对应任务的推荐调用地址。Args: code, task。"""
    action = {
        "regression": "predict",
        "classification": "predict",
        "anomaly_detection": "detect",
        "rule_calculation": "calculate",
    }[task]
    return f"{signature_url(code)}:{action}"
