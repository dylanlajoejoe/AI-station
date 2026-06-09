import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { watch } from 'fs';
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'fs/promises';
import { OfficeParser } from 'officeparser';
import path from 'path';
import WordExtractor from 'word-extractor';
import { compressTranscript, type CompressionInputMessage, type CompressionResult } from './memoryCompression.js';

const isDev = !app.isPackaged;
const maxPreviewFileSize = 1024 * 1024;
const maxOfficePreviewFileSize = 10 * 1024 * 1024;
const previewableTextExtensions = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.log'
]);

type ChatMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

type SendMessageParams = {
  sessionId: string;
  content: string;
  history: ChatMessageInput[];
  workspacePath: string | null;
  locatedPaths: LocatedPathResult[];
  referencedFiles: ReferencedFileInput[];
};

type ReferencedFileInput = {
  name: string;
  path: string;
  type: 'file' | 'directory';
};

type ReferencedFileContent = {
  name: string;
  path: string;
  status: 'read' | 'skipped';
  content: string | null;
  originalHash: string | null;
  message: string;
};

type SaveTextFileParams = {
  workspacePath: string | null;
  filePath: string;
  expectedOriginalHash: string;
  content: string;
  sensitivePathConfirmed: boolean;
};

type WriteEditableTextFileParams = {
  workspacePath: string | null;
  filePath: string;
  expectedOriginalHash: string;
  content: string;
  sensitivePathConfirmed: boolean;
};

type WorkspaceTreeEntry = {
  depth: number;
  name: string;
  type: 'file' | 'directory';
  size: number | null;
  modifiedAt: string | null;
};

type LocatedPathResult = {
  input: string;
  status: 'found' | 'not_found' | 'outside_workspace' | 'filtered';
  path: string | null;
  name: string | null;
  type: 'file' | 'directory' | null;
  size: number | null;
  modifiedAt: string | null;
  message: string;
};

type SendMessageResult = {
  userMessage: ReturnType<typeof mapMessage>;
  assistantMessage: ReturnType<typeof mapMessage>;
  locatedPaths: LocatedPathResult[];
  referencedFiles: ReferencedFileContent[];
  fileEditSuggestion: FileEditSuggestion | null;
};

type FileEditSuggestion = {
  id: string;
  sessionId: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  filePath: string;
  targetPath: string | null;
  fileName: string;
  originalHash: string | null;
  originalContent: string | null;
  proposedContent: string | null;
  proposedHash: string | null;
  summary: string;
  status: 'suggested' | 'applied' | 'failed';
  messageId: string | null;
};

type CompactRequest = {
  reason: string;
  beforeMessageId: string | null;
};

type ApplyFileEditParams = {
  sessionId: string;
  suggestionId: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  filePath: string;
  targetPath: string | null;
  expectedOriginalHash: string | null;
  proposedContent: string | null;
  sensitivePathConfirmed: boolean;
  deleteConfirmed: boolean;
  summary: string;
};

type CreateWorkspaceEntryParams = {
  type: 'file' | 'directory';
  name: string;
};

type SessionEventRow = {
  id: string;
  session_id: string;
  type: string;
  payload_json: string;
  created_at: string;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
  }>;
};

type CompactRequestEventRow = {
  id: string;
  payload_json: string;
  created_at: string;
};

type SessionRow = {
  id: string;
  title: string;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

type TaskStateRow = {
  session_id: string;
  state_json: string;
  updated_at: string;
};

type ContextPackRow = {
  id: string;
  session_id: string;
  from_message_id: string | null;
  to_message_id: string | null;
  pack_json: string;
  created_at: string;
};

type RollingSummaryRow = {
  id: string;
  session_id: string;
  from_message_id: string | null;
  to_message_id: string | null;
  summary: string;
  source_pack_id: string | null;
  created_at: string;
  updated_at: string;
};

type FileIndexRow = {
  id: string;
  session_id: string;
  file_path: string;
  operation: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

type CommandLogRow = {
  id: string;
  session_id: string;
  command: string;
  cwd: string | null;
  exit_code: number | null;
  status: string;
  important_output_json: string;
  created_at: string;
};

type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

const maxWorkspaceTreeEntries = 300;
const maxWorkspaceTreeDepth = 3;
const compactMessageThreshold = 80;
const compactTokenThreshold = 60000;
const compactToolOutputCharThreshold = 120000;
const sensitiveFileNames = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'credentials.json',
  'secrets.json',
  'id_rsa',
  'id_ed25519'
]);
const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  '.vite'
]);
const previewableOfficeExtensions = new Set(['.doc', '.docx', '.xlsx', '.ppt', '.pptx', '.pdf']);

let aiConfig: Partial<AiConfig> = {
  baseUrl: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
  model: process.env.AI_MODEL,
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30000)
};

let db: Database.Database;
let trustedWorkspacePath: string | null = null;
let workspaceWatcher: ReturnType<typeof watch> | null = null;
let workspaceChangeTimer: NodeJS.Timeout | null = null;
let mainWindowRef: BrowserWindow | null = null;
const activeChatControllers = new Map<string, AbortController>();

function normalizeAiConfig(config: Partial<AiConfig>): Partial<AiConfig> {
  return {
    baseUrl: config.baseUrl?.trim(),
    apiKey: config.apiKey?.trim(),
    model: config.model?.trim(),
    timeoutMs: Number(config.timeoutMs) || 30000
  };
}

function getStoredAiConfig() {
  const rows = db.prepare('SELECT key, value FROM ai_config').all() as Array<{ key: keyof AiConfig; value: string }>;

  return rows.reduce<Partial<AiConfig>>((config, row) => {
    if (row.key === 'timeoutMs') {
      config.timeoutMs = Number(row.value) || 30000;
      return config;
    }

    config[row.key] = row.value;
    return config;
  }, {});
}

function loadAiConfig() {
  const storedConfig = getStoredAiConfig();

  aiConfig = normalizeAiConfig({
    ...storedConfig,
    baseUrl: process.env.AI_BASE_URL ?? storedConfig.baseUrl,
    apiKey: process.env.AI_API_KEY ?? storedConfig.apiKey,
    model: process.env.AI_MODEL ?? storedConfig.model,
    timeoutMs: process.env.AI_TIMEOUT_MS ? Number(process.env.AI_TIMEOUT_MS) : storedConfig.timeoutMs
  });
}

