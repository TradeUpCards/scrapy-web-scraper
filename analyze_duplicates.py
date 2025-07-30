#!/usr/bin/env python3
"""
Analyze duplicate patterns in scraped data
"""

import json
import argparse
import sys
from urllib.parse import urlparse
from collections import defaultdict, Counter

def analyze_duplicates(data):
    """Analyze duplicate patterns in the data"""
    
    print(f"📊 Analyzing {len(data)} items...")
    print("=" * 60)
    
    # 1. URL Analysis
    print("\n🔗 URL Analysis:")
    urls = [item.get('url', 'NO_URL') for item in data]
    url_counter = Counter(urls)
    
    print(f"Total items: {len(data)}")
    print(f"Unique URLs: {len(set(urls))}")
    print(f"Duplicate URLs: {len([url for url, count in url_counter.items() if count > 1])}")
    
    # Show most common URLs
    print("\nMost common URLs:")
    for url, count in url_counter.most_common(10):
        if count > 1:
            print(f"  {count}x: {url}")
    
    # 2. Normalized URL Analysis
    print("\n🔗 Normalized URL Analysis:")
    normalized_urls = []
    for item in data:
        if 'url' in item:
            parsed = urlparse(item['url'])
            normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            normalized_urls.append(normalized)
        else:
            normalized_urls.append('NO_URL')
    
    norm_counter = Counter(normalized_urls)
    print(f"Unique normalized URLs: {len(set(normalized_urls))}")
    print(f"Duplicate normalized URLs: {len([url for url, count in norm_counter.items() if count > 1])}")
    
    # Show most common normalized URLs
    print("\nMost common normalized URLs:")
    for url, count in norm_counter.most_common(10):
        if count > 1:
            print(f"  {count}x: {url}")
    
    # 3. Title Analysis
    print("\n📝 Title Analysis:")
    titles = [item.get('title', 'NO_TITLE') for item in data]
    title_counter = Counter(titles)
    
    print(f"Unique titles: {len(set(titles))}")
    print(f"Duplicate titles: {len([title for title, count in title_counter.items() if count > 1])}")
    
    # Show most common titles
    print("\nMost common titles:")
    for title, count in title_counter.most_common(5):
        if count > 1:
            print(f"  {count}x: {title[:80]}...")
    
    # 4. Content Length Analysis
    print("\n📏 Content Length Analysis:")
    content_lengths = []
    for item in data:
        content = item.get('content', {})
        total_length = 0
        total_length += len(str(content.get('headings', [])))
        total_length += len(str(content.get('paragraphs', [])))
        total_length += len(str(content.get('lists', [])))
        total_length += len(str(content.get('links', [])))
        total_length += len(str(content.get('images', [])))
        total_length += len(str(content.get('tables', [])))
        content_lengths.append(total_length)
    
    print(f"Average content length: {sum(content_lengths) // len(content_lengths):,} chars")
    print(f"Min content length: {min(content_lengths):,} chars")
    print(f"Max content length: {max(content_lengths):,} chars")
    
    # 5. Sample of items with same URL
    print("\n🔍 Sample of duplicate URL items:")
    seen_urls = set()
    for item in data:
        if 'url' in item:
            if item['url'] in seen_urls:
                print(f"\nDuplicate found for: {item['url']}")
                print(f"  Title: {item.get('title', 'NO_TITLE')}")
                print(f"  Content keys: {list(item.get('content', {}).keys())}")
                break
            seen_urls.add(item['url'])
    
    # 6. File size estimation
    print("\n💾 File Size Analysis:")
    sample_size = len(json.dumps(data[:10], indent=2))
    estimated_size_mb = (sample_size / 10) * len(data) / (1024 * 1024)
    print(f"Estimated file size: {estimated_size_mb:.1f} MB")
    
    # 7. Recommendations
    print("\n💡 Recommendations:")
    if len(set(urls)) == len(data):
        print("  ✅ No URL duplicates found - data is already unique by URL")
    else:
        print(f"  🔧 Found {len(data) - len(set(urls))} URL duplicates")
        print("  🔧 Consider URL-based deduplication")
    
    if len(set(normalized_urls)) < len(set(urls)):
        print(f"  🔧 Found {len(set(urls)) - len(set(normalized_urls))} URL variations")
        print("  🔧 Consider normalized URL deduplication")
    
    if len(set(titles)) < len(data):
        print(f"  🔧 Found {len(data) - len(set(titles))} title duplicates")
        print("  🔧 Consider title-based deduplication")

def main():
    parser = argparse.ArgumentParser(description='Analyze duplicate patterns in scraped data')
    parser.add_argument('input_file', help='Input JSON file with scraped data')
    
    args = parser.parse_args()
    
    try:
        # Read input file
        with open(args.input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Analyze
        analyze_duplicates(data)
        
    except FileNotFoundError:
        print(f"❌ Error: File '{args.input_file}' not found")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in '{args.input_file}': {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 