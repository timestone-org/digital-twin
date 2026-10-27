"""对隔离环境运行账号密钥建模、真实 worker 训练与部署预测验收。"""

import json
import os
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from pathlib import Path
from typing import Any

import httpx

PLATFORM = "/api/v1/platform"
AUTH = "/api/v1/auth"
CONFIG_NODE_COUNT = 4
PREDICTION_TOLERANCE = 0.001
EXPECTED_PREDICTION = 1345


class Scenario:
    """显式指定验收环境的 HTTP 驱动。"""

    def __init__(self) -> None:
        self.client = httpx.Client(
            base_url=os.environ["MODELING_E2E_BASE_URL"],
            timeout=25,
            trust_env=False,
        )
        self.suffix = uuid.uuid4().hex[:10]
        self.resources: dict[str, str] = {}

    def request(
        self, method: str, path: str, body: object = None, *, status: int = 200
    ) -> Any:
        response = self.client.request(method, path, json=body)
        if response.status_code != status:
            raise RuntimeError(
                f"{method} {path}: HTTP {response.status_code}, "
                f"expected {status}"
            )
        return response.json()["data"]

    def login(self) -> None:
        result = self.request(
            "POST",
            f"{AUTH}/sessions",
            {
                "username": "admin",
                "password": os.environ["MODELING_E2E_PASSWORD"],
            },
            status=201,
        )
        self.client.headers["Authorization"] = (
            f"Bearer {result['token']['access_token']}"
        )

    def seed_data(self) -> str:
        code = f"e2e-energy-{self.suffix}"
        table = self.request(
            "POST",
            f"{PLATFORM}/dataset-tables",
            {"code": code, "name": "验收样本：线性能耗"},
            status=201,
        )
        table_id = table["id"]
        for key in ("温度", "负荷", "能耗"):
            self.request(
                "POST",
                f"{PLATFORM}/dataset-tables/{table_id}/columns",
                {"key": key, "name": key},
                status=201,
            )
        base = datetime.now(UTC) - timedelta(days=3)
        for index in range(48):
            temperature, load = 20 + index % 13, 400 + (index % 7) * 15
            self.request(
                "POST",
                f"{PLATFORM}/dataset-tables/{table_id}/records",
                {
                    "ts": (base + timedelta(hours=index)).isoformat(),
                    "values": {
                        "温度": temperature,
                        "负荷": load,
                        "能耗": 2 * temperature + 3 * load + 5,
                    },
                },
                status=201,
            )
        return code

    def publish_template(self, code: str) -> str:
        graph = make_graph(code)
        design = self.request(
            "POST",
            f"{PLATFORM}/modeling-pipelines",
            {
                "code": f"e2e-design-{self.suffix}",
                "name": "能耗预测标准模板",
                "graph": graph,
            },
            status=201,
        )
        template = self.request(
            "POST",
            f"{PLATFORM}/modeling-templates",
            {
                "pipeline_id": design["id"],
                "name": "能耗预测标准模板",
                "description": "输入温度与负荷，预测能耗。隔离环境合成数据。",
            },
            status=201,
        )
        self.resources.update(
            template_id=template["id"], pipeline_id=design["id"]
        )
        return template["id"]

    def partner(self) -> None:
        role = self.request(
            "POST",
            f"{AUTH}/roles",
            {
                "name": f"e2e_partner_{self.suffix}",
                "codes": ["modeling:view", "modeling:run", "modeling:publish"],
            },
            status=201,
        )
        user = self.request(
            "POST",
            f"{AUTH}/users",
            {
                "username": f"partner-{self.suffix}",
                "email": f"partner-{self.suffix}@example.com",
                "password": os.environ["MODELING_E2E_PASSWORD"],
                "role_id": role["id"],
            },
            status=201,
        )
        key = self.request(
            "POST",
            f"{AUTH}/api-keys",
            {
                "user_id": user["id"],
                "name": "隔离环境 E2E",
                "expires_in_days": 1,
            },
            status=201,
        )
        self.client.headers["Authorization"] = f"Bearer {key['secret']}"
        response = self.client.post(
            f"{PLATFORM}/modeling-templates",
            json={
                "pipeline_id": self.resources["pipeline_id"],
                "name": "禁止的模板设计",
            },
        )
        if response.status_code != HTTPStatus.FORBIDDEN:
            raise RuntimeError("第三方不应获得模板设计权限")

    def instantiate(self, template_id: str) -> str:
        config = self.request(
            "GET", f"{PLATFORM}/modeling-templates/{template_id}/configuration"
        )
        if (
            len(config["nodes"]) != CONFIG_NODE_COUNT
            or not config["json_schema"]["properties"]["nodes"]
        ):
            raise RuntimeError("配置 Schema 不完整")
        model = self.request(
            "POST",
            f"{PLATFORM}/modeling-instances",
            {
                "template_id": template_id,
                "code": f"e2e-model-{self.suffix}",
                "name": "第三方冷机能耗模型",
            },
            status=201,
        )
        updated = self.request(
            "PUT",
            f"{PLATFORM}/modeling-instances/{model['id']}/configuration",
            {
                "expected_revision": model["revision"],
                "configuration": config["configuration"],
                "name": "第三方冷机能耗模型（已配置）",
            },
        )
        if updated["revision"] != model["revision"] + 1:
            raise RuntimeError("参数修订号没有推进")
        self.resources["instance_id"] = model["id"]
        return model["id"]

    def train(self, instance_id: str) -> str:
        path = f"{PLATFORM}/modeling-instances/{instance_id}:train"
        self.client.headers["Idempotency-Key"] = f"e2e-train-{self.suffix}"
        run = self.request("POST", path, {"trigger": "api"}, status=202)
        replay = self.request("POST", path, {"trigger": "api"}, status=202)
        self.client.headers.pop("Idempotency-Key")
        if run["id"] != replay["id"]:
            raise RuntimeError("训练幂等键没有生效")
        deadline = time.monotonic() + 90
        while (
            run["status"] in {"pending", "running", "cancelling"}
            and time.monotonic() < deadline
        ):
            time.sleep(0.5)
            run = self.request("GET", f"{PLATFORM}/modeling-runs/{run['id']}")
        if run["status"] != "succeeded":
            raise RuntimeError(
                f"训练未成功: {run['status']} {run.get('error_text')}"
            )
        self.resources["run_id"] = run["id"]
        return run["id"]

    def deploy(self, instance_id: str, run_id: str) -> None:
        version = self.request(
            "POST",
            f"{PLATFORM}/modeling-model-versions",
            {"run_id": run_id, "name": "E2E 训练版本"},
            status=201,
        )
        code = f"e2e-serving-{self.suffix}"
        deployment = self.request(
            "POST",
            f"{PLATFORM}/modeling-instances/{instance_id}:deploy",
            {
                "model_version_id": version["id"],
                "code": code,
                "name": "E2E 预测服务",
            },
            status=201,
        )
        key = self.request(
            "POST",
            f"{PLATFORM}/modeling-deployments/{deployment['id']}/api-keys",
            {"name": "E2E 推理"},
            status=201,
        )
        self.client.headers.pop("Authorization")
        self.client.headers["X-Api-Key"] = key["plaintext"]
        signature = self.request("GET", f"{PLATFORM}/open-models/{code}")
        prediction = self.request(
            "POST",
            f"{PLATFORM}/open-models/{code}:predict",
            {"rows": [{"温度": 25, "负荷": 430}]},
        )
        if (
            not signature
            or abs(prediction["predictions"][0] - EXPECTED_PREDICTION)
            > PREDICTION_TOLERANCE
        ):
            raise RuntimeError("真实预测与已知线性规律不一致")
        self.resources.update(
            version_id=version["id"],
            deployment_id=deployment["id"],
            deployment_code=code,
        )


