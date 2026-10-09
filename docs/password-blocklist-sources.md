# 离线弱密码列表来源

前后端共用 `backend/app/password_policy.json`。基础条目取自 SecLists 的两份公开常见密码列表：10k 列表保留 NFC 规范化后长度为 8–128 的完整密码，100k 列表保留原有的 15–128 字符长密码条目；统一小写去重，另补充少量常见长密码和产品名组合。目前共 2,183 项，覆盖降低注册长度门槛后常见的较短密码。此列表不代表完整的泄露密码库，也不查询或上传用户密码。

- 来源：https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/10k-most-common.txt
  下载日期：2026-10-06；原文件 SHA-256：`68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`。
- 来源：https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt
  下载日期：2026-10-06；原文件 SHA-256：`1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`。

本项目的新增条目按项目许可提供。以下保留 SecLists 的原始许可证：

```text
MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
