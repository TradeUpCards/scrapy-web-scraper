import scrapy
import json
from urllib.parse import urljoin, urlparse, urlunparse
import os


class MaxrollSpider(scrapy.Spider):
    name = "maxroll"
    allowed_domains = ["maxroll.gg"]
    
    def __init__(self, start_urls=None, filter_depth=1, max_depth=None, output_file='output.json', max_pages=10000, *args, **kwargs):
        super(MaxrollSpider, self).__init__(*args, **kwargs)
        if start_urls:
            self.start_urls = start_urls.split(',')
        else:
            self.start_urls = ["https://maxroll.gg/d4/getting-started/first-steps-in-diablo-4"]
        
        # Set the filter depth (0 = no filtering, 1+ = number of path levels to match)
        self.filter_depth = int(filter_depth) if filter_depth is not None else 1
        
        # Set the max depth (None = no restriction, 1+ = maximum crawl depth)
        self.max_depth = int(max_depth) if max_depth is not None else None
        
        # Set maximum pages to scrape (very high number = effectively no limit)
        self.max_pages = int(max_pages) if max_pages is not None else 10000
        
        # Set output file
        self.output_file = output_file
        
        # Extract the path filter from the first start URL
        if self.start_urls and self.filter_depth > 0:
            self.path_filter = self._get_path_filter(self.start_urls[0])
        else:
            self.path_filter = None
        
        # Progress tracking
        self.pages_processed = 0
        self.pages_filtered = 0
        self.depth_exceeded = 0
        self.estimated_total_pages = 0
        self.current_page_url = ""
        
        # URL tracking - two separate lists
        self.urls_found = set()      # All unique URLs discovered
        self.urls_scraped = set()    # URLs that have been actually scraped
        self.duplicate_urls_skipped = 0
        
        # Data collection for sorting and deduplication
        self.collected_data = []     # Store all scraped data in memory
        
        # Add starting URLs to both sets
        for start_url in self.start_urls:
            normalized_url = self._normalize_url(start_url)
            self.urls_found.add(normalized_url)
            self.urls_scraped.add(normalized_url)
        
        # Log initialization
        self.logger.info(f"Spider initialized with filter_depth={self.filter_depth}, max_depth={self.max_depth}, path_filter={self.path_filter}")
        
        # Clear the output file at the start
        try:
            with open(self.output_file, 'w', encoding='utf-8') as f:
                pass  # Just clear the file
            self.logger.info(f"Cleared output file: {self.output_file}")
        except Exception as e:
            self.logger.error(f"Error clearing output file: {e}")

    def _normalize_url(self, url):
        """Normalize URL to handle slight variations (remove fragments, normalize scheme)"""
        parsed = urlparse(url)
        # Remove fragments and normalize
        normalized = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            parsed.query,
            ''  # Remove fragment
        ))
        return normalized

    def _get_path_filter(self, url):
        """Extract the path segments to use as a filter based on filter_depth"""
        parsed = urlparse(url)
        path_parts = [part for part in parsed.path.split('/') if part]
        
        if self.filter_depth == 0:
            return None  # No filtering
        elif self.filter_depth == 1:
            return path_parts[0] if path_parts else None  # First level only
        else:
            # Return multiple path segments up to the specified depth
            if len(path_parts) >= self.filter_depth:
                return '/'.join(path_parts[:self.filter_depth])
            else:
                return '/'.join(path_parts) if path_parts else None

    def _matches_filter(self, url):
        """Check if URL matches the path filter"""
        if not self.path_filter or self.filter_depth == 0:
            return True

        parsed = urlparse(url)
        path_parts = [part for part in parsed.path.split('/') if part]
        
        if self.filter_depth == 1:
            # Simple first-level matching
            return path_parts and path_parts[0] == self.path_filter
        else:
            # Multi-level matching
            if len(path_parts) >= self.filter_depth:
                url_path = '/'.join(path_parts[:self.filter_depth])
                return url_path == self.path_filter
            else:
                # If the URL is shorter than our filter depth, check if it's a prefix
                url_path = '/'.join(path_parts)
                return self.path_filter.startswith(url_path + '/') or url_path == self.path_filter

    def _estimate_total_pages(self, response):
        """Estimate total pages by counting links on the starting page"""
        if self.pages_processed == 1:  # Only do this on the first page
            potential_links = 0
            filtered_links = 0
            
            for link in response.css('a[href]'):
                href = link.css('::attr(href)').get()
                if href:
                    full_url = urljoin(response.url, href)
                    if (full_url.startswith('https://maxroll.gg') and 
                        not any(skip in full_url for skip in ['#', 'javascript:', 'mailto:', '.pdf', '.jpg', '.png', '.gif', '.webp', '.svg'])):
                        
                        if self._matches_filter(full_url):
                            potential_links += 1
                        else:
                            filtered_links += 1
            
            # Estimate based on potential links found
            # Assume each page has similar link density
            if potential_links > 0:
                # Conservative estimate: assume 50-80% of potential links are unique pages
                self.estimated_total_pages = max(potential_links, 5)  # At least 5 pages
                if self.max_depth and self.max_depth > 1:
                    # If we have depth limits, adjust estimate
                    self.estimated_total_pages = min(self.estimated_total_pages * self.max_depth, 100)
                else:
                    # No depth limit, be more conservative
                    self.estimated_total_pages = min(self.estimated_total_pages * 2, 50)
            
            self.logger.info(f"Estimated {self.estimated_total_pages} total pages based on {potential_links} potential links found (filtered out {filtered_links})")

    def parse(self, response):
        """Parse the main page and extract content"""
        
        # Check if we've reached the maximum page limit
        if self.pages_processed >= self.max_pages:
            self.logger.info(f"Maximum page limit reached ({self.max_pages}), stopping spider")
            return
        
        # Get current depth from response meta
        current_depth = response.meta.get('depth', 0)
        
        # Check if we've exceeded max depth
        if self.max_depth is not None and current_depth > self.max_depth:
            self.depth_exceeded += 1
            self.logger.info(f"Max depth exceeded ({current_depth} > {self.max_depth}) for URL: {response.url}")
            return
        
        # Update current page URL for progress tracking
        self.current_page_url = response.url
        
        # Log progress
        self.pages_processed += 1
        
        # Estimate total pages on first page
        self._estimate_total_pages(response)
        
        # Calculate progress percentage
        progress_percent = 0
        if len(self.urls_found) > 0:
            progress_percent = min((self.pages_processed / len(self.urls_found)) * 100, 100)
        
        self.logger.info(f"Processing page {self.pages_processed}/{len(self.urls_found)} ({progress_percent:.1f}%): {response.url} (depth: {current_depth}) - Total discovered: {len(self.urls_found)}, Total scraped: {len(self.urls_scraped)})")
        
        # Extract page title
        title = response.css('title::text').get()
        if not title:
            title = response.css('h1::text').get()
        
        # Extract main content
        content = {
            'url': response.url,
            'title': title,
            'content': {},
            'metadata': {}
        }
        
        # Extract headings
        headings = []
        for i in range(1, 7):
            for heading in response.css(f'h{i}::text').getall():
                headings.append({
                    'level': i,
                    'text': heading.strip()
                })
        content['content']['headings'] = headings
        
        # Extract paragraphs
        paragraphs = []
        for p in response.css('p::text').getall():
            text = p.strip()
            if text and len(text) > 10:  # Only meaningful paragraphs
                paragraphs.append(text)
        content['content']['paragraphs'] = paragraphs
        
        # Extract lists
        lists = []
        for ul in response.css('ul'):
            list_items = []
            for li in ul.css('li::text').getall():
                text = li.strip()
                if text:
                    list_items.append(text)
            if list_items:
                lists.append(list_items)
        content['content']['lists'] = lists
        
        # Extract links
        links = []
        for link in response.css('a[href]'):
            href = link.css('::attr(href)').get()
            text = link.css('::text').get()
            if href and text:
                full_url = urljoin(response.url, href)
                links.append({
                    'url': full_url,
                    'text': text.strip()
                })
        content['content']['links'] = links
        
        # Extract images
        images = []
        for img in response.css('img[src]'):
            src = img.css('::attr(src)').get()
            alt = img.css('::attr(alt)').get() or ''
            if src:
                full_src = urljoin(response.url, src)
                images.append({
                    'src': full_src,
                    'alt': alt
                })
        content['content']['images'] = images
        
        # Extract metadata
        meta = {}
        for meta_tag in response.css('meta'):
            name = meta_tag.css('::attr(name)').get()
            content_attr = meta_tag.css('::attr(content)').get()
            if name and content_attr:
                meta[name] = content_attr
        content['metadata'] = meta
        
        # Extract any structured data (JSON-LD)
        structured_data = []
        for script in response.css('script[type="application/ld+json"]::text').getall():
            try:
                data = json.loads(script)
                structured_data.append(data)
            except json.JSONDecodeError:
                pass
        content['content']['structured_data'] = structured_data
        
        # Extract tables
        tables = []
        for table in response.css('table'):
            table_data = []
            for row in table.css('tr'):
                row_data = []
                for cell in row.css('td, th'):
                    cell_text = cell.css('::text').get()
                    if cell_text:
                        row_data.append(cell_text.strip())
                if row_data:
                    table_data.append(row_data)
            if table_data:
                tables.append(table_data)
        content['content']['tables'] = tables
        
        # Extract code blocks
        code_blocks = []
        for code in response.css('code::text').getall():
            text = code.strip()
            if text:
                code_blocks.append(text)
        content['content']['code_blocks'] = code_blocks
        
        # Collect data in memory for sorting and deduplication
        self._collect_data(content)
        
        # Follow links to other pages on the same domain AND matching the path filter
        links_followed = 0
        links_filtered = 0
        links_duplicate = 0
        links_new_found = 0
        
        for link in response.css('a[href]'):
            href = link.css('::attr(href)').get()
            if href:
                full_url = urljoin(response.url, href)
                # Only follow links that:
                # 1. Are on the same domain
                # 2. Match our path filter (same game/section)
                # 3. Avoid common non-content URLs
                # 4. Don't exceed max depth
                # 5. Haven't been visited before
                if (full_url.startswith('https://maxroll.gg') and 
                    not any(skip in full_url for skip in ['#', 'javascript:', 'mailto:', '.pdf', '.jpg', '.png', '.gif', '.webp', '.svg'])):
                    
                    normalized_full_url = self._normalize_url(full_url)
                    
                    # Always add to found list (for tracking total discovered)
                    if normalized_full_url not in self.urls_found:
                        self.urls_found.add(normalized_full_url)
                        links_new_found += 1
                    
                    if self._matches_filter(full_url):
                        # Check if we've already scraped this URL
                        if normalized_full_url in self.urls_scraped:
                            links_duplicate += 1
                            self.duplicate_urls_skipped += 1
                        else:
                            links_followed += 1
                            # Mark URL as scraped before following
                            self.urls_scraped.add(normalized_full_url)
                            # Pass depth information to the next request
                            yield response.follow(full_url, self.parse, meta={'depth': current_depth + 1})
                    else:
                        links_filtered += 1
                        self.pages_filtered += 1
        
        if links_followed > 0 or links_filtered > 0 or links_duplicate > 0 or links_new_found > 0:
            self.logger.info(f"Found {links_followed + links_filtered + links_duplicate + links_new_found} links on {response.url}: {links_followed} followed, {links_filtered} filtered out, {links_duplicate} duplicates skipped, {links_new_found} newly discovered")
    
    def _collect_data(self, content):
        """Collect content in memory for later sorting and deduplication"""
        try:
            # Add to collected data
            self.collected_data.append(content)
            self.logger.info(f"Collected data for {content.get('url', 'unknown URL')}")
        except Exception as e:
            self.logger.error(f"Error collecting data: {e}")

    def _write_sorted_deduplicated_output(self):
        """Write sorted and deduplicated data to file"""
        try:
            if not self.collected_data:
                self.logger.info("No data to write")
                return
            
            # Remove duplicates based on URL
            seen_urls = set()
            unique_data = []
            for item in self.collected_data:
                url = item.get('url', '')
                if url not in seen_urls:
                    seen_urls.add(url)
                    unique_data.append(item)
            
            # Sort by URL
            unique_data.sort(key=lambda x: x.get('url', ''))
            
            # Write sorted, deduplicated data
            with open(self.output_file, 'w', encoding='utf-8') as f:
                for item in unique_data:
                    json_line = json.dumps(item, ensure_ascii=False)
                    f.write(json_line + '\n')
            
            self.logger.info(f"Wrote {len(unique_data)} sorted, deduplicated records to {self.output_file}")
            self.logger.info(f"Removed {len(self.collected_data) - len(unique_data)} duplicate records")
            
        except Exception as e:
            self.logger.error(f"Error writing sorted output: {e}")

    def _write_compact_output(self, content):
        """Write content to file in compact format (one line per record)"""
        try:
            json_line = json.dumps(content, ensure_ascii=False)
            with open(self.output_file, 'a', encoding='utf-8') as f:
                f.write(json_line + '\n')
            self.logger.info(f"Wrote compact line to {self.output_file}: {len(json_line)} characters")
        except Exception as e:
            self.logger.error(f"Error writing compact output: {e}")

    def closed(self, reason):
        """Called when spider is closed"""
        # Write sorted and deduplicated output
        self._write_sorted_deduplicated_output()
        
        self.logger.info(f"Spider finished. Summary:")
        self.logger.info(f"  - Pages processed: {self.pages_processed}")
        self.logger.info(f"  - Pages filtered out: {self.pages_filtered}")
        self.logger.info(f"  - Pages exceeding max depth: {self.depth_exceeded}")
        self.logger.info(f"  - Duplicate URLs skipped: {self.duplicate_urls_skipped}")
        self.logger.info(f"  - Total URLs discovered: {len(self.urls_found)}")
        self.logger.info(f"  - Total URLs scraped: {len(self.urls_scraped)}")
        self.logger.info(f"  - Filter depth: {self.filter_depth}")
        self.logger.info(f"  - Max depth: {self.max_depth}")
        self.logger.info(f"  - Path filter: {self.path_filter}")