function saveAiConfig(config: Partial<AiConfig>) {
  const normalizedConfig = normalizeAiConfig(config);
  const statement = db.prepare(`
    INSERT INTO ai_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  for (const [key, value] of Object.entries(normalizedConfig)) {
    if (value !== undefined) {
      statement.run(key, String(value));
    }
  }
}

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    title: row.title,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

function mapSessionEvent(row: SessionEventRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at
  };
}

function recordSessionEvent(sessionId: string, type: string, payload: unknown) {
  const event = {
    id: createId('event'),
    session_id: sessionId,
    type,
    payload_json: JSON.stringify(payload),
    created_at: new Date().toISOString()
  };

  db.prepare(`
    INSERT INTO session_events (id, session_id, type, payload_json, created_at)
    VALUES (@id, @session_id, @type, @payload_json, @created_at)
  `).run(event);

  return mapSessionEvent(event);
}

function getSessionTranscriptForMemory(sessionId: string): CompressionInputMessage[] {
  const messages = db.prepare(`
    SELECT id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId) as Array<Pick<MessageRow, 'id' | 'role' | 'content' | 'created_at'>>;
  const events = db.prepare(`
    SELECT id, type, payload_json, created_at
    FROM session_events
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId) as Array<Pick<SessionEventRow, 'id' | 'type' | 'payload_json' | 'created_at'>>;
  const transcript: Array<CompressionInputMessage & { sortAt: string }> = [];

  for (const message of messages) {
    transcript.push({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
      sortAt: message.created_at
    });
  }

  for (const event of events) {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(event.payload_json) as unknown;
      payload = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
      payload = {};
    }

    if (event.type === 'referenced_files_read') {
      const files = Array.isArray(payload.files) ? payload.files : [];
      for (const file of files) {
        if (typeof file !== 'object' || file === null) continue;
        const fileRecord = file as Record<string, unknown>;
        transcript.push({
          id: `${event.id}:${String(fileRecord.path ?? fileRecord.name ?? 'file')}`,
          role: 'tool',
          toolName: 'read',
          input: { filePath: fileRecord.path },
          output: fileRecord.message,
          createdAt: event.created_at,
          sortAt: event.created_at
        });
      }
    } else if (event.type === 'file_edit_applied' || event.type === 'file_edit_suggested' || event.type === 'file_edit_failed') {
      transcript.push({
        id: event.id,
        role: 'tool',
        toolName: event.type === 'file_edit_suggested' ? 'edit_suggestion' : 'edit',
        input: { filePath: payload.filePath, targetPath: payload.targetPath },
        output: payload.summary ?? payload.message ?? event.type,
        createdAt: event.created_at,
        sortAt: event.created_at
      });
    }
  }

  return transcript.sort((left, right) => left.sortAt.localeCompare(right.sortAt)).map(({ sortAt: _sortAt, ...message }) => message);
}

function replaceJsonRow(tableName: string, columns: string[], values: Record<string, unknown>) {
  const columnList = columns.join(', ');
  const placeholderList = columns.map((column) => `@${column}`).join(', ');
  db.prepare(`DELETE FROM ${tableName} WHERE session_id = @session_id`).run(values);
  db.prepare(`INSERT INTO ${tableName} (${columnList}) VALUES (${placeholderList})`).run(values);
}

function saveMemoryCompressionResult(result: CompressionResult) {
  const now = new Date().toISOString();

  replaceJsonRow('task_state', ['session_id', 'state_json', 'updated_at'], {
    session_id: result.sessionId,
    state_json: JSON.stringify(result.taskState),
    updated_at: now
  });

  db.prepare('DELETE FROM file_index WHERE session_id = ?').run(result.sessionId);
  const insertFileIndex = db.prepare(`
    INSERT INTO file_index (id, session_id, task_id, file_path, operation, reason, symbols_json, content_hash, mtime, created_at, updated_at)
    VALUES (@id, @session_id, @task_id, @file_path, @operation, @reason, @symbols_json, @content_hash, @mtime, @created_at, @updated_at)
  `);
  for (const filePath of result.fileIndex.read) {
    insertFileIndex.run({ id: createId('file-index'), session_id: result.sessionId, task_id: null, file_path: filePath, operation: 'read', reason: null, symbols_json: '[]', content_hash: null, mtime: null, created_at: now, updated_at: now });
  }
  for (const filePath of result.fileIndex.edited) {
    insertFileIndex.run({ id: createId('file-index'), session_id: result.sessionId, task_id: null, file_path: filePath, operation: 'edited', reason: null, symbols_json: '[]', content_hash: null, mtime: null, created_at: now, updated_at: now });
  }
  for (const skipped of result.fileIndex.skipped) {
    insertFileIndex.run({ id: createId('file-index'), session_id: result.sessionId, task_id: null, file_path: skipped.path, operation: 'skipped', reason: skipped.reason, symbols_json: '[]', content_hash: null, mtime: null, created_at: now, updated_at: now });
  }

  db.prepare('DELETE FROM command_log WHERE session_id = ?').run(result.sessionId);
  const insertCommandLog = db.prepare(`
    INSERT INTO command_log (id, session_id, command, cwd, exit_code, status, important_output_json, created_at)
    VALUES (@id, @session_id, @command, @cwd, @exit_code, @status, @important_output_json, @created_at)
  `);
  for (const command of result.commandLog) {
    insertCommandLog.run({ id: createId('command'), session_id: result.sessionId, command: command.command, cwd: command.cwd, exit_code: command.exitCode, status: command.status, important_output_json: JSON.stringify(command.importantOutput), created_at: now });
  }

  db.prepare('DELETE FROM context_pack WHERE session_id = ?').run(result.sessionId);
  db.prepare(`
    INSERT INTO context_pack (id, session_id, from_message_id, to_message_id, pack_json, created_at)
    VALUES (@id, @session_id, @from_message_id, @to_message_id, @pack_json, @created_at)
  `).run({
    id: createId('context-pack'),
    session_id: result.sessionId,
    from_message_id: result.contextPack.range.fromMessageId,
    to_message_id: result.contextPack.range.toMessageId,
    pack_json: JSON.stringify(result.contextPack),
    created_at: now
  });
}

function estimateMemoryTokens(transcript: CompressionInputMessage[]) {
  const text = transcript.map((message) => [message.content, message.output, message.result].filter(Boolean).join('\n')).join('\n');

  return Math.ceil(text.length / 4);
}

function getToolOutputChars(transcript: CompressionInputMessage[]) {
  return transcript.reduce((total, message) => {
    if (message.role !== 'tool') return total;
    return total + String(message.output ?? message.result ?? message.content ?? '').length;
  }, 0);
}

function getLastSummarizedMessageId(sessionId: string) {
  const row = db.prepare(`
    SELECT last_summarized_message_id
    FROM compact_boundary
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as { last_summarized_message_id: string | null } | undefined;

  return row?.last_summarized_message_id ?? null;
}

function getHistoryMessagesForModel(sessionId: string) {
  const lastSummarizedMessageId = getLastSummarizedMessageId(sessionId);
  const messages = db.prepare(`
    SELECT id, session_id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId) as MessageRow[];
  const startIndex = lastSummarizedMessageId
    ? messages.findIndex((message) => message.id === lastSummarizedMessageId) + 1
    : Math.max(0, messages.length - 20);
  const safeStartIndex = startIndex > 0 ? startIndex : Math.max(0, messages.length - 20);

  return messages.slice(safeStartIndex).slice(-20).map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function countMessagesAfterBoundary(transcript: CompressionInputMessage[], lastSummarizedMessageId: string | null) {
  const chatMessages = transcript.filter((message) => message.role === 'user' || message.role === 'assistant');
  if (!lastSummarizedMessageId) return chatMessages.length;

  const boundaryIndex = chatMessages.findIndex((message) => message.id === lastSummarizedMessageId);
  if (boundaryIndex === -1) return chatMessages.length;

  return chatMessages.length - boundaryIndex - 1;
}

function hasCompactRequestForMessage(sessionId: string, toMessageId: string | null) {
  if (!toMessageId) return false;

  const rows = db.prepare(`
    SELECT payload_json
    FROM session_events
    WHERE session_id = ? AND type = 'compact_requested'
    ORDER BY created_at DESC
    LIMIT 10
  `).all(sessionId) as Array<{ payload_json: string }>;

  return rows.some((row) => {
    const payload = safeJsonParse(row.payload_json) as Record<string, unknown> | null;
    return payload?.toMessageId === toMessageId;
  });
}

function maybeRecordProgramCompactRequest(sessionId: string, transcript: CompressionInputMessage[], result: CompressionResult) {
  const lastSummarizedMessageId = getLastSummarizedMessageId(sessionId);
  const uncompressedMessageCount = countMessagesAfterBoundary(transcript, lastSummarizedMessageId);
  const estimatedTokens = estimateMemoryTokens(transcript);
  const toolOutputChars = getToolOutputChars(transcript);
  const reasons: string[] = [];

  if (uncompressedMessageCount > compactMessageThreshold) {
    reasons.push(`未压缩消息数 ${uncompressedMessageCount} 超过 ${compactMessageThreshold}`);
  }
  if (estimatedTokens > compactTokenThreshold) {
    reasons.push(`估算上下文 ${estimatedTokens} tokens 超过 ${compactTokenThreshold}`);
  }
  if (toolOutputChars > compactToolOutputCharThreshold) {
    reasons.push(`工具输出 ${toolOutputChars} 字符超过 ${compactToolOutputCharThreshold}`);
  }

  if (reasons.length === 0 || hasCompactRequestForMessage(sessionId, result.contextPack.range.toMessageId)) {
    return;
  }

  recordSessionEvent(sessionId, 'compact_requested', {
    source: 'program',
    status: 'pending',
    reasons,
    fromMessageId: result.contextPack.range.fromMessageId,
    toMessageId: result.contextPack.range.toMessageId,
    lastSummarizedMessageId,
    metrics: {
      uncompressedMessageCount,
      estimatedTokens,
      toolOutputChars
    }
  });
}

function getPendingCompactRequest(sessionId: string) {
  const rows = db.prepare(`
    SELECT id, payload_json, created_at
    FROM session_events
    WHERE session_id = ? AND type = 'compact_requested'
    ORDER BY created_at DESC
    LIMIT 20
  `).all(sessionId) as CompactRequestEventRow[];

  const statusRows = db.prepare(`
    SELECT payload_json
    FROM session_events
    WHERE session_id = ? AND type = 'compact_request_status'
    ORDER BY created_at DESC
    LIMIT 50
  `).all(sessionId) as Array<{ payload_json: string }>;
  const handledRequestIds = new Set<string>();

  for (const row of statusRows) {
    const payload = safeJsonParse(row.payload_json) as Record<string, unknown> | null;
    if (typeof payload?.requestEventId === 'string') {
      handledRequestIds.add(payload.requestEventId);
    }
  }

  return rows.find((row) => {
    if (handledRequestIds.has(row.id)) return false;
    const payload = safeJsonParse(row.payload_json) as Record<string, unknown> | null;
    return payload?.status === 'pending';
  }) ?? null;
}

function getLatestContextPack(sessionId: string) {
  return db.prepare(`
    SELECT id, session_id, from_message_id, to_message_id, pack_json, created_at
    FROM context_pack
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as ContextPackRow | undefined;
}

function markCompactRequestStatus(sessionId: string, request: CompactRequestEventRow, status: 'completed' | 'failed', extra: Record<string, unknown>) {
  const payload = safeJsonParse(request.payload_json) as Record<string, unknown> | null;
  recordSessionEvent(sessionId, 'compact_request_status', {
    requestEventId: request.id,
    status,
    originalRequest: payload,
    ...extra
  });
}

function saveRollingSummary(sessionId: string, contextPack: ContextPackRow, summary: string, tokenCount: number | null) {
  const now = new Date().toISOString();
  const summaryId = createId('summary');

  db.prepare(`
    INSERT INTO rolling_summary (id, session_id, from_message_id, to_message_id, summary, source_pack_id, created_at, updated_at)
    VALUES (@id, @session_id, @from_message_id, @to_message_id, @summary, @source_pack_id, @created_at, @updated_at)
  `).run({
    id: summaryId,
    session_id: sessionId,
    from_message_id: contextPack.from_message_id,
    to_message_id: contextPack.to_message_id,
    summary,
    source_pack_id: contextPack.id,
    created_at: now,
    updated_at: now
  });
  db.prepare(`
    INSERT INTO compact_boundary (id, session_id, summary_id, last_summarized_message_id, pre_compact_token_count, created_at)
    VALUES (@id, @session_id, @summary_id, @last_summarized_message_id, @pre_compact_token_count, @created_at)
  `).run({
    id: createId('compact-boundary'),
    session_id: sessionId,
    summary_id: summaryId,
    last_summarized_message_id: contextPack.to_message_id,
    pre_compact_token_count: tokenCount,
    created_at: now
  });

  return summaryId;
}

function buildRollingSummaryPrompt(contextPackJson: string) {
  return [
    '请基于下面的 context_pack 生成当前会话滚动摘要。',
    '要求：',
    '- 简洁、事实化',
    '- 保留用户明确要求',
    '- 保留任务目标和当前进度',
    '- 保留重要决策、已读/已改文件、待验证项、阻塞点',
    '- 不要包含 API Key、Token、密码、私钥',
    '- 不要复述大段文件内容',
    '- 输出纯文本，不要 Markdown 表格，不要 JSON',
    '',
    'context_pack:',
    contextPackJson
  ].join('\n');
}

async function generateRollingSummaryFromPendingCompact(sessionId: string) {
  const request = getPendingCompactRequest(sessionId);
  if (!request) return;

  const contextPack = getLatestContextPack(sessionId);
  if (!contextPack) {
    markCompactRequestStatus(sessionId, request, 'failed', { message: '缺少 context_pack' });
    return;
  }

  try {
    const baseUrl = String(getRequiredConfig('baseUrl', 'AI Base URL')).replace(/\/$/, '');
    const apiKey = String(getRequiredConfig('apiKey', 'AI API Key'));
    const model = String(getRequiredConfig('model', 'AI Model'));
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: '你是会话记忆压缩器，只负责把结构化上下文压缩成可靠摘要。'
          },
          {
            role: 'user',
            content: buildRollingSummaryPrompt(contextPack.pack_json)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`AI 摘要接口请求失败：${response.status}`);
    }

    const summary = await readNonStreamingChatResponse(response);
    const summaryId = saveRollingSummary(sessionId, contextPack, summary, null);
    markCompactRequestStatus(sessionId, request, 'completed', { summaryId });
  } catch (error) {
    markCompactRequestStatus(sessionId, request, 'failed', {
      message: error instanceof Error ? error.message : '生成滚动摘要失败'
    });
  }
}

