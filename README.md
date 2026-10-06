[简体中文](README.md) | [English](README.en.md)

# InspireJev

**Turn ideas into actions with Jev.**

A Jev-powered execution toolkit, starting with browser automation.

[![版本：1.0.0-rc.8](https://img.shields.io/badge/version-1.0.0--rc.8-orange)](https://github.com/q1325833367/inspire-jev/releases/tag/v1.0.0-rc.8)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

InspireJev 让主 Agent 优先通过 Jev 工具连续执行网页交互，适用于搜索筛选、资料采集和表单填写。主 Agent 保留完整目标，负责规划、授权、结果核验与必要接管；Jev 从当前页面实际观测到的候选中选择动作。

当前版本为 **RC**：六个平台的核心 CI 回归及真实网页适配器流程已通过，macOS 本地核心回归已通过。Windows 11 ARM64 实机已验证 Pi、MCP、51 次真实网站操作及重启续跑；54 次正式端到端验收与速度对照尚未完成。详细证据与门槛见[兼容矩阵](docs/COMPATIBILITY.md)和[验收说明](docs/ACCEPTANCE.md)。

## 工作方式

`主 Agent 规划与核验 → InspireJev 执行核心 → TypeSafe / Jev 动作决策 → Playwright 浏览器 → 页面证据`

- 连续执行自然业务阶段，返回结构化采集结果和来源。
- 已知输入由执行核心填写；需要新写文字时，可选用 DeepSeek 文本模型。
- 任务以完成条件核验，支持检查点、续跑、取消和同一现场接管。
- 各宿主拥有独立的浏览器会话与档案。用户在受控浏览器中手动登录。

运行依赖：**Node.js 24+**、Playwright 1.63、MCP SDK、Undici、Zod 与 cross-spawn。架构与权限边界见[架构说明](docs/ARCHITECTURE.md)。

## 安装与快速开始

先安装 Node.js 24 或更高版本，再安装 RC 发布包及 Chromium：

```sh
npm install --global https://github.com/q1325833367/inspire-jev/releases/download/v1.0.0-rc.8/inspire-jev-1.0.0-rc.8.tgz
npx playwright@1.63.0 install chromium
inspire-jev setup
inspire-jev install --entry gpt
inspire-jev doctor
```

`setup` 在交互终端中引导配置，密钥输入会被遮蔽。已有私密配置文件时，也可直接引用仓库外的文件：

```sh
inspire-jev setup --env-file /path/outside/repo/credentials.env
```

完成入口安装后，按安装器提示重新加载宿主，在对话中提出网页任务，例如：

> 搜索指定作者的前三本书，逐一打开详情，整理标题、阅读格式和来源链接。

平台前置条件、宿主配置位置和安装故障排查见[安装指南](docs/INSTALLATION.md)。

## 模型与网络配置

浏览器动作决策使用 TypeSafe / Jev；新文字生成使用可选的文本模型。提供商、接口地址和模型名称均可配置。

| 配置项 | 用途 | 默认值 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Jev 决策接口密钥，必需 | 无 |
| `TYPESAFE_BASE_URL` | Jev 接口地址 | `https://api.typesafe.ai/v1/systemone` |
| `TYPESAFE_MODEL` | Jev 模型 | `jev-latest` |
| `TEXT_MODEL_API_KEY` | 新文字生成密钥，按需配置 | 无 |
| `TEXT_MODEL_BASE_URL` | 文本模型接口地址 | `https://api.deepseek.com/v1` |
| `TEXT_MODEL` | 文本模型 | `deepseek-chat` |

查看配置或交互修改密钥：

```sh
inspire-jev config show
inspire-jev config set TYPESAFE_API_KEY
inspire-jev doctor --models
```

`doctor --models` 会实际调用已配置的模型接口。模型请求与浏览器流量分别使用显式 HTTP 代理配置 `modelProxy`、`browserProxy`，也可直连；运行不要求 TUN。密钥应保存在本地私密文件中。代理设置与配置优先级见[配置指南](docs/CONFIGURATION.md)。

## GPT、Pi 与 MCP 入口

安装所需入口，或一次安装全部入口：

```sh
inspire-jev install --entry gpt
inspire-jev install --entry pi
inspire-jev install --entry mcp
inspire-jev install --entry all
```

| 入口 | 使用方式 |
| --- | --- |
| GPT | 安装器配置宿主插件与浏览器技能，按宿主提示加载 |
| Pi | 安装器配置 Pi 扩展与技能，按宿主提示加载 |
| 通用 MCP | 将安装器输出的配置加入支持 stdio MCP 的客户端 |

通用 MCP 服务启动命令：

```sh
inspire-jev mcp --host mcp
```

安装器会输出以 Node 和已安装 CLI 的绝对路径组成的 MCP 配置，适合宿主子进程调用。非 Windows 环境也可在客户端配置中使用 `inspire-jev` 命令。入口细节见[安装指南](docs/INSTALLATION.md)。

三个入口提供相同的五个工具：

| 工具 | 用途 |
| --- | --- |
| `jev_session` | 打开、观察、接管或关闭浏览器会话 |
| `jev_run` | 按业务阶段连续执行任务 |
| `jev_resume` | 核对现场后从检查点继续 |
| `jev_status` | 查看状态、证据、采集数据与剩余要求 |
| `jev_cancel` | 停止发起新动作并保留恢复信息 |

参数与状态定义见[公共 API](docs/API.md)。

## 平台验证状态

| 平台 | 当前验证状态 |
| --- | --- |
| macOS | ARM64 / x64 CI 回归与真实网页适配器流程通过；正式宿主验收未完成 |
| Windows | Windows 11 ARM64 / Server x64 CI 通过；本机 ARM64 已验证 Pi、MCP、取消、恢复及安装生命周期 |
| Linux | ARM64 / x64 CI 回归与真实网页适配器流程通过 |

宿主版本、入口、浏览器能力和平台前置条件以[兼容矩阵](docs/COMPATIBILITY.md)为准。54 项正式验收状态见[验收说明](docs/ACCEPTANCE.md)。

## 示例

常见任务：搜索并筛选结果、比较多条详情、采集网页表格、定位章节并附来源，以及在用户已登录的现场填写草稿。

直接调用工具时，先用 `jev_session` 打开允许的来源：

默认复用该宿主的持久浏览器档案，关闭会话、重启和升级保留登录态。旧安装用 `profiles` 列出已有档案，使用 `useProfile` 选择默认档案；明确需要隔离账号时再指定新的 `profileId`。网站使登录失效时才可能需要重新登录，各宿主的档案保持独立。

```json
{
  "action": "open",
  "url": "https://example.com/",
  "allowedOrigins": ["https://example.com"]
}
```

再用返回的会话编号替换 `SESSION_ID`，向 `jev_run` 传入任务：

```json
{
  "task": {
    "sessionId": "SESSION_ID",
    "requestId": "SESSION_ID-read-001",
    "goal": "读取当前页面标题并返回来源链接",
    "allowedOrigins": ["https://example.com"],
    "subgoals": [{
      "id": "read",
      "goal": "采集页面标题与来源",
      "checks": [
        {"kind": "title", "notEmpty": true},
        {"kind": "url", "equals": "https://example.com/"}
      ],
      "extract": [
        {"name": "title", "source": "title"},
        {"name": "url", "source": "url"}
      ]
    }],
    "completionChecks": [{"kind": "evidence", "subgoal": "read"}]
  }
}
```

返回 `running` 时，用 `jev_resume` 继续；返回 `handoff` 时，主 Agent 先检查同一现场，再接管。`verified` 表示指定检查全部通过，主 Agent 仍须核对它们覆盖了原始业务要求。更多规划示例见[浏览器技能](skills/jev-browser/SKILL.md)和[公共 API](docs/API.md)。

## 使用边界

- 登录、验证码与敏感输入由用户或宿主处理，不复制个人浏览器 cookies。
- 主 Agent 明确允许来源与提交授权，付款、发布、删除等操作沿用宿主授权机制。
- 页面变化后重新观测；未知提交效果先检查，再决定后续动作。
- DOM 观测无法覆盖的画布、Shadow DOM 等场景可能需要接管。
- 默认总预算为 90 秒 / 40 动作，每片段最多 45 秒；长任务最多 15 分钟 / 200 动作。

模型服务费用与网站访问条件由各提供方决定。安全问题请参考[安全政策](SECURITY.md)。

## 升级与卸载

```sh
inspire-jev upgrade --package /path/to/inspire-jev-VERSION.tgz
inspire-jev rollback --version VERSION
inspire-jev uninstall --entry gpt
```

卸载入口可选 `gpt`、`pi`、`mcp` 或 `all`。版本变更见[更新记录](CHANGELOG.md)，升级、回滚和本地数据处理见[安装指南](docs/INSTALLATION.md)。

## 参与贡献

真实使用反馈是项目改进的重要依据。欢迎分享 Agent 执行任务时遇到的卡点、可复现的失败案例，以及值得支持的新场景。测试、文档和体验建议同样是贡献。

- **报告问题：** 在 [Issues](https://github.com/q1325833367/inspire-jev/issues) 提供版本、系统、入口、复现步骤和脱敏证据。
- **讨论想法：** 在 [Discussions](https://github.com/q1325833367/inspire-jev/discussions) 交流使用场景、执行器设计或新的宿主适配。较大的改动先讨论方案。
- **提交改进：** 欢迎修复、文档完善和兼容性验证。开发环境与提交要求见[贡献指南](CONTRIBUTING.md)；安全问题请通过[安全报告渠道](SECURITY.md)私下联系。

## 联系与交流

我是 **q1325833367**，一名用 AI 辅助开发的独立开发者，正在把自己的想法做成可用的开源工具。希望认识同样在做东西的人：分享实际经验、一起试验新的想法，也一起把项目打磨好。

如果你有好的思路、想共同做一个项目，或者所在的社群常有开源协作与实践交流，欢迎来信介绍。公开讨论可以直接发到 Discussions，让更多人参与。

邮箱：[1325833367@qq.com](mailto:1325833367@qq.com)。介绍一下你正在做什么、想交流什么即可。

## 许可证与致谢

本项目采用 [MIT 许可证](LICENSE)，保留 `Copyright (c) 2026 Browser Use` 与 `Copyright (c) 2026 q1325833367`。

InspireJev 基于 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) 的提交 [`1231850a0bf1a0c0341fe408ef1668dbbfdfac46`](https://github.com/browser-use/jev-ultrafast/commit/1231850a0bf1a0c0341fe408ef1668dbbfdfac46) 构建，感谢上游作者。相关资料：[Browser Use 官方文档](https://docs.browser-use.com/)、[Playwright 官方文档](https://playwright.dev/docs/intro)。来源与依赖许可详见[致谢说明](docs/ATTRIBUTION.md)。
