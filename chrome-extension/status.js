document.addEventListener('DOMContentLoaded', () => {
  let logContainer = document.getElementById('log');
  let currentFilter = 'all';
  let downloadLinks = new Set();
  let isScrapingInProgress = false;
  let activeScraping = new Set(); // Track active scraping jobs

  function updateStatus(data) {
    document.getElementById('queued').textContent = data.queued;
    document.getElementById('processed').textContent = data.processed;
    document.getElementById('assets').textContent = data.assets;
    document.getElementById('currentStatus').textContent = data.status;
    
    // Update URL display if provided
    if (data.currentUrl) {
      updateUrlDisplay(data.currentUrl);
    }
    
    const statusBadge = document.getElementById('status-badge');
    if (data.status === 'stopped' || data.status === 'error') {
      isScrapingInProgress = false;
      activeScraping.clear();
      updateControlState();
      
      // Update status badge
      if (data.status === 'stopped') {
        statusBadge.textContent = 'Complete';
        statusBadge.className = 'status-badge status-complete';
        // Show download section
        showDownloadSection();
      } else {
        statusBadge.textContent = 'Error';
        statusBadge.className = 'status-badge status-error';
      }
    }
  }

  function addLogEntry(data) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    // Better message classification
    const message = data.message.toLowerCase();
    if (message.includes('error') || message.includes('failed') || message.includes('invalid')) {
      entry.classList.add('error');
    } else if (message.includes('warning') || message.includes('skipped') || message.includes('retry')) {
      entry.classList.add('warning');
    } else if (
      message.includes('complete') || 
      message.includes('processed') || 
      message.includes('success') ||
      message.includes('queued') ||
      message.includes('fetching') ||
      message.includes('download') ||
      message.startsWith('found')
    ) {
      entry.classList.add('success');
    }
    
    entry.innerHTML = `
      <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>
      <span class="message">${data.message}</span>
    `;
    
    logContainer.appendChild(entry);
    
    // Apply current filter to new entry
    switch (currentFilter) {
      case 'error':
        entry.style.display = entry.classList.contains('error') ? 'block' : 'none';
        break;
      case 'warning':
        entry.style.display = entry.classList.contains('warning') ? 'block' : 'none';
        break;
      case 'success':
        entry.style.display = entry.classList.contains('success') ? 'block' : 'none';
        break;
      default:
        entry.style.display = 'block';
    }
    
    logContainer.scrollTop = logContainer.scrollHeight;

    // Track download links
    if (data.message.includes('Download Part')) {
      downloadLinks.add(data.message);
      updateDownloadSection();
    }
  }

  function shouldShowEntry(entry) {
    switch (currentFilter) {
      case 'error':
        return entry.classList.contains('error');
      case 'warning':
        return entry.classList.contains('warning');
      case 'success':
        return entry.classList.contains('success');
      case 'all':
      default:
        return true;
    }
  }

  function showDownloadSection() {
    const section = document.getElementById('download-section');
    if (section) {
      section.classList.add('visible');
      section.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function updateDownloadSection() {
    const list = document.querySelector('.download-list');
    list.innerHTML = Array.from(downloadLinks).map(link => `
      <div class="download-item">
        <span>${link}</span>
        <button onclick="window.open('${link}', '_blank')">Download</button>
      </div>
    `).join('');
  }

  // Initialize listeners
  initializeEventListeners();

  function initializeEventListeners() {
    document.getElementById('clear-log')?.addEventListener('click', () => {
      logContainer.innerHTML = '';
    });

    document.getElementById('export-log')?.addEventListener('click', exportLog);
    document.getElementById('toggle-filters')?.addEventListener('click', toggleFilters);
    document.getElementById('start-scraping')?.addEventListener('click', startScraping);
    document.getElementById('stop-scraping')?.addEventListener('click', stopScraping);
    document.getElementById('baseUrl')?.addEventListener('input', validateUrl);

    initializeFilters();
    
    // Initialize filter section visibility
    const filterSection = document.querySelector('.filter-section');
    if (filterSection) {
      filterSection.style.display = 'none';
    }

    const stopButton = document.getElementById('stop-scraping');
    if (stopButton) {
      stopButton.addEventListener('click', stopScraping);
    }
  }

  // Initialize control state
  updateControlState();

  // Update the URL display function
  function updateUrlDisplay(url) {
    const currentUrlElement = document.getElementById('currentUrl');
    if (currentUrlElement) {
      currentUrlElement.textContent = url || 'No URL specified';
    }
  }

  // Check for pending URL and start scraping
  chrome.storage.local.get(['pendingUrl'], result => {
    if (result.pendingUrl) {
      const url = result.pendingUrl;
      updateUrlDisplay(url);
      chrome.storage.local.remove('pendingUrl');
      startScraping(url);
    }
  });

  function startScraping(url) {
    if (!url) return;

    // Check if already scraping
    if (activeScraping.size > 0) {
      addLogEntry({
        timestamp: new Date().toISOString(),
        message: 'Error: Already scraping another site. Please wait for it to complete.',
        type: 'error'
      });
      return;
    }

    isScrapingInProgress = true;
    activeScraping.add(url);
    updateControlState();
    
    // Immediately update the URL display
    updateUrlDisplay(url);
    
    chrome.runtime.sendMessage({
      action: 'startScraping',
      baseUrl: url
    }, response => {
      if (!response.success) {
        isScrapingInProgress = false;
        activeScraping.delete(url);
        updateControlState();
        addLogEntry({
          timestamp: new Date().toISOString(),
          message: `Error: ${response.error}`,
          type: 'error'
        });
      }
    });
  }

  function stopScraping() {
    if (!isScrapingInProgress) return;
    
    chrome.runtime.sendMessage({ action: 'stopScraping' }, response => {
      if (response.success) {
        isScrapingInProgress = false;
        activeScraping.clear();
        updateControlState();
        
        addLogEntry({
          timestamp: new Date().toISOString(),
          message: 'Scraping stopped by user',
          type: 'warning'
        });
      } else {
        addLogEntry({
          timestamp: new Date().toISOString(),
          message: `Failed to stop scraping: ${response.error}`,
          type: 'error'
        });
      }
    });
  }

  // Add URL validation
  function validateUrl(e) {
    const startButton = document.getElementById('start-scraping');
    try {
      new URL(e.target.value);
      startButton.disabled = false;
      e.target.classList.remove('error');
    } catch {
      startButton.disabled = true;
      e.target.classList.add('error');
    }
  }

  function applyFilters() {
    // Get all log entries
    const entries = Array.from(logContainer.children);
    
    // Show/hide based on current filter
    entries.forEach(entry => {
      switch (currentFilter) {
        case 'error':
          entry.style.display = entry.classList.contains('error') ? 'block' : 'none';
          break;
        case 'warning':
          entry.style.display = entry.classList.contains('warning') ? 'block' : 'none';
          break;
        case 'success':
          entry.style.display = entry.classList.contains('success') ? 'block' : 'none';
          break;
        case 'all':
        default:
          entry.style.display = 'block';
      }
    });
  }

  function exportLog() {
    const logText = Array.from(logContainer.children)
      .map(entry => {
        const timestamp = entry.querySelector('.timestamp').textContent;
        const message = entry.querySelector('.message').textContent;
        return `${timestamp}: ${message}`;
      })
      .join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scraper-log.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleFilters() {
    const filterSection = document.querySelector('.filter-section');
    const isHidden = filterSection.style.display === 'none';
    filterSection.style.display = isHidden ? 'flex' : 'none';
    
    // Update button text
    const toggleButton = document.getElementById('toggle-filters');
    if (toggleButton) {
      toggleButton.textContent = isHidden ? 'Hide Filters' : 'Show Filters';
    }
  }

  // Keep the page awake
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(console.error);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'ping') {
        sendResponse({ success: true });
        return true;
      }
      
      if (request.action === 'updateStatus') {
        // Update URL display if it's the first message
        if (request.data.message.includes('Fetching:')) {
          const url = request.data.message.replace('Fetching: ', '');
          updateUrlDisplay(url);
        }

        updateStatus(request.data);
        addLogEntry(request.data);
        
        if (request.allMessages) {
          logContainer.innerHTML = '';
          request.allMessages.forEach(msg => {
            try {
              addLogEntry(msg);
            } catch (e) {
              console.error('Failed to add log entry:', e);
            }
          });
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
    return true;
  });

  // Update control state function
  function updateControlState() {
    const stopButton = document.getElementById('stop-scraping');
    if (stopButton) {
      stopButton.disabled = !isScrapingInProgress;
    }
  }

  // Update filter button initialization
  function initializeFilters() {
    document.querySelectorAll('.filter-button').forEach(button => {
      button.addEventListener('click', () => {
        // Update active filter
        currentFilter = button.dataset.type;
        
        // Update button styles
        document.querySelectorAll('.filter-button').forEach(btn => {
          btn.classList.remove('active');
        });
        button.classList.add('active');
        
        // Apply the filter
        applyFilters();
      });
    });
  }
}); 