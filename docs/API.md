# 公共接口

协议版本 2，包版本 1.0.0-rc.5。三入口注册相同五个工具，具体参数来源唯一：`src/tools.mjs`。

|工具|输入|输出|
|---|---|---|
|jev_session|action：open/list/inspect/act/close；会话、档案、URL、来源、目标 ref|会话信息、有限观测、新鲜目标引用或动作结果|
|jev_run|task：sessionId、requestId、goal、inputs、subgoals、allowedOrigins、completionChecks、budget|RunResult 摘要与 checkpointId|
|jev_resume|runId、可选 reattach|重新观测后继续；未知效果先检查|
|jev_status|runId|状态、阶段证据、采集数据、剩余要求和模型版本|
|jev_cancel|runId|取消请求或持久化取消状态|

子目标必须有独立 checks。支持 URL、标题、范围文本、元素存在/数量、字段值、复选框、选择框、元素文字、属性检查；最终 evidence 条件引用已完成阶段。数量用 minCount/maxCount；已知值使用 equals/includes。equalsFrom/includesFrom 可引用先前阶段的 field/index 或来源 URL，resolveUrl 负责代码解析相对链接，不由模型推算。

阶段 checks 不能包含 evidence，也不能引用自身、后面的阶段或不存在的阶段；这些规划在浏览器操作前拒绝。sessionId、requestId、阶段 id 只接受字母、数字、下划线、连字符，最多100字符。requestId 建议由会话编号加阶段标识构成，改动任务后必须使用新编号；先检查旧任务实际效果，不能以换编号重放未知提交。

提取规格包含 name、selector、attribute、all、maxItems、maxChars、required；source 可为 url、title 或 section。section 从指定标题读取正文段落，maxParagraphs 限定数量，跳过图注；每项返回覆盖和截断情况。缺省 required=true，缺字段则接管；可用格式等可能不存在的字段显式 required=false，并在最终报告标明缺项。

读取链接 href 或元素列表时不设置 source。section 不能与 attribute、all 或 maxItems 混用。inspect 向主 Agent 返回实际观测到的 selector 与新鲜 ref，供建立采集条件；Jev 模型仍只能选择候选编号。selector 只用于主 Agent 只读检查和采集，接管写入必须用新鲜 ref。

Jev 只能选择适配器实际提供的动作，不能输出代码或定位器。完成检查可由主 Agent 指定只读选择范围。覆盖不足会返回标记，不能当作目标不存在。

```json
{"task":{"sessionId":"已有会话编号","requestId":"wiki-search-001","goal":"搜索并核查条目","allowedOrigins":["https://en.wikipedia.org"],"inputs":{"Search Wikipedia":"Browser automation"},"subgoals":[{"id":"search","goal":"填写搜索词","checks":[{"kind":"field","label":"Search Wikipedia","equals":"Browser automation"}]}],"completionChecks":[{"kind":"evidence","subgoal":"search"}]}}
```

这只是填写阶段示例；业务闭环需加入提交、详情采集和完整结果核验。输入值不进入普通追踪；本机任务检查点包含恢复必需的任务参数，权限 600，敏感登录由宿主或用户处理。

运行状态：starting、running、handoff、budget_reached、cancelled、verified。只有 verified 表示独立条件通过；handoff 包含分类原因。每片段最多 45 秒，所有片段累计总预算。重复 requestId 与同任务绑定，不能改目标后复用编号。

verified 表示主 Agent 指定的全部条件已通过。主 Agent 最终仍须核对条件覆盖原始业务要求；正式验收另设原始目标检查器。自然阶段可以包含多个字段条件，核心连续填写，不要求 GPT 逐字段决策。调用完成后保留 requestId 墓碑，七天清理已完成大检查点后也不会重建旧任务。

浏览器、标签页和档案均使用真实物理身份互斥。未知动作保留 pending 和意图摘要，恢复先查实际效果，不接受文字声明直接清除。新进程必须打开原档案并检查现场，显式 reattach 后再次观测；不会复用旧 ref。

动作阶段：prepared 表示只持久化意图、尚未交给驱动；dispatching 表示进入驱动调用、效果可能未知；acknowledged 表示驱动返回，之后仍核对实际效果。prepared 的恢复不当作已执行；dispatching/acknowledged 的异常必须先查效果。确认丢失不能直接重放提交。点击使用固定元素句柄，并在提交给驱动前检查就绪与目标语义，避免重渲染后自动改点其他控件。

同一现场正在执行时，第二写入任务和会改变 ref 的 inspect 返回 TAB_BUSY；使用 jev_status 查看进度。登录表单字段、密码、OTP、支付凭据和密钥字段不进入 Jev 候选；表单目的地也须位于允许来源。授权、审批和登录仍使用宿主原有机制。

主 Agent 对敏感阶段标记 sensitive/hostOnly，对敏感检查标记 sensitive。未满足时返回宿主接管；已完成后，其字段和已知值也不会进入后续 Jev 状态。预填 textarea/输入框的内容不进入页面摘要。普通网页业务内容仍属于按任务授权发送给模型的状态，不能用插件处理未经授权的私密内容。
