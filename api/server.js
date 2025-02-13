const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();

// Free tier limits
const freeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100 // 100 requests per day
});

// Premium tier limits  
const premiumLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10000 // 10k requests per day
});

// Public API endpoints
app.post('/api/scrape', freeLimiter, async (req, res) => {
  // Basic scraping functionality
});

// Reference premium endpoints but don't implement
app.post('/api/premium/scrape', (req, res) => {
  res.status(402).json({ 
    error: 'Premium API required',
    upgrade: 'https://your-domain.com/upgrade'
  });
}); 