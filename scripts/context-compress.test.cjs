#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  compressTranscript,
  extractImportantOutput,
  extractUserRequirements,
} = require('./context-compress.cjs');

function makeTranscript() {
  return {
    sessionId: 'test_session',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '完善 Memory 管理方案。我不希望只看到最近20轮对话，所有对话保持最简。',
      },
      {
        id: 'm2',
        role: 'tool',
        toolName: 'read',
        input: { filePath: 'docs/Memory管理/Memory管理方案.md' },
        output: 'file content',
      },
      {
        id: 'm3',
        role: 'assistant',
        content: '推荐采用分层记忆，不只依赖最近对话。',
      },
      {
        id: 'm4',
        role: 'tool',
        toolName: 'edit',
        input: { filePath: 'docs/Memory管理/Memory管理方案.md' },
        output: 'edited',
      },
      {
        id: 'm5',
        role: 'tool',
        toolName: 'bash',
        input: { command: 'npm test', workdir: '/repo' },
        exitCode: 1,
        output: [
          'running tests',
          'Error: Expected 2 tests, actual 1',
          'some long line',
          'failed test suite',
        ].join('\n'),
      },
      {
        id: 'm6',
        role: 'user',
        content: '压缩上下文能不能通过一些脚本辅助？',
      },
    ],
  };
}

function testRequirementExtraction() {
  const requirements = extractUserRequirements(makeTranscript().messages);
  assert(requirements.includes('不希望只看到最近20轮对话'));
  assert(requirements.includes('保持最简'));
}

function testImportantOutputExtraction() {
  const output = extractImportantOutput('ok\nWarning: be careful\nError: failed\nnoise', 2);
  assert.deepStrictEqual(output, ['Warning: be careful', 'Error: failed']);
}

function testCompressionResult() {
  const result = compressTranscript(makeTranscript(), { recent: 2, maxOutputLines: 2 });

  assert.strictEqual(result.sessionId, 'test_session');
  assert.deepStrictEqual(result.fileIndex.read, ['docs/Memory管理/Memory管理方案.md']);
  assert.deepStrictEqual(result.fileIndex.edited, ['docs/Memory管理/Memory管理方案.md']);
  assert.strictEqual(result.commandLog.length, 1);
  assert.strictEqual(result.commandLog[0].status, 'failed');
  assert(result.taskState.pendingValidation.includes('Run relevant validation'));
  assert(result.taskState.blockers.includes('npm test failed'));
  assert.strictEqual(result.contextPack.recentMessages.length, 2);
  assert(result.contextPack.decisions.some((line) => line.includes('分层记忆')));
}

function testCliWritesFiles() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-compress-'));
  const inputPath = path.join(tempDir, 'transcript.json');
  const outputDir = path.join(tempDir, 'out');

  fs.writeFileSync(inputPath, JSON.stringify(makeTranscript(), null, 2), 'utf8');
  execFileSync(process.execPath, [
    path.resolve(__dirname, 'context-compress.cjs'),
    '--input',
    inputPath,
    '--output-dir',
    outputDir,
    '--recent',
    '2',
  ]);

  const sessionDir = path.join(outputDir, 'test_session');
  assert(fs.existsSync(path.join(sessionDir, 'task_state.json')));
  assert(fs.existsSync(path.join(sessionDir, 'file_index.json')));
  assert(fs.existsSync(path.join(sessionDir, 'command_log.json')));
  assert(fs.existsSync(path.join(sessionDir, 'event_log.jsonl')));
  assert(fs.existsSync(path.join(sessionDir, 'context_pack.json')));

  const contextPack = JSON.parse(fs.readFileSync(path.join(sessionDir, 'context_pack.json'), 'utf8'));
  assert.strictEqual(contextPack.sessionId, 'test_session');
}

function run() {
  testRequirementExtraction();
  testImportantOutputExtraction();
  testCompressionResult();
  testCliWritesFiles();
  console.log('context-compress tests passed');
}

run();
