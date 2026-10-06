# 兼容矩阵

## 1.1 RC 本地决策后端

以下是本地推理的实际验证状态，不沿用浏览器或核心 CI 的平台成绩。云端仍是默认；详情与失败记录见[本地对照报告](validation/local-model-comparison-20261006.md)。

|后端|macOS ARM64 实测|macOS x64 / Windows / Linux|
|---|---|---|
|OpenJev／SemIf + 本项目桥接|MLX、Qwen3.5-4B；三项单阶段网页任务各重复三次，9/9 通过；固定观测回放 6/9|模型推理与真实业务待验证；当前桥接使用 Apple MLX|
|Kev-0.5B|官方 torch / MPS / fp32；固定观测回放 3/9，完整流程 0/9，保持实验状态|待验证|
|Laya multilingual|官方 torch / MPS；本轮批量接口 HTTP 422，完整流程未通过|待验证|
|自定义 System One 兼容端点|HTTP 契约及密钥隔离回归通过；具体模型待验证|具体模型待验证|

模型服务需自行安装并启动。云端与本地不会静默互相回退；上述单阶段开发对照不等于三个主 Agent 入口的正式验收。

## 1.0 与历史宿主证据

1.0 的九项公开网站原生验收与三系统安装结果以[同版报告](https://github.com/q1325833367/inspire-jev/releases/download/v1.0.0/acceptance-report.json)为准。以下历史证据保留原版本与分类；登录表单及速度对照不在首发验收范围。

|系统 / 架构|核心回归|真实浏览器|GPT 插件|Pi|stdio MCP|
|---|---|---|---|---|---|
|macOS ARM64|RC.7 发布包本机及 CI 61 项通过|Books 适配器流程通过|RC.7 桌面对话原生 MCP 完成作者搜索、前三本详情与格式，8 次动作、0 次接管；正式验收待完成|Pi 0.84.3 / 官方 zai GLM 5.3 的历史开发流程经接管完成；RC.7 本机 Pi 待验证|RC.7 原生 Codex CLI / GPT 完整 Books 目标通过，1 次采集接管及 1 次参数拒绝保留|
|macOS x64|CI 61 项通过|CI Books 适配器流程通过|待验证|待验证|待验证|
|Windows 11 ARM64|CI 60 项通过，1 项平台适用跳过；实机安装通过|实机 Books 与 Gutenberg 51 次操作通过；Chromium x64 模拟|宿主可用性待验证|RC.7 Pi 0.84.3 / 官方 zai GLM 5.3 完整 Books 目标通过，4 次动作、0 次接管|RC.7 实际 stdio MCP / Jev、取消、重启及原档案续跑通过；Windows Codex CLI 模型调用待验证|
|Windows x64|Server CI 60 项通过，1 项平台适用跳过；Windows 11 实机待验证|Server CI Books 适配器流程通过|宿主可用性待验证|待验证|待验证|
|Linux ARM64|CI 60 项通过，1 项平台适用跳过|CI Books 适配器流程通过|宿主可用性待验证|待验证|待验证|
|Linux x64|CI 60 项通过，1 项平台适用跳过|CI Books 适配器流程通过|宿主可用性待验证|待验证|待验证|

RC.7 [六平台 CI](https://github.com/q1325833367/inspire-jev/actions/runs/37409948590) 全部通过。CI 网页流程不调用模型，不能用来宣称 Jev 成功率或提速。Linux 与 Windows 跳过的 1 项是仅适用于 macOS 的实际进程沙箱参数检查。

macOS 原生 Codex CLI 0.160.1 / GPT 通过 MCP 完成 Books 分类、现场首本详情、价格、UPC 与返回流程。共 4 次动作（含 1 次接管滚动）、核心累计 1,801 毫秒、端到端 90,860 毫秒。错误采集方案及参数拒绝记录保留；该开发验证不计入桌面插件的正式成绩。

Windows 11 本机使用微软 ARM64 90 天评估系统，Node.js 原生 ARM64，Chromium 使用 x64 模拟。模型与浏览器分别使用显式 HTTP 代理，TUN 关闭。安装、Pi/MCP 实际流程、升级、回退、卸载和凭据保留见 [Windows 验证记录](validation/windows11-arm64.md)。计时、主模型用量与全部限制见 [发布验证附件](https://github.com/q1325833367/inspire-jev/releases/download/v1.0.0-rc.8/validation-evidence.json)。

CI 使用 macOS ARM/Intel、Ubuntu ARM/x64、Windows 11 ARM 和 Windows Server x64 标准运行器。Server 成绩不等于 Windows 11 实机成绩。[GitHub 运行器规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

GPT 当前交付路径为独立浏览器 MCP。宿主内置 Computer Use 后端没有被替换；侧栏适配仍需宿主接口验证。桌面应用（包括 UTM）尚无 Jev 适配器。已安装的包版本与宿主当前运行的服务版本必须分别核对，更新安装文件后按宿主提示重新加载连接。

浏览器支持范围以 [Playwright 系统要求](https://playwright.dev/docs/intro#system-requirements) 为基础。正式通过状态必须附同版安装、配置、真实主 Agent 完整业务和对应平台证据。全部旧失败、接管及未知动作记录保留；开发集、构建及无模型冒烟不计入正式验收。
