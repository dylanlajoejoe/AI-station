# Memory 管理方案

## 1. 目标

Memory 管理不是为了把更多聊天记录塞进模型，而是让 AI 在长任务、跨会话、跨文件修改时稳定恢复上下文。

核心目标：

- 不只依赖最近 20 轮对话
- 保留当前任务目标、进度、约束和待验证项
- 记住用户明确要求、项目事实和重要决策
- 记录文件访问、文件修改、命令执行和结果
- 支持从历史会话中检索相关信息
- 避免旧聊天历史挤占当前文件内容和当前问题上下文
- 用户可以查看、编辑、删除和禁用记忆

## 2. 核心判断

只保留最近 N 轮对话是不够的。

原因：

- 早期目标、限制条件、验收标准可能不在最近几轮里
- 长任务中容易忘记已读文件、已尝试方案和失败原因
- 最近对话只反映局部状态，不能表达完整任务进度
- 对话里混有事实、推测、临时计划和过期结论，按时间截断无法判断可信度
- 跨会话恢复时，仅靠最后几条消息无法知道任务做到哪里
- 项目知识、用户偏好、常用命令不应该每次从聊天中重新发现

更好的方案是：

```text
最近对话只负责短期连续性。
任务状态负责恢复当前工作现场。
滚动摘要负责压缩长会话。
事件日志负责审计和回放。
项目事实库负责沉淀稳定知识。
检索系统负责从历史中找相关信息。
```

## 3. 设计原则

- 不无限发送全部历史消息
- 不把最近 20 轮作为唯一记忆来源
- 当前用户问题和当前文件内容优先级最高
- 用户主动保存的记忆优先级高于自动总结
- 长期记忆必须有来源、可查看、可删除
- 自动写入长期记忆必须谨慎，默认不记敏感信息
- 文件访问记录必须结构化，不混在普通聊天文本里
- 摘要必须可更新、可修正、可标记过期
- 检索结果必须保留来源，不能把相似历史直接当事实

## 4. Memory 分层

### 4.1 短期上下文

短期上下文直接发送给模型。

内容：

- 当前用户消息
- 最近少量对话
- 当前工具调用结果
- 当前打开或引用的文件片段
- 当前 git diff 或未保存修改

用途：

- 处理当前指代，比如“这个文件”“刚才那个错误”
- 保证本轮推理连贯

建议：

- 最近对话可以保留 10 到 30 条，但它只是短期缓存
- 不应该把“最近 20 条”设计成长期记忆边界

### 4.2 当前任务状态

当前任务状态是比最近对话更重要的工作记忆。

它显式记录：

- 当前任务目标
- 用户明确要求
- 当前阶段
- 已完成步骤
- 下一步计划
- 相关文件
- 已修改文件
- 已运行命令
- 待验证项
- 阻塞点
- 风险和假设

用途：

- 长任务中恢复工作现场
- 避免重复搜索和重复试错
- 让 AI 知道当前任务做到哪里
- 跨会话继续工作时提供稳定入口

### 4.3 滚动摘要

滚动摘要用于压缩长会话，不是简单覆盖旧摘要。

摘要应该区分：

- 用户明确要求
- 已确认事实
- 已完成事项
- 重要决策
- 已尝试但失败的方案
- 当前未解决问题
- 过期或被推翻的结论

建议做法：

- 会话超过阈值后，将较早对话合并进摘要
- 新摘要基于旧摘要和新增事件增量更新
- 关键决策单独进入决策记录，避免被摘要压缩掉
- 摘要保留来源引用，比如消息 ID、文件路径、命令 ID

### 4.4 事件日志

事件日志使用 append-only 方式记录关键行为。

事件类型：

- 用户请求
- 计划创建和计划变更
- 文件定位
- 文件读取
- 文件修改
- 命令执行
- 测试结果
- 错误和恢复动作
- 用户确认或拒绝
- 重要决策

用途：

