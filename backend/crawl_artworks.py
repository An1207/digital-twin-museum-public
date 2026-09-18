#!/usr/bin/env python3
"""
Artwork Crawling Script
Downloads 500 art images from Cleveland Museum of Art (primary) and Met Museum (secondary) APIs.
"""

import os
import re
import csv
import time
import random
import requests
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from runtime_config import IMAGE_ROOT_DIR, MANIFEST_ROOT_DIR

# === CONFIGURATION ===
BACKEND_DIR = Path(__file__).resolve().parent
IMAGE_DIR = IMAGE_ROOT_DIR / "artworks"
META_DIR = MANIFEST_ROOT_DIR
TARGET_COUNT = 500
DELAY_MIN = 0.4
DELAY_MAX = 0.8

# API Endpoints
CMA_API = "https://openaccess-api.clevelandart.org/api/artworks"
MET_API_SEARCH = "https://collectionapi.metmuseum.org/public/collection/v1/search"
MET_API_OBJECT = "https://collectionapi.metmuseum.org/public/collection/v1/objects"

# Search keywords - expanded list for 500 images
KEYWORDS = [
    # Original 20
    "impressionism",
    "renaissance portrait",
    "landscape painting",
    "rococo portrait",
    "dutch master",
    "baroque painting",
    "japanese print",
    "religious painting",
    "neoclassical art",
    "romantic landscape",
    "seurat",
    "munch",
    "cassatt",
    "pissarro",
    "ingres",
    "turner",
    "monet landscape",
    "van gogh drawing",
    "egyptian relief",
    "byzantine icon",
    # Additional 30+ for diversity
    "french landscape",
    "italian renaissance",
    "flemish painting",
    "american landscape",
    "english painting",
    "spanish painting",
    "flemish master",
    "german painting",
    "antwerp master",
    "portrait painting",
    "oil painting",
    "watercolor landscape",
    "marble sculpture",
    "bronze sculpture",
    "terracotta relief",
    "tapestry medieval",
    "illumination manuscript",
    "woodcut print",
    "etching portrait",
    "lithograph art",
    "chiaroscuro painting",
    "genre painting",
    "allegorical painting",
    "mythological painting",
    "historical painting",
    "marine painting",
    "still life painting",
    "flower painting",
    "animal painting",
    "architectural view",
    "cityscape painting",
    "sunset painting",
    "moonlight painting",
    "storm painting",
    "autumn landscape",
    "spring landscape",
    "summer landscape",
    "winter landscape",
    "river landscape",
    "mountain landscape",
    "seascape painting",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}


def to_image_relative_path(path: Path) -> str:
    return str(path.resolve().relative_to(IMAGE_ROOT_DIR.resolve()))


def delay():
    """Random delay between requests."""
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def slugify(text, max_len=50):
    """Convert text to ASCII slug."""
    if not text:
        return "unknown"
    # Lowercase, replace spaces/special chars with hyphens
    slug = text.lower()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[-\s]+', '-', slug)
    slug = slug.strip('-')
    # Truncate
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip('-')
    return slug if slug else "unknown"


def get_existing_files():
    """Scan existing artwork2_* files and return (max_seq, filenames_set, seen_keys_set)."""
    existing = {}
    seen_keys = set()
    pattern = re.compile(r'artwork2_(\w+)_(\d+)_.*\.jpg$')

    for f in IMAGE_DIR.glob("artwork2_*"):
        m = pattern.match(f.name)
        if m:
            source, seq = m.group(1), int(m.group(2))
            existing[f.name] = (source, seq)
            seen_keys.add(f"{m.group(1)}_{m.group(2)}")

    max_seq = max((seq for _, (_, seq) in existing.items()), default=5)
    return max_seq, existing, seen_keys


