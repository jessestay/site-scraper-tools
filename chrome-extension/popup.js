class PopupUI {
  constructor() {
    this.status = document.getElementById('status');
    this.progress = document.getElementById('progress');
    this.scrapeButton = document.getElementById('scrapeButton');
    this.stopButton = document.getElementById('stopButton');
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.scrapeButton.addEventListener('click', () => this.startScraping());
    this.stopButton.addEventListener('click', () => this.stopScraping());
    
    // Listen for progress updates
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'progress') {
        this.updateProgress(request);
      }
    });
  }

  async startScraping() {
    this.status.textContent = 'Scraping...';
    this.scrapeButton.classList.add('hidden');
    this.stopButton.classList.remove('hidden');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const baseUrl = new URL(tab.url).origin;
      
      // Inject required scripts
      await this.injectScripts(tab.id);
      
      const response = await this.sendMessage(tab.id, {
        action: 'scrape',
        baseUrl: baseUrl
      });
      
      if (response?.success) {
        this.status.textContent = 'Scraping complete!';
      } else {
        this.status.textContent = `Error: ${response?.error || 'Unknown error'}`;
      }
    } catch (error) {
      this.status.textContent = `Error: ${error.message}`;
    } finally {
      this.stopButton.classList.add('hidden');
      this.scrapeButton.classList.remove('hidden');
    }
  }

  async stopScraping() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'stop' });
    this.status.textContent = 'Scraping stopped.';
    this.stopButton.classList.add('hidden');
    this.scrapeButton.classList.remove('hidden');
  }

  async injectScripts(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['jszip.min.js']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scraper.js']
    });
  }

  async sendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  updateProgress({ message, queued, processed }) {
    this.progress.textContent = message;
    // Optional: Add progress bar or other visual indicators
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupUI();
}); 