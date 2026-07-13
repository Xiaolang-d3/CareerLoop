from __future__ import annotations

from uuid import uuid4

from ..domain import ModelRequest, ModelResponse, ToolCall


class FakeModelProvider:
    name = "fake"

    _cities = ("北京", "上海", "广州", "深圳", "杭州", "南京", "苏州", "成都", "武汉", "西安", "重庆", "天津")

    @classmethod
    def _search_arguments(cls, user_message: str) -> dict:
        cities = [city for city in cls._cities if city in user_message]
        keyword = user_message
        for city in cities:
            keyword = keyword.replace(city, " ")
        for phrase in (
            "帮我",
            "请",
            "我想找",
            "我想要找",
            "找",
            "相关的工作",
            "相关工作",
            "相关岗位",
            "工作",
            "岗位",
            "职位",
            "的",
        ):
            keyword = keyword.replace(phrase, " ")
        keyword = " ".join(keyword.replace("，", " ").replace(",", " ").split())
        return {
            "keywords": [keyword or user_message],
            "cities": cities,
            "limit": 5,
        }

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
                        arguments=self._search_arguments(user_message),
                    )
                ],
                provider_metadata={"mode": "deterministic"},
            )

        last_tool_message = tool_messages[-1]
        if last_tool_message.payload.get("status") not in {None, "done"}:
            return ModelResponse(content=f"岗位搜索未完成：{last_tool_message.content}")

        jobs = last_tool_message.payload.get("jobs", [])
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
