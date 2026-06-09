declare module 'word-extractor' {
  type WordDocument = {
    getBody: () => string;
    getHeaders: () => string;
    getFooters: () => string;
    getFootnotes: () => string;
    getEndnotes: () => string;
    getAnnotations: () => string;
    getTextboxes: () => string;
  };

  export default class WordExtractor {
    extract(filePath: string | Buffer): Promise<WordDocument>;
  }
}
