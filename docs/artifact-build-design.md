# 产物命名与增量构建设计

## 目标

本设计解决三个问题：

1. 输出目录中的文件名需要更语义化，便于用户理解与排序
2. Whisper 支持不同模型，且转录耗时较长，需要尽量复用已有产物
3. 用户删除部分产物后，应尽量从缺失阶段继续，而不是整条流水线重头开始

## 总体原则

1. 保留视频旁的同名输出目录
   - 目录仍然保持 `<video-base>.subtitle/`
   - 不把 `taskId` 或 `batchId` 混入目录名
2. 目录内主文件采用语义化命名
3. Whisper 原始转录增加内部缓存层
4. 默认采用增量构建
   - 某阶段产物存在就优先复用
   - 删除某阶段产物后，从该阶段向后重建

## 目录结构

示例：

```text
MyVideo.subtitle/
  01-raw-transcript.srt
  02-optimized-subtitle.srt
  03-default-subtitle.srt
  04-translation.zh-CN.srt
  04-translation.en.srt
  task-config.json
  task-log.txt
  review-summary.md
  manual-review.json
  lexicon-candidates.json
  cache/
    raw/
      whisper-tiny.ja.srt
      whisper-large-v3.ja.srt
```

说明：

- 目录根部的文件是用户主视角产物
- `cache/raw/` 用于区分不同 Whisper 模型与语言组合
- 当前第一版只对 Whisper 原始转录做显式缓存分层

## 主文件命名

目录根部主文件采用以下命名：

- `01-raw-transcript.srt`
  - 当前任务使用的原始转录结果
- `02-optimized-subtitle.srt`
  - 当前任务使用的优化字幕
- `03-default-subtitle.srt`
  - 当前默认字幕
  - 目前由优化后的字幕复制而来
- `04-translation.<lang>.srt`
  - 指定目标语言的翻译结果
- `task-config.json`
- `task-log.txt`
- `review-summary.md`
- `manual-review.json`
- `lexicon-candidates.json`

设计理由：

- 数字前缀保证 Finder / 文件管理器里排序稳定
- 文件名本身说明用途，不要求用户理解 `.llm`、`.raw` 等内部术语

## Whisper 缓存命名

Whisper 原始转录采用模型和语言组合区分缓存文件：

- `cache/raw/whisper-<model>.<language>.srt`

例如：

- `cache/raw/whisper-tiny.ja.srt`
- `cache/raw/whisper-large-v3.auto.srt`

设计理由：

- Whisper 是整条流水线里最昂贵、最耗时的阶段
- 不同模型生成的结果不能互相覆盖
- 目录根部仍只保留一个当前生效的主文件 `01-raw-transcript.srt`

## 增量构建规则

### 阶段 1：转录

复用规则：

1. 若存在当前模型/语言对应的 `cache/raw/whisper-<model>.<language>.srt`
   - 直接复用
   - 同步生成或覆盖 `01-raw-transcript.srt`
2. 若存在历史旧命名文件
   - 尝试迁移到 `cache/raw/...`
   - 再同步到 `01-raw-transcript.srt`
3. 否则重新执行 Whisper

删除后的行为：

- 删除 `01-raw-transcript.srt`
  - 仍可从 `cache/raw/...` 自动恢复
- 删除对应 `cache/raw/...`
  - 才会真正重新跑 Whisper

### 阶段 2：优化

复用规则：

1. 若存在 `02-optimized-subtitle.srt`
   - 直接跳过优化
2. 若存在历史旧命名 `*.llm.srt`
   - 尝试迁移到 `02-optimized-subtitle.srt`
3. 否则重新执行优化

删除后的行为：

- 删除 `02-optimized-subtitle.srt`
  - 将重新执行优化
  - 后续翻译也会在缺失时重新执行

### 阶段 3：翻译

复用规则：

1. 对每个目标语言，若已存在 `04-translation.<lang>.srt`
   - 直接复用该语言结果
2. 缺失的语言单独重建

删除后的行为：

- 删除某一个翻译文件
  - 只重建该语言
- 删除所有翻译文件
  - 只重建翻译阶段

## 默认字幕规则

当前默认字幕仍由优化后的字幕生成：

- `03-default-subtitle.srt`

同时保留一份视频同级默认字幕副本：

- `<video-base>.srt`

设计理由：

- 输出目录内需要一个稳定的默认字幕主文件
- 视频同级保留一份副本，方便播放器直接识别

## 兼容策略

当前第一版兼容以下历史命名：

- `<video>.<model>.raw.srt`
- `<video>.llm.srt`

兼容方式：

- 优先迁移到新命名
- 迁移失败时重新构建

不做的事情：

- 不批量重命名历史目录中的所有文件
- 不要求旧任务目录立即升级为新结构

## 用户侧行为

用户默认看到的是语义化主文件，而不是缓存文件。

因此用户的直觉操作可以是：

1. 正常重跑任务
   - 系统自动复用已有阶段产物
2. 删除部分产物后再重跑
   - 系统从缺失阶段往后继续
3. 想更换 Whisper 模型
   - 只会重新构建新的 raw cache
   - 不会覆盖旧模型的 raw cache

## 当前已实现范围

已实现：

- 语义化主文件命名
- `task-config.json` / `task-log.txt`
- Whisper `cache/raw/` 分层缓存
- 基于文件存在的增量构建
- 历史 `raw` / `llm` 文件兼容迁移

暂未实现：

- optimize / translate 的独立 cache 子目录
- build manifest / signature 校验
- 显式“从某阶段强制重建”的 UI 命令

## 后续建议

1. 增加 `build-manifest.json`
   - 记录当前任务的模型、语言、目标语言和阶段签名
2. 增加阶段级命令
   - 从转录重建
   - 从优化重建
   - 仅重建某个目标语言
3. 在树视图中直接展示“可重建阶段”