function updateSessionMemory(sessionId: string) {
  const transcript = getSessionTranscriptForMemory(sessionId);
  const result = compressTranscript({ sessionId, messages: transcript });
  saveMemoryCompressionResult(result);
  maybeRecordProgramCompactRequest(sessionId, transcript, result);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function formatStringList(title: string, values: unknown, maxItems = 8) {
  if (!Array.isArray(values) || values.length === 0) return '';
  const lines = values.slice(0, maxItems).map((value) => `- ${String(value)}`);
  return [`${title}:`, ...lines].join('\n');
}

function formatMemoryContext(sessionId: string) {
  const taskStateRow = db.prepare(`
    SELECT session_id, state_json, updated_at
    FROM task_state
    WHERE session_id = ?
  `).get(sessionId) as TaskStateRow | undefined;
  const contextPackRow = db.prepare(`
    SELECT id, session_id, from_message_id, to_message_id, pack_json, created_at
    FROM context_pack
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as ContextPackRow | undefined;
  const rollingSummaryRow = db.prepare(`
    SELECT id, session_id, from_message_id, to_message_id, summary, source_pack_id, created_at, updated_at
    FROM rolling_summary
    WHERE session_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(sessionId) as RollingSummaryRow | undefined;
  const parts: string[] = [];

  if (taskStateRow) {
    const taskState = safeJsonParse(taskStateRow.state_json) as Record<string, unknown> | null;
    if (taskState) {
      const taskParts = [
        `目标：${String(taskState.goal ?? '未记录')}`,
        formatStringList('用户要求', taskState.requirements),
        formatStringList('已完成', taskState.completed),
        formatStringList('待验证', taskState.pendingValidation),
        formatStringList('阻塞点', taskState.blockers),
        formatStringList('相关文件', taskState.relatedFiles)
      ].filter(Boolean);
      parts.push(['[current_task]', ...taskParts].join('\n'));
    }
  }

  if (rollingSummaryRow?.summary.trim()) {
    parts.push(['[rolling_summary]', rollingSummaryRow.summary.trim()].join('\n'));
  }

  if (contextPackRow) {
    const contextPack = safeJsonParse(contextPackRow.pack_json) as Record<string, unknown> | null;
    const packParts: string[] = [];
    if (contextPack) {
      packParts.push(formatStringList('历史用户要求', contextPack.userRequirements));
      packParts.push(formatStringList('历史决策', contextPack.decisions));
      packParts.push(formatStringList('未解决问题', contextPack.openQuestions));
      const files = contextPack.files as Record<string, unknown> | undefined;
      if (files) {
        packParts.push(formatStringList('读过文件', files.read));
        packParts.push(formatStringList('改过文件', files.edited));
      }
    }
    const compactPack = packParts.filter(Boolean).join('\n');
    if (compactPack) {
      parts.push(['[compressed_context]', compactPack].join('\n'));
    }
  }

  if (parts.length === 0) {
    return '当前会话暂无可用 Memory。';
  }

  return parts.join('\n\n');
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function setTrustedWorkspacePath(workspacePath: string | null) {
  trustedWorkspacePath = workspacePath ? await realpath(workspacePath) : null;
  workspaceWatcher?.close();
  workspaceWatcher = null;

  if (!trustedWorkspacePath) {
    return;
  }

  workspaceWatcher = watch(trustedWorkspacePath, { recursive: process.platform === 'win32' }, (_eventType, filename) => {
    if (workspaceChangeTimer) {
      clearTimeout(workspaceChangeTimer);
    }

    workspaceChangeTimer = setTimeout(() => {
      mainWindowRef?.webContents.send('workspace:changed', {
        workspacePath: trustedWorkspacePath,
        path: filename ? path.join(trustedWorkspacePath as string, filename.toString()) : null
      });
    }, 250);
  });
}

async function getTrustedWorkspacePath() {
  if (!trustedWorkspacePath) {
    throw new Error('请先选择工作区目录');
  }

  return trustedWorkspacePath;
}

function shouldHideEntry(name: string, isDirectory: boolean) {
  if (name.startsWith('.')) {
    return true;
  }

  if (sensitiveFileNames.has(name.toLowerCase())) {
    return true;
  }

  return isDirectory && ignoredDirectoryNames.has(name);
}

function isInsideWorkspace(workspacePath: string, targetPath: string) {
  const relativePath = path.relative(path.resolve(workspacePath), path.resolve(targetPath));

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function hashTextContent(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function getFileContentKind(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (previewableTextExtensions.has(extension)) {
    return 'text' as const;
  }

  if (previewableOfficeExtensions.has(extension)) {
    return 'office' as const;
  }

  return 'unsupported' as const;
}

async function readDocText(filePath: string) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(filePath);

  return [
    document.getBody(),
    document.getHeaders(),
    document.getFooters(),
    document.getFootnotes(),
    document.getEndnotes(),
    document.getAnnotations(),
    document.getTextboxes()
  ].filter(Boolean).join('\n\n').trim();
}

async function readOfficeText(filePath: string, enableOcr: boolean) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.doc') {
    return readDocText(filePath);
  }

  const ast = await OfficeParser.parseOffice(filePath, {
    ocr: enableOcr,
    ocrConfig: enableOcr ? {
      language: 'chi_sim+eng',
      timeout: {
        workerLoad: 60000,
        recognition: 30000,
        autoTerminate: 10000
      }
    } : undefined,
    ignoreComments: true,
    ignoreHeadersAndFooters: false
  });
  const result = await ast.to('text');

  return typeof result.value === 'string' ? result.value.trim() : '';
}

function isSensitivePath(workspacePath: string, targetPath: string) {
  const relativePath = path.relative(path.resolve(workspacePath), path.resolve(targetPath));
  const segments = relativePath.split(path.sep).filter(Boolean);

  return segments.some((segment, index) => {
    const isDirectory = index < segments.length - 1;

    return segment.startsWith('.') || sensitiveFileNames.has(segment.toLowerCase()) || (isDirectory && segment === '.git');
  });
}

async function assertEditableTextFile(filePath: string) {
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error('当前选择的不是文件');
  }

  if (fileStat.size > maxPreviewFileSize) {
    throw new Error('文件超过 1MB，暂不支持编辑保存');
  }

  const extension = path.extname(filePath).toLowerCase();

  if (!previewableTextExtensions.has(extension)) {
    throw new Error('该文件类型暂不支持编辑保存');
  }

  return fileStat;
}

async function readPreviewableFile(filePath: string, enableOcr = false) {
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error('当前选择的不是文件');
  }

  const contentKind = getFileContentKind(filePath);

  if (contentKind === 'text') {
    if (fileStat.size > maxPreviewFileSize) {
      throw new Error('文件超过 1MB，暂不支持读取');
    }

    const content = await readFile(filePath, 'utf8');

    return {
      content,
      originalHash: hashTextContent(content),
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      isEditable: true,
      contentKind,
      ocrEnabled: false
    };
  }

  if (contentKind === 'office') {
    if (fileStat.size > maxOfficePreviewFileSize) {
      throw new Error('Office 文件超过 10MB，暂不支持读取');
    }

    const content = await readOfficeText(filePath, enableOcr);

    if (!content) {
      throw new Error('未能从该 Office 文件提取到文本内容');
    }

    return {
      content,
      originalHash: hashTextContent(content),
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      isEditable: false,
      contentKind,
      ocrEnabled: enableOcr
    };
  }

  throw new Error('该文件类型暂不支持读取');
}

function assertTextFileExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (!previewableTextExtensions.has(extension)) {
    throw new Error('该文件类型暂不支持操作');
  }
}

async function resolveWorkspaceTargetPath(filePath: string) {
  const resolvedWorkspacePath = await getTrustedWorkspacePath();
  const resolvedFilePath = path.resolve(filePath);

  if (!isInsideWorkspace(resolvedWorkspacePath, resolvedFilePath)) {
    throw new Error('只能操作当前工作区内的文件');
  }

  return {
    resolvedWorkspacePath,
    resolvedFilePath
  };
}

async function writeEditableTextFile(params: WriteEditableTextFileParams) {
  const { resolvedWorkspacePath, resolvedFilePath } = await resolveWorkspaceTargetPath(params.filePath);

  await assertEditableTextFile(resolvedFilePath);

  const realFilePath = await realpath(resolvedFilePath);

  if (!isInsideWorkspace(resolvedWorkspacePath, realFilePath)) {
    throw new Error('只能保存当前工作区内的文件');
  }

  if (isSensitivePath(resolvedWorkspacePath, realFilePath) && !params.sensitivePathConfirmed) {
    throw new Error('该路径属于敏感文件或隐藏路径，请确认后再保存');
  }

  const currentContent = await readFile(realFilePath, 'utf8');
  const currentHash = hashTextContent(currentContent);

  if (currentHash !== params.expectedOriginalHash) {
    throw new Error('文件已被外部修改，请重新打开或刷新后再保存');
  }

  if (Buffer.byteLength(params.content, 'utf8') > maxPreviewFileSize) {
    throw new Error('文件内容超过 1MB，已拒绝保存');
  }

  await writeFile(realFilePath, params.content, 'utf8');
  const nextStat = await stat(realFilePath);
  const nextHash = hashTextContent(params.content);

  return {
    size: nextStat.size,
    modifiedAt: nextStat.mtime.toISOString(),
    nextHash
  };
}

async function createEditableTextFile(params: { filePath: string; content: string; sensitivePathConfirmed: boolean }) {
  const { resolvedWorkspacePath, resolvedFilePath } = await resolveWorkspaceTargetPath(params.filePath);
  assertTextFileExtension(resolvedFilePath);

  if (Buffer.byteLength(params.content, 'utf8') > maxPreviewFileSize) {
    throw new Error('文件内容超过 1MB，已拒绝创建');
  }

  if (isSensitivePath(resolvedWorkspacePath, resolvedFilePath) && !params.sensitivePathConfirmed) {
    throw new Error('该路径属于敏感文件或隐藏路径，请确认后再创建');
  }

  try {
    await stat(resolvedFilePath);
    throw new Error('目标文件已存在，不能覆盖创建');
  } catch (error) {
    if (error instanceof Error && error.message === '目标文件已存在，不能覆盖创建') {
      throw error;
    }
  }

  await mkdir(path.dirname(resolvedFilePath), { recursive: true });
  await writeFile(resolvedFilePath, params.content, 'utf8');
  const nextStat = await stat(resolvedFilePath);
  const nextHash = hashTextContent(params.content);

  return {
    size: nextStat.size,
    modifiedAt: nextStat.mtime.toISOString(),
    nextHash
  };
}

async function deleteEditableTextFile(params: { filePath: string; expectedOriginalHash: string; sensitivePathConfirmed: boolean; deleteConfirmed: boolean }) {
  if (!params.deleteConfirmed) {
    throw new Error('删除文件前必须确认');
  }

  const { resolvedWorkspacePath, resolvedFilePath } = await resolveWorkspaceTargetPath(params.filePath);
  await assertEditableTextFile(resolvedFilePath);
  const realFilePath = await realpath(resolvedFilePath);

  if (!isInsideWorkspace(resolvedWorkspacePath, realFilePath)) {
    throw new Error('只能删除当前工作区内的文件');
  }

  if (isSensitivePath(resolvedWorkspacePath, realFilePath) && !params.sensitivePathConfirmed) {
    throw new Error('该路径属于敏感文件或隐藏路径，请确认后再删除');
  }

  const currentContent = await readFile(realFilePath, 'utf8');
  const currentHash = hashTextContent(currentContent);

  if (currentHash !== params.expectedOriginalHash) {
    throw new Error('文件已被外部修改，请重新生成删除建议');
  }

  await unlink(realFilePath);

  return {
    size: 0,
    modifiedAt: new Date().toISOString(),
    nextHash: ''
  };
}

async function renameWorkspaceEntry(params: { filePath: string; targetPath: string; expectedOriginalHash: string | null; sensitivePathConfirmed: boolean }) {
  const { resolvedWorkspacePath, resolvedFilePath } = await resolveWorkspaceTargetPath(params.filePath);
  const resolvedTargetPath = path.resolve(params.targetPath);

  if (!isInsideWorkspace(resolvedWorkspacePath, resolvedTargetPath)) {
    throw new Error('只能重命名到当前工作区内');
  }

  const sourceStat = await stat(resolvedFilePath);
  const realSourcePath = await realpath(resolvedFilePath);

  if (!isInsideWorkspace(resolvedWorkspacePath, realSourcePath)) {
    throw new Error('只能重命名当前工作区内的文件');
  }

  if ((isSensitivePath(resolvedWorkspacePath, realSourcePath) || isSensitivePath(resolvedWorkspacePath, resolvedTargetPath)) && !params.sensitivePathConfirmed) {
    throw new Error('该路径属于敏感文件或隐藏路径，请确认后再重命名');
  }

  try {
    await stat(resolvedTargetPath);
    throw new Error('目标路径已存在，不能重命名');
  } catch (error) {
    if (error instanceof Error && error.message === '目标路径已存在，不能重命名') {
      throw error;
    }
  }

  if (sourceStat.isFile() && params.expectedOriginalHash) {
    assertTextFileExtension(resolvedFilePath);
    const currentContent = await readFile(realSourcePath, 'utf8');
    const currentHash = hashTextContent(currentContent);

    if (currentHash !== params.expectedOriginalHash) {
      throw new Error('文件已被外部修改，请重新生成重命名建议');
    }
  }

  await mkdir(path.dirname(resolvedTargetPath), { recursive: true });
  await rename(realSourcePath, resolvedTargetPath);
  const nextStat = await stat(resolvedTargetPath);

  return {
    size: nextStat.isFile() ? nextStat.size : 0,
    modifiedAt: nextStat.mtime.toISOString(),
    nextHash: params.expectedOriginalHash ?? ''
  };
}

