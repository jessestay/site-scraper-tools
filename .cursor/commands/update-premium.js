module.exports = {
  name: 'update-premium',
  description: 'Updates premium repository with latest base scraper changes',
  async run(cursor) {
    // 1. Save and commit base changes
    await cursor.exec('git add chrome-extension/scraper.js');
    await cursor.exec('git commit -m "Update base scraper"');
    await cursor.exec('git push origin main');

    // 2. Switch to premium repo and update
    const premiumPath = '../site-scraper-tools-premium';
    await cursor.exec(`cd ${premiumPath}`);
    await cursor.exec('npm install github:yourusername/site-scraper-tools#main --force');
    
    // 3. Commit premium updates
    await cursor.exec('git add package.json package-lock.json');
    await cursor.exec('git commit -m "Update base scraper dependency"');
    await cursor.exec('git push origin main');

    cursor.showMessage('Successfully updated premium repository');
  }
}; 