- 审计 AI 做过什么
- 从历史中重建任务过程
- 给滚动摘要提供可靠输入
- 给检索系统提供结构化来源

事件日志一般不直接发送给模型，而是通过摘要、任务状态和检索结果选择性注入。

### 4.5 文件访问索引

文件访问索引记录 AI 和文件之间的关系。

记录内容：

- 用户输入中定位到的路径
- 实际读取过的文件
- 读取时的文件 hash 或 mtime
- 关注过的符号、函数、类、配置项
- 拒绝读取的文件和原因
- 编辑过的文件
- 文件和当前任务的相关性说明

用途：

- 避免 AI 假装读过文件
- 避免重复探索同一批文件
- 文件变化后判断旧结论是否过期
- 让历史会话可追溯

### 4.6 项目事实库

项目事实库保存和当前项目长期相关、可复用的信息。

例如：

- 项目目标
- 技术栈
- 常用目录
- 入口文件
- 构建、测试、运行命令
- 命名习惯
- 架构边界
- 用户确认过的项目规则
- 常见问题和解决方式

项目事实需要有生命周期：

- 新发现事实先作为候选事实
- 被用户确认或多次验证后提升为稳定事实
- 与文件变化冲突时标记为可能过期
- 用户可以手动编辑或删除

首版不建议自动把一次性任务细节写入项目事实库，避免污染长期记忆。

### 4.7 用户记忆

用户记忆保存跨项目偏好。

例如：

- 输出风格
- 语言偏好
- 常用技术栈
- 协作习惯
- 明确禁止的行为

用户记忆写入必须更谨慎。

建议：

- 用户明确说“记住”时直接保存
- 自动识别到偏好时先作为候选，不直接长期保存
- 敏感信息默认不保存
- 支持“忘记这条记忆”“不要记住这个信息”

## 5. 检索增强记忆

为了避免只看到最近 20 轮，需要在发送模型前主动检索相关历史。

### 5.1 检索来源

可检索内容：

- 历史用户请求
- 滚动摘要
- 事件日志
- 项目事实
- 用户记忆
- 文件访问索引
- 命令执行结果
- 历史决策

### 5.2 混合检索

推荐使用关键词检索 + 向量检索的混合方式。

关键词检索适合：

- 文件名
- 函数名
- 错误码
- 命令名
- 配置项
- 精确路径

向量检索适合：

- “之前为什么不用这个方案”
- “这个设计和哪个历史决策有关”
- “类似问题之前怎么处理过”
- “用户以前对这类输出有什么偏好”

排序时应综合：

- 当前任务相关性
- 时间新鲜度
- 来源可信度
- 是否用户明确确认
- 文件是否已变化
- 是否和当前 workspace 匹配

### 5.3 检索结果使用规则

检索结果不能直接当作事实。

必须满足：

- 保留来源引用
- 标记事实、推测、历史结论或过期信息
- 与当前文件内容冲突时，以当前文件内容为准
- 与用户当前要求冲突时，以用户当前要求为准

## 6. 推荐上下文组装结构

发送给模型时，不再只是：

```text
会话摘要 + 最近 20 条消息 + 当前问题
```

推荐改成：

```text
system:
  产品规则
  工具能力边界
  文件访问规则
  记忆使用规则

current_task:
  当前任务目标
  用户明确要求
  当前进度
  待验证项
  阻塞点

memory:
  高优先级项目事实
  用户显式记忆
  滚动摘要
  相关历史决策
  检索召回的历史片段

workspace:
  当前文件上下文
  当前 diff
  文件访问索引中和本任务相关的文件

history:
  最近少量对话

user:
  当前用户问题
  本轮引用文件清单
```

优先级：

1. 当前用户消息
2. 系统和工具约束
3. 当前任务状态
4. 当前文件内容和当前 diff
5. 用户明确保存的记忆
6. 项目事实和历史决策
7. 滚动摘要
8. 检索召回的历史片段
9. 最近对话

最近对话排在后面，不代表不重要，而是它不能替代结构化状态和检索。

