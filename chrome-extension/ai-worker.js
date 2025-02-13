// Web Worker to handle AI processing without blocking UI
importScripts('onnxruntime-web.min.js', 'tokenizer.js');

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/tinyllama-2-1b-wasm@0.1.0/dist/model.wasm';
const TOKENIZER_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/tinyllama-2-1b-wasm@0.1.0/dist/tokenizer.json';

class BrowserAI {
  async init() {
    this.session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      optimizedModelFilePath: 'model.onnx'
    });
    this.tokenizer = await (await fetch(TOKENIZER_URL)).json();
  }

  async analyze(html) {
    const input = this.prepareInput(html);
    const output = await this.session.run(input);
    return this.processOutput(output);
  }
}

// Lightweight AI implementation for older hardware
class LiteAI {
  constructor(options = {}) {
    this.options = {
      modelSize: 'tiny',
      maxBatchSize: 512,
      useQuantization: true,
      ...options
    };
  }

  async init() {
    // Load tiny model (~100MB)
    const modelUrl = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.5.0/tiny-bert-wp.onnx';
    this.model = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      optimizedModelFilePath: 'model.onnx',
      enableMemoryOptimization: true
    });
  }

  async analyzeStructure(html, progressCallback) {
    // Break analysis into small chunks
    const chunks = this.chunkContent(html);
    let progress = 0;

    const results = [];
    for (const chunk of chunks) {
      const result = await this.processChunk(chunk);
      results.push(result);
      
      progress += (100 / chunks.length);
      progressCallback(progress);
    }

    return this.mergeResults(results);
  }

  chunkContent(html) {
    // Split content into manageable pieces
    const chunks = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Process in small batches
    const elements = [...doc.body.children];
    while (elements.length) {
      chunks.push(elements.splice(0, this.options.maxBatchSize));
    }
    
    return chunks;
  }
}

// Handle messages from main thread
self.onmessage = async (e) => {
  const { type, data } = e.data;
  
  if (type === 'analyze') {
    const ai = new BrowserAI();
    await ai.init();
    const result = await ai.analyze(data.html);
    self.postMessage({ type: 'result', data: result });
  }
}; 