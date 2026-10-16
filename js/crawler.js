
const CRAWLER_CATEGORIES_URL = "js/categories.json";
const CRAWLER_STORAGE_KEY = "newsWebsitePosts";

let crawledArticle = null;
let crawlerCategories = [];

const crawlerById = (id) => document.getElementById(id);

function crawlerEscape(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function crawlerSlugify(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function crawlerSetStatus(message) {
  crawlerById("crawlerStatus").textContent = message;
}

function crawlerFlattenCategories(items = []) {
  const result = [];

  function walk(list) {
    list.forEach((item) => {
      result.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    });
  }

  walk(items);
  return result;
}

async function crawlerLoadCategories() {
  try {
    const response = await fetch(CRAWLER_CATEGORIES_URL);

    if (!response.ok) {
      throw new Error("Không đọc được js/categories.json");
    }

    const data = await response.json();
    const menu = Array.isArray(data) ? data : data.menu || [];
    crawlerCategories = crawlerFlattenCategories(menu);

    const select = crawlerById("postCategory");
    select.innerHTML = '<option value="">-- Chọn chuyên mục --</option>';

    crawlerCategories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.title;
      option.textContent = category.title;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
    crawlerSetStatus(
      "Không tải được danh mục. Hãy kiểm tra file js/categories.json."
    );
  }
}

/*
  Lưu ý: trình duyệt thường chặn việc đọc trực tiếp trang Dân trí
  từ GitHub Pages do chính sách CORS. Hàm này thử lấy HTML qua
  một proxy công khai. Proxy có thể ngừng hoạt động hoặc từ chối URL.
  Không tự bịa tác giả, ngày đăng hay nội dung nếu không đọc được.
*/
async function crawlerFetchHTML(articleUrl) {
  const parsed = new URL(articleUrl);

  if (
    parsed.protocol !== "https:" ||
    !/(^|\.)dantri\.com\.vn$/i.test(parsed.hostname)
  ) {
    throw new Error("Chỉ chấp nhận URL HTTPS thuộc dantri.com.vn.");
  }

  const proxies = [
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(articleUrl),
    "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(articleUrl)
  ];

  let lastError = null;

  for (const proxyUrl of proxies) {
    try {
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error("Proxy trả về HTTP " + response.status);
      }

      const html = await response.text();

      if (!html || html.length < 500) {
        throw new Error("HTML nhận được không đầy đủ.");
      }

      return html;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    "Không thể lấy HTML bài báo qua các proxy. " +
    "Có thể do CORS, giới hạn truy cập hoặc proxy không hoạt động. " +
    (lastError ? lastError.message : "")
  );
}

function crawlerMeta(documentObject, selectors) {
  for (const selector of selectors) {
    const element = documentObject.querySelector(selector);
    const value = element?.getAttribute("content") ||
      element?.textContent?.trim();

    if (value) return value.trim();
  }

  return "";
}

function crawlerExtractArticle(html, articleUrl) {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");

  const title = crawlerMeta(parsedDocument, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    "h1"
  ]);

  const excerpt = crawlerMeta(parsedDocument, [
    'meta[property="og:description"]',
    'meta[name="description"]'
  ]);

  const image = crawlerMeta(parsedDocument, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]'
  ]);

  const author = crawlerMeta(parsedDocument, [
    'meta[name="author"]',
    'meta[property="article:author"]',
    '[rel="author"]'
  ]);

  const publishedRaw = crawlerMeta(parsedDocument, [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
    'time[datetime]'
  ]);

  let publishedAt = "";

  if (publishedRaw) {
    const date = new Date(publishedRaw);

    if (!Number.isNaN(date.getTime())) {
      const pad = (number) => String(number).padStart(2, "0");

      publishedAt =
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
        `${pad(date.getDate())} ${pad(date.getHours())}:` +
        `${pad(date.getMinutes())}`;
    } else {
      publishedAt = publishedRaw;
    }
  }

  const contentSelectors = [
    "article",
    ".singular-content",
    ".article-content",
    ".detail-content",
    '[itemprop="articleBody"]'
  ];

  let content = "";

  for (const selector of contentSelectors) {
    const element = parsedDocument.querySelector(selector);

    if (element) {
      content = element.innerText.trim();
      if (content.length > 100) break;
    }
  }

  const pathParts = new URL(articleUrl).pathname.split("/").filter(Boolean);
  const categorySlug = pathParts.length > 1 ? pathParts[0] : "";

  const matchedCategory = crawlerCategories.find((category) =>
    crawlerSlugify(category.title) === crawlerSlugify(categorySlug)
  );

  const filename = pathParts[pathParts.length - 1] || "";
  const idMatch = filename.match(/(\d{10,})/);
  const id = idMatch
    ? "dtri-" + idMatch[1]
    : "dtri-" + crawlerSlugify(title || filename);

  const slug = crawlerSlugify(title || filename.replace(/\.htm(l)?$/i, ""));

  if (!title) {
    throw new Error(
      "Không tìm thấy tiêu đề trong HTML. Dữ liệu không được lưu."
    );
  }

  return {
    id,
    title,
    slug,
    excerpt,
    content,
    author,
    category: matchedCategory ? matchedCategory.title : "",
    publishedAt,
    source: "dantri.com.vn",
    url: articleUrl,
    image
  };
}

