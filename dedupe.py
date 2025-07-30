#!/usr/bin/env python3
"""
Deduplication script for scraped data
Removes duplicate entries based on URL and content similarity
"""

import json
import hashlib
from urllib.parse import urlparse
from collections import defaultdict
import argparse
import sys

def normalize_url(url):
    """Normalize URL by removing fragments and query parameters"""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

def get_content_hash(content):
    """Create a hash of the content for comparison"""
    # Create a simplified representation of content for hashing
    content_str = ""
    
    # Add headings
    if 'headings' in content:
        for heading in content['headings']:
            content_str += f"h{heading['level']}:{heading['text']}\n"
    
    # Add paragraphs (first 100 chars of each)
    if 'paragraphs' in content:
        for para in content['paragraphs']:
            content_str += para[:100] + "\n"
    
    # Add title
    if 'title' in content:
        content_str += f"title:{content['title']}\n"
    
    return hashlib.md5(content_str.encode('utf-8')).hexdigest()

def deduplicate_data(data, output_file=None, verbose=True):
    """
    Deduplicate scraped data
    
    Args:
        data: List of scraped items
        output_file: Optional output file path
        verbose: Whether to print progress information
    
    Returns:
        Deduplicated data list
    """
    if verbose:
        print(f"Original data: {len(data)} items")
    
    # Track seen URLs and content hashes
    seen_urls = set()
    seen_content_hashes = set()
    deduplicated = []
    
    # Group by normalized URL first
    url_groups = defaultdict(list)
    for item in data:
        if 'url' in item:
            normalized_url = normalize_url(item['url'])
            url_groups[normalized_url].append(item)
    
    if verbose:
        print(f"Unique URLs: {len(url_groups)}")
    
    # Process each URL group
    for normalized_url, items in url_groups.items():
        if len(items) == 1:
            # Only one item for this URL, keep it
            item = items[0]
            content_hash = get_content_hash(item.get('content', {}))
            
            if content_hash not in seen_content_hashes:
                seen_content_hashes.add(content_hash)
                deduplicated.append(item)
                if verbose:
                    print(f"✓ Kept: {item.get('url', normalized_url)}")
            else:
                if verbose:
                    print(f"✗ Duplicate content: {item.get('url', normalized_url)}")
        else:
            # Multiple items for same URL, keep the best one
            if verbose:
                print(f"Multiple items for {normalized_url}: {len(items)} items")
            
            # Sort by content richness (more content = better)
            def content_score(item):
                content = item.get('content', {})
                score = 0
                score += len(content.get('headings', [])) * 2
                score += len(content.get('paragraphs', [])) * 3
                score += len(content.get('lists', [])) * 2
                score += len(content.get('links', []))
                score += len(content.get('images', []))
                score += len(content.get('tables', [])) * 5
                return score
            
            best_item = max(items, key=content_score)
            content_hash = get_content_hash(best_item.get('content', {}))
            
            if content_hash not in seen_content_hashes:
                seen_content_hashes.add(content_hash)
                deduplicated.append(best_item)
                if verbose:
                    print(f"✓ Kept best: {best_item.get('url', normalized_url)} (score: {content_score(best_item)})")
            else:
                if verbose:
                    print(f"✗ Duplicate content: {best_item.get('url', normalized_url)}")
    
    if verbose:
        print(f"\nDeduplication complete!")
        print(f"Original: {len(data)} items")
        print(f"Deduplicated: {len(deduplicated)} items")
        print(f"Removed: {len(data) - len(deduplicated)} duplicates")
        print(f"Reduction: {((len(data) - len(deduplicated)) / len(data) * 100):.1f}%")
    
    # Save to file if specified
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(deduplicated, f, indent=2, ensure_ascii=False)
        if verbose:
            print(f"Saved deduplicated data to: {output_file}")
    
    return deduplicated

def main():
    parser = argparse.ArgumentParser(description='Deduplicate scraped JSON data')
    parser.add_argument('input_file', help='Input JSON file with scraped data')
    parser.add_argument('-o', '--output', help='Output file (default: input_file_deduplicated.json)')
    parser.add_argument('-q', '--quiet', action='store_true', help='Suppress verbose output')
    
    args = parser.parse_args()
    
    try:
        # Read input file
        with open(args.input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Determine output file
        if args.output:
            output_file = args.output
        else:
            base_name = args.input_file.rsplit('.', 1)[0]
            output_file = f"{base_name}_deduplicated.json"
        
        # Deduplicate
        deduplicated = deduplicate_data(data, output_file, verbose=not args.quiet)
        
        print(f"\n✅ Deduplication successful!")
        print(f"📁 Output: {output_file}")
        
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