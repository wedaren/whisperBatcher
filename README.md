# Whisper Subtitle Flow

一个用于批量生成字幕的 VS Code 扩展，核心流程是：

1. 使用 Whisper 对视频做转录
2. 使用 VS Code LM / Copilot 模型优化字幕可读性
3. 将优化后的字幕翻译成多个目标语言

## 功能说明

- 批量选择多个视频并创建任务
- 按最大并发数自动调度任务
- 在侧边栏查看任务状态和输出文件
- 通过 `@subtitleFlow` Copilot agent 以后台任务方式控制长流程
- 通过扩展 `exports` 暴露公共 API，便于其他 VS Code 插件直接消费
- 为每个任务生成配置文件和执行日志
- 通过合规词表做敏感词替换与恢复

## Agent 工作方式

Whisper 转录可能持续较长时间，因此 Copilot agent 不采用“单次对话同步等待完成”的设计，而是采用后台任务模型：

1. `enqueue`
   - 创建任务并返回任务 ID
   - 不阻塞等待 Whisper 完成
2. `run`
   - 启动排队中的任务
   - 真实执行交给 `TaskScheduler`
3. `get` / `list`
   - 查询当前状态、阶段、错误和输出路径
   - 适合长耗时任务的轮询式交互
4. `pause` / `resume` / `retry`
   - 控制后台任务生命周期

当前推荐的 Copilot 使用方式：

- `@subtitleFlow /enqueue "/absolute/path/video.mp4"`
- `@subtitleFlow /run`
- `@subtitleFlow /get task_xxx`

当前 participant 已经具备基础编排能力：

- “生成字幕 /abs/video.mp4”
  - 自动执行 `enqueue -> runPending -> get`
- “重试失败任务”
  - 自动执行 `retry -> runPending -> get`
- “恢复刚才暂停的任务”
  - 自动执行 `resume -> runPending -> get`
- “查看最近任务状态”
  - 自动定位最近任务并读取状态

## LLM 恢复机制

优化字幕与翻译字幕阶段现在接入了受控恢复 agent：

- 当 LLM 调用失败、被安全审查拒答、输出格式错误、或疑似未翻译时
- 系统会优先切换 prompt 策略并重试
- 达到上限后再降级为回退到安全原文，而不是直接让整条流水线失败

这套机制重点保证：

- 单个坏块不轻易拖垮整任务
- 安全拒答可通过更保守的 prompt 再尝试
- 所有恢复动作都有日志和调试转储

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
- 对外接入文档：[docs/developer-api.md](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/docs/developer-api.md)

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
