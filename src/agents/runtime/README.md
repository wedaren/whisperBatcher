# Agent Runtime

职责：

- 封装 VS Code Chat / Tool 调用细节
- 为各 agent 提供统一运行时上下文
- 统一管理工具调用、任务快照读取和响应输出

不负责：

- 业务策略决策
- 恢复策略
- review 工件生成