## 7. 建议数据结构

### 7.1 当前任务状态

```ts
type TaskState = {
  id: string;
  sessionId: string;
  workspacePath: string;
  goal: string;
  userRequirements: string[];
  status: 'active' | 'blocked' | 'completed' | 'archived';
  currentStep: string | null;
  completedSteps: string[];
  nextSteps: string[];
  relatedFiles: string[];
  editedFiles: string[];
  commandsRun: string[];
  pendingValidation: string[];
  blockers: string[];
  assumptions: string[];
  updatedAt: string;
};
```

### 7.2 滚动摘要

```ts
type RollingSummary = {
  sessionId: string;
  summary: string;
  confirmedFacts: string[];
  decisions: string[];
  openIssues: string[];
  supersededNotes: string[];
  sourceMessageIds: string[];
  updatedAt: string;
};
```

### 7.3 事件日志

```ts
type MemoryEvent = {
  id: string;
  sessionId: string;
  taskId: string | null;
  type:
    | 'user_request'
    | 'plan_update'
    | 'file_located'
    | 'file_read'
    | 'file_edited'
    | 'command_run'
    | 'test_result'
    | 'decision'
    | 'error'
    | 'user_feedback';
  target: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
```

### 7.4 文件访问索引

```ts
type FileMemoryIndex = {
  id: string;
  workspacePath: string;
  sessionId: string;
  taskId: string | null;
  path: string;
  reason: string;
  operations: Array<'located' | 'read' | 'edited' | 'skipped'>;
  symbols: string[];
  contentHash: string | null;
  mtime: string | null;
  lastAccessedAt: string;
};
```

### 7.5 项目事实

```ts
type ProjectFact = {
  id: string;
  workspacePath: string;
  category: 'command' | 'architecture' | 'style' | 'workflow' | 'domain' | 'other';
  content: string;
  source: 'user' | 'file' | 'command' | 'summary' | 'system';
  sourceRef: string | null;
  confidence: 'candidate' | 'confirmed' | 'stale';
  createdAt: string;
  updatedAt: string;
};
```

### 7.6 用户记忆