async function createWorkspaceEntry(params: CreateWorkspaceEntryParams) {
  const workspacePath = await getTrustedWorkspacePath();
  const normalizedName = params.name.trim();

  if (!normalizedName) {
    throw new Error('请输入名称');
  }

  if (path.isAbsolute(normalizedName)) {
    throw new Error('名称不能是绝对路径');
  }

  const targetPath = path.resolve(workspacePath, normalizedName);

  if (!isInsideWorkspace(workspacePath, targetPath)) {
    throw new Error('只能在当前工作区内创建');
  }

  try {
    await stat(targetPath);
    throw new Error('目标已存在');
  } catch (error) {
    if (error instanceof Error && error.message === '目标已存在') {
      throw error;
    }
  }

  if (params.type === 'directory') {
    await mkdir(targetPath, { recursive: true });
  } else {
    assertTextFileExtension(targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, '', 'utf8');
  }

  const entryStat = await stat(targetPath);

  return {
    id: targetPath,
    name: path.basename(targetPath),
    path: targetPath,
    type: params.type,
    size: params.type === 'file' ? entryStat.size : null,
    modifiedAt: entryStat.mtime.toISOString()
  };
}

function hasFilteredPathSegment(workspacePath: string, targetPath: string) {
  const relativePath = path.relative(path.resolve(workspacePath), path.resolve(targetPath));
  const segments = relativePath.split(path.sep).filter(Boolean);

  return segments.some((segment, index) => {
    const isDirectory = index < segments.length - 1;
    return shouldHideEntry(segment, isDirectory);
  });
}

