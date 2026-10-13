"""Translate the validated, protocol-neutral model profile parameters."""
from typing import Any


def request_parameters(parameters: dict[str, float | int], output_field: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if "temperature" in parameters:
        result["temperature"] = parameters["temperature"]
    if "max_output_tokens" in parameters:
        result[output_field] = parameters["max_output_tokens"]
    return result