```ts
type UserMemory = {
  id: string;
  scope: 'global' | 'workspace';
  workspacePath: string | null;
  content: string;
  source: 'explicit_user_request' | 'user_confirmed' | 'system';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

### 7.7 检索索引

```ts
type MemorySearchIndex = {
  id: string;
  scope: 'session' | 'workspace' | 'global';
  sourceType: 'summary' | 'event' | 'project_fact' | 'user_memory' | 'file_index';
  sourceId: string;
  text: string;
  keywords: string[];
  embeddingId: string | null;
  updatedAt: string;
};
```

## 8. 写入策略

### 8.1 自动写入

可以自动写入：

- 当前任务状态
- 滚动摘要
- 事件日志
- 文件访问索引
- 命令执行结果

自动写入必须避免：

- 密码
- API Key
- 私钥
- Cookie
- Token
- 个人隐私信息
- 大段文件原文

### 8.2 候选写入

以下内容可以先作为候选，不直接进入稳定长期记忆：

- 项目常用命令
- 项目结构判断
- 编码风格判断
- 用户偏好推断
- 常见错误解决方式

候选记忆可以由用户确认，也可以在多次验证后提升为稳定事实。

### 8.3 显式写入

用户明确表达时直接写入：

- “记住这个项目使用 pnpm”
- “以后回答都简洁一点”
- “这个目录是主要入口”
- “不要自动修改这个文件”

### 8.4 删除和禁用

必须支持：

- 查看当前会话摘要
- 查看当前任务状态
- 查看项目事实
- 查看用户记忆
- 删除单条记忆
- 禁用某类自动记忆
- 清空当前会话记忆
- 清空当前 workspace 记忆

## 9. 读取策略

每次调用模型前，按以下流程组装上下文：

1. 读取当前任务状态
2. 读取当前用户显式记忆
3. 读取当前 workspace 的高置信项目事实
4. 根据当前问题做关键词检索
5. 有需要时做向量检索
6. 合并滚动摘要和相关历史决策
7. 检查文件索引中的文件是否已变化
8. 过滤敏感信息和低相关内容
9. 按 token 预算裁剪

裁剪原则：

- 当前用户消息不裁剪
- 当前文件内容优先于历史聊天
- 当前任务状态优先于滚动摘要
- 用户显式记忆优先于自动候选记忆
- 有来源的事实优先于无来源摘要
- 新信息优先于旧信息，但用户明确要求不因时间变旧而丢弃

## 10. UI 建议

后续可以增加 Memory 页面或弹窗。

展示：

- 当前任务状态
- 当前会话滚动摘要
- 本会话访问过的文件
- 历史决策
- 项目事实列表
- 用户记忆列表
- 候选记忆列表
- 检索命中的历史来源

操作：

- 删除记忆
- 编辑记忆
- 禁用记忆
- 确认候选记忆
- 标记记忆过期
- 重新生成摘要
- 清空当前会话记忆

## 11. MVP 实现范围

MVP 不建议一开始做复杂向量库。

第一阶段先做本地结构化记忆：

- `task_state`：当前任务状态
- `rolling_summary`：滚动摘要
- `memory_event`：追加式事件日志
- `file_memory_index`：文件访问索引
- `project_fact`：项目事实候选和确认状态

第一阶段暂不做：

- 自动长期用户记忆
- 跨项目记忆共享
- 自动保存隐私信息
- 大规模向量检索
- 复杂 rerank 模型

## 12. 可借鉴 claude-code 的设计

`~/bili/claude-code` 可以借鉴，但不建议照搬。它的 Memory 设计更偏“文件式长期记忆 + 后台 session 摘要 + compact 接管”，适合参考实现边界和工程细节。

### 12.1 值得借鉴

#### 后台 Session Memory

claude-code 的 session memory 不是在主对话里同步生成，而是在 post-sampling hook 中用 forked agent 后台更新。

可借鉴点：

- 记忆更新不阻塞主对话
- 用独立 agent 提取当前会话关键信息
- forked agent 使用隔离上下文，避免污染主线程工具状态
- 只允许该 agent 编辑指定 memory 文件，降低误写风险

建议本项目采用类似机制：

```text
主对话结束一轮后 -> 判断是否达到更新阈值 -> 后台 Memory Worker 更新 rolling_summary/task_state
```

#### 基于 token 和工具调用的更新阈值

claude-code 不按“固定 20 轮”触发摘要，而是按上下文增长和工具调用数量触发。

可借鉴规则：

- 首次达到一定 token 后初始化 session memory
- 距离上次提取增长一定 token 后再更新
- 工具调用达到一定数量后优先更新
- 最后一轮仍有工具调用时避免立即截断，防止 tool_use/tool_result 被拆开

本项目建议：

```ts
type MemoryUpdatePolicy = {
  minimumTokensToInit: number;
  minimumTokensBetweenUpdate: number;
  toolCallsBetweenUpdates: number;
  avoidExtractWhenLastTurnHasToolCalls: boolean;
};
```

#### compact 时使用 session memory

claude-code 在 compact 时会优先使用已生成的 session memory，而不是重新总结所有旧消息。

可借鉴点：

- compact 前等待正在进行的 memory extraction 完成，但设置超时
- compact 后保留 session memory 作为摘要消息
- 同时保留未被总结的新消息
- 如果找不到 summarized boundary，则回退到传统 compact

这比“最近 20 条 + 摘要”更稳，因为它知道哪些消息已经被总结过，哪些消息还必须保留。

建议本项目增加：

```ts
type CompactBoundary = {
  sessionId: string;
  lastSummarizedMessageId: string | null;
  preCompactTokenCount: number;
  summaryId: string;
  createdAt: string;
};
```

#### 保留 API 消息不变量

claude-code compact 时会避免拆散 tool_use 和 tool_result，也会处理同一个 assistant message id 被拆成多个块的情况。

这是非常重要的工程细节。

本项目 compact 时必须保证：

- tool_use 和对应 tool_result 不能只保留一半
- assistant streaming 拆分出的同 message id 内容不能被错误切开
- compact boundary 不能导致后续 API 请求结构非法
- 如果无法确认边界安全，应回退到保守策略

#### 文件式 Memory

claude-code 的长期 memory 使用 markdown 文件，而不是只存在数据库里。

可借鉴点：

- 用户容易查看和编辑
- 可以用普通编辑器打开
- 可放入项目目录形成团队共享记忆
- `MEMORY.md` 作为索引入口，具体内容拆到 topic 文件

本项目如果首版想简单，可以采用混合方式：

```text
SQLite: 存结构化状态、事件、索引、检索元数据
Markdown: 存用户可编辑的长期记忆和项目规则
```

#### Memory Scope

claude-code 有 user/project/local 三种 agent memory scope。

可借鉴成：

- `global`：跨项目用户偏好
- `workspace`：当前项目共享记忆
- `local`：当前机器私有项目记忆，不进 VCS
- `session`：当前会话临时记忆

本项目存储建议：

```text
app.getPath('userData')/ai-workstation.db