function normalizePathCandidate(candidate: string) {
  return candidate.trim().replace(/^["'“”‘’]+|["'“”‘’，。；;）)]+$/g, '');
}

function extractPathCandidates(content: string) {
  const candidates = new Set<string>();
  const quotedPattern = /["'“‘]([^"'”’]+)["'”’]/g;
  const pathLikePattern = /(?:[A-Za-z]:)?[^\s"'“”‘’<>|]+[\\/][^\s"'“”‘’<>|]+/g;

  for (const match of content.matchAll(quotedPattern)) {
    const candidate = normalizePathCandidate(match[1]);

    if (candidate.includes('/') || candidate.includes('\\')) {
      candidates.add(candidate);
    }
  }

  for (const match of content.matchAll(pathLikePattern)) {
    candidates.add(normalizePathCandidate(match[0]));
  }

  return Array.from(candidates).filter(Boolean).slice(0, 20);
}

async function locatePathsInWorkspace(workspacePath: string | null, content: string): Promise<LocatedPathResult[]> {

  const candidates = extractPathCandidates(content);
  const results: LocatedPathResult[] = [];

  for (const candidate of candidates) {
    const targetPath = path.isAbsolute(candidate) ? candidate : path.join(workspacePath ?? process.cwd(), candidate);
    const resolvedPath = path.resolve(targetPath);

    try {
      const targetStat = await stat(resolvedPath);
      const isDirectory = targetStat.isDirectory();

      results.push({
        input: candidate,
        status: 'found',
        path: resolvedPath,
        name: path.basename(resolvedPath),
        type: isDirectory ? 'directory' : 'file',
        size: targetStat.isFile() ? targetStat.size : null,
        modifiedAt: targetStat.mtime.toISOString(),
        message: '已在当前工作区定位到该路径'
      });
    } catch {
      results.push({
        input: candidate,
        status: 'not_found',
        path: resolvedPath,
        name: path.basename(resolvedPath),
        type: null,
        size: null,
        modifiedAt: null,
        message: '当前工作区内未找到该路径'
      });
    }
  }

  return results;
}

function formatLocatedPaths(results: LocatedPathResult[]) {
  if (results.length === 0) {
    return '用户消息中未识别到可定位的文件路径。';
  }

  return results.map((result) => {
    if (result.status !== 'found') {
      return `- ${result.input}: ${result.message}`;
    }

    const kind = result.type === 'directory' ? '文件夹' : '文件';
    const size = result.size === null ? '-' : `${result.size} bytes`;
    const modifiedAt = result.modifiedAt ?? '-';

    return `- ${result.input}: 已定位 ${kind} ${result.path} (size: ${size}, modified: ${modifiedAt})`;
  }).join('\n');
}

async function readReferencedFiles(
  workspacePath: string | null,
  referencedFiles: ReferencedFileInput[]
): Promise<ReferencedFileContent[]> {
  const results: ReferencedFileContent[] = [];

  for (const file of referencedFiles.slice(0, 10)) {
    const resolvedPath = path.resolve(path.isAbsolute(file.path) ? file.path : path.join(workspacePath ?? process.cwd(), file.path));

    try {
      const fileStat = await stat(resolvedPath);

      if (!fileStat.isFile()) {
        results.push({
          name: file.name,
          path: resolvedPath,
          status: 'skipped',
          content: null,
          originalHash: null,
          message: '引用的是文件夹，暂不读取内容'
        });
        continue;
      }

      if (fileStat.size > maxOfficePreviewFileSize) {
        results.push({
          name: file.name,
          path: resolvedPath,
          status: 'skipped',
          content: null,
          originalHash: null,
          message: '文件超过 10MB，已拒绝读取'
        });
        continue;
      }

      if (getFileContentKind(resolvedPath) === 'unsupported') {
        results.push({
          name: file.name,
          path: resolvedPath,
          status: 'skipped',
          content: null,
          originalHash: null,
          message: '该文件类型暂不支持读取'
        });
        continue;
      }

      const preview = await readPreviewableFile(resolvedPath);

      results.push({
        name: file.name,
        path: resolvedPath,
        status: 'read',
        content: preview.content,
        originalHash: preview.originalHash,
        message: preview.isEditable ? '已读取引用文件内容' : '已提取 Office 文件文本内容'
      });
    } catch {
      results.push({
        name: file.name,
        path: resolvedPath,
        status: 'skipped',
        content: null,
        originalHash: null,
        message: '引用文件不存在或无法读取'
      });
    }
  }

  if (referencedFiles.length > 10) {
    results.push({
      name: '引用文件数量限制',
      path: '',
      status: 'skipped',
      content: null,
      originalHash: null,
      message: '最多读取前 10 个引用文件，其余已跳过'
    });
  }

  return results;
}

function formatReferencedFiles(files: ReferencedFileContent[]) {
  if (files.length === 0) {
    return '用户未引用文件。';
  }

  return files.map((file) => {
    if (file.status !== 'read') {
      return `### ${file.name}\n路径：${file.path || '-'}\n状态：${file.message}`;
    }

    return `### ${file.name}\n路径：${file.path}\n状态：${file.message}\n原始 hash：${file.originalHash ?? '-'}\n内容：\n${file.content}`;
  }).join('\n\n');
}

function formatReferencedFileNames(files: ReferencedFileContent[]) {
  const readableFiles = files.filter((file) => file.status === 'read');

  if (readableFiles.length === 0) {
    return '';
  }

  return readableFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n');
}

function parseFileEditSuggestion(content: string, referencedFiles: ReferencedFileContent[], sessionId: string): FileEditSuggestion | null {
  const match = content.match(/```file-edit-suggestion\s*([\s\S]*?)```/);

  if (!match) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as {
    operation?: unknown;
    filePath?: unknown;
    targetPath?: unknown;
    originalHash?: unknown;
    nextContent?: unknown;
    summary?: unknown;
  };

  if (
    (candidate.operation !== 'update' && candidate.operation !== 'create' && candidate.operation !== 'delete' && candidate.operation !== 'rename')
    || typeof candidate.filePath !== 'string'
    || typeof candidate.summary !== 'string'
  ) {
    return null;
  }

  if (candidate.operation === 'create') {
    if (typeof candidate.nextContent !== 'string' || Buffer.byteLength(candidate.nextContent, 'utf8') > maxPreviewFileSize) {
      return null;
    }

    return {
      id: createId('file-edit'),
      sessionId,
      operation: 'create',
      filePath: candidate.filePath,
      targetPath: null,
      fileName: path.basename(candidate.filePath),
      originalHash: null,
      originalContent: null,
      proposedContent: candidate.nextContent,
      proposedHash: hashTextContent(candidate.nextContent),
      summary: candidate.summary.slice(0, 500),
      status: 'suggested',
      messageId: null
    };
  }

  if (typeof candidate.originalHash !== 'string') {
    return null;
  }

  const file = referencedFiles.find((referencedFile) => referencedFile.status === 'read'
    && referencedFile.path === candidate.filePath
    && referencedFile.originalHash === candidate.originalHash);

  if (!file) {
    return null;
  }

  if (candidate.operation === 'delete') {
    return {
      id: createId('file-edit'),
      sessionId,
      operation: 'delete',
      filePath: file.path,
      targetPath: null,
      fileName: file.name,
      originalHash: candidate.originalHash,
      originalContent: file.content,
      proposedContent: null,
      proposedHash: null,
      summary: candidate.summary.slice(0, 500),
      status: 'suggested',
      messageId: null
    };
  }

  if (candidate.operation === 'rename') {
    if (typeof candidate.targetPath !== 'string') {
      return null;
    }

    return {
      id: createId('file-edit'),
      sessionId,
      operation: 'rename',
      filePath: file.path,
      targetPath: candidate.targetPath,
      fileName: file.name,
      originalHash: candidate.originalHash,
      originalContent: file.content,
      proposedContent: null,
      proposedHash: null,
      summary: candidate.summary.slice(0, 500),
      status: 'suggested',
      messageId: null
    };
  }

  if (typeof candidate.nextContent !== 'string' || Buffer.byteLength(candidate.nextContent, 'utf8') > maxPreviewFileSize) {
    return null;
  }

  return {
    id: createId('file-edit'),
    sessionId,
    operation: 'update',
    filePath: file.path,
    targetPath: null,
    fileName: file.name,
    originalHash: candidate.originalHash,
    originalContent: file.content,
    proposedContent: candidate.nextContent,
    proposedHash: hashTextContent(candidate.nextContent),
    summary: candidate.summary.slice(0, 500),
    status: 'suggested',
    messageId: null
  };
}

function stripFileEditSuggestionBlock(content: string) {
  return content.replace(/```file-edit-suggestion\s*[\s\S]*?```/g, '').trim();
}

function parseCompactRequest(content: string): CompactRequest | null {
  const match = content.match(/```compact-request\s*([\s\S]*?)```/);

  if (!match) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as { type?: unknown; reason?: unknown; suggestedRange?: { beforeMessageId?: unknown } };

  if (candidate.type !== 'REQUEST_COMPACT' || typeof candidate.reason !== 'string') {
    return null;
  }

  const beforeMessageId = typeof candidate.suggestedRange?.beforeMessageId === 'string'
    ? candidate.suggestedRange.beforeMessageId
    : null;

  return {
    reason: candidate.reason.slice(0, 500),
    beforeMessageId
  };
}

function stripCompactRequestBlock(content: string) {
  return content.replace(/```compact-request\s*[\s\S]*?```/g, '').trim();
}

function mergeReferencedFilesWithLocatedPaths(
  referencedFiles: ReferencedFileInput[],
  locatedPaths: LocatedPathResult[]
) {
  const mergedFiles = new Map<string, ReferencedFileInput>();

  for (const file of referencedFiles) {
    mergedFiles.set(path.resolve(file.path), file);
  }

  for (const locatedPath of locatedPaths) {
    if (locatedPath.status !== 'found' || locatedPath.type !== 'file' || !locatedPath.path) {
      continue;
    }

    const resolvedPath = path.resolve(locatedPath.path);

    if (!mergedFiles.has(resolvedPath)) {
      mergedFiles.set(resolvedPath, {
        name: locatedPath.name ?? path.basename(resolvedPath),
        path: resolvedPath,
        type: 'file'
      });
    }
  }

  return Array.from(mergedFiles.values());
}

function formatWorkspaceTree(entries: WorkspaceTreeEntry[], wasTruncated: boolean) {
  if (entries.length === 0) {
    return '当前工作区目录结构为空，或所有条目均被安全规则过滤。';
  }

  const lines = entries.map((entry) => {
    const indent = '  '.repeat(entry.depth);
    const kind = entry.type === 'directory' ? '文件夹' : '文件';
    const size = entry.size === null ? '-' : `${entry.size} bytes`;
    const modifiedAt = entry.modifiedAt ?? '-';

    return `${indent}- ${entry.name} (${kind}, size: ${size}, modified: ${modifiedAt})`;
  });

  if (wasTruncated) {
    lines.push(`- 已达到 ${maxWorkspaceTreeEntries} 项上限，后续目录结构已省略。`);
  }

  return lines.join('\n');
}

async function collectWorkspaceTree(rootPath: string) {
  const entries: WorkspaceTreeEntry[] = [];
  let wasTruncated = false;

  async function walk(directoryPath: string, depth: number) {
    if (entries.length >= maxWorkspaceTreeEntries) {
      wasTruncated = true;
      return;
    }

    if (depth > maxWorkspaceTreeDepth) {
      return;
    }

    let directoryEntries;

    try {
      directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    const visibleEntries = directoryEntries
      .filter((entry) => !shouldHideEntry(entry.name, entry.isDirectory()))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }

        return left.name.localeCompare(right.name, 'zh-CN');
      });

    for (const entry of visibleEntries) {
      if (entries.length >= maxWorkspaceTreeEntries) {
        wasTruncated = true;
        return;
      }

      const entryPath = path.join(directoryPath, entry.name);
      const isDirectory = entry.isDirectory();

      try {
        const entryStat = await stat(entryPath);
        entries.push({
          depth,
          name: entry.name,
          type: isDirectory ? 'directory' : 'file',
          size: entry.isFile() ? entryStat.size : null,
          modifiedAt: entryStat.mtime.toISOString()
        });
      } catch {
        entries.push({
          depth,
          name: entry.name,
          type: isDirectory ? 'directory' : 'file',
          size: null,
          modifiedAt: null
        });
      }

      if (isDirectory) {
        await walk(entryPath, depth + 1);
      }
    }
  }

  await walk(rootPath, 0);

  return {
    entries,
    wasTruncated
  };
}

function initDatabase() {
  db = new Database(path.join(app.getPath('userData'), 'ai-workstation.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS ai_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS task_state (
      session_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS file_index (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      reason TEXT,
      symbols_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT,
      mtime TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS command_log (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT,
      exit_code INTEGER,
      status TEXT NOT NULL,
      important_output_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS context_pack (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_message_id TEXT,
      to_message_id TEXT,
      pack_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS rolling_summary (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_message_id TEXT,
      to_message_id TEXT,
      summary TEXT NOT NULL,
      source_pack_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (source_pack_id) REFERENCES context_pack(id)
    );

    CREATE TABLE IF NOT EXISTS compact_boundary (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      summary_id TEXT,
      last_summarized_message_id TEXT,
      pre_compact_token_count INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (summary_id) REFERENCES rolling_summary(id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_events_session_id_created_at ON session_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_file_index_session_id_path ON file_index(session_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_command_log_session_id_created_at ON command_log(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_context_pack_session_id_created_at ON context_pack(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_rolling_summary_session_id_updated_at ON rolling_summary(session_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_compact_boundary_session_id_created_at ON compact_boundary(session_id, created_at);
  `);
}

function getRequiredConfig<K extends keyof AiConfig>(key: K, label: string) {
  const value = aiConfig[key];

  if (!value) {
    throw new Error(`${label} 未配置`);
  }

  return value;
}

async function readStreamingChatResponse(response: Response, onChunk: (content: string) => void) {
  if (!response.body) {
    throw new Error('AI 接口未返回流式内容');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine.startsWith('data:')) {
        continue;
      }

      const data = trimmedLine.slice(5).trim();

      if (!data || data === '[DONE]') {
        continue;
      }

      const parsed = JSON.parse(data) as ChatCompletionChunk;
      const content = parsed.choices?.[0]?.delta?.content;

      if (content) {
        fullContent += content;
        onChunk(content);
      }
    }
  }

  return fullContent.trim();
}

async function readNonStreamingChatResponse(response: Response) {
  const parsed = await response.json() as ChatCompletionChunk;
  const content = parsed.choices?.[0]?.message?.content;

  if (!content?.trim()) {
    throw new Error('AI 摘要接口未返回内容');
  }

  return content.trim();
}

ipcMain.handle('config:getAiConfig', async () => ({
  baseUrl: aiConfig.baseUrl ?? '',
  model: aiConfig.model ?? '',
  timeoutMs: aiConfig.timeoutMs ?? 30000,
  hasApiKey: Boolean(aiConfig.apiKey)
}));

ipcMain.handle('config:setAiConfig', async (_event, config: AiConfig) => {
  aiConfig = normalizeAiConfig({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey.trim() || aiConfig.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs
  });
  saveAiConfig(aiConfig);

  return { ok: true };
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return {
      canceled: true,
      path: null
    };
  }

  await setTrustedWorkspacePath(result.filePaths[0]);

  return {
    canceled: false,
    path: result.filePaths[0]
  };
});

ipcMain.handle('session:create', async (_event, params: { workspacePath: string | null }) => {
  await setTrustedWorkspacePath(params.workspacePath);
  const now = new Date().toISOString();
  const session = {
    id: createId('session'),
    title: '新会话',
    workspace_path: params.workspacePath,
    created_at: now,
    updated_at: now
  };

  db.prepare(`
    INSERT INTO sessions (id, title, workspace_path, created_at, updated_at)
    VALUES (@id, @title, @workspace_path, @created_at, @updated_at)
  `).run(session);

  return mapSession(session);
});

ipcMain.handle('session:list', async () => {
  const rows = db.prepare(`
    SELECT id, title, workspace_path, created_at, updated_at
    FROM sessions
    ORDER BY updated_at DESC
  `).all() as SessionRow[];

  return rows.map(mapSession);
});

ipcMain.handle('session:get', async (_event, params: { sessionId: string }) => {
  const session = db.prepare(`
    SELECT id, title, workspace_path, created_at, updated_at
    FROM sessions
    WHERE id = ?
  `).get(params.sessionId) as SessionRow | undefined;

  if (!session) {
    throw new Error('会话不存在');
  }

  await setTrustedWorkspacePath(session.workspace_path);

  const messages = db.prepare(`
    SELECT id, session_id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(params.sessionId) as MessageRow[];

  return {
    session: mapSession(session),
    messages: messages.map(mapMessage)
  };
});

ipcMain.handle('session:getEvents', async (_event, params: { sessionId: string }) => {
  const events = db.prepare(`
    SELECT id, session_id, type, payload_json, created_at
    FROM session_events
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(params.sessionId) as SessionEventRow[];

  return events.map(mapSessionEvent);
});

ipcMain.handle('session:getMemory', async (_event, params: { sessionId: string }) => {
  const taskState = db.prepare(`
    SELECT session_id, state_json, updated_at
    FROM task_state
    WHERE session_id = ?
  `).get(params.sessionId) as TaskStateRow | undefined;
  const contextPack = getLatestContextPack(params.sessionId);
  const rollingSummary = db.prepare(`
    SELECT id, session_id, from_message_id, to_message_id, summary, source_pack_id, created_at, updated_at
    FROM rolling_summary
    WHERE session_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(params.sessionId) as RollingSummaryRow | undefined;
  const files = db.prepare(`
    SELECT id, session_id, file_path, operation, reason, created_at, updated_at
    FROM file_index
    WHERE session_id = ?
    ORDER BY updated_at DESC
    LIMIT 50
  `).all(params.sessionId) as FileIndexRow[];
  const commands = db.prepare(`
    SELECT id, session_id, command, cwd, exit_code, status, important_output_json, created_at
    FROM command_log
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(params.sessionId) as CommandLogRow[];

  return {
    taskState: taskState ? safeJsonParse(taskState.state_json) : null,
    taskStateUpdatedAt: taskState?.updated_at ?? null,
    contextPack: contextPack ? safeJsonParse(contextPack.pack_json) : null,
    contextPackCreatedAt: contextPack?.created_at ?? null,
    rollingSummary: rollingSummary ? {
      id: rollingSummary.id,
      summary: rollingSummary.summary,
      fromMessageId: rollingSummary.from_message_id,
      toMessageId: rollingSummary.to_message_id,
      updatedAt: rollingSummary.updated_at
    } : null,
    files: files.map((file) => ({
      id: file.id,
      path: file.file_path,
      operation: file.operation,
      reason: file.reason,
      updatedAt: file.updated_at
    })),
    commands: commands.map((command) => ({
      id: command.id,
      command: command.command,
      cwd: command.cwd,
      exitCode: command.exit_code,
      status: command.status,
      importantOutput: safeJsonParse(command.important_output_json),
      createdAt: command.created_at
    }))
  };
});

ipcMain.handle('session:rename', async (_event, params: { sessionId: string; title: string }) => {
  const title = params.title.trim();

  if (!title) {
    throw new Error('会话标题不能为空');
  }

  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    new Date().toISOString(),
    params.sessionId
  );

  return { ok: true };
});

ipcMain.handle('session:delete', async (_event, params: { sessionId: string }) => {
  db.prepare('DELETE FROM compact_boundary WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM rolling_summary WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM context_pack WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM command_log WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM file_index WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM task_state WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM session_events WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(params.sessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(params.sessionId);

  return { ok: true };
});

ipcMain.handle('session:exportMarkdown', async (_event, params: { sessionId: string }) => {
  const session = db.prepare(`
    SELECT id, title, workspace_path, created_at, updated_at
    FROM sessions
    WHERE id = ?
  `).get(params.sessionId) as SessionRow | undefined;

  if (!session) {
    throw new Error('会话不存在');
  }

  const messages = db.prepare(`
    SELECT id, session_id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(params.sessionId) as MessageRow[];
  const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || '会话导出';
  const result = await dialog.showSaveDialog({
    defaultPath: `${safeTitle}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, path: null };
  }

  const markdown = [
    `# ${session.title}`,
    '',
    `- 创建时间：${session.created_at}`,
    `- 更新时间：${session.updated_at}`,
    `- 初始目录：${session.workspace_path ?? '未记录'}`,
    '',
    ...messages.flatMap((message) => [
      `## ${message.role === 'user' ? '用户' : 'AI'} · ${message.created_at}`,
      '',
      message.content,
      ''
    ])
  ].join('\n');

  await writeFile(result.filePath, markdown, 'utf8');

  return { ok: true, path: result.filePath };
});

ipcMain.handle('fileTree:list', async (_event, directoryPath: string) => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nodes = await Promise.all(
    entries.filter((entry) => !shouldHideEntry(entry.name, entry.isDirectory())).map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      const entryType = entry.isDirectory() ? 'directory' : 'file';

      try {
        const entryStat = await stat(entryPath);

        return {
          id: entryPath,
          name: entry.name,
          path: entryPath,
          type: entryType,
          size: entry.isFile() ? entryStat.size : null,
          modifiedAt: entryStat.mtime.toISOString()
        };
      } catch {
        return {
          id: entryPath,
          name: entry.name,
          path: entryPath,
          type: entryType,
          size: null,
          modifiedAt: null
        };
      }
    })
  );

  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, 'zh-CN');
  });
});

ipcMain.handle('fileTree:createEntry', async (_event, params: CreateWorkspaceEntryParams) => {
  return createWorkspaceEntry(params);
});

ipcMain.handle('fileTree:renameEntry', async (_event, params: { filePath: string; newName: string }) => {
  const trimmedName = params.newName.trim();

  if (!trimmedName) {
    throw new Error('请输入新名称');
  }

  if (path.isAbsolute(trimmedName) || trimmedName.includes('/') || trimmedName.includes('\\')) {
    throw new Error('名称不能包含路径分隔符');
  }

  const targetPath = path.join(path.dirname(params.filePath), trimmedName);
  const sourceStat = await stat(params.filePath);
  const workspacePath = await getTrustedWorkspacePath();

  if (isSensitivePath(workspacePath, params.filePath) || isSensitivePath(workspacePath, targetPath)) {
    throw new Error('隐藏或敏感路径暂不支持直接重命名');
  }

  const result = await renameWorkspaceEntry({
    filePath: params.filePath,
    targetPath,
    expectedOriginalHash: null,
    sensitivePathConfirmed: false
  });

  return {
    id: targetPath,
    name: path.basename(targetPath),
    path: targetPath,
    type: sourceStat.isDirectory() ? 'directory' : 'file',
    size: sourceStat.isDirectory() ? null : result.size,
    modifiedAt: result.modifiedAt
  };
});

ipcMain.handle('file:readTextPreview', async (_event, params: string | { filePath: string; enableOcr?: boolean }) => {
  const filePath = typeof params === 'string' ? params : params.filePath;
  const enableOcr = typeof params === 'string' ? false : Boolean(params.enableOcr);

  return readPreviewableFile(filePath, enableOcr);
});

ipcMain.handle('file:saveText', async (_event, params: SaveTextFileParams) => {
  return writeEditableTextFile(params);
});

ipcMain.handle('file:applyEdit', async (_event, params: ApplyFileEditParams) => {
  try {
    const result = params.operation === 'create'
      ? await createEditableTextFile({
        filePath: params.filePath,
        content: params.proposedContent ?? '',
        sensitivePathConfirmed: params.sensitivePathConfirmed
      })
      : params.operation === 'delete'
        ? await deleteEditableTextFile({
          filePath: params.filePath,
          expectedOriginalHash: params.expectedOriginalHash ?? '',
          sensitivePathConfirmed: params.sensitivePathConfirmed,
          deleteConfirmed: params.deleteConfirmed
        })
        : params.operation === 'rename'
          ? await renameWorkspaceEntry({
            filePath: params.filePath,
            targetPath: params.targetPath ?? '',
            expectedOriginalHash: params.expectedOriginalHash,
            sensitivePathConfirmed: params.sensitivePathConfirmed
          })
          : await writeEditableTextFile({
            workspacePath: null,
            filePath: params.filePath,
            expectedOriginalHash: params.expectedOriginalHash ?? '',
            content: params.proposedContent ?? '',
            sensitivePathConfirmed: params.sensitivePathConfirmed
          });
    const event = recordSessionEvent(params.sessionId, 'file_edit_applied', {
      suggestionId: params.suggestionId,
      operation: params.operation,
      filePath: params.filePath,
      targetPath: params.targetPath,
      previousHash: params.expectedOriginalHash,
      nextHash: result.nextHash,
      size: result.size,
      modifiedAt: result.modifiedAt,
      summary: params.summary
    });
    updateSessionMemory(params.sessionId);

    return {
      ok: true,
      filePath: params.filePath,
      size: result.size,
      modifiedAt: result.modifiedAt,
      nextHash: result.nextHash,
      logId: event.id
    };
  } catch (error) {
    recordSessionEvent(params.sessionId, 'file_edit_failed', {
      suggestionId: params.suggestionId,
      operation: params.operation,
      filePath: params.filePath,
      targetPath: params.targetPath,
      summary: params.summary,
      message: error instanceof Error ? error.message : '应用修改失败'
    });
    throw error;
  }
});

ipcMain.handle('file:locatePaths', async (_event, params: { workspacePath: string | null; content: string }) => {
  return locatePathsInWorkspace(params.workspacePath, params.content);
});

ipcMain.handle('chat:stopMessage', async (_event, params: { sessionId: string }) => {
  const controller = activeChatControllers.get(params.sessionId);

  if (controller) {
    controller.abort();
    activeChatControllers.delete(params.sessionId);
  }

  return { ok: true };
});

ipcMain.handle('chat:sendMessage', async (_event, params: SendMessageParams): Promise<SendMessageResult> => {
  const baseUrl = String(getRequiredConfig('baseUrl', 'AI Base URL')).replace(/\/$/, '');
  const apiKey = String(getRequiredConfig('apiKey', 'AI API Key'));
  const model = String(getRequiredConfig('model', 'AI Model'));
  const timeoutMs = Number(aiConfig.timeoutMs ?? 30000);
  const controller = new AbortController();
  activeChatControllers.set(params.sessionId, controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = new Date().toISOString();
  const workspaceTree = params.workspacePath ? await collectWorkspaceTree(params.workspacePath) : null;
  const workspaceTreeText = workspaceTree
    ? formatWorkspaceTree(workspaceTree.entries, workspaceTree.wasTruncated)
    : '用户尚未选择工作区目录。';
  const locatedPathsText = formatLocatedPaths(params.locatedPaths);
  const filesToRead = mergeReferencedFilesWithLocatedPaths(params.referencedFiles, params.locatedPaths);
  const referencedFiles = await readReferencedFiles(params.workspacePath, filesToRead);
  const referencedFilesText = formatReferencedFiles(referencedFiles);
  const referencedFileNamesText = formatReferencedFileNames(referencedFiles);
  const memoryContextText = formatMemoryContext(params.sessionId);
  const historyMessages = getHistoryMessagesForModel(params.sessionId);
  recordSessionEvent(params.sessionId, 'referenced_files_read', {
    files: referencedFiles.map((file) => ({
      name: file.name,
      path: file.path,
      status: file.status,
      originalHash: file.originalHash,
      message: file.message
    }))
  });
  const userMessage = {
    id: createId('message'),
    session_id: params.sessionId,
    role: 'user' as const,
    content: params.content,
    created_at: now
  };

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at)
    VALUES (@id, @session_id, @role, @content, @created_at)
  `).run(userMessage);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: 'system',
            content: [
              '你是一个桌面 AI 助手。',
              '你可以看到用户已选择工作区的目录结构摘要，包括文件名、文件夹名、大小和修改时间。',
              '如果用户消息里包含路径，系统会真实定位路径；定位到的文本文件会自动读取内容并提供给你。',
              '用户显式引用的文件内容也会由系统读取后提供给你。',
              '你只能使用系统提供的文件内容，不能假装读取未提供内容的文件。',
              '如果还需要其他文件内容，请明确要求用户引用文件或粘贴内容。',
              '你不能直接修改文件，只能生成修改建议。',
              '如果用户明确要求修改、创建、删除或重命名文件，可以生成一个文件操作建议。',
              '如需生成编辑建议，请在普通说明后追加一个 fenced JSON 块，格式必须为 ```file-edit-suggestion。',
              'JSON 字段必须包含 operation、filePath、summary。operation 只能是 update、create、delete、rename。',
              'update 必须包含 originalHash、nextContent，且 filePath 和 originalHash 必须来自已读取引用文件。',
              'delete 必须包含 originalHash，且 filePath 和 originalHash 必须来自已读取引用文件。',
              'rename 必须包含 originalHash、targetPath，且 filePath 和 originalHash 必须来自已读取引用文件。',
              'create 必须包含 nextContent，filePath 必须在当前工作区内且是文本文件路径。',
              '不要一次生成多个文件操作，不要生成 diff。删除文件必须等待用户确认，重命名文件可直接生成建议。',
              '系统会提供当前会话 Memory。Memory 只是辅助上下文；如果 Memory 与当前用户消息或当前文件内容冲突，以当前用户消息和当前文件内容为准。',
              '如果你判断当前会话历史已经过长、旧讨论可以压缩，请在普通回复后追加一个 fenced JSON 块，格式为 ```compact-request。',
              'compact-request JSON 必须为 {"type":"REQUEST_COMPACT","reason":"...","suggestedRange":{"beforeMessageId":"可选消息ID"}}。',
              'compact-request 只是请求，系统会决定是否执行；不要在普通回复里提到这个内部请求。',
              '',
              `当前工作区路径：${params.workspacePath ?? '未选择'}`,
              '当前会话 Memory：',
              memoryContextText,
              '',
              '用户消息路径定位结果：',
              locatedPathsText,
              '',
              '用户显式引用文件读取结果：',
              referencedFilesText,
              '',
              '当前工作区目录结构摘要：',
              workspaceTreeText
            ].join('\n')
          },
          ...historyMessages,
          {
            role: 'user',
            content: referencedFileNamesText
              ? `${params.content}\n\n本轮用户引用并已读取的文件：\n${referencedFileNamesText}\n\n请优先基于这些文件回答用户问题。`
              : params.content
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI 接口请求失败：${response.status}`);
    }

    const content = await readStreamingChatResponse(response, (chunk) => {
      _event.sender.send('chat:messageChunk', {
        sessionId: params.sessionId,
        content: chunk
      });
    });

    if (!content) {
      throw new Error('AI 返回内容为空');
    }

    const fileEditSuggestion = parseFileEditSuggestion(content, referencedFiles, params.sessionId);
    const compactRequest = parseCompactRequest(content);
    const displayContent = stripCompactRequestBlock(stripFileEditSuggestionBlock(content)) || content;
    const assistantMessage = {
      id: createId('message'),
      session_id: params.sessionId,
      role: 'assistant' as const,
      content: displayContent,
      created_at: new Date().toISOString()
    };

    if (fileEditSuggestion) {
      fileEditSuggestion.messageId = assistantMessage.id;
    }

    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (@id, @session_id, @role, @content, @created_at)
    `).run(assistantMessage);
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(
      params.content.slice(0, 20) || '新会话',
      assistantMessage.created_at,
      params.sessionId
    );

    if (fileEditSuggestion) {
      recordSessionEvent(params.sessionId, 'file_edit_suggested', {
        suggestionId: fileEditSuggestion.id,
        messageId: assistantMessage.id,
        operation: fileEditSuggestion.operation,
        filePath: fileEditSuggestion.filePath,
        targetPath: fileEditSuggestion.targetPath,
        fileName: fileEditSuggestion.fileName,
        originalHash: fileEditSuggestion.originalHash,
        proposedHash: fileEditSuggestion.proposedHash,
        summary: fileEditSuggestion.summary
      });
    }
    if (compactRequest) {
      recordSessionEvent(params.sessionId, 'compact_requested', {
        source: 'model',
        status: 'pending',
        reason: compactRequest.reason,
        beforeMessageId: compactRequest.beforeMessageId,
        assistantMessageId: assistantMessage.id
      });
    }
    updateSessionMemory(params.sessionId);
    await generateRollingSummaryFromPendingCompact(params.sessionId);

    return {
      userMessage: mapMessage(userMessage),
      assistantMessage: mapMessage(assistantMessage),
      locatedPaths: params.locatedPaths,
      referencedFiles,
      fileEditSuggestion
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('回复已停止');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    activeChatControllers.delete(params.sessionId);
  }
});

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: '轻量级 AI 工作区连接器',
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindowRef = mainWindow;
  mainWindow.on('closed', () => {
    mainWindowRef = null;
  });

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

void app.whenReady().then(() => {
  initDatabase();
  loadAiConfig();
  Menu.setApplicationMenu(null);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  workspaceWatcher?.close();
  workspaceWatcher = null;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
