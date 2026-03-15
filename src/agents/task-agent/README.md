# TaskAgent

职责：

- 解析用户在 Chat 中的任务意图
- 将自然语言映射为任务工作流
- 通过 runtime 调用任务控制工具

包含：

- `prompt.ts`
- `policy.ts`
- `tools.ts`
- `index.ts`

不负责：

- optimize / translate 的块级恢复
- review artifact 输出
