const crypto = require('crypto');

function generateSecurityKey() {
  // Generate a random 128-bit key
  const key = crypto.randomBytes(16).toString('hex');
  
  // Generate its hash for verification
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  
  console.log('Generated Security Key:', key);
  console.log('Verification Hash:', hash);
  console.log('\nAdd this key to your dev.config.js');
  console.log('Add this hash to the validHash check in scraper.js');
}

generateSecurityKey(); 