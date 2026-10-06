# 配置

`inspire-jev setup` 交互配置模型、代理和入口。密钥输入隐藏；DeepSeek 仅在任务需要生成新文字时必需。不要把密钥放进命令参数、Git 仓库或截图。

|配置|默认值 / 用途|
|---|---|
|TYPESAFE_API_KEY|必填；Jev 决策服务|
|TYPESAFE_BASE_URL|https://api.typesafe.ai/v1/systemone|
|TYPESAFE_MODEL|jev-latest|
|TEXT_MODEL_API_KEY|可选；文字生成服务|
|TEXT_MODEL_BASE_URL|https://api.deepseek.com/v1|
|TEXT_MODEL|deepseek-chat|
|modelProxy|模型 HTTP 请求的显式 HTTP(S) 代理|
|browserProxy|独立浏览器的显式 HTTP(S) 代理|

环境变量覆盖凭据文件，同名配置支持旧 `--env-file`。`.env.example` 只有空密钥。现有 Pi 的主模型和模型路由由 Pi 管理，InspireJev 不修改它们。

```sh
inspire-jev config show
inspire-jev config set TYPESAFE_API_KEY
inspire-jev config set modelProxy
inspire-jev config set browserProxy
inspire-jev config unset browserProxy
inspire-jev doctor --models
```

`config show` 只报告密钥是否配置。自动配置可使用 `config set TYPESAFE_API_KEY --stdin` 从私密管道读取，不使用命令参数传递值。

## 私密目录

|系统|新安装默认目录|
|---|---|
|macOS|`~/Library/Application Support/InspireJev`|
|Windows|`%LOCALAPPDATA%\InspireJev`|
|Linux|`$XDG_DATA_HOME/inspire-jev`，缺省 `~/.local/share/inspire-jev`|

`INSPIRE_JEV_HOME` 优先，其次兼容 `JEV_AGENT_HOME`。升级检测到旧 Jev Agent 配置时继续使用原目录；不自动迁移登录档案。凭据在目录外的原 env 文件，或本目录 `credentials.env` 中；`config.json` 保存文件指针和非凭据设置。Unix 目录权限 700、凭据文件 600，Windows 使用当前用户 ACL。配置及宿主注册修改前保留私密备份。

## 网络

模型和浏览器代理分别配置，无需 TUN。HTTP(S) 地址不能内嵌用户名、密码或密钥。`doctor` 检查网络；`doctor --models` 额外发起实际模型调用。代理地址使用你自己的代理监听端口；虚拟机要使用客户机可达的宿主地址。

正常使用关闭颗粒追踪。测试追踪包含时间戳、步骤耗时和错误分类，不记录密钥、输入值或完整页面。未完成任务、效果未知动作和待查日志受保护；已排查日志按七天、二十份和容量规则清理，已完成大检查点七天后清理。
