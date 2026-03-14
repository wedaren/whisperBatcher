# Whisper Subtitle Flow

一个用于批量生成字幕的 VS Code 扩展，核心流程是：

1. 使用 Whisper 对视频做转录
2. 使用 VS Code LM / Copilot 模型优化字幕可读性
3. 将优化后的字幕翻译成多个目标语言

## 功能说明

- 批量选择多个视频并创建任务
- 按最大并发数自动调度任务
- 在侧边栏查看任务状态和输出文件
- 为每个任务生成配置文件和执行日志
- 通过合规词表做敏感词替换与恢复

## 依赖要求

- VS Code `1.109.0` 或更高版本
- 可用的 GitHub Copilot / VS Code LM 模型
- 已安装本地 `openai-whisper` CLI

## 配置项

扩展提供以下关键配置：

- `subtitleFlow.maxConcurrency`
  - 最大并发任务数
- `subtitleFlow.targetLanguages`
  - 默认目标语言列表
- `subtitleFlow.whisperModel`
  - 默认 Whisper 模型
- `subtitleFlow.whisperBinary`
  - whisper 可执行文件路径
- `subtitleFlow.whisperModelPath`
  - whisper 模型目录
- `subtitleFlow.whisperLanguage`
  - 默认源语言
- `subtitleFlow.complianceRulesPath`
  - 合规词表路径
- `subtitleFlow.autoRun`
  - 添加任务后是否自动执行

## 文档

- 架构文档：[docs/architecture.md](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/docs/architecture.md)
- 原理文档：[docs/principles.md](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/docs/principles.md)

## 当前状态

当前代码已统一补充中文注释，包含：

- 源码中的文件级说明
- 核心方法与关键流程说明
- 测试文件说明
- 脚本说明

如果后续要继续细化，可以再补：

- 更详细的时序图
- 常见故障排查手册
- 产物目录示例
