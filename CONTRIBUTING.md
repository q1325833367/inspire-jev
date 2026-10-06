# 贡献指南

欢迎参与 InspireJev。可以从一次真实使用反馈、一段文档修正或一个失败案例开始，也可以参与执行器和宿主适配的实现。

## 从哪里开始

- **使用与测试：** 在 [Issues](https://github.com/q1325833367/inspire-jev/issues) 报告问题。写明版本、操作系统及架构、使用入口、预期行为、实际结果和最小复现步骤；附脱敏错误或耗时证据。
- **想法与设计：** 在 [Discussions](https://github.com/q1325833367/inspire-jev/discussions) 描述场景和希望解决的问题。新增宿主、接口变更或较大的实现先讨论方案。
- **文档与代码：** 修正安装说明、补充双语文档、修复问题或验证平台兼容性，都欢迎提交 PR。一个 PR 围绕一个明确问题，说明触发条件、最终行为、验证结果与限制。
- **安全问题：** 按[安全报告说明](SECURITY.md)私下联系，避免在公开讨论中暴露漏洞细节和敏感资料。

## 开发与验证

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

代码改动应运行对应检查，并验证受影响的真实业务流程；文档改动核对命令、链接和中英文表述。不要用站点专用脚本替代通用适配器，也不要修改 Pi 主模型路由或宿主审批策略。

## 联系维护者

项目由独立开发者 **q1325833367** 维护。欢迎通过 Discussions 交流实践与想法；共同做项目或开发者社群的交流邀请，可以发邮件至 [1325833367@qq.com](mailto:1325833367@qq.com)，简单介绍正在做的事情与合作方向。
