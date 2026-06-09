# Memory 实现任务步骤

## 1. 接入数据库表（已完成）

这一阶段的目标是：先让 Memory 有地方存。

要做的事：

- 在 `ai-workstation.db` 里增加 Memory 表
- 增加 `task_state`
- 增加 `file_index`
- 增加 `command_log`
- 增加 `context_pack`
- 增加 `rolling_summary`
- 增加 `compact_boundary`
- 删除会话时同步删除 Memory 数据

完成后的效果：

- 每个对话都可以按 `session_id` 保存自己的 Memory 数据
- Memory 数据不会写进项目目录
- Memory 数据跟随现有 Electron `userData` 数据库

## 2. 接入脚本压缩逻辑

这一阶段的目标是：把现在的 `context-compress` 脚本能力接到主进程。

要做的事：

- 把 `compressTranscript()` 逻辑整理成可复用模块
- Electron 主进程能传入当前会话消息
- 生成 `taskState`
- 生成 `fileIndex`
- 生成 `commandLog`
- 生成 `contextPack`

完成后的效果：

- 不需要手动运行脚本
- 主进程可以直接得到结构化压缩结果

## 3. 每轮对话后更新 Memory

这一阶段的目标是：每次 AI 回复结束后，自动更新当前会话 Memory。

要做的事：

- 用户消息保存后记录事件
- AI 回复保存后记录事件
- 文件读取后记录 `file_index`
- 文件编辑后记录 `file_index`
- 命令执行后记录 `command_log`
- 每轮结束后更新 `task_state`
- 每轮结束后保存最新 `context_pack`

完成后的效果：

- 一个对话越聊越久，系统能持续知道任务状态
- 不依赖模型回忆最近多少轮

## 4. 实现 Context Assembler

这一阶段的目标是：调用模型前，自动组装更好的上下文。

要做的事：

- 读取当前 `session_id` 的最近消息
- 读取当前 `task_state`
- 读取最新 `context_pack`
- 读取最新 `rolling_summary`
- 拼出最终 prompt
- 控制最近消息数量
- 当前用户消息必须始终保留

完成后的效果：

- 模型每次回复前都能看到压缩后的任务状态
- 不再只依赖最近 20 轮对话

## 5. 实现模型主动请求压缩

这一阶段的目标是：允许模型在合适时机请求压缩。

要做的事：

- 在 prompt 里告诉模型可以输出 `REQUEST_COMPACT`
- 解析模型输出中的 `REQUEST_COMPACT`
- 只把它当作请求，不直接生效
- 记录请求原因

完成后的效果：

- 模型发现上下文过长时，可以主动提示系统压缩
- 压缩是否执行仍由程序决定

## 6. 实现程序硬触发压缩

这一阶段的目标是：即使模型没请求，程序也能自动判断是否该压缩。

要做的事：

- 统计当前上下文长度
- 统计未压缩消息数量
- 统计工具输出大小
- 判断是否达到压缩阈值
- 避免在工具调用链中间压缩

建议阈值：

- 上下文超过 70%
- 未压缩消息超过 80 条
- 工具输出累计超过 30k token

完成后的效果：

- 长会话不会无限膨胀
- 不完全依赖模型主动判断

## 7. 生成滚动摘要

这一阶段的目标是：让模型基于 `context_pack` 生成自然语言摘要。

要做的事：

- 找出需要压缩的消息范围
- 用脚本生成 `context_pack`
- 把 `context_pack` 发给模型
- 模型生成 `rolling_summary`
- 保存到 `rolling_summary` 表
- 保存 `compact_boundary`

完成后的效果：

- 旧消息可以用摘要代替
- 系统知道已经压缩到哪条消息

## 8. 压缩后上下文切换

这一阶段的目标是：压缩完成后，下次请求不再发送全部旧消息。

要做的事：

- 根据 `compact_boundary` 判断哪些消息已压缩
- 已压缩消息不再默认发送给模型
- 保留最近少量未压缩消息
- 注入 `rolling_summary`
- 注入 `task_state`
- 注入当前用户消息

完成后的效果：

- 历史上下文变短
- 关键任务信息仍然保留

## 9. 增加 Memory 调试 UI

这一阶段的目标是：用户和开发者能看到 Memory 当前状态。

要做的事：

- 增加 Memory 查看入口
- 展示 `task_state`
- 展示 `context_pack`
- 展示 `rolling_summary`
- 展示文件访问记录
- 展示命令记录
- 支持清空当前会话 Memory

完成后的效果：

- 用户知道 AI 记住了什么
- 开发时方便排查上下文问题

## 10. 增加安全和清理规则

这一阶段的目标是：避免 Memory 保存不该保存的内容。

要做的事：

- 过滤 API Key
- 过滤 Token
- 过滤 Cookie
- 不保存大段文件原文
- 限制 `context_pack` 大小
- 删除会话时清理 Memory
- 压缩失败时保留原始消息

完成后的效果：

- Memory 不会保存明显敏感信息
- 压缩失败不会破坏原始会话

## 11. 验收标准

必须通过：

- 新建对话后能生成 Memory 数据
- 不同对话的 Memory 按 `session_id` 隔离
- 关闭软件后 Memory 仍在数据库中
- 下轮请求能注入 `task_state`
- 长会话能触发压缩
- 压缩后仍能回答早期用户要求
- 删除会话会删除对应 Memory 数据
- `npm test` 通过
- `npm run build` 通过

## 推荐开发顺序

1. 先把脚本逻辑接到 Electron 主进程
2. 再做每轮结束自动写入 Memory 表
3. 再做 Context Assembler
4. 再做程序硬触发压缩
5. 再做模型 `REQUEST_COMPACT`
6. 再做 `rolling_summary`
7. 最后做 Memory UI 和安全清理
