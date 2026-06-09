import { parentPort, workerData } from 'worker_threads';
import { OfficeParser } from 'officeparser';
import path from 'path';
import WordExtractor from 'word-extractor';

type WorkerData = {
  filePath: string;
  enableOcr: boolean;
};

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

const { filePath, enableOcr } = workerData as WorkerData;

readOfficeText(filePath, enableOcr)
  .then((content) => parentPort?.postMessage({ content }))
  .catch((error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : 'Office/PDF 文本提取失败' }));
