import { createHash } from 'crypto';

export type CompressionInputMessage = {
  id?: string;
  uuid?: string;
  role?: string;
  type?: string;
  content?: unknown;
  text?: unknown;
  output?: unknown;
  result?: unknown;
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
  exitCode?: number;
  exit_code?: number;
  code?: number;
  command?: string;
  createdAt?: string;
};

export type CompressionInput = {
  sessionId?: string;
  messages: CompressionInputMessage[];
};

export type CompressionOptions = {
  sessionId?: string | null;
  recent?: number;
  maxOutputLines?: number;
};

type NormalizedMessage = {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  input: Record<string, unknown>;
  output: unknown;
  createdAt: string | null;
  raw: CompressionInputMessage;
};

export type CompressedCommand = {
  command: string;
  cwd: string | null;
  exitCode: number | null;
  status: 'success' | 'failed' | 'unknown';
  importantOutput: string[];
  truncated: boolean;
};

export type CompressionResult = {
  sessionId: string;
  taskState: {
    goal: string | null;
    requirements: string[];
    completed: string[];
    inProgress: string | null;
    pendingValidation: string[];
    relatedFiles: string[];
    editedFiles: string[];
    blockers: string[];
    updatedAt: string;
  };
  fileIndex: {
    read: string[];
    edited: string[];
    skipped: Array<{ path: string; reason: string }>;
  };
  commandLog: CompressedCommand[];
  eventLog: Array<{
    id: string;
    type: string;
    target: string | null;
    summary: string;
    messageId: string | null;
    createdAt: string;
  }>;
  contextPack: {
    sessionId: string;
    range: { fromMessageId: string | null; toMessageId: string | null };
    userRequirements: string[];
    taskState: {
      goal: string | null;
      completed: string[];
      pending: string[];
      blockers: string[];
    };
    files: CompressionResult['fileIndex'];
    commands: Array<{
      command: string;
      exitCode: number | null;
      status: 'success' | 'failed' | 'unknown';
      importantOutput: string[];
    }>;
    decisions: string[];
    openQuestions: string[];
    recentMessages: Array<{ role: string; content: string }>;
  };
};

const IMPORTANT_OUTPUT_PATTERNS = [/error/i, /failed/i, /exception/i, /traceback/i, /warning/i, /cannot/i, /not found/i, /expected/i, /actual/i];
const USER_REQUIREMENT_PATTERNS = [/不要[^，,。.!！?？\n]*/g, /不希望[^，,。.!！?？\n]*/g, /我希望[^，,。.!！?？\n]*/g, /以后[^，,。.!！?？\n]*/g, /记住[^，,。.!！?？\n]*/g, /保持[^，,。.!！?？\n]*/g, /用最简[^，,。.!！?？\n]*/g];

