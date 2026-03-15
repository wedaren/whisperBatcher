# SubtitleFlowAgentHost

职责：

- 对外暴露插件级 agent 能力
- 统一列出内部 agent manifest
- 为其他 VS Code 插件或其他 agent 提供稳定的 capability 调用入口

设计原则：

- 外部调用只依赖 capability，不依赖内部 agent 类
- host 负责外部集成，orchestrator 负责内部 handoff
- 对外保持稳定 DTO 和输入输出约定
