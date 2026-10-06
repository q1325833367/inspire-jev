# 本地决策模型

本地选项在 **1.1.0-rc.1** 中提供，属于实验能力。1.0.0 的默认 TypeSafe 云端路径继续保留。请先阅读[真实网页对照](validation/local-model-comparison-20261006.md)，不要依据模型参数量或上游毫秒数判断网页任务可靠性。

本地决策采用较小的通用观测批次：每批最多 36 个候选、1,200 字符摘要。候选仍来自实际 DOM；覆盖不足保留游标并继续发现，不能认定未看到的目标不存在。独立业务核验和内容采集不受这个模型输入窗口限制。

## 选择与边界

|引擎|配置标识|默认模型标识|说明|
|---|---|---|---|
|TypeSafe Jev|`JEV_PROVIDER=typesafe`|`jev-latest`|默认云端服务，需要 TypeSafe key|
|Laya|`local` + `LOCAL_JEV_ENGINE=laya`|`multilingual`|约 322M，多语言非自回归模型；使用官方 HTTP 服务|
|Kev|`local` + `LOCAL_JEV_ENGINE=kev`|`kev-latest`|使用官方 HTTP 服务；本次验证的 0.5B 是英文研究原型|
|OpenJev／SemIf|`local` + `LOCAL_JEV_ENGINE=semif`|`semif-local`|本次使用 Qwen3.5-4B 原生 MLX 评分；仅 Apple Silicon 服务端实测|
|其他兼容服务|`local` + `LOCAL_JEV_ENGINE=custom`|服务实际接受的标识|需要完整候选概率和兼容 choice 响应；逐项验证|

这些是独立开源实现，**并非 TypeSafe 官方 Jev 权重**。切换的是局部动作决策，主 Agent 的规划、结果核验、权限和接管保持原样。DeepSeek 仅生成新文字；保留它的云端配置不等于全链路离线。

## 安装本地依赖

本功能需要安装可选预发布版本，并注册需要使用的入口：

```sh
npm install --global https://github.com/q1325833367/inspire-jev/releases/download/v1.1.0-rc.1/inspire-jev-1.1.0-rc.1.tgz
inspire-jev install --entry gpt
```

Pi 选择 `--entry pi`，通用 MCP 选择 `--entry mcp`。已有安装先执行 `install` 再 `setup`，确保配置由新版读取；日常旧版 1.0 可继续保留，不要求升级本地模型。

先安装本版 InspireJev，再安装 Python 3.12 和 Git。三个模型分别使用独立 Python 环境，避免依赖相互覆盖。下面从本版仓库根目录执行；npm 全局用户可从 `npm root -g` 返回目录下的 `inspire-jev` 找到相同 `integrations/local-jev` 文件。

Laya：

```sh
python3.12 -m venv .venv-laya
.venv-laya/bin/python -m pip install -r integrations/local-jev/requirements-laya.txt
.venv-laya/bin/python integrations/local-jev/laya-server.py --device mps
```

Linux／Windows 可使用 `--device cpu`；CUDA 环境使用 `--device cuda`。Windows 的 Python 可执行文件是 `.venv-laya\Scripts\python.exe`，创建环境使用 `py -3.12 -m venv .venv-laya`。本机测试仅证明 macOS MPS 推理路径；其他推理后端不据此标为已验证。

Kev-0.5B：

```sh
python3.12 -m venv .venv-kev
.venv-kev/bin/python -m pip install -r integrations/local-jev/requirements-kev.txt
.venv-kev/bin/python -m kev.serve --run jaredpalmer/kev-0.5b@9ce2fd39db3a397c89733f94af948e3d1fdfffcd --host 127.0.0.1 --port 8770
```

服务端会另外下载 Qwen2.5-0.5B 基础权重。Kev 新家族可以用同一官方接口接入，但本次成绩仅对应上述 0.5B 固定权重。本次运行使用官方 torch 后端、MPS、fp32，命令前设置 `KEV_BACKEND=torch`、`KEV_DTYPE=fp32` 可复现；不要将它与新家族的 MLX 成绩混淆。

OpenJev／SemIf（Apple Silicon）：

```sh
python3.12 -m venv .venv-semif
.venv-semif/bin/python -m pip install -r integrations/local-jev/requirements-semif.txt
.venv-semif/bin/python integrations/local-jev/semif-server.py
```

首启下载模型，随后复用本机缓存。桥接固定来源提交 `23cf1f39fc9534fe81437200959b6dfc7106e45a`、Qwen3.5-4B 权重提交 `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`，不运行模型仓库的远程自定义代码。默认只监听 `127.0.0.1:8772`；服务不生成网页代码或定位器。

SemIf 原生问题最多 16 个候选。超过 16 时，桥接同时评分所有候选组及各组内部选项，以组概率乘条件概率组合完整分布，最多 256 个候选；**不删除尾部候选**。这是 InspireJev 的桥接策略，不是上游原生扁平评分，其概率未经浏览器任务校准。默认上下文上限 16,384 token，超限拒绝，禁止隐式截断。

桥接只对评分器实际读取的 token 位置执行原生词表投影，减少无用的位置输出；权重与选项 token 保持原样。本次小输入的一致性检查中，原生与优化后的选项概率逐项相同。该检查不等于所有输入都获得了准确率保证；真实网页结果单独报告。

## 连接 InspireJev

保持模型服务终端运行，然后：

```sh
inspire-jev setup
inspire-jev doctor --models
```

在 `setup` 中选择 `local`、对应引擎、完整 `/v1/systemone` 地址和模型标识。Laya 默认 `http://127.0.0.1:8769/v1/systemone`；Kev 使用端口 8770，SemIf 使用 8772。未启用本地鉴权时，API key 留空；若启用鉴权，填写该本地服务的 key。不需要填写 TypeSafe key。

已有配置可通过 `inspire-jev config set JEV_PROVIDER` 等逐项交互修改。环境变量优先于凭据文件；修改后从新任务开始使用选择的模型，不改变正在执行的片段。三个 Agent 入口使用同一配置方式；Pi 的主模型路由保持原样。

## 安全与故障

- 本地请求绕过模型代理，云端 key 不发送给本地服务；文本模型和浏览器继续使用自己的代理，无需 TUN。
- 本地服务故障、无效目标、非有限概率、候选缺失或报告截断时返回错误／接管，不自动调用云端，不宣布业务完成。
- 本地服务默认仅监听本机。SemIf 可用环境变量 `LOCAL_JEV_API_KEY` 启用鉴权；Laya 官方服务使用 `LAYA_API_KEY`，Kev 使用 `KEV_API_KEY`。客户端统一使用自己的 `LOCAL_JEV_API_KEY`，不要通过命令参数传入。
- 关闭模型服务不删除权重。卸载 InspireJev 不自动删除 Python 环境、模型缓存或已有浏览器登录档案；确认不再需要后自行删除相应环境或缓存。
- 模型和推理框架各受其原许可证约束，权重与 Python 环境不随 npm 安装包分发。
