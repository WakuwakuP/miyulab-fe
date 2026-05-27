#!/usr/bin/env python3
"""Fetch miyulab-fe SonarQube metrics via sonarqube-ce-mcp client logic."""

from __future__ import annotations

import json
import os
import sys

from sonarqube_mcp.settings import SonarQubeSettings, load_settings
from sonarqube_mcp.sonarqube_client import SonarQubeClient

PROJECT_KEY = "WakuwakuP_miyulab-fe_4aa1e963-ad00-4ad4-9169-1d86c0671a4d"

DEFAULT_METRIC_KEYS = ",".join(
    [
        "bugs",
        "vulnerabilities",
        "code_smells",
        "security_hotspots",
        "coverage",
        "duplicated_lines_density",
        "ncloc",
        "sqale_index",
        "reliability_rating",
        "security_rating",
        "sqale_rating",
        "alert_status",
        "quality_gate_details",
    ]
)


def load_runtime_settings() -> SonarQubeSettings:
    url = os.getenv("SONARQUBE_URL") or os.getenv("SONAR_HOST_URL")
    token = os.getenv("SONARQUBE_TOKEN") or os.getenv("SONAR_TOKEN")
    if url:
        os.environ.setdefault("SONARQUBE_URL", url.rstrip("/"))
    if token:
        os.environ.setdefault("SONARQUBE_TOKEN", token)
    return load_settings()


def analyze(metrics: dict[str, str | None]) -> list[dict[str, str]]:
    problems: list[dict[str, str]] = []

    alert = metrics.get("alert_status")
    if alert and alert != "OK":
        problems.append(
            {
                "metric": "alert_status",
                "value": alert,
                "reason": "品質ゲートが OK ではありません",
            }
        )

    for key, label in (
        ("reliability_rating", "信頼性"),
        ("security_rating", "セキュリティ"),
        ("sqale_rating", "保守性"),
    ):
        raw = metrics.get(key)
        if raw is None:
            continue
        try:
            rating = float(raw)
        except ValueError:
            continue
        if rating >= 3.0:
            problems.append(
                {
                    "metric": key,
                    "value": raw,
                    "reason": f"{label}評価が C 以下相当 (1=A … 5=E)",
                }
            )

    for key, label, threshold in (
        ("bugs", "バグ", 0),
        ("vulnerabilities", "脆弱性", 0),
        ("code_smells", "コードスメル", 0),
        ("security_hotspots", "セキュリティホットスポット", 0),
    ):
        raw = metrics.get(key)
        if raw is None:
            continue
        try:
            count = int(float(raw))
        except ValueError:
            continue
        if count > threshold:
            problems.append(
                {
                    "metric": key,
                    "value": raw,
                    "reason": f"{label}が {count} 件あります",
                }
            )

    coverage = metrics.get("coverage")
    if coverage is not None:
        try:
            cov = float(coverage)
            if cov < 80.0:
                problems.append(
                    {
                        "metric": "coverage",
                        "value": coverage,
                        "reason": "カバレッジが 80% 未満です",
                    }
                )
        except ValueError:
            pass

    dup = metrics.get("duplicated_lines_density")
    if dup is not None:
        try:
            density = float(dup)
            if density > 3.0:
                problems.append(
                    {
                        "metric": "duplicated_lines_density",
                        "value": dup,
                        "reason": "重複行率が 3% を超えています",
                    }
                )
        except ValueError:
            pass

    return problems


def main() -> int:
    settings = load_runtime_settings()
    if not settings.sonarqube_token:
        print(
            "SONARQUBE_TOKEN (または SONAR_TOKEN) が未設定です。",
            file=sys.stderr,
        )
        return 1

    with SonarQubeClient(settings) as client:
        result = client.get_measures(PROJECT_KEY, DEFAULT_METRIC_KEYS)

    component = result.get("component", {})
    measures = {m["metric"]: m.get("value") for m in component.get("measures", [])}
    problems = analyze(measures)

    report = {
        "project_key": component.get("key", PROJECT_KEY),
        "project_name": component.get("name"),
        "metrics": measures,
        "problematic_metrics": problems,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