tables:
  sessions
  messages
  session_events
  task_state
  file_index
  command_log
  rolling_summary
  compact_boundary
```

说明：

- 运行时 session 数据默认写入现有 SQLite 数据库
- 数据库路径由 Electron `app.getPath('userData')` 决定
- 不默认写入 `.kilo`、`~/.config/kilo` 或项目目录
- 只有用户明确要共享的项目长期记忆，才考虑写到 workspace 内

#### 类型化 Memory

claude-code 将长期 memory 限制为 `user`、`feedback`、`project`、`reference` 等类型，并明确什么不该保存。

本项目可以借鉴类型约束，但需要结合 IDE Agent 场景扩展：

- `user`：用户偏好和背景
- `feedback`：用户对 AI 行为的纠正或确认
- `project`：不可从代码直接推导的项目背景、目标、决策原因
- `reference`：外部系统入口，比如文档、issue、dashboard
- `workflow`：用户确认过的项目工作流
- `constraint`：长期有效的项目约束

不应该长期保存：

- 当前任务临时进度
- 可从代码直接读取的架构和文件结构
- git log 能查到的提交历史
- 大段文件内容
- 一次性调试过程
- 敏感信息

#### MEMORY.md 作为索引，不作为正文

claude-code 把 `MEMORY.md` 当索引，要求每条索引一行，正文放到独立 topic 文件。

这是很好的设计。

原因：

- `MEMORY.md` 总是进入上下文，必须短
- topic 文件只有相关时再读取
- 避免长期记忆无限膨胀
- 方便用户手动编辑

建议：

```text
MEMORY.md:
  - [测试约定](testing.md) - 项目测试策略和禁用行为
  - [用户偏好](user-style.md) - 输出风格和协作习惯

topic file:
  frontmatter + 详细内容 + Why + How to apply
