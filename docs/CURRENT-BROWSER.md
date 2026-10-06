# 操作已有浏览器标签页

当前开发分支新增微软官方 Playwright Extension 连接。已有浏览器适配器仍在验收阶段，稳定 1.0 安装包不包含此功能；尚无企业后台业务或提速成绩。

## 安装与配置

在日常使用、已登录网站的 Chrome 或 Edge 档案内安装[微软官方扩展](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。扩展要求页面调试、网站数据及标签页组访问权限；访问范围和连接撤销使用官方授权界面。

官方扩展 0.4.0 的连接界面同时警告：授权客户端可能获得整个浏览器的调试访问，包括其他标签页与已登录会话，并允许以后重连。标签页组不能据此视为可靠的权限隔离边界。客户端的来源和目标限制属于本项目执行约束，不降低浏览器授予的底层权限；接受实际授权范围后才能继续。要限制底层访问，需使用独立档案，这会放弃直接复用当前档案的目标。

运行 `inspire-jev setup`，浏览器模式选择 `extension`，填写档案目录名称。档案名称是 `chrome://version` 中 Profile Path 的最后一段，例如 `Default` 或 `Profile 2`，不是账号名。

可选连接 token 从官方扩展界面取得，通过隐藏输入保存；不能放入命令参数。留空时通过官方界面确认连接，不需要重新登录网站。

```sh
inspire-jev config set browserMode
inspire-jev config set extensionProfile
inspire-jev config set PLAYWRIGHT_MCP_EXTENSION_TOKEN
inspire-jev config show
```

token 保存在私密凭据文件中；`config show` 只显示是否配置。已有 Chrome 使用自身网络设置，模型仍使用 `modelProxy`。`browserProxy` 仅用于独立受控浏览器。

## 工具使用

1. `jev_session` 的 `connect` 完成官方连接，返回当前授权页面。
2. `tabs` 返回授权范围内的标签页及 `targetId`。
3. `attach` 传入 `targetId` 和明确 `allowedOrigins`；不导航、不刷新、不新建业务页。
4. 使用 `inspect` 获取新鲜引用，或传递完整任务给 `jev_run`；`running` 时使用 `jev_resume`。
5. `detach` 释放会话，用户页面和浏览器保留。关闭服务释放后端连接。

`open` 继续表示独立受控浏览器，不能用来替代失败的“当前网页”连接。OpenAI 原生浏览器编号和扩展编号分别使用，不可互换。

## 已验证与限制

- 上游真实 stdio 服务已通过版本及工具契约检查。
- 通过同一官方后端的受控 CDP 契约，验证原标签页读写、frame 身份、旧引用拒绝、取消和断开后页面保留。
- 真实 Books to Scrape 页面完成读取及详情导航；该记录是开发验证，不是用户 Chrome 扩展验收。
- 官方扩展、企业后台业务、三入口和速度对照尚待实际验收。
- 当前扩展观测复用既有有界 DOM 观测函数；上游 AX 快照复用与简化任务接口尚未交付。
- 标签页访问撤销、未知动作和来源不足均须原现场核对，不创建替代网页。frame CSS 形式的旧检查暂不支持此适配器，使用观测返回的 `frameId`。

## English

This development branch adds an internal, pinned Playwright MCP backend for the official Microsoft browser extension. Stable 1.0 does not include this capability. Install the official extension in the existing signed-in browser profile, select `extension` during setup, and enter the profile directory name. An optional extension token is entered through a hidden prompt and stored outside the repository.

Use `connect`, `tabs`, and `attach` with an observed `targetId` and allowed origins. Attaching does not navigate or create a business tab. `detach` retains the user's page. Existing `open` continues to use the independent managed browser. Backend contracts and a public-site development flow have passed; the actual extension path, enterprise workflows and performance comparison remain unverified. No speed claim is made.
