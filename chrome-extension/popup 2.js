document.addEventListener('DOMContentLoaded', () => {
  class PopupUI {
    constructor() {
      this.status = document.getElementById('status');
      this.progress = document.getElementById('progress');
      this.scrapeButton = document.getElementById('scrapeButton');
      this.stopButton = document.getElementById('stopButton');
      this.urlInput = document.getElementById('url');
      this.startButton = document.getElementById('start');
      this.setupEventListeners();
    }

    setupEventListeners() {
      if (this.startButton) {
        this.startButton.addEventListener('click', () => {
          const url = this.urlInput?.value.trim();
          if (!url) return;

          try {
            // Validate URL format
            new URL(url);
            
            chrome.tabs.create({
              url: chrome.runtime.getURL('status.html'),
              active: true
            }, tab => {
              // Store URL in local storage for status page to read
              chrome.storage.local.set({ 
                'pendingUrl': url 
              }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Error saving URL:', chrome.runtime.lastError);
                }
              });
            });
            
            window.close();
          } catch (e) {
            console.error('Invalid URL:', e);
            this.status.textContent = 'Please enter a valid URL';
          }
        });
      }

      if (this.scrapeButton) {
        this.scrapeButton.addEventListener('click', () => this.startScraping());
      }
      
      if (this.stopButton) {
        this.stopButton.addEventListener('click', () => this.stopScraping());
      }
      
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
        
        // Execute in background script context instead
        const response = await chrome.runtime.sendMessage({
          action: 'startScraping',
          baseUrl: baseUrl,
          sourceTabId: tab.id
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
      await chrome.runtime.sendMessage({ action: 'stopScraping' });
      this.status.textContent = 'Scraping stopped.';
      this.stopButton.classList.add('hidden');
      this.scrapeButton.classList.remove('hidden');
    }

    updateProgress({ message, queued, processed }) {
      this.progress.textContent = message;
    }
  }

  // Initialize popup when DOM is loaded
  new PopupUI();
}); 