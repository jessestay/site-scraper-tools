class PremiumFeatureManager {
  constructor() {
    this.validator = new PremiumValidator();
    this.features = new Map();
    this.setupValidationCheck();
  }

  async setupValidationCheck() {
    // Regular validation checks
    setInterval(async () => {
      const isValid = await this.validator.validatePremium();
      if (!isValid) {
        this.disableAllPremiumFeatures();
      }
    }, this.validator.validationInterval);
  }

  async enableFeature(featureId) {
    if (!await this.validator.validatePremium()) {
      throw new Error('Premium validation failed');
    }

    const feature = this.features.get(featureId);
    if (!feature) {
      throw new Error('Feature not found');
    }

    // Load feature code dynamically
    const module = await import(
      chrome.runtime.getURL(`premium-features/${featureId}.js`)
    );

    // Initialize feature with validation token
    const validation = await chrome.storage.local.get('premiumValidation');
    return new module.default(validation.token);
  }

  disableAllPremiumFeatures() {
    for (const feature of this.features.values()) {
      feature.disable();
    }
  }
} 