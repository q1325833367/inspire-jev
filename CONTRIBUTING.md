# 贡献指南

欢迎报告可复现问题、提出执行器思路、补充宿主适配和一起做开源项目。先在 Issues 或 Discussions 说明场景、平台、入口及预期行为；复杂变更先讨论接口。

```sh
git clone https://github.com/q1325833367/inspire-jev.git
cd inspire-jev
npm ci
npx playwright install chromium
git config core.hooksPath .githooks
npm run check
npm test
npm run check:secrets -- --history
```

提交不得包含密钥、登录档案、完整页面、个人机器路径、聊天记录或私密排障材料。密钥扫描只输出文件与类型。测试失败和接管如实保留，开发集不能改写为正式成绩。新增兼容状态需附实际宿主和业务流程证据。

一个变更围绕一个明确问题，说明触发条件、最终行为、验证与限制。不要用站点专用脚本替代通用适配器，也不要修改 Pi 主模型路由或宿主审批策略。完成修改并通过对应检查后提交推送；未完成变更使用工作分支。

维护者是独立开发者，欢迎点子、实践反馈、开源协作以及共同做项目的社群。公开联系：1325833367@qq.com。安全问题请使用 [安全报告](SECURITY.md)。
