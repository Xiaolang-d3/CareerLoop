# 桌面版

桌面版使用 Tauri 2：React 前端仍复用 `frontend/`，FastAPI 以受限的 loopback sidecar 运行；每次启动使用动态端口，并在显示窗口前校验服务名、版本和实例 ID。退出应用时会终止并等待 sidecar，SQLite、附件和工作区写入操作系统的用户级应用数据目录，不会写入应用安装目录。

浏览器开发模式和 `scripts/dev.sh` 不受影响。

当前版本面向 **macOS ARM64 内部测试**。

## 构建步骤

在每个目标系统的发布构建机上执行：

```bash
cd desktop
npm install
../backend/scripts/install_deps.sh ../backend/.venv dev   # 运行时 + 测试依赖，按哈希安装
npm run package-sidecar
../backend/.venv/bin/python scripts/smoke-sidecar.py
npm run build
```

## 架构说明

- Tauri 要求 sidecar 带目标三元组后缀，不要把本机生成的二进制复制到其他系统或架构。
- Python 后端以 PyInstaller onedir runtime 放入应用资源目录，Tauri 通过同架构的原生 launcher 启动它。
- 开发桌面壳可运行 `npm run dev`，但仍需要先生成当前平台的真实 sidecar，不能用占位脚本构建。
- 为控制内部包体积，首版桌面包不包含可选的图片 OCR 推理栈；PDF、DOCX、纯文本和粘贴文本仍可正常导入，图片 OCR 在安装可选依赖的浏览器开发环境可用。
- `text/event-stream` 由桌面桥按块转发到 WebView，仍走 loopback 且不经过系统代理；JSON 和文件响应仍整包返回。关应用仍会停掉 sidecar 里的任务。

## CI 制品

桌面 CI 生成临时签名、未公证的 macOS ARM64 `.app` / `.dmg` 内部制品。
