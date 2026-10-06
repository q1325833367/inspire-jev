# 技术来源与许可证

|类别|来源|用途 / 许可证|
|---|---|---|
|改编代码|[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46)|候选观察、并行操作与目标决策的起点；MIT，保留 BrowserUse 版权|
|运行时|[Node.js](https://nodejs.org/)|Node.js 24；Node 项目许可证|
|运行依赖|[Playwright](https://github.com/microsoft/playwright)|浏览器驱动；Apache-2.0|
|运行依赖|[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)|stdio 协议；MIT|
|运行依赖|[Undici](https://github.com/nodejs/undici)|HTTP 与显式代理；MIT|
|运行依赖|[Zod](https://github.com/colinhacks/zod)|参数验证；MIT|
|运行依赖|[cross-spawn](https://github.com/moxystudio/node-cross-spawn)|跨平台进程启动；MIT|
|模型服务|[TypeSafe / Jev](https://docs.typesafe.ai/)|局部动作选择；独立服务条款，不属于本项目 MIT 授权|
|模型服务|[DeepSeek API](https://api-docs.deepseek.com/)|按需新文字生成；独立服务条款|
|可选本地依赖／权重|[Laya](https://github.com/NandhaKishorM/laya)、[多语言权重](https://huggingface.co/convaiinnovations/laya-multilingual)|官方 HTTP 服务；Apache-2.0；权重不随包分发|
|可选本地依赖／权重|[Kev](https://github.com/jaredpalmer/kev)、[Kev-0.5B](https://huggingface.co/jaredpalmer/kev-0.5b)|官方 HTTP 服务；Apache-2.0；0.5B 是已被替代的研究原型|
|可选本地依赖|[OpenJev／SemIf](https://github.com/TheoLeeCJ/SemIf-OpenJev/tree/23cf1f39fc9534fe81437200959b6dfc7106e45a)|调用原生 MLX 评分 API；MIT；本项目提供 HTTP choice 桥接与大候选集分组组合|
|可选基础模型|[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)、[Qwen2.5-0.5B](https://huggingface.co/Qwen/Qwen2.5-0.5B)|SemIf 与 Kev 的基础模型；Apache-2.0；权重不随包分发|
|接口规范|[Pi 扩展](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)|原生工具、取消、进度和状态接口；Pi 不随包分发|
|接口规范|[MCP](https://modelcontextprotocol.io/docs/develop/build-server)|通用 Agent 工具接入|
|接口规范|[Agent Plugins](https://agent-plugins.org/)|可移植插件布局；宿主能力各自验证|
|文档结构参考|[Browser Use](https://github.com/browser-use/browser-use)、[Playwright](https://github.com/microsoft/playwright)|README 信息组织；未复制文档正文|

InspireJev 新增代码采用 MIT，版权见根目录 [LICENSE](../LICENSE)。依赖通过锁文件固定，保留各依赖原许可证。浏览器由 Playwright 官方下载，宿主浏览器运行时不随安装包分发。Windows 和 UTM 仅用于测试环境，不随包分发，不授予其产品许可。

本地依赖按需安装在独立 Python 环境；具体来源、固定权重版本和调用限制见[本地模型指南](LOCAL-MODELS.md)。本地模型不属于 TypeSafe 官方 Jev 权重。上游性能数据不作为 InspireJev 的性能成绩。
