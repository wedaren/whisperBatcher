# ExecutionAgent

职责：

- 执行 optimize / translate 阶段的恢复策略
- 根据失败类型决定是否重试
- 选择 prompt 变体
- 在需要时快速降级，保证主任务继续

不负责：

- 写 review artifact
- 修改正式词典
- 用户对话
