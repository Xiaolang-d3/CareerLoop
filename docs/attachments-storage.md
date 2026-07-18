# 私有附件与 MinIO

聊天附件默认采用本地解析：岗位截图仅提取文字，简历仅提取并脱敏文本。原始文件保存在私有对象存储中，不会自动发送给模型服务。

## 本地开发

启动 MinIO：

```bash
docker compose -f docker-compose.minio.yml up -d
```

开发环境可先使用后端默认的 `ATTACHMENT_STORAGE=local`，文件会落在 `backend/data/attachments`。切换至 MinIO 时，在 `backend/.env` 配置：

```dotenv
ATTACHMENT_STORAGE=minio
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=bosscopilot
MINIO_SECRET_KEY=请替换为本地密钥
MINIO_BUCKET=bosscopilot-attachments
MINIO_SECURE=false
```

桶始终保持私有；前端不会取得 MinIO 密钥。

## 视觉模型增强（默认关闭）

只有模型网关能够读取 HTTPS 图片 URL 时，才可以启用视觉增强。当前流程不使用 Base64 Data URL。启用前必须完成以下部署项：

1. 使用 HTTPS 域名反向代理 MinIO，例如 `files.example.com`。
2. 设置 `MINIO_PUBLIC_ENDPOINT=https://files.example.com`。
3. 设置 `ATTACHMENT_VISION_ENABLED=true`，并按需调整 `ATTACHMENT_VISION_URL_TTL_SECONDS`。
4. 不将签名 URL 写入数据库、聊天记录或日志；签名链接到期后失效，原始对象按附件保留和删除策略管理。

聊天中发送岗位截图时，默认只使用本地 OCR 文本；用户勾选“模型看图”后，后端才会为本轮请求生成短期签名 URL。简历不提供视觉直传，始终只向 Agent 提供本地脱敏文本。
