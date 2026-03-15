# 对外接入文档

## 目标

当前扩展对外暴露两类能力：

1. `exports API`
   - 供其他 VS Code 插件直接调用
   - 同时暴露稳定 `SubtitleFlowApi` 和插件级 `agentHost`
2. `Copilot agent`
   - 供用户在 Chat 面板里通过 `@subtitleFlow` 调用

两类入口都复用同一个公共门面：

- [src/publicApi.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/publicApi.ts)
- [src/services/subtitleFlowApi.ts](/Users/wedaren/repositoryDestinationOfGithub/whisperBatcher/src/services/subtitleFlowApi.ts)

## 扩展 ID

- 发布者：`wedaren`
- 扩展名：`whisper-subtitle-flow`
- 完整扩展 ID：`wedaren.whisper-subtitle-flow`

## 从其他 VS Code 插件调用

```ts
import * as vscode from 'vscode';
import type { SubtitleFlowExtensionExports } from 'whisper-subtitle-flow/dist/publicApi';

async function useSubtitleFlow(): Promise<void> {
    const extension = vscode.extensions.getExtension<SubtitleFlowExtensionExports>('wedaren.whisper-subtitle-flow');
    if (!extension) {
        throw new Error('Subtitle Flow extension not found');
    }

    const subtitleFlow = extension.isActive ? extension.exports : await extension.activate();

    const task = await subtitleFlow.enqueueTask(
        { videoPath: '/absolute/path/demo.mp4' },
        { targetLanguages: ['zh-CN', 'en'] }
    );

    subtitleFlow.runPending();
    console.log(task.id);

    console.log(subtitleFlow.agentHost.listCapabilities().map((item) => item.name));
}
```

## 公共 API

高层任务 API：

- `enqueueTask(input, options?)`
- `enqueueTasks(inputs, options?)`
- `runPending()`
- `getTask(taskId)`
- `listTasks()`
- `cleanStaleTasks()`
- `pauseTask(taskId)`
- `resumeTask(taskId)`
- `retryTask(taskId)`
- `deleteTask(taskId)`
- `onDidChangeTasks(listener)`

底层单步 API：

- `transcribe(videoPath, options?)`
- `optimize(rawSrtPath, options?)`
- `translate(llmSrtPath, targetLanguages, options?)`
- `runPipeline(videoPath, options?)`

## Agent Host

如果你是从其他插件里的其他 agent 调用本扩展，优先通过 `agentHost` 发现能力：

- `listAgents()`
- `listCapabilities()`
- `invokeCapability(name, input?)`

`listCapabilities()` 现在会同时返回：

- `inputSchema`
- `outputSchema`
- `inputSchemaSummary`
- `outputSchemaSummary`

也就是外部插件既可以做结构化校验，也可以直接拿摘要文案做展示。

当前关键 capability：

- `task.scan-directory`
- `task.enqueue`
- `task.enqueue-batch`
- `task.enqueue-directory`
- `task.run-pending`
- `task.get`
- `task.list`
- `task.pause`
- `task.resume`
- `task.retry`
- `task.delete`
- `subtitle.optimize`
- `subtitle.translate`
- `review.inspect-failures`

## 返回值约定

- 所有任务查询统一返回 `TaskSummary`
- 路径统一为绝对路径
- 长任务状态使用：
  - `queued`
  - `transcribing`
  - `optimizing`
  - `translating`
  - `completed`
  - `failed`
  - `paused`

## 长任务设计约束

Whisper 转录可能持续较长时间，因此推荐外部调用方遵守下面的模型：

1. 先 `enqueueTask()`
2. 再 `runPending()`
3. 通过 `getTask()` / `listTasks()` 轮询状态

不建议把 `runPipeline()` 当成默认入口，因为它是同步直跑，更适合受控脚本环境，不适合交互式 agent。

## Copilot agent 用法

用户可以在 VS Code Chat 中直接输入：

- `@subtitleFlow /enqueue "/absolute/path/video.mp4"`
- `@subtitleFlow /run`
- `@subtitleFlow /get task_xxx`
- `@subtitleFlow /list`

当前 participant 会做两层判断：

1. 优先解析显式命令
2. 对自然语言做轻量推断
   - 例如“查看最近任务状态”
   - 例如“恢复刚才暂停的任务”
   - 例如“给这个路径生成字幕”
   - 例如“为目录 `/path/to/folder` 下的所有视频提供字幕”

## 与 commands 的区别

- `commands.executeCommand(...)`
  - 适合触发 UI 命令
  - 参数和返回值不稳定
- `exports API`
  - 适合程序化集成
  - 类型和 DTO 更稳定
- `agentHost`
  - 适合其他插件的其他 agent 做 capability 发现和调用

如果你要从其他插件消费能力，优先走 `exports API` / `agentHost`，不要依赖命令层内部行为，也不要直接引用内部 agent 类。
