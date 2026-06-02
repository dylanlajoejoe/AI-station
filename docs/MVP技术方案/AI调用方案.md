# AI 调用方案

## 1. 技术栈

- OpenAI 兼容接口
- Node.js fetch
- Electron Main Process
- TypeScript

当前可在 Linux 环境开发 AI 调用逻辑，但最终运行环境以 Windows Electron 应用为准。AI 配置读取、网络请求、错误提示和日志路径都必须兼容 Windows。

## 2. 调用位置

AI 接口只在本地服务中调用，不在前端直接调用。

原因：

- 避免 API Key 暴露到前端页面
- 方便统一保存消息
- 方便统一处理失败和超时

## 3. 请求流程

```text
前端发送消息
  -> preload API
  -> Electron 主进程 chat IPC
  -> 保存用户消息
  -> 读取当前会话历史消息
  -> 调用 AI 接口
  -> 保存助手回复
  -> 返回前端展示
```

## 4. 发送给 AI 的内容

只发送：

- 当前用户输入内容
- 必要的历史消息
- 简单 system prompt

不发送：

- 文件内容
- 文件列表
- 目录树
- 未经用户输入的本地路径信息

## 5. System Prompt

建议 MVP 使用简单提示：

```text
你是一个桌面 AI 助手。用户可能会在消息中提到本地文件名或文件夹名，但你不能读取本地文件内容。请只根据用户输入的文字回答。如果需要文件内容，请提醒用户把内容粘贴到对话中。
```

## 6. 请求结构

```ts
type AiChatRequest = {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
};
```

## 7. 响应结构

```ts
type AiChatResponse = {
  content: string;
};
```

## 8. 配置项

需要配置：

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_TIMEOUT_MS`

MVP 可先通过本地配置文件或环境变量配置。

Windows 版本需要支持从应用配置中读取这些配置，不能依赖 Linux shell 环境变量作为唯一方式。

## 9. 超时和失败处理

建议：

- 默认超时 30 秒
- 失败后返回明确错误
- 不自动无限重试
- 用户可以手动重新发送

错误类型：

- API Key 未配置
- 网络失败
- 接口超时
- 模型不可用
- 返回内容为空

## 10. 历史消息策略

MVP 可直接发送最近若干条消息。

建议：

- 最多发送最近 20 条消息
- 不做 token 精算
- 不做摘要压缩
- 超出后截断更早消息

## 11. AI 调用不做

- 不读取文件内容
- 不做工具调用
- 不做 Agent
- 不做向量检索
- 不做文件总结
- 不做多模型路由

## 12. Windows 兼容要求

- AI 调用在 Electron 主进程执行
- API Key 不暴露给 Renderer
- 网络失败时给出用户可理解的提示
- 配置文件路径使用 `app.getPath('userData')`
- 不依赖 Linux 专用环境变量或 shell 启动脚本
