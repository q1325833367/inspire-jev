# 安装、更新与卸载

需要 Node.js 24，以及 [Playwright 支持的系统](https://playwright.dev/docs/intro#system-requirements)。平台实测状态见 [兼容矩阵](COMPATIBILITY.md)。

```sh
npm install --global https://github.com/q1325833367/inspire-jev/releases/download/v1.0.0/inspire-jev-1.0.0.tgz
inspire-jev setup
```

安装包来自 GitHub Releases，依赖通过 `npm-shrinkwrap.json` 固定。发布页提供 SHA256 校验和。首次安装需要下载 Chromium；Linux 缺少系统库时按 Playwright 官方指南运行 `npx playwright@1.63.0 install-deps chromium`，再重试安装。

## Linux 沙箱

Ubuntu 的 AppArmor 可能限制 Chromium 使用用户命名空间。出现 `BROWSER_SANDBOX_UNAVAILABLE` 时，先确认浏览器已下载，再生成仅匹配本版浏览器路径的配置，阅读后由管理员安装：

```sh
inspire-jev linux-sandbox-profile > inspire-jev-browser.profile
cat inspire-jev-browser.profile
sudo install -m 644 inspire-jev-browser.profile /etc/apparmor.d/inspire-jev-browser
sudo apparmor_parser -r /etc/apparmor.d/inspire-jev-browser
```

该配置遵循 [Chromium 的 AppArmor 指南](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)，只允许指定浏览器使用命名空间。浏览器沙箱保持启用，系统限制保持开启。浏览器更新后重新生成；卸载时可用 `sudo apparmor_parser -R /etc/apparmor.d/inspire-jev-browser` 卸载规则，再删除该文件。未启用 AppArmor 的系统无需此操作。

## 三个入口

```sh
inspire-jev install --entry gpt
inspire-jev install --entry pi
inspire-jev install --entry mcp
```

`--entry all` 安装已存在的 GPT/Pi 宿主和通用 MCP。各入口指向同版核心，不复制浏览器登录态。

- GPT 插件：需要本机可用的 Codex CLI。安装器注册本地技能插件与固定 `gpt` 身份的 `inspire-jev-desktop` stdio MCP 连接，在桌面宿主启用连接并加载新对话；新工具未出现时重启宿主。当前版本使用独立受控浏览器，侧栏路径按兼容矩阵记录。
- Pi 扩展：需要已安装 Pi；扩展通过原生 `pi install` 注册。重开 Pi 或加载扩展后使用五个 `jev_*` 工具，主模型仍由 Pi 配置。
- MCP：生成私密目录中的 `mcp-client.json`。将 `mcpServers` 内容合并到客户端原生配置；有 Codex CLI 时同时注册 `inspire-jev-cli`。服务使用 Node 绝对路径和版本化脚本，不依赖 Unix 启动脚本。

MCP 使用宿主启动的 stdio 进程，stdout 只承载协议。宿主授权通过原生通道完成；不要通过放宽全局审批设置解决工具权限问题。

## 更新与回退

```sh
inspire-jev upgrade --package https://github.com/q1325833367/inspire-jev/releases/download/v1.0.0/inspire-jev-1.0.0.tgz
inspire-jev rollback --version 1.0.0-rc.8
inspire-jev version
```

使用具体发布版本。升级保存版本化核心、配置备份、检查点及登录档案；回退需要对应版本已存在于本机。宿主正在运行时先结束任务，再刷新宿主。旧 PoC 检查点不自动重放；不确定动作必须检查原现场。

## 卸载

```sh
inspire-jev uninstall --entry all
npm uninstall --global inspire-jev
```

入口卸载保留凭据、登录档案、恢复证据和版本目录。通用 MCP 客户端中手动合并的配置需从对应客户端删除。要彻底删除某个档案，先关闭其会话并备份需要的证据，再删除对应私密目录；不要删除正在运行或效果未知的任务资料。

## 排障

`inspire-jev doctor` 返回配置、平台及网络诊断。模型错误与浏览器错误分别报告。代理不可达时检查监听端口和宿主可达地址；无需打开 TUN。浏览器登录由用户手动完成；第三方 OAuth 拒绝自动化浏览器时，使用服务原生支持的登录方式或记录兼容阻塞。
