# 架构文档

## 总览

`whisper-subtitle-flow` 是一个 VS Code 扩展，目标是把“视频转录 + 字幕优化 + 多语言翻译”组织成一条可批处理的字幕流水线。

当前架构按职责分为六层：

1. 入口层
   - [src/extension.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/extension.ts)
   - 负责装配依赖、初始化状态、注册命令、Copilot tools 和 chat participant
2. 公共 API 层
   - [src/publicApi.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/publicApi.ts)
   - [src/services/subtitleFlowApi.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/subtitleFlowApi.ts)
   - 对外暴露稳定门面，收敛任务与流水线能力
3. 交互层
   - [src/commands.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/commands.ts)
   - [src/copilot/tools.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/copilot/tools.ts)
   - [src/copilot/participant.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/copilot/participant.ts)
   - [src/copilot/participantParser.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/copilot/participantParser.ts)
   - 负责 UI 命令和 Copilot agent 交互
4. 状态与调度层
   - [src/taskStore.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/taskStore.ts)
   - [src/services/taskScheduler.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/taskScheduler.ts)
   - 负责任务持久化、状态切换、并发调度
5. 核心流水线层
   - [src/services/pipelineRunner.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/pipelineRunner.ts)
   - [src/services/whisperService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/whisperService.ts)
   - [src/services/optimizeService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/optimizeService.ts)
   - [src/services/translateService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/translateService.ts)
   - 负责真正的字幕处理
6. 辅助基础设施层
   - [src/services/llmClient.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/llmClient.ts)
   - [src/services/complianceService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/complianceService.ts)
   - [src/services/logger.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/logger.ts)
   - [src/services/srtParser.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/srtParser.ts)
   - [src/services/llmUtils.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/llmUtils.ts)
   - 提供 LLM 调用、合规替换、日志和字幕解析能力

## 核心对象关系

- `TaskStore`
  - 所有任务状态的唯一持久化来源
  - 将任务数据写入 `tasks.json`
- `TaskScheduler`
  - 从 `TaskStore` 读取待执行任务
  - 控制最大并发数
  - 调用 `PipelineRunner.run()`
- `SubtitleFlowApiService`
  - 统一封装 `TaskStore`、`TaskScheduler`、`PipelineRunner`
  - 作为命令层、Copilot agent 和外部扩展的共同入口
- `PipelineRunner`
  - 对单个任务串起三阶段处理
  - 持续把阶段状态和产物回写到 `TaskStore`
- `TaskTreeDataProvider`
  - 订阅 `TaskStore` 变化
  - 将任务和输出文件渲染到侧边栏树视图

## Agent 长任务设计

- `@subtitleFlow` 不直接等待 Whisper 整体完成
  - agent 负责创建任务、启动队列、查询状态、控制生命周期
- 真正的长耗时执行交给 `TaskScheduler`
  - 这样即使聊天关闭，后台任务仍能继续运行
- 任务状态通过 `TaskStore` 持久化
  - agent 后续可以通过任务 ID 恢复上下文并继续查询

## 目录与输出约定

- 源视频：用户选中的原始视频文件
- 任务输出目录：`<视频名>.subtitle`
- 原始字幕：`<视频名>.<模型>.raw.srt`
- 优化字幕：`<视频名>.llm.srt`
- 最终默认字幕：`<视频名>.srt`
- 多语言翻译字幕：`<视频名>.<语言>.srt`
- 任务配置：`<视频名>.task.json`
- 任务日志：`<视频名>.log`

## 设计取舍

- 优先保证流水线能“尽量完成”
  - 优化和翻译遇到局部块错误时优先回退，不轻易中断整任务
- 优先保证输出文件可追踪
  - 任务配置、日志、产物路径都会落盘
- 优先保证状态一致
  - 所有任务状态统一由 `TaskStore` 维护
- 优先保证 UI 简单
  - 树视图只展示任务和关键产物，不承担复杂编辑行为
