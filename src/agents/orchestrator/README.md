# Agent Orchestrator

职责：

- 管理 agent 之间的 handoff
- 调用 `ExecutionAgent` 做执行决策
- 在需要降级时调用 `ReviewAgent`

设计原则：

- agent 之间不直接互调
- handoff 通过结构化 payload 完成
- orchestrator 是唯一调度入口
