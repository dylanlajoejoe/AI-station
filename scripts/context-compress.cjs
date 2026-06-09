#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function loadMemoryCompression() {
  const compiledPath = path.resolve(__dirname, '../dist-electron/memoryCompression.js');
  if (!fs.existsSync(compiledPath)) {
    throw new Error('Missing dist-electron/memoryCompression.js. Run `tsc -p electron/tsconfig.json` before using this script.');
  }
  return require(compiledPath);
}

function parseArgs(argv) {
  const args = {
    input: null,
    outputDir: null,
    sessionId: null,
    recent: 10,
    maxOutputLines: 12,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--input') {
      args.input = next;
      i += 1;
    } else if (arg === '--output-dir') {
      args.outputDir = next;
      i += 1;
    } else if (arg === '--session-id') {
      args.sessionId = next;
      i += 1;
    } else if (arg === '--recent') {
      args.recent = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--max-output-lines') {
      args.maxOutputLines = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/context-compress.cjs --input transcript.json --output-dir out [options]

Options:
  --output-dir <dir>          Output base directory for CLI/dev use. Required.
  --session-id <id>           Session id. Default: input sessionId or generated hash
  --recent <number>           Recent user/assistant messages to keep. Default: 10
  --max-output-lines <number> Important command output lines to keep. Default: 12
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, values) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
}

function writeOutputs(result, outputDir) {
  const sessionDir = path.join(outputDir, result.sessionId);
  writeJson(path.join(sessionDir, 'task_state.json'), result.taskState);
  writeJson(path.join(sessionDir, 'file_index.json'), result.fileIndex);
  writeJson(path.join(sessionDir, 'command_log.json'), result.commandLog);
  writeJsonl(path.join(sessionDir, 'event_log.jsonl'), result.eventLog);
  writeJson(path.join(sessionDir, 'context_pack.json'), result.contextPack);
  return sessionDir;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input) throw new Error('Missing required --input <transcript.json>.');
  if (!args.outputDir) throw new Error('Missing required --output-dir <dir>. Product integration should write results to app.getPath("userData")/ai-workstation.db.');

  const { compressTranscript } = loadMemoryCompression();
  const input = readJson(args.input);
  const result = compressTranscript(input, args);
  const sessionDir = writeOutputs(result, args.outputDir);
  console.log(`Context pack written to ${sessionDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = loadMemoryCompression();
