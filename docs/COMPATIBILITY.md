# 兼容矩阵

RC 状态按能力分别记录。目标覆盖六个 OS/架构组合；配置和进程身份代码适配不等于完整业务验收通过。

|系统 / 架构|核心回归|真实浏览器|GPT 插件|Pi|stdio MCP|
|---|---|---|---|---|---|
|macOS ARM64|本机 / CI 55 项通过|Books to Scrape 适配器流程通过|RC.4 三入口已安装；桌面重载后的原生调用待验证|RC.4：Pi 0.84.3 / zai GLM 5.3 原生网页任务通过|RC.4：真实 stdio MCP / Jev Gutenberg 搜索通过|
|macOS x64|CI 55 项通过|Books to Scrape 适配器流程通过|待验证|待验证|待验证|
|Windows 11 ARM64|CI 55 项通过；本机 VM 待验证|CI Books to Scrape 适配器流程通过|宿主可用性待验证|待验证|待验证|
|Windows x64|Server CI 待运行；Windows 11 待验证|待验证|宿主可用性待验证|待验证|待验证|
|Linux ARM64|CI 55 项通过|Books to Scrape 适配器流程通过|宿主可用性待验证|待验证|待验证|
|Linux x64|CI 55 项通过|Books to Scrape 适配器流程通过|宿主可用性待验证|待验证|待验证|

开发分支运行证据：[跨平台 CI](https://github.com/q1325833367/inspire-jev/actions/runs/37404670487)。该运行对应平台修复提交，正式 RC 包与本机宿主安装需分别验证。CI 网页流程不调用模型，不能用来宣称 Jev 成功率或提速。

CI 使用 macOS ARM/Intel、Ubuntu ARM/x64、Windows 11 ARM 和 Windows Server x64 标准运行器。Server 成绩不等于 Windows 11 成绩；Windows ARM 上浏览器可能使用 x64 模拟，运行报告记录实际情况。[GitHub 运行器规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

GPT 当前交付路径为独立浏览器 MCP。宿主内置 Computer Use 后端没有被替换；真正侧栏适配仍需宿主接口验证。桌面应用（包括 UTM）尚无 Jev 适配器。

浏览器支持范围以 [Playwright 系统要求](https://playwright.dev/docs/intro#system-requirements) 为基础。每个平台发布通过状态必须附安装、配置、实际网站完整流程和对应宿主证据。跨平台构建、模拟服务回归及无模型浏览器冒烟均不计入正式 Jev 验收。