```

#### 记忆过期校验

claude-code 明确要求：memory 只是写入时的事实，使用前要验证当前状态。

本项目必须保留这个规则：

- memory 提到文件路径时，先检查文件是否存在
- memory 提到函数、flag、命令时，先 grep 或读取当前文件
- memory 和当前文件冲突时，以当前文件为准
- memory 和当前用户要求冲突时，以当前用户要求为准
- 过期 memory 应标记 stale 或删除

#### Memory 操作可见

claude-code 有 `/memory` 命令和 memory updated notification。

可借鉴点：

- 用户能打开 memory 文件编辑
- AI 更新 memory 后给出提示
- 自动管理的 memory 文件在 UI 中可识别
- memory 文件路径显示为相对路径或 `~` 路径，减少噪音

本项目建议：

- 增加 `/memory` 查看和编辑入口
- Memory 更新后显示简短提示
- 自动 memory 和用户项目文档区分展示
- 支持禁用自动记忆

#### 搜索历史上下文

claude-code 在 prompt 里指导模型优先搜索 memory topic 文件，最后才搜 transcript。

本项目可借鉴顺序：

1. 搜索结构化项目事实
2. 搜索 memory topic 文件
3. 搜索 session summary
4. 搜索事件日志
5. 最后搜索完整 transcript

完整 transcript 很大，应作为兜底来源，不应该每轮注入。

### 12.2 不建议照搬

#### 不建议只用 Markdown 文件

Markdown 对用户友好，但不适合承载所有记忆。

本项目还需要：

- 按消息 ID 定位 compact boundary
- 按 taskId 查询当前任务状态
- 按文件 hash 判断上下文是否过期
- 按事件类型过滤历史行为
- 按关键词和向量检索历史片段

这些更适合 SQLite 或本地数据库。

推荐：

```text
结构化运行态记忆 -> SQLite
用户可编辑长期记忆 -> Markdown
检索索引 -> SQLite + 可选向量库
```

#### 不建议让模型自由维护所有记忆

claude-code 的文件式 memory 很依赖模型遵守 prompt。

本项目应更多使用程序约束：

- 自动事件由系统写入，不让模型手写
- 文件访问索引由工具层写入
- task_state 由系统根据工具调用和计划更新
- 长期用户记忆才允许模型提出候选
- 写入长期记忆前做敏感信息过滤

#### 不建议把可推导信息保存成长期记忆

claude-code 明确指出：代码结构、架构、git history 可以从当前项目推导，不应保存为 memory。

本项目也应遵守。

长期记忆只保存“不可直接推导但未来有用”的信息：

- 用户为什么要做某件事
- 项目当前业务目标
- 某个决策背后的原因
- 用户对 AI 协作方式的要求
- 外部系统在哪里

代码事实应通过读取文件、grep、LSP、git 获取。

### 12.3 对当前方案的调整

结合 claude-code，当前方案建议强化为：

```text
Memory Worker:
  后台更新 session memory，不阻塞主对话

Compact Boundary:
  记录 lastSummarizedMessageId，compact 时只保留未总结片段

Message Invariant Guard:
  compact 时保护 tool_use/tool_result 和 streaming message blocks

Memory Scope:
  session / local / workspace / global 四层

File-backed Long-term Memory:
  MEMORY.md 只做索引，topic 文件保存用户可编辑记忆

SQLite Runtime Memory:
  task_state、event_log、file_index、summary、compact_boundary

Recall Policy:
  先查结构化记忆和 topic 文件，最后查 transcript
```

## 13. 推荐实现顺序

1. 数据库增加 `task_state` 表
2. 数据库增加 `memory_event` 表
3. 数据库增加 `file_memory_index` 表
4. 将每轮文件读取、文件编辑、命令执行写入事件日志
5. 每轮结束后更新当前任务状态
6. 会话超过阈值后增量更新滚动摘要
7. 发送消息时注入任务状态、滚动摘要、相关项目事实和最近少量对话
8. 增加基于关键词的历史检索
9. 数据库增加 `project_fact` 表，并支持候选事实
10. 增加 Memory UI，支持查看、确认、删除和标记过期
11. 后续再接入向量检索和混合排序

## 14. 最终推荐方案

不要把方案设计成“最近 20 条消息 + 一个摘要”。

推荐设计成：

```text
短期上下文：解决当前连续性
当前任务状态：解决长任务恢复
滚动摘要：解决长会话压缩
事件日志：解决审计和回放
文件访问索引：解决代码上下文追踪
项目事实库：解决项目知识复用
用户记忆：解决跨会话偏好
混合检索：解决历史信息召回
```

这样即使最近 20 轮对话里没有相关信息，AI 仍然可以通过任务状态、项目事实、文件索引和历史检索找回关键上下文。
