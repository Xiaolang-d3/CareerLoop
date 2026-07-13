from __future__ import annotations

from uuid import uuid4

from ..domain import ModelRequest, ModelResponse, ToolCall


class FakeModelProvider:
    name = "fake"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        tool_messages = [message for message in request.messages if message.role == "tool"]
        if not tool_messages:
            user_message = next(
                (message.content for message in reversed(request.messages) if message.role == "user"),
                "",
            )
            return ModelResponse(
                tool_calls=[
                    ToolCall(
                        id=f"fake-{uuid4().hex[:12]}",
                        name="search_jobs",
                        arguments={"keywords": [user_message], "limit": 5},
                    )
                ],
                provider_metadata={"mode": "deterministic"},
            )

        jobs = tool_messages[-1].payload.get("jobs", [])
        if not jobs:
            return ModelResponse(content="暂时没有找到符合条件的岗位，请调整关键词或城市后重试。")

        lines = ["我通过模拟招聘平台找到了这些候选岗位："]
        for index, job in enumerate(jobs, start=1):
            salary = job.get("salary", {}) or {}
            salary_text = salary.get("text") or "薪资面议"
            location = job.get("location") or "地点未注明"
            lines.append(
                f"{index}. {job['title']}｜{job['company']}｜{location}｜{salary_text}"
            )
        lines.append("当前结果来自 Mock Platform，用于验证 Agent 工具调用链路。")
        return ModelResponse(content="\n".join(lines), provider_metadata={"mode": "deterministic"})