function crawlerFillForm(article) {
  crawlerById("postTitle").value = article.title || "";
  crawlerById("postSlug").value = article.slug || "";
  crawlerById("postExcerpt").value = article.excerpt || "";
  crawlerById("postContent").value = article.content || "";
  crawlerById("postAuthor").value = article.author || "";
  crawlerById("postDate").value = article.publishedAt || "";
  crawlerById("postImage").value = article.image || "";
  crawlerById("postSource").value = article.source || "dantri.com.vn";
  crawlerById("postOriginalUrl").value = article.url || "";

  const select = crawlerById("postCategory");

  if (article.category) {
    const match = [...select.options].find((option) =>
      option.textContent === article.category
    );

    if (match) select.value = match.value;
  }

  crawlerById("previewSection").hidden = false;
  crawlerRenderJSON();
}

function crawlerReadForm() {
  return {
    id: crawledArticle?.id || "dtri-" + Date.now(),
    title: crawlerById("postTitle").value.trim(),
    slug: crawlerById("postSlug").value.trim(),
    excerpt: crawlerById("postExcerpt").value.trim(),
    content: crawlerById("postContent").value.trim(),
    author: crawlerById("postAuthor").value.trim(),
    category: crawlerById("postCategory").value,
    publishedAt: crawlerById("postDate").value.trim(),
    source: crawlerById("postSource").value.trim(),
    url: crawlerById("postOriginalUrl").value.trim(),
    image: crawlerById("postImage").value.trim()
  };
}

function crawlerRenderJSON() {
  const article = crawlerReadForm();
  crawlerById("jsonOutput").textContent = JSON.stringify(article, null, 2);
}

async function crawlerHandleSubmit(event) {
  event.preventDefault();

  const articleUrl = crawlerById("articleUrl").value.trim();

  try {
    new URL(articleUrl);
  } catch {
    crawlerSetStatus("URL không hợp lệ.");
    return;
  }

  crawlerById("crawlButton").disabled = true;
  crawlerSetStatus("Đang thử lấy dữ liệu bài viết...");

  try {
    const html = await crawlerFetchHTML(articleUrl);
    crawledArticle = crawlerExtractArticle(html, articleUrl);
    crawlerFillForm(crawledArticle);

    crawlerSetStatus(
      "Đã lấy được một số thông tin. Hãy kiểm tra và bổ sung các trường còn thiếu trước khi lưu."
    );
  } catch (error) {
    console.error(error);
    crawlerSetStatus(error.message);
  } finally {
    crawlerById("crawlButton").disabled = false;
  }
}

function crawlerSaveArticle(event) {
  event.preventDefault();

  const article = crawlerReadForm();

  if (!article.title || !article.slug || !article.content ||
      !article.category || !article.publishedAt || !article.url) {
    crawlerSetStatus(
      "Hãy điền tiêu đề, slug, nội dung, chuyên mục, ngày đăng và URL bài viết."
    );
    return;
  }

  try {
    const parsedUrl = new URL(article.url);

    if (
      parsedUrl.protocol !== "https:" ||
      !/(^|\.)dantri\.com\.vn$/i.test(parsedUrl.hostname)
    ) {
      crawlerSetStatus("URL bài gốc phải thuộc dantri.com.vn.");
      return;
    }

    const saved = JSON.parse(
      localStorage.getItem(CRAWLER_STORAGE_KEY) || "[]"
    );

    if (!Array.isArray(saved)) {
      throw new Error("Dữ liệu LocalStorage không đúng định dạng.");
    }

    const index = saved.findIndex((item) =>
      item.url === article.url || item.id === article.id
    );

    if (index >= 0) {
      saved[index] = article;
    } else {
      saved.push(article);
    }

    localStorage.setItem(CRAWLER_STORAGE_KEY, JSON.stringify(saved));

    crawledArticle = article;
    crawlerRenderJSON();

    crawlerSetStatus(
      "Đã lưu bài viết vào LocalStorage của trình duyệt này. " +
      "Bài viết chưa được thêm vào file JSON trên GitHub."
    );
  } catch (error) {
    console.error(error);
    crawlerSetStatus("Không lưu được dữ liệu: " + error.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  crawlerLoadCategories();

  crawlerById("crawlerForm").addEventListener(
    "submit",
    crawlerHandleSubmit
  );

  crawlerById("articleForm").addEventListener(
    "submit",
    crawlerSaveArticle
  );

  crawlerById("showJsonButton").addEventListener("click", () => {
    crawlerRenderJSON();
    crawlerById("jsonSection").hidden = false;
  });
});