def fetch_cma_artworks(keyword):
    """Fetch artworks from Cleveland Museum of Art API."""
    params = {
        "q": keyword,
        "has_image": 1,
        "cc0": None,  # CC0 only
        "limit": 100,
        "fields": "id,title,creators,images,share_license_status,is_public_domain,url,type",
    }
    try:
        resp = requests.get(CMA_API, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
    except Exception as e:
        print(f"  [CMA API Error] {keyword}: {e}")
        return []


def fetch_met_object(object_id):
    """Fetch single object from Met API."""
    try:
        resp = requests.get(f"{MET_API_OBJECT}/{object_id}", headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        return None


def fetch_met_artworks(keyword):
    """Fetch artworks from Met Museum API (search then fetch objects)."""
    params = {
        "q": keyword,
        "hasImages": True,
        "isPublicDomain": True,
    }
    try:
        resp = requests.get(MET_API_SEARCH, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        search_data = resp.json()
        object_ids = search_data.get("objectIDs", [])[:50]  # Limit per keyword

        results = []
        for oid in object_ids:
            delay()
            obj = fetch_met_object(oid)
            if obj and obj.get("primaryImage") and obj.get("isPublicDomain"):
                results.append(obj)
            if len(results) >= 30:  # Max 30 per keyword from Met
                break
        return results
    except Exception as e:
        print(f"  [Met API Error] {keyword}: {e}")
        return []


def extract_cma_info(artwork):
    """Extract relevant info from CMA artwork."""
    creators = artwork.get("creators", [])
    artist_name = creators[0].get("name", "Unknown") if creators else "Unknown"
    birth = creators[0].get("birth_time", "") if creators else ""
    death = creators[0].get("death_time", "") if creators else ""
    if birth and death:
        date_str = f"{birth}-{death}"
    elif birth:
        date_str = str(birth)
    else:
        date_str = ""

    images = artwork.get("images", {})
    image_url = images.get("web", {}).get("url") or images.get("print", {}).get("url") or images.get("full", {}).get("url")

    return {
        "id": str(artwork.get("id", "")),
        "title": artwork.get("title", "Untitled"),
        "artist": artist_name,
        "date_str": date_str,
        "image_url": image_url,
        "url": artwork.get("url", ""),
        "is_public_domain": artwork.get("is_public_domain", False) or artwork.get("share_license_status") == "CC0",
    }


def extract_met_info(artwork):
    """Extract relevant info from Met artwork."""
    artist = artwork.get("artistDisplayName", "Unknown")
    birth = artwork.get("artistBeginDate", "")
    death = artwork.get("artistEndDate", "")
    if birth and death:
        date_str = f"{birth}-{death}"
    elif birth:
        date_str = str(birth)
    else:
        date_str = ""

    return {
        "id": str(artwork.get("objectID", "")),
        "title": artwork.get("title", "Untitled"),
        "artist": artist,
        "date_str": date_str,
        "image_url": artwork.get("primaryImage", ""),
        "url": artwork.get("objectURL", ""),
        "is_public_domain": artwork.get("isPublicDomain", False),
    }


def generate_filename(source, seq, artist, title):
    """Generate standardized filename."""
    artist_slug = slugify(artist, 40)
    title_slug = slugify(title, 50)
    return f"artwork2_{source}_{seq:03d}_{artist_slug}_{title_slug}.jpg"


def download_image(url, filepath):
    """Download image to file. Returns True on success."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        content = resp.content
        # Verify it's likely an image
        if len(content) < 1000:
            return False
        with open(filepath, "wb") as f:
            f.write(content)
        return True
    except Exception as e:
        print(f"  [Download Error] {url}: {e}")
        return False


def main():
    print("=" * 60)
    print("Artwork Crawling Script - 500 Images")
    print("=" * 60)

    # Ensure directories exist
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)

    # Get existing files
    max_seq, existing_files, seen_keys = get_existing_files()
    print(f"\nExisting files found: {len(existing_files)}")
    print(f"Starting sequence from: {max_seq + 1}")

    # Trackers
    next_seq = max_seq + 1
    seen_object_ids = set()  # source + id
    seen_filenames = set(existing_files.keys())
    downloaded = []
    success_count = 0
    fail_count = 0
    attempt_count = 0

    # CSV manifest
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = META_DIR / f"artwork_catalog_manifest_{timestamp}.csv"
    csv_fd = open(csv_path, "w", newline="", encoding="utf-8")
    csv_writer = csv.DictWriter(csv_fd, fieldnames=[
        "query", "source", "object_id", "title", "artist", "filename",
        "image_path", "object_url", "is_public_domain"
    ])
    csv_writer.writeheader()

    print(f"\nTarget: {TARGET_COUNT} new images")
    print(f"Output: {IMAGE_DIR}")
    print(f"Manifest: {csv_path}")
    print("-" * 60)

    # Iterate through keywords
    keyword_idx = 0
    while success_count < TARGET_COUNT and keyword_idx < len(KEYWORDS):
        keyword = KEYWORDS[keyword_idx]
        keyword_idx += 1

        print(f"\n[{keyword_idx}/{len(KEYWORDS)}] Query: '{keyword}'")

        # Try Cleveland first
        cma_results = fetch_cma_artworks(keyword)
        print(f"  CMA results: {len(cma_results)}")

        for artwork in cma_results:
            if success_count >= TARGET_COUNT:
                break

            attempt_count += 1
            info = extract_cma_info(artwork)

            if not info["image_url"]:
                continue

            # Deduplication
            key = f"cma_{info['id']}"
            if key in seen_object_ids:
                continue
            seen_object_ids.add(key)

            filename = generate_filename("cma", next_seq, info["artist"], info["title"])
            if filename in seen_filenames:
                continue
            seen_filenames.add(filename)

            filepath = IMAGE_DIR / filename
            print(f"  Downloading [{success_count + 1}/{TARGET_COUNT}]: {filename[:60]}...")

            delay()
            if download_image(info["image_url"], filepath):
                success_count += 1
                row = {
                    "query": keyword,
                    "source": "cma",
                    "object_id": info["id"],
                    "title": info["title"],
                    "artist": info["artist"],
                    "filename": filename,
                    "image_path": to_image_relative_path(filepath),
                    "object_url": info["url"],
                    "is_public_domain": info["is_public_domain"],
                }
                csv_writer.writerow(row)
                csv_fd.flush()
                downloaded.append(filename)
                next_seq += 1
            else:
                fail_count += 1

        # If CMA didn't fill all, try Met
        if success_count < TARGET_COUNT:
            delay()
            met_results = fetch_met_artworks(keyword)
            print(f"  Met results: {len(met_results)}")

            for artwork in met_results:
                if success_count >= TARGET_COUNT:
                    break

                attempt_count += 1
                info = extract_met_info(artwork)

                if not info["image_url"]:
                    continue

                # Deduplication
                key = f"met_{info['id']}"
                if key in seen_object_ids:
                    continue
                seen_object_ids.add(key)

                filename = generate_filename("met", next_seq, info["artist"], info["title"])
                if filename in seen_filenames:
                    continue
                seen_filenames.add(filename)

                filepath = IMAGE_DIR / filename
                print(f"  Downloading [{success_count + 1}/{TARGET_COUNT}]: {filename[:60]}...")

                delay()
                if download_image(info["image_url"], filepath):
                    success_count += 1
                    row = {
                        "query": keyword,
                        "source": "met",
                        "object_id": info["id"],
                        "title": info["title"],
                        "artist": info["artist"],
                        "filename": filename,
                        "image_path": to_image_relative_path(filepath),
                        "object_url": info["url"],
                        "is_public_domain": info["is_public_domain"],
                    }
                    csv_writer.writerow(row)
                    csv_fd.flush()
                    downloaded.append(filename)
                    next_seq += 1
                else:
                    fail_count += 1

        print(f"  Progress: {success_count}/{TARGET_COUNT} downloaded, {fail_count} failures")

    csv_fd.close()

    # Final summary
    print("\n" + "=" * 60)
    print("CRAWLING COMPLETE")
    print("=" * 60)

    # Verify actual file count
    actual_files = list(IMAGE_DIR.glob("artwork2_*"))
    actual_count = len(actual_files)

    print(f"""
NEW ADDITIONS:
  - Requested: {TARGET_COUNT}
  - Downloaded (new): {success_count}
  - Failed: {fail_count}
  - Total attempts: {attempt_count}

TOTAL FILES IN DIRECTORY:
  - artwork2_* files: {actual_count}
  - Existing before run: {max_seq}
  - Expected new: {actual_count - max_seq}

SOURCES USED:
  - Cleveland Museum of Art (cma)
  - Metropolitan Museum of Art (met)

METADATA:
  - Manifest file: {csv_path}

SAMPLE FILENAMES (first 10):
""")
    for fn in downloaded[:10]:
        print(f"  - {fn}")

    print(f"\nAll files saved to: {IMAGE_DIR}")
    print("Done!")


if __name__ == "__main__":
    main()