function stableId(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function firstLine(text: unknown) {
  return asText(text).split(/\r?\n/).find((line) => line.trim()) || '';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function normalizeMessages(input: CompressionInput | CompressionInputMessage[]): NormalizedMessage[] {
  const messages = Array.isArray(input) ? input : input.messages;
  if (!Array.isArray(messages)) {
    throw new Error('Input must be an array of messages or an object with messages array.');
  }

  return messages.map((message, index) => ({
    id: message.id || message.uuid || `msg_${index + 1}`,
    role: message.role || message.type || 'unknown',
    content: asText(message.content ?? message.text ?? message.output ?? ''),
    toolName: message.toolName || message.name || null,
    input: message.input || message.args || {},
    output: message.output ?? message.result ?? null,
    createdAt: message.createdAt || null,
    raw: message
  }));
}

export function extractUserRequirements(messages: CompressionInputMessage[] | NormalizedMessage[]) {
  const requirements: string[] = [];

  for (const message of messages) {
    if (message.role !== 'user') continue;
    const content = 'content' in message ? asText(message.content) : '';

    for (const pattern of USER_REQUIREMENT_PATTERNS) {
      const matches = content.match(pattern) || [];
      requirements.push(...matches.map((match) => match.trim()));
    }
  }

  return unique(requirements);
}

function getFilePathFromTool(message: NormalizedMessage) {
  return getString(message.input.filePath) || getString(message.input.file_path) || getString(message.input.path) || getString(message.input.file);
}

function classifyTool(message: NormalizedMessage) {
  const name = String(message.toolName || '').toLowerCase();
  const raw = JSON.stringify(message.raw).toLowerCase();

  if (name.includes('read') || raw.includes('fileread') || raw.includes('read_file')) return 'file_read';
  if (name.includes('edit') || name.includes('write') || raw.includes('fileedit') || raw.includes('filewrite')) return 'file_edited';
  if (name.includes('bash') || name.includes('shell') || name.includes('command')) return 'command_run';
  return null;
}

function extractFiles(messages: NormalizedMessage[]) {
  const read: string[] = [];
  const edited: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const message of messages) {
    if (message.role !== 'tool') continue;

    const filePath = getFilePathFromTool(message);
    const type = classifyTool(message);
    if (!filePath) continue;

    if (type === 'file_read') read.push(filePath);
    if (type === 'file_edited') edited.push(filePath);
    if (/denied|skipped|refused/i.test(message.content)) {
      skipped.push({ path: filePath, reason: firstLine(message.content) });
    }
  }

  return { read: unique(read), edited: unique(edited), skipped };
}

export function extractImportantOutput(output: unknown, maxLines: number) {
  const lines = asText(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const important = lines.filter((line) => IMPORTANT_OUTPUT_PATTERNS.some((pattern) => pattern.test(line)));

  if (important.length > 0) return important.slice(0, maxLines);
  return lines.slice(0, Math.min(3, maxLines));
}

function inferExitCode(message: NormalizedMessage) {
  const raw = message.raw;
  if (typeof raw.exitCode === 'number') return raw.exitCode;
  if (typeof raw.exit_code === 'number') return raw.exit_code;
  if (typeof raw.code === 'number') return raw.code;
  const match = message.content.match(/exit code\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractCommands(messages: NormalizedMessage[], maxOutputLines: number): CompressedCommand[] {
  const commands: CompressedCommand[] = [];

  for (const message of messages) {
    if (message.role !== 'tool' || classifyTool(message) !== 'command_run') continue;

    const command = getString(message.input.command) || getString(message.input.cmd) || message.raw.command || firstLine(message.content);
    const exitCode = inferExitCode(message);
    const status = exitCode === null ? 'unknown' : exitCode === 0 ? 'success' : 'failed';
    const output = message.output ?? message.content;

    commands.push({
      command,
      cwd: getString(message.input.workdir) || getString(message.input.cwd),
      exitCode,
      status,
      importantOutput: extractImportantOutput(output, maxOutputLines),
      truncated: asText(output).split(/\r?\n/).length > maxOutputLines
    });
  }

  return commands;
}

function extractDecisions(messages: NormalizedMessage[]) {
  const decisions: string[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const line of message.content.split(/\r?\n/)) {
      if (/建议|决定|推荐|采用|不建议|方案是/.test(line)) {
        decisions.push(line.trim().replace(/^[-*]\s*/, ''));
      }
    }
  }

  return unique(decisions).slice(0, 20);
}

function extractOpenQuestions(messages: NormalizedMessage[]) {
  return unique(messages.filter((message) => message.role === 'user').flatMap((message) => message.content.split(/\r?\n/).filter((line) => /[?？]/.test(line)).map((line) => line.trim()))).slice(0, 20);
}

function buildTaskState(messages: NormalizedMessage[], files: CompressionResult['fileIndex'], commands: CompressedCommand[], userRequirements: string[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const failedCommands = commands.filter((command) => command.status === 'failed');
  const hasEditedFiles = files.edited.length > 0;
  const hasSuccessfulValidation = commands.some((command) => command.status === 'success' && /test|build|lint|check/i.test(command.command));

  return {
    goal: lastUser ? firstLine(lastUser.content) : null,
    requirements: userRequirements,
    completed: hasEditedFiles ? [`Edited ${files.edited.length} file(s)`] : [],
    inProgress: null,
    pendingValidation: hasEditedFiles && !hasSuccessfulValidation ? ['Run relevant validation'] : [],
    relatedFiles: unique([...files.read, ...files.edited]),
    editedFiles: files.edited,
    blockers: failedCommands.map((command) => `${command.command} failed`),
    updatedAt: new Date().toISOString()
  };
}

function event(index: number, type: string, target: string | null, summary: string, messageId: string | null, createdAt: string) {
  return { id: `evt_${String(index).padStart(4, '0')}`, type, target, summary, messageId, createdAt };
}

function buildEvents(messages: NormalizedMessage[], files: CompressionResult['fileIndex'], commands: CompressedCommand[], taskState: CompressionResult['taskState']) {
  const events: CompressionResult['eventLog'] = [];
  let index = 1;
  const now = new Date().toISOString();

  for (const message of messages) {
    if (message.role === 'user') events.push(event(index++, 'user_request', null, firstLine(message.content), message.id, message.createdAt || now));
  }
  for (const filePath of files.read) events.push(event(index++, 'file_read', filePath, `Read ${filePath}`, null, now));
  for (const filePath of files.edited) events.push(event(index++, 'file_edited', filePath, `Edited ${filePath}`, null, now));
  for (const command of commands) events.push(event(index++, /test|build|lint|check/i.test(command.command) ? 'test_result' : 'command_run', command.command, `${command.status}: ${command.command}`, null, now));
  for (const blocker of taskState.blockers) events.push(event(index++, 'blocker', null, blocker, null, now));

  return events;
}

function buildRecentMessages(messages: NormalizedMessage[], count: number) {
  return messages.filter((message) => message.role === 'user' || message.role === 'assistant').slice(-count).map((message) => ({ role: message.role, content: message.content }));
}

export function compressTranscript(input: CompressionInput | CompressionInputMessage[], options: CompressionOptions = {}): CompressionResult {
  const messages = normalizeMessages(input);
  const sessionId = options.sessionId || (!Array.isArray(input) ? input.sessionId : null) || `session_${stableId(JSON.stringify(messages.map((message) => message.id)))}`;
  const recent = Number.isFinite(options.recent) ? options.recent as number : 10;
  const maxOutputLines = Number.isFinite(options.maxOutputLines) ? options.maxOutputLines as number : 12;
  const userRequirements = extractUserRequirements(messages);
  const files = extractFiles(messages);
  const commands = extractCommands(messages, maxOutputLines);
  const taskState = buildTaskState(messages, files, commands, userRequirements);
  const eventLog = buildEvents(messages, files, commands, taskState);

  return {
    sessionId,
    taskState,
    fileIndex: files,
    commandLog: commands,
    eventLog,
    contextPack: {
      sessionId,
      range: { fromMessageId: messages[0]?.id || null, toMessageId: messages[messages.length - 1]?.id || null },
      userRequirements,
      taskState: { goal: taskState.goal, completed: taskState.completed, pending: taskState.pendingValidation, blockers: taskState.blockers },
      files,
      commands: commands.map((command) => ({ command: command.command, exitCode: command.exitCode, status: command.status, importantOutput: command.importantOutput })),
      decisions: extractDecisions(messages),
      openQuestions: extractOpenQuestions(messages),
      recentMessages: buildRecentMessages(messages, recent)
    }
  };
}
