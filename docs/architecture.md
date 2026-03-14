# 架构文档

## 总览

`whisper-subtitle-flow` 是一个 VS Code 扩展，目标是把“视频转录 + 字幕优化 + 多语言翻译”组织成一条可批处理的字幕流水线。

当前架构按职责分为五层：

1. 入口层
   - [src/extension.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/extension.ts)
   - 负责装配依赖、初始化状态、注册命令和视图
2. 交互层
   - [src/commands.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/commands.ts)
   - 负责和用户交互，收集任务参数
3. 状态与调度层
   - [src/taskStore.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/taskStore.ts)
   - [src/services/taskScheduler.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/taskScheduler.ts)
   - 负责任务持久化、状态切换、并发调度
4. 核心流水线层
   - [src/services/pipelineRunner.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/pipelineRunner.ts)
   - [src/services/whisperService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/whisperService.ts)
   - [src/services/optimizeService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/optimizeService.ts)
   - [src/services/translateService.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/translateService.ts)
   - 负责真正的字幕处理
5. 辅助基础设施层
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
- `PipelineRunner`
  - 对单个任务串起三阶段处理
  - 持续把阶段状态和产物回写到 `TaskStore`
- `TaskTreeDataProvider`
  - 订阅 `TaskStore` 变化
  - 将任务和输出文件渲染到侧边栏树视图

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
