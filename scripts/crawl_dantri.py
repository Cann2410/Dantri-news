
import json
import re
import time
import hashlib
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES_FILE = ROOT / "js" / "categories.json"
POSTS_FILE = ROOT / "data" / "posts.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
    ),
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
}

MAX_PER_CATEGORY = 10
REQUEST_DELAY = 1.2
session = requests.Session()
session.headers.update(HEADERS)


def read_json(path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def flatten_categories(items):
    result = []

    for item in items:
        if not isinstance(item, dict):
            continue

        if item.get("url"):
            result.append(item)

        result.extend(flatten_categories(item.get("children", [])))

    return result


def get_soup(url):
    try:
        response = session.get(url, timeout=25)
        response.raise_for_status()

        if "text/html" not in response.headers.get("Content-Type", ""):
            print("Bỏ qua nội dung không phải HTML:", url)
            return None

        return BeautifulSoup(response.text, "html.parser")
    except requests.RequestException as error:
        print(f"Không truy cập được {url}: {error}")
        return None


def meta_content(soup, *selectors):
    for selector in selectors:
        element = soup.select_one(selector)

        if not element:
            continue

        value = element.get("content") or element.get_text(" ", strip=True)

        if value:
            return value.strip()

    return ""


def is_article_url(url):
    parsed = urlparse(url)

    if parsed.scheme != "https" or parsed.hostname not in {
        "dantri.com.vn",
        "www.dantri.com.vn",
    }:
        return False

    path = parsed.path.lower()

    # Bỏ trang chuyên mục, tìm kiếm, video và các URL không phải bài .htm.
    return path.endswith(".htm") and not any(
        part in path
        for part in ("/tim-kiem/", "/video/", "/multimedia/")
    )


def find_article_links(soup, base_url):
    links = []
    seen = set()

    for anchor in soup.select("a[href]"):
        href = urljoin(base_url, anchor.get("href", "").strip())
        parsed = urlparse(href)
        normalized = parsed._replace(query="", fragment="").geturl()

        if is_article_url(normalized) and normalized not in seen:
            seen.add(normalized)
            links.append(normalized)

    return links


def extract_category_from_url(url, categories):
    path_parts = [
        part for part in urlparse(url).path.split("/") if part
    ]

    if not path_parts:
        return ""

    section_slug = path_parts[0].lower()

    for category in categories:
        category_url = category.get("url", "")
        category_path = urlparse(category_url).path.strip("/").lower()

        if category_path and category_path == section_slug:
            return category.get("title", "")

    return ""


def extract_article(url, categories, default_category=""):
    soup = get_soup(url)

    if soup is None:
        return None

    title = meta_content(
        soup,
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        "h1",
    )

    if not title:
        print("Không tìm thấy tiêu đề, bỏ qua:", url)
        return None

    excerpt = meta_content(
        soup,
        'meta[property="og:description"]',
        'meta[name="description"]',
    )

    image = meta_content(
        soup,
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
    )

    author = meta_content(
        soup,
        'meta[name="author"]',
        'meta[property="article:author"]',
        '[rel="author"]',
    )

    published = meta_content(
        soup,
        'meta[property="article:published_time"]',
        'meta[name="pubdate"]',
        'meta[name="date"]',
        "time[datetime]",
    )

    if published:
        published = published.replace("T", " ")
        published = re.sub(r"(Z|[+-]\d{2}:\d{2})$", "", published)[:16]

    body = ""
    for selector in (
        '[itemprop="articleBody"]',
        ".singular-content",
        ".article-content",
        ".detail-content",
        "article",
    ):
        element = soup.select_one(selector)

        if element:
            for unwanted in element.select(
                "script, style, figure, .related-news, .social-share"
            ):
                unwanted.decompose()

            candidate = element.get_text("\n", strip=True)

            if len(candidate) > len(body):
                body = candidate

    if not body:
        body = excerpt

    filename = urlparse(url).path.rsplit("/", 1)[-1]
    match = re.search(r"(\d{10,})", filename)

    article_id = (
        "dtri-" + match.group(1)
        if match
        else "dtri-" + hashlib.sha1(url.encode()).hexdigest()[:14]
    )

    slug = re.sub(r"\.htm(l)?$", "", filename, flags=re.I)
    category = extract_category_from_url(url, categories) or default_category

    return {
        "id": article_id,
        "title": title,
        "slug": slug,
        "excerpt": excerpt,
        "content": body,
        "author": author,
        "category": category,
        "publishedAt": published,
        "source": "dantri.com.vn",
        "url": url,
        "image": image,
    }


def main():
    category_data = read_json(CATEGORIES_FILE, {})
    menu = category_data if isinstance(category_data, list) else category_data.get("menu", [])
    categories = flatten_categories(menu)

    old_data = read_json(POSTS_FILE, {"posts": []})
    old_posts = old_data.get("posts", []) if isinstance(old_data, dict) else []
    by_url = {
        post.get("url"): post
        for post in old_posts
        if isinstance(post, dict) and post.get("url")
    }

    if not categories:
        raise SystemExit("Không tìm thấy chuyên mục có URL trong categories.json")

    for category in categories:
        category_url = category.get("url", "")
        category_title = category.get("title", "")

        if not category_url.startswith("https://dantri.com.vn/"):
            continue

        print(f"\nĐang xử lý chuyên mục: {category_title}")
        soup = get_soup(category_url)

        if soup is None:
            continue

        article_urls = find_article_links(soup, category_url)
        count = 0

        for article_url in article_urls:
            if count >= MAX_PER_CATEGORY:
                break

            # Không tải lại bài đã có trong JSON.
            if article_url in by_url:
                continue

            time.sleep(REQUEST_DELAY)
            post = extract_article(
                article_url,
                categories,
                default_category=category_title,
            )

            if not post:
                continue

            # Chỉ lưu bài có tiêu đề và nội dung thực sự đọc được.
            if not post["title"] or not post["content"]:
                print("Bỏ qua bài thiếu nội dung:", article_url)
                continue

            by_url[article_url] = post
            count += 1
            print(f"Đã thu thập ({count}/{MAX_PER_CATEGORY}): {post['title']}")

    POSTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    posts = sorted(
        by_url.values(),
        key=lambda post: post.get("publishedAt", ""),
        reverse=True,
    )

    with POSTS_FILE.open("w", encoding="utf-8") as file:
        json.dump({"posts": posts}, file, ensure_ascii=False, indent=2)

    print(f"\nHoàn tất. Tổng số bài trong JSON: {len(posts)}")


if __name__ == "__main__":
    main()