def make_graph(code: str) -> dict[str, object]:
    configs = _graph_configs(code)
    edges = [
        ("source", "frame", "split", "frame"),
        ("split", "train", "model", "train"),
        ("split", "test", "model", "test"),
        ("model", "scored", "evaluation", "scored"),
    ]
    return {
        "format_version": "1.0",
        "nodes": [
            {
                "id": name,
                "operator": operator,
                "alias": "",
                "config": config,
                "position": {"left": index * 270, "top": 120},
            }
            for index, (name, operator, config) in enumerate(configs)
        ],
        "edges": [
            {
                "id": f"edge-{index}",
                "from_node": source,
                "from_port": output,
                "to_node": target,
                "to_port": input_port,
            }
            for index, (source, output, target, input_port) in enumerate(edges)
        ],
    }


def _graph_configs(code: str) -> list[tuple[str, str, dict[str, object]]]:
    configs: list[tuple[str, str, dict[str, object]]] = [
        (
            "source",
            "ledger_source",
            {
                "table_code": code,
                "columns": ["温度", "负荷", "能耗"],
                "row_source": "manual",
                "since": "",
                "until": "",
            },
        ),
        (
            "split",
            "split_dataset",
            {
                "target_column": "能耗",
                "test_ratio": 0.2,
                "method": "time_order",
            },
        ),
        ("model", "linear_regression", {}),
        ("evaluation", "regression_metrics", {}),
    ]
    return configs


def main() -> None:
    scenario = Scenario()
    try:
        scenario.login()
        template_id = scenario.publish_template(scenario.seed_data())
        scenario.partner()
        instance_id = scenario.instantiate(template_id)
        scenario.deploy(instance_id, scenario.train(instance_id))
        Path(os.environ["MODELING_E2E_RESULT"]).write_text(
            json.dumps(
                {"passed": True, "resources": scenario.resources},
                ensure_ascii=False,
                indent=2,
            )
        )
        sys.stdout.write(
            "PASS: real gateway, API-key permissions, schema, configuration, "
            "worker, deployment and prediction\n"
        )
    finally:
        scenario.client.close()


if __name__ == "__main__":
    main()
