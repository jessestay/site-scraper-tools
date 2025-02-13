class PremiumValidator {
  constructor() {
    this.keyPrefix = 'SST'; // Site Scraper Tools prefix
    this.storage = chrome.storage.local;
    this.devConfigPath = '../config/dev.config.js'; // Added in .gitignore
  }

  async validatePremium() {
    try {
      // Check for developer configuration first
      const devConfig = await this.loadDevConfig();
      if (devConfig?.developerKey) {
        return true; // Developer key present, always grant premium
      }

      // Regular premium validation
      const { premiumKey } = await this.storage.get('premiumKey');
      if (!premiumKey) return false;

      // Validate key format and checksum
      return this.validateKeyFormat(premiumKey) && 
             await this.validateKeyChecksum(premiumKey);
    } catch (error) {
      console.error('Premium validation failed:', error);
      return false;
    }
  }

  validateKeyFormat(key) {
    // Format: SST-XXXXX-XXXXX-XXXXX
    const keyFormat = /^SST-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
    return keyFormat.test(key);
  }

  async validateKeyChecksum(key) {
    // Simple but effective local validation
    const parts = key.split('-');
    const checksum = parts[3];
    const data = parts.slice(0, 3).join('');
    
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const calculatedChecksum = Array.from(new Uint8Array(hashBuffer))
      .slice(0, 5)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    return checksum === calculatedChecksum;
  }

  async setPremiumKey(key) {
    if (!this.validateKeyFormat(key)) {
      throw new Error('Invalid key format');
    }
    
    if (!await this.validateKeyChecksum(key)) {
      throw new Error('Invalid key');
    }

    await this.storage.set({ premiumKey: key });
    return true;
  }

  async loadDevConfig() {
    try {
      const response = await fetch(chrome.runtime.getURL(this.devConfigPath));
      if (!response.ok) return null;
      const config = await response.json();
      return config;
    } catch {
      return null; // Silently fail if no dev config exists
    }
  }
} 