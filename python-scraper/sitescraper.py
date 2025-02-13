import os
import time
import argparse
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
import mimetypes
from collections import deque
import requests
import urllib3
import ssl
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.ssl_ import create_urllib3_context

# Disable SSL warnings
urllib3.disable_warnings()

class TLSAdapter(HTTPAdapter):
    def __init__(self, *args, **kwargs):
        self.ssl_context = create_urllib3_context(
            ssl_version=ssl.PROTOCOL_TLSv1,
            ciphers='ALL:@SECLEVEL=1'
        )
        super().__init__(*args, **kwargs)

    def init_poolmanager(self, *args, **kwargs):
        kwargs['ssl_context'] = self.ssl_context
        return super().init_poolmanager(*args, **kwargs)

def download_content(url, output_path=None, session=None):
    if session is None:
        session = create_session()
    
    try:
        response = session.get(url, verify=False, timeout=30)
        response.raise_for_status()
        
        if output_path:
            with open(output_path, 'wb') as f:
                f.write(response.content)
            return True
        return response.text
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return None

def create_session():
    session = requests.Session()
    adapter = TLSAdapter()
    session.mount('https://', adapter)
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    })
    return session

def clean_filename(url):
    parsed = urlparse(url)
    path = parsed.path
    if not path or path == '/':
        path = '/index.html'
    elif not path.endswith(('.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif')):
        path = path.rstrip('/') + '/index.html'
    return path.lstrip('/')

def is_asset_url(url):
    mime_type, _ = mimetypes.guess_type(url)
    return mime_type in ['text/css', 'application/javascript'] or \
           mime_type and mime_type.startswith(('image/', 'font/'))

def scrape(start_url, output_dir, delay=1.0):
    if not start_url.startswith(('http://', 'https://')):
        start_url = 'https://' + start_url
    
    visited = set()
    pages_queue = deque([start_url])
    assets_queue = set()
    session = create_session()
    
    os.makedirs(output_dir, exist_ok=True)
    
    while pages_queue or assets_queue:
        while pages_queue:
            url = pages_queue.popleft()
            if url in visited:
                continue
            
            try:
                print(f"Fetching page: {url}")
                html = download_content(url, session=session)
                if not html:
                    print(f"Failed to fetch {url}")
                    continue
                
                visited.add(url)
                soup = BeautifulSoup(html, 'html.parser')
                
                # Find and queue assets
                for tag in soup.find_all(['link', 'script', 'img']):
                    for attr in ['href', 'src']:
                        if tag.get(attr):
                            asset_url = urljoin(url, tag[attr])
                            if asset_url.startswith(start_url) and is_asset_url(asset_url):
                                assets_queue.add(asset_url)
                                tag[attr] = asset_url
                
                # Save the HTML
                filename = os.path.join(output_dir, clean_filename(url))
                os.makedirs(os.path.dirname(filename), exist_ok=True)
                
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(str(soup))
                print(f"Saved HTML to {filename}")
                
                # Queue new pages
                for link in soup.find_all('a'):
                    href = link.get('href')
                    if href:
                        full_url = urljoin(url, href)
                        if full_url.startswith(start_url) and full_url not in visited:
                            pages_queue.append(full_url)
                
                time.sleep(delay)
            
            except Exception as e:
                print(f"Error processing {url}: {e}")
        
        # Process assets
        if assets_queue:
            asset_url = assets_queue.pop()
            if asset_url not in visited:
                time.sleep(delay)
                filename = os.path.join(output_dir, clean_filename(asset_url))
                os.makedirs(os.path.dirname(filename), exist_ok=True)
                if download_content(asset_url, filename, session):
                    visited.add(asset_url)
                    print(f"Downloaded asset: {asset_url}")
    
    print(f"\nScraping complete. Processed {len(visited)} URLs")
    return visited

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Website to static HTML scraper')
    parser.add_argument('url', help='Starting URL to scrape')
    parser.add_argument('--output', '-o', default='site_output',
                       help='Output directory (default: site_output)')
    parser.add_argument('--delay', '-d', type=float, default=1.0,
                       help='Delay between requests in seconds (default: 1.0)')
    args = parser.parse_args()

    urls = scrape(args.url, args.output, delay=args.delay)
    