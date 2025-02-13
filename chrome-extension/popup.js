const UI = {
  constructor() {
    this.scrapeState = {
      lastUrl: null,
      processedUrls: new Set(),
      timestamp: null
    };
  },

  async init() {
    this.renderMainMenu();
    this.isPremium = await this.checkPremiumStatus();
  },

  async renderMainMenu() {
    document.getElementById('app').innerHTML = `
      <div class="menu-container">
        <h2>Site Migration Assistant</h2>
        
        <div class="mode-selector">
          <button id="basic-export" class="mode-btn">
            <h3>Basic Export</h3>
            <p>Download site files & assets</p>
            <span class="badge free">Free</span>
          </button>

          <button id="wordpress-export" class="mode-btn premium ${this.isPremium ? '' : 'locked'}">
            <h3>WordPress Export</h3>
            <p>AI-powered WordPress conversion</p>
            <span class="badge premium">Premium</span>
            ${!this.isPremium ? '<div class="lock-overlay">🔒</div>' : ''}
          </button>
        </div>

        <div class="progress-container" style="display: none">
          <div class="progress-step">
            <div class="step-label">Analyzing Structure</div>
            <div class="progress-bar">
              <div class="progress" id="structure-progress"></div>
            </div>
          </div>
          <div class="progress-step">
            <div class="step-label">Extracting Content</div>
            <div class="progress-bar">
              <div class="progress" id="content-progress"></div>
            </div>
          </div>
          <div class="progress-step">
            <div class="step-label">Processing Media</div>
            <div class="progress-bar">
              <div class="progress" id="media-progress"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  },

  async startWordPressExport() {
    if (!this.isPremium) {
      this.showPremiumDialog();
      return;
    }

    const progressContainer = document.querySelector('.progress-container');
    progressContainer.style.display = 'block';

    // Use lightweight model for your hardware
    const ai = new LiteAI({
      modelSize: 'tiny', // ~100MB model
      maxBatchSize: 512, // Limit memory usage
      useQuantization: true // 8-bit quantization for speed
    });

    try {
      // Structure Analysis (30%)
      await this.updateProgress('structure', async (progress) => {
        const structure = await ai.analyzeStructure(document, progress);
        return structure;
      });

      // Content Extraction (40%)
      await this.updateProgress('content', async (progress) => {
        const content = await ai.extractContent(document, progress);
        return content;
      });

      // Media Processing (30%)
      await this.updateProgress('media', async (progress) => {
        const media = await ai.processMedia(document, progress);
        return media;
      });

      this.showExportOptions();
    } catch (err) {
      this.showError('Export failed', err);
    }
  },

  async updateProgress(type, operation) {
    const progressBar = document.getElementById(`${type}-progress`);
    let progress = 0;

    const updateUI = (percent) => {
      progress = Math.min(100, percent);
      progressBar.style.width = `${progress}%`;
    };

    return await operation((percent) => {
      updateUI(percent);
    });
  },

  async renderProgressUI() {
    document.getElementById('app').innerHTML = `
      <div class="progress-dashboard">
        <h3>Site Migration Progress</h3>
        
        <div class="overall-progress">
          <div class="progress-label">
            <span>Overall Progress</span>
            <span class="percentage" id="total-progress">0%</span>
          </div>
          <div class="progress-bar">
            <div class="progress" id="total-progress-bar"></div>
          </div>
        </div>

        <div class="detailed-progress">
          <div class="progress-phase ${this.currentPhase === 'discovery' ? 'active' : ''}">
            <div class="phase-header">
              <span class="phase-icon">🔍</span>
              <span class="phase-title">Site Discovery</span>
              <span class="phase-status" id="discovery-status">Pending...</span>
            </div>
            <div class="phase-details" id="discovery-details">
              <div class="detail-item">Pages Found: <span id="pages-count">0</span></div>
              <div class="detail-item">Media Files: <span id="media-count">0</span></div>
            </div>
          </div>

          <div class="progress-phase ${this.currentPhase === 'scraping' ? 'active' : ''}">
            <div class="phase-header">
              <span class="phase-icon">📥</span>
              <span class="phase-title">Content Scraping</span>
              <span class="phase-status" id="scraping-status">Waiting...</span>
            </div>
            <div class="progress-bar">
              <div class="progress" id="scraping-progress"></div>
            </div>
            <div class="current-action" id="current-page">
              <!-- Currently processing page shown here -->
            </div>
          </div>

          ${this.isPremium ? `
            <div class="progress-phase ${this.currentPhase === 'wordpress' ? 'active' : ''}">
              <div class="phase-header">
                <span class="phase-icon">🔄</span>
                <span class="phase-title">WordPress Conversion</span>
                <span class="phase-status" id="wp-status">Waiting...</span>
              </div>
              <div class="phase-details" id="wp-details">
                <div class="detail-item">Templates: <span id="template-count">0</span></div>
                <div class="detail-item">Posts: <span id="post-count">0</span></div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="action-buttons">
          <button id="pause-btn" class="secondary">Pause</button>
          <button id="cancel-btn" class="danger">Cancel</button>
        </div>
      </div>
    `;
  },

  async startScraping() {
    try {
      // Save state periodically
      setInterval(() => this.saveState(), 30000);

      if (await this.hasExistingState()) {
        await this.showResumeDialog();
      }

      // ... rest of scraping logic
    } catch (error) {
      await this.saveState();
      this.showRecoveryDialog(error);
    }
  },

  showRecoveryDialog(error) {
    document.getElementById('app').innerHTML += `
      <div class="error-dialog">
        <h3>⚠️ Encountered an Issue</h3>
        <p>${error.message}</p>
        <div class="actions">
          <button onclick="UI.resumeScraping()">Resume</button>
          <button onclick="UI.restartScraping()">Start Over</button>
        </div>
      </div>
    `;
  },

  updateProgress(data) {
    const { pagesProcessed, pagesTotal, currentUrl, phase } = data;
    
    // Update overall progress
    const totalProgress = document.getElementById('total-progress');
    const percentage = Math.round((pagesProcessed / pagesTotal) * 100);
    totalProgress.textContent = `${percentage}%`;
    
    // Update current action with truncated URL
    const currentAction = document.getElementById('current-page');
    const displayUrl = new URL(currentUrl).pathname;
    currentAction.textContent = `Processing: ${displayUrl.length > 40 ? 
      displayUrl.substring(0, 37) + '...' : displayUrl}`;
    
    // Update phase status
    const phaseStatus = document.getElementById(`${phase}-status`);
    if (phaseStatus) {
      phaseStatus.textContent = `${pagesProcessed}/${pagesTotal}`;
    }

    // Show estimated time remaining
    this.updateTimeEstimate(pagesProcessed, pagesTotal);
  },

  updateTimeEstimate(processed, total) {
    if (!this.startTime) this.startTime = Date.now();
    
    const elapsed = (Date.now() - this.startTime) / 1000;
    const avgTimePerPage = elapsed / processed;
    const remaining = (total - processed) * avgTimePerPage;
    
    const timeDisplay = document.getElementById('time-estimate');
    timeDisplay.textContent = `Est. ${this.formatTime(remaining)} remaining`;
  },

  async renderPremiumActivation() {
    document.getElementById('app').innerHTML = `
      <div class="premium-activation">
        <h3>Activate Premium Features</h3>
        
        <div class="key-input">
          <input type="text" 
                 id="premium-key" 
                 placeholder="Enter your premium key"
                 pattern="SST-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}"
                 maxlength="23"
                 autocomplete="off"
                 spellcheck="false">
          <button id="activate-btn" class="primary">Activate</button>
        </div>

        <div class="key-format">
          Format: SST-XXXXX-XXXXX-XXXXX
        </div>

        <div id="activation-message" class="message" style="display: none;">
        </div>

        <div class="premium-features">
          <h4>Premium Features Include:</h4>
          <ul>
            <li>🔄 WordPress Conversion</li>
            <li>🎨 Template Extraction</li>
            <li>🤖 AI-Powered Content Analysis</li>
            <li>📱 Responsive Design Detection</li>
          </ul>
        </div>
      </div>
    `;

    this.attachPremiumListeners();
  },

  async attachPremiumListeners() {
    const input = document.getElementById('premium-key');
    const button = document.getElementById('activate-btn');
    const message = document.getElementById('activation-message');

    // Auto-format key as user types
    input.addEventListener('input', (e) => {
      let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (value.length > 0) {
        value = `SST-${value.match(/.{1,5}/g).join('-')}`;
      }
      e.target.value = value.substring(0, 23);
    });

    button.addEventListener('click', async () => {
      try {
        const validator = new PremiumValidator();
        await validator.setPremiumKey(input.value);
        
        message.textContent = '✓ Premium features activated!';
        message.className = 'message success';
        message.style.display = 'block';
        
        setTimeout(() => this.renderMainMenu(), 1500);
      } catch (error) {
        message.textContent = '✗ ' + error.message;
        message.className = 'message error';
        message.style.display = 'block';
      }
    });
  }
}; 