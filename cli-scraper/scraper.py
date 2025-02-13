from pathlib import Path
import asyncio
import aiohttp
import logging
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import json

class WebScraper:
    def __init__(self, base_url, output_dir="output", is_premium=False):
        self.base_url = base_url
        self.output_dir = Path(output_dir)
        self.visited_urls = set()
        self.queue = asyncio.Queue()
        self.session = None
        self.is_premium = is_premium
        
        # Configure logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger("WebScraper")

    async def init_session(self):
        self.session = aiohttp.ClientSession()

    async def close_session(self):
        if self.session:
            await self.session.close()

    async def scrape(self):
        try:
            await self.init_session()
            self.output_dir.mkdir(parents=True, exist_ok=True)
            
            # Add start URL to queue
            await self.queue.put(self.base_url)
            
            # Process URLs concurrently
            workers = [
                asyncio.create_task(self.process_url())
                for _ in range(5)  # 5 concurrent workers
            ]
            
            # Wait for queue to be empty
            await self.queue.join()
            
            # Cancel workers
            for w in workers:
                w.cancel()
                
            # Save sitemap
            await self.save_sitemap()
            
        finally:
            await self.close_session()

    async def process_url(self):
        while True:
            try:
                url = await self.queue.get()
                
                if url in self.visited_urls:
                    self.queue.task_done()
                    continue
                    
                self.logger.info(f"Processing: {url}")
                
                async with self.session.get(url) as response:
                    if response.status != 200:
                        self.logger.warning(f"Failed to fetch {url}: {response.status}")
                        continue
                        
                    content = await response.text()
                    soup = BeautifulSoup(content, 'html.parser')
                    
                    # Save page content
                    await self.save_page(url, content)
                    
                    # Extract and queue links
                    await self.process_links(soup, url)
                    
                    # Handle assets
                    await self.process_assets(soup, url)
                    
                    self.visited_urls.add(url)
                    
            except Exception as e:
                self.logger.error(f"Error processing {url}: {e}")
            finally:
                self.queue.task_done()

    async def process_links(self, soup, base_url):
        for link in soup.find_all('a', href=True):
            url = urljoin(base_url, link['href'])
            
            # Only process URLs from same domain
            if not url.startswith(self.base_url):
                continue
                
            # Skip already visited or queued URLs
            if url in self.visited_urls:
                continue
                
            await self.queue.put(url)

    async def process_assets(self, soup, base_url):
        # Process images, scripts, stylesheets
        selectors = {
            'img': 'src',
            'script': 'src',
            'link': 'href',
            'video': 'src',
            'audio': 'src',
        }
        
        for tag, attr in selectors.items():
            for element in soup.find_all(tag, {attr: True}):
                url = urljoin(base_url, element[attr])
                if url.startswith(self.base_url):
                    await self.save_asset(url)

    async def save_page(self, url, content):
        path = self.url_to_filepath(url)
        path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)

    async def save_asset(self, url):
        try:
            path = self.url_to_filepath(url)
            if path.exists():
                return
                
            path.parent.mkdir(parents=True, exist_ok=True)
            
            async with self.session.get(url) as response:
                if response.status == 200:
                    content = await response.read()
                    with open(path, 'wb') as f:
                        f.write(content)
        except Exception as e:
            self.logger.error(f"Failed to save asset {url}: {e}")

    def url_to_filepath(self, url):
        parsed = urlparse(url)
        path = parsed.path.lstrip('/')
        
        if not path:
            path = 'index.html'
        elif path.endswith('/'):
            path += 'index.html'
        elif '.' not in path.split('/')[-1]:
            path += '/index.html'
            
        return self.output_dir / path

    async def save_sitemap(self):
        sitemap = {
            'pages': sorted(list(self.visited_urls)),
            'baseUrl': self.base_url,
            'totalPages': len(self.visited_urls)
        }
        
        with open(self.output_dir / 'sitemap.json', 'w') as f:
            json.dump(sitemap, f, indent=2)

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python scraper.py <url> [output_dir]")
        sys.exit(1)
        
    url = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "output"
    
    scraper = WebScraper(url, output_dir)
    asyncio.run(scraper.scrape()) 