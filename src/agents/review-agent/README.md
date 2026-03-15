# ReviewAgent

职责：

- 记录最终失败块
- 输出 `manual-review.json`
- 输出 `lexicon-candidates.json`
- 为人工审查提供候选信息

不负责：

- 主链路重试
- 自动更新正式词典
- 直接和用户交互
