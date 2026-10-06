# 兼容矩阵

RC 状态按能力分别记录。目标覆盖六个 OS/架构组合；配置和进程身份代码适配不等于完整业务验收通过。

|系统 / 架构|核心回归|真实浏览器|GPT 插件|Pi|stdio MCP|
|---|---|---|---|---|---|
|macOS ARM64|RC.7 本机 61 项通过；RC.6 CI 55 项通过|Books to Scrape 适配器流程通过|RC.6 三入口已安装；桌面原生调用完整验收待验证|RC.5：Pi 0.84.3 / zai GLM 5.3 网页任务经接管完成|RC.7 源码 stdio MCP / Jev Books 完整流程通过；CLI 原生工具调用待验证|
|macOS x64|CI 55 项通过|Books to Scrape 适配器流程通过|待验证|待验证|待验证|
|Windows 11 ARM64|RC.6 CI 54 项通过 / 1 项平台跳过；本机包安装通过|本机 Books 完整流程通过；Chromium x64 模拟|宿主可用性待验证|RC.6：Pi 0.84.3 / zai GLM 5.3 经 3 次接管完成 Books 原始目标|RC.6：实际 stdio MCP / Jev Books 完整流程通过；重启后返回目的地存在缺陷|
|Windows x64|Server CI 54 项通过 / 1 项平台跳过；Windows 11 待验证|Server CI Books to Scrape 适配器流程通过|宿主可用性待验证|待验证|待验证|
|Linux ARM64|CI 54 项通过 / 1 项平台跳过|Books to Scrape 适配器流程通过|宿主可用性待验证|待验证|待验证|
|Linux x64|CI 54 项通过 / 1 项平台跳过|Books to Scrape 适配器流程通过|宿主可用性待验证|待验证|待验证|

已发布 RC.6 运行证据：[跨平台 CI](https://github.com/q1325833367/inspire-jev/actions/runs/37405723886)。新版本的 CI 与本机宿主安装需分别验证。CI 网页流程不调用模型，不能用来宣称 Jev 成功率或提速。Linux 与 Windows 跳过的 1 项是仅适用于 macOS 的实际进程沙箱参数检查。

原生 Pi 开发冒烟保留 2 次接管：调用方检查器没有唯一定位首本书；在同一会话修正检查器并使用新调用编号后，独立核验完整业务目标通过。3 次实际动作，核心累计 4,632 毫秒，计入主模型规划与接管的端到端耗时 137,888 毫秒。原任务的失败状态保留。这次结果不属于正式验收，也不用于速度优势结论。

Windows 11 本机使用微软 ARM64 90 天评估系统，Node.js 原生 ARM64，浏览器可执行文件为 x64。安装、显式代理、模型连通性、Pi 与 MCP 业务开发验证详见 [Windows 验证记录](validation/windows11-arm64.md)。这些记录不计入正式 54 次验收。

CI 使用 macOS ARM/Intel、Ubuntu ARM/x64、Windows 11 ARM 和 Windows Server x64 标准运行器。Server 成绩不等于 Windows 11 成绩；Windows ARM 上浏览器可能使用 x64 模拟，运行报告记录实际情况。[GitHub 运行器规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

GPT 当前交付路径为独立浏览器 MCP。宿主内置 Computer Use 后端没有被替换；真正侧栏适配仍需宿主接口验证。桌面应用（包括 UTM）尚无 Jev 适配器。

浏览器支持范围以 [Playwright 系统要求](https://playwright.dev/docs/intro#system-requirements) 为基础。每个平台发布通过状态必须附安装、配置、实际网站完整流程和对应宿主证据。跨平台构建、模拟服务回归及无模型浏览器冒烟均不计入正式 Jev 验收。
