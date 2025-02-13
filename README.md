# Site Scraper Tools

A comprehensive toolkit for scraping and archiving websites, providing both a Chrome extension and a Python command-line tool. This project aims to help users create local copies of websites while preserving the original structure and assets.

## Features

### Chrome Extension
- 🌐 Scrape entire websites while preserving directory structure
- 📥 Download all assets (images, CSS, JS, fonts)
- 🗂️ Create organized ZIP archives of sites
- ⚡ Handle JavaScript-rendered content
- 📊 Real-time progress tracking
- ⏹️ Pause/Stop functionality
- 🔄 Automatic retry mechanism
- 🧹 Clean up resources automatically

### Python Script
- 🔄 Recursive website crawling
- 🔒 Advanced SSL/TLS handling
- 📁 Maintains directory structure
- 🚀 Configurable delay between requests
- 💾 Asset downloading
- 🔍 Smart URL filtering

## Installation & Usage

## Installation

### Chrome Extension
1. Clone this repository:
```bash
git clone https://github.com/yourusername/site-scraper-tools.git
```

2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `chrome-extension` directory

### Python Script
1. Install required packages:
```bash
pip install requests beautifulsoup4
```

2. Navigate to the python-scraper directory:
```bash
cd site-scraper-tools/python-scraper
```

## Usage

### Chrome Extension
1. Click the extension icon on any webpage
2. Click "Scrape Current Site"
3. Monitor progress in the popup
4. Choose save location for the ZIP file when complete

Options:
- Stop scraping at any time with the "Stop" button
- Progress is shown in real-time
- Assets are automatically detected and downloaded

### Python Script
Basic usage:
```bash
python sitescraper.py https://example.com
```

With options:
```bash
python sitescraper.py https://example.com --output custom_dir --delay 2.0
```

Options:
- `--output`, `-o`: Output directory (default: site_output)
- `--delay`, `-d`: Delay between requests in seconds (default: 1.0)

## Technical Details

### Chrome Extension
- Uses modern Chrome Extension Manifest V3
- Handles JavaScript-rendered content
- Manages browser resources efficiently
- Provides real-time progress updates
- Creates organized ZIP archives

### Python Script
- Handles SSL certificate issues
- Respects rate limiting
- Manages memory efficiently
- Provides detailed progress output
- Creates clean directory structure

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Uses JSZip for file compression
- BeautifulSoup4 for HTML parsing
- Requests library for HTTP handling

## Security Note

Please ensure you have permission to scrape any website you target. Some websites explicitly forbid scraping in their terms of service or robots.txt file.