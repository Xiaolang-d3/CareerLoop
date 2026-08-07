# BossCopilot 浏览器助手

本地 Chrome 扩展，为 BossCopilot 提供用户主动触发的页面读取能力。

## 构建与安装

```bash
npm test
npm run build
```

然后打开 `chrome://extensions/`：

1. 开启“开发者模式”。
2. 选择“加载已解压的扩展程序”。
3. 选择本目录生成的 `dist/`。

后端还需要设置：

```text
BROWSER_JOB_IMPORT_ENABLED=true
```

扩展不会读取 Cookie、浏览历史、密码或浏览器存储，也不会自动点击、投递或沟通。
