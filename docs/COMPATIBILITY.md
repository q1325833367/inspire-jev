# 兼容矩阵

RC 状态按能力分别记录。目标覆盖六个 OS/架构组合；配置和进程身份代码适配不等于完整业务验收通过。

|系统 / 架构|核心回归|真实浏览器|GPT 插件|Pi|stdio MCP|
|---|---|---|---|---|---|
|macOS ARM64|本机 55 项通过|Books to Scrape 适配器流程通过；Jev 正式验收待运行|安装流程待验证|安装流程待验证|本版待验证|
|macOS x64|CI 待运行|待验证|待验证|待验证|待验证|
|Windows 11 ARM64|CI / 本机 VM 待验证|待验证|宿主可用性待验证|待验证|待验证|
|Windows x64|Server CI 待运行；Windows 11 待验证|待验证|宿主可用性待验证|待验证|待验证|
|Linux ARM64|CI 待运行|待验证|宿主可用性待验证|待验证|待验证|
|Linux x64|CI 待运行|待验证|宿主可用性待验证|待验证|待验证|

CI 使用 macOS ARM/Intel、Ubuntu ARM/x64、Windows 11 ARM 和 Windows Server x64 标准运行器。Server 成绩不等于 Windows 11 成绩；Windows ARM 上浏览器可能使用 x64 模拟，运行报告记录实际情况。[GitHub 运行器规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

GPT 当前交付路径为独立浏览器 MCP。宿主内置 Computer Use 后端没有被替换；真正侧栏适配仍需宿主接口验证。桌面应用（包括 UTM）尚无 Jev 适配器。

浏览器支持范围以 [Playwright 系统要求](https://playwright.dev/docs/intro#system-requirements) 为基础。每个平台发布通过状态必须附安装、配置、实际网站完整流程和对应宿主证据。跨平台构建、模拟服务回归及无模型浏览器冒烟均不计入正式 Jev 验收。
