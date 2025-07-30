#!/usr/bin/env python3
"""
Compact deduplication script for scraped data
Removes duplicate entries based on URL and outputs each item on one line, sorted by URL
Filters results to match the same game/section as the input URL
"""

import json
import argparse
import sys
from urllib.parse import urlparse

def normalize_url(url):
    """Normalize URL by removing fragments and query parameters"""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

def get_path_filter(input_url):
    """Extract the first path segment to use as a filter"""
    parsed = urlparse(input_url)
    path_parts = [part for part in parsed.path.split('/') if part]
    if path_parts:
        return path_parts[0]  # First non-empty path segment
    return None

def matches_filter(url, path_filter):
    """Check if URL matches the path filter"""
    if not path_filter:
        return True
    
    parsed = urlparse(url)
    path_parts = [part for part in parsed.path.split('/') if part]
    return path_parts and path_parts[0] == path_filter

def deduplicate_by_url_compact(data, input_url, output_file=None, verbose=True):
    """
    Deduplicate scraped data by URL and output in compact format, sorted by URL
    Filters results to match the same game/section as the input URL
    
    Args:
        data: List of scraped items
        input_url: The original input URL to extract filter from
        output_file: Optional output file path
        verbose: Whether to print progress information
    
    Returns:
        Deduplicated data list
    """
    if verbose:
        print(f"Original data: {len(data)} items")
    
    # Get path filter from input URL
    path_filter = get_path_filter(input_url)
    if verbose:
        print(f"Path filter: '{path_filter}' (from input URL: {input_url})")
    
    # Track seen URLs
    seen_urls = set()
    deduplicated = []
    duplicates_removed = 0
    filtered_removed = 0
    
    for item in data:
        if 'url' in item:
            # Check if URL matches the filter
            if not matches_filter(item['url'], path_filter):
                filtered_removed += 1
                continue
            
            normalized_url = normalize_url(item['url'])
            
            if normalized_url not in seen_urls:
                seen_urls.add(normalized_url)
                deduplicated.append(item)
            else:
                duplicates_removed += 1
                if verbose:
                    print(f"✗ Duplicate URL: {item['url']}")
        else:
            # Item has no URL, keep it
            deduplicated.append(item)
            if verbose:
                print(f"⚠ No URL found, keeping item")
    
    # Sort by URL
    if verbose:
        print(f"\nSorting {len(deduplicated)} items by URL...")
    
    deduplicated.sort(key=lambda x: x.get('url', ''))
    
    if verbose:
        print(f"Deduplication complete!")
        print(f"Original: {len(data)} items")
        print(f"Filtered out: {filtered_removed} items (wrong game/section)")
        print(f"Deduplicated: {len(deduplicated)} items")
        print(f"Removed: {duplicates_removed} duplicates")
        print(f"Total reduction: {((filtered_removed + duplicates_removed) / len(data) * 100):.1f}%")
        print(f"Sorted by URL: ✅")
    
    # Save to file if specified
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            # Write each item on a single line
            for item in deduplicated:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')
        if verbose:
            print(f"Saved filtered and sorted compact deduplicated data to: {output_file}")
    
    return deduplicated

def main():
    parser = argparse.ArgumentParser(description='Compact deduplication by URL with game/section filtering')
    parser.add_argument('input_file', help='Input JSON file with scraped data')
    parser.add_argument('input_url', help='Original input URL to extract filter from')
    parser.add_argument('-o', '--output', help='Output file (default: input_file_compact.json)')
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
            output_file = f"{base_name}_compact.json"
        
        # Deduplicate
        deduplicated = deduplicate_by_url_compact(data, args.input_url, output_file, verbose=not args.quiet)
        
        print(f"\n✅ Compact deduplication successful!")
        print(f"📁 Output: {output_file}")
        print(f"📝 Format: One JSON object per line, sorted by URL")
        print(f"🎯 Filtered to match: {get_path_filter(args.input_url)}")
        
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