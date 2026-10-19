# 联网搜索

灯灯默认不依赖联网搜索即可运行。启用后，可直接使用 Tavily API，也可连接独立部署的 AgentSearch。

## 使用 Tavily

在本地 `backend/.env` 配置并重启后端：

```dotenv
WEB_RESEARCH_ENABLED=true
WEB_SEARCH_PROVIDER=auto
TAVILY_API_KEY=你的搜索密钥
```

`auto` 会在配置了 `TAVILY_API_KEY` 时选择 Tavily，无需启动本地 AgentSearch。也可用 `WEB_SEARCH_PROVIDER=tavily` / `agent_search` 显式指定服务；指定 Tavily 却没有密钥时会提示配置错误。

模型 API Key 与搜索 API Key 分开使用。密钥只由本地后端读取，不返回浏览器。网络、鉴权或额度错误不会自动切换到另一个服务。

## 使用 AgentSearch

需要单独启动 AgentSearch；`scripts/dev.sh` 不会自动启动它。

AgentSearch 适配器使用 `general`、`news` 和 `company` 搜索策略，目前不支持金融类别或技术资料软偏好，对应选项会禁用并说明原因。启用前请确认所部署的 AgentSearch 版本支持：

```bash
curl "http://127.0.0.1:3939/health"
curl "http://127.0.0.1:3939/search?q=OpenAI&count=2&mode=company"
```

如果第二个请求返回 `Unknown search strategy mode`，该版本与灯灯不兼容，不能仅通过重新构建旧镜像解决；请先升级到明确支持 `company` 策略的版本。

确认兼容后，在 `backend/.env` 中启用集成并重启后端：

```dotenv
AGENT_SEARCH_BASE_URL=http://127.0.0.1:3939
WEB_SEARCH_PROVIDER=agent_search
# AGENT_SEARCH_TOKEN=
WEB_RESEARCH_ENABLED=true
```

`/health` 可能因单个上游引擎超时或验证码显示 `degraded`。应以实际 `/search` 请求能否返回结果为准。

## 对话中的联网选项

对话输入框可以开关联网，并选择自动、通用、新闻或金融类别，以及技术资料来源偏好。可用选项随搜索服务能力变化；Tavily 使用 basic 搜索，自动类别交给服务判断。优先读取搜索返回的正文，缺失时按预算补充提取；提取失败保留摘要并标明原因，回答仍须引用来源。

## 相关文档

- 搜索类别实施细节：[联网搜索类别实施计划](web-search-category-plan.md)
