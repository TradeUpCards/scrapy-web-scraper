#!/usr/bin/env python3
"""
Simple deduplication script for scraped data
Removes duplicate entries based on URL only
"""

import json
import argparse
import sys
from urllib.parse import urlparse

def normalize_url(url):
    """Normalize URL by removing fragments and query parameters"""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

def deduplicate_by_url(data, output_file=None, verbose=True):
    """
    Deduplicate scraped data by URL only
    
    Args:
        data: List of scraped items
        output_file: Optional output file path
        verbose: Whether to print progress information
    
    Returns:
        Deduplicated data list
    """
    if verbose:
        print(f"Original data: {len(data)} items")
    
    # Track seen URLs
    seen_urls = set()
    deduplicated = []
    duplicates_removed = 0
    
    for item in data:
        if 'url' in item:
            normalized_url = normalize_url(item['url'])
            
            if normalized_url not in seen_urls:
                seen_urls.add(normalized_url)
                deduplicated.append(item)
                if verbose:
                    print(f"✓ Kept: {item['url']}")
            else:
                duplicates_removed += 1
                if verbose:
                    print(f"✗ Duplicate URL: {item['url']}")
        else:
            # Item has no URL, keep it
            deduplicated.append(item)
            if verbose:
                print(f"⚠ No URL found, keeping item")
    
    if verbose:
        print(f"\nDeduplication complete!")
        print(f"Original: {len(data)} items")
        print(f"Deduplicated: {len(deduplicated)} items")
        print(f"Removed: {duplicates_removed} duplicates")
        print(f"Reduction: {(duplicates_removed / len(data) * 100):.1f}%")
    
    # Save to file if specified
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(deduplicated, f, indent=2, ensure_ascii=False)
        if verbose:
            print(f"Saved deduplicated data to: {output_file}")
    
    return deduplicated

def main():
    parser = argparse.ArgumentParser(description='Simple deduplication by URL')
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
        deduplicated = deduplicate_by_url(data, output_file, verbose=not args.quiet)
        
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