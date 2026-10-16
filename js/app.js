
const POSTS_URL = "data/posts.json";
const CATEGORIES_URL = "js/categories.json";
const LOCAL_POSTS_KEY = "newsWebsitePosts";

let allPosts = [];
let allCategories = [];

const $ = (selector) => document.querySelector(selector);

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function getAllCategories(items = []) {
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

function getCategoryLabel(category) {
  if (Array.isArray(category)) return category.join(", ");
  return category || "Tin tức";
}

function getCategoryId(category) {
  const value = normalizeText(category);
  const found = allCategories.find((item) =>
    normalizeText(item.title) === value ||
    normalizeText(item.id) === value
  );
  return found ? found.id : "";
}

function getPostDate(post) {
  const date = new Date(String(post.publishedAt || "").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortNewest(posts) {
  return [...posts].sort((a, b) => getPostDate(b) - getPostDate(a));
}

function getPostId(post) {
  return String(post.id || post.slug || post.url || post.title || "");
}

function mergePosts(jsonPosts, savedPosts) {
  const map = new Map();

  [...jsonPosts, ...savedPosts].forEach((post) => {
    if (!post || !post.title) return;

    const key = getPostId(post);
    if (!key) return;

    map.set(key, { ...map.get(key), ...post });
  });

  return sortNewest([...map.values()]);
}

async function loadJSON(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Không thể đọc ${path}: HTTP ${response.status}`);
  }

  return response.json();
}

async function initializeSite() {
  if ($("#currentYear")) {
    $("#currentYear").textContent = new Date().getFullYear();
  }

  setupMobileMenu();

  try {
    const [categoryData, postData] = await Promise.all([
      loadJSON(CATEGORIES_URL),
      loadJSON(POSTS_URL)
    ]);

    const menu = Array.isArray(categoryData)
      ? categoryData
      : categoryData.menu || categoryData.categories || [];

    allCategories = getAllCategories(menu);

    let savedPosts = [];

    try {
      const stored = JSON.parse(localStorage.getItem(LOCAL_POSTS_KEY) || "[]");
      if (Array.isArray(stored)) savedPosts = stored;
    } catch {
      savedPosts = [];
    }

    const jsonPosts = Array.isArray(postData)
      ? postData
      : postData.posts || [];

    allPosts = mergePosts(jsonPosts, savedPosts);

    renderNavigation(menu);
    renderFooterCategories(menu);

    const params = new URLSearchParams(window.location.search);
    const articleId = params.get("id");
    const articleSlug = params.get("slug");

    if (articleId || articleSlug) {
      renderArticleDetail(articleId || articleSlug);
    } else {
      renderHome(params.get("category"));
    }
  } catch (error) {
    console.error(error);

    const featured = $("#featuredPosts");
    if (featured) {
      featured.innerHTML = `
        <p class="loading-message">
          Không tải được dữ liệu. Hãy kiểm tra file
          <strong>js/categories.json</strong> và
          <strong>data/posts.json</strong>.
        </p>`;
    }

    const list = $("#postList");
    if (list) list.innerHTML = "";

    const count = $("#postCount");
    if (count) count.textContent = "Lỗi tải dữ liệu";
  }
}

function setupMobileMenu() {
  const toggle = $("#menuToggle");
  const nav = $("#categoryMenu");

  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const opened = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(opened));
  });
}

function renderNavigation(menu) {
  const nav = $("#categoryMenu");
  if (!nav) return;

  const currentCategory = new URLSearchParams(location.search)
    .get("category");

  const homeLink = `
    <a href="index.html"
       class="${!currentCategory ? "active" : ""}">
      Trang chủ
    </a>`;

  const links = menu.map((item) => {
    const isActive = currentCategory === item.id;
    return `
      <a href="index.html?category=${encodeURIComponent(item.id)}"
         class="${isActive ? "active" : ""}">
        ${escapeHTML(item.title)}
      </a>`;
  }).join("");

  nav.innerHTML = homeLink + links;
}

function renderFooterCategories(menu) {
  const footer = $("#footerCategories");
  if (!footer) return;

  const selected = menu.slice(0, 6);

  footer.innerHTML = selected.map((item) => `
    <li>
      <a href="index.html?category=${encodeURIComponent(item.id)}">
        ${escapeHTML(item.title)}
      </a>
    </li>
  `).join("");
}

function getFilteredPosts(categoryId) {
  if (!categoryId) return sortNewest(allPosts);

  const category = allCategories.find((item) => item.id === categoryId);

  if (!category) return [];

  const targetNames = new Set([
    normalizeText(category.id),
    normalizeText(category.title)
  ]);

  return sortNewest(allPosts.filter((post) => {
    const values = Array.isArray(post.category)
      ? post.category
      : [post.category || ""];

    return values.some((value) => {
      const normalized = normalizeText(value);
      const mappedId = normalizeText(getCategoryId(value));

      return targetNames.has(normalized) ||
        targetNames.has(mappedId);
    });
  }));
}

function categoryLink(post) {
  const category = Array.isArray(post.category)
    ? post.category[0]
    : post.category;

  const id = getCategoryId(category);
  if (!id) return "";

  return `
    <a class="category-label"
       href="index.html?category=${encodeURIComponent(id)}">
      ${escapeHTML(category)}
    </a>`;
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return escapeHTML(value);

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getArticleURL(post) {
  const identifier = post.id || post.slug;

  return `index.html?${post.id
    ? "id=" + encodeURIComponent(post.id)
    : "slug=" + encodeURIComponent(identifier)}`;
}

function getImageHTML(post, className = "post-image") {
  if (!post.image) {
    return `<div class="${className} image-placeholder"
      role="img" aria-label="Bài viết chưa có ảnh"></div>`;
  }

  return `
    <img class="${className}"
      src="${escapeHTML(post.image)}"
      alt="${escapeHTML(post.title)}"
      loading="lazy"
      onerror="this.style.display='none'">
  `;
}

function renderHome(categoryId) {
  const posts = getFilteredPosts(categoryId);
  const category = allCategories.find((item) => item.id === categoryId);

  const pageTitle = category ? category.title : "Tin tức mới nhất";

  if ($("#pageTitle")) $("#pageTitle").textContent = pageTitle;
  if ($("#listHeading")) {
    $("#listHeading").textContent = category
      ? `Tin ${category.title}`
      : "Tin mới nhất";
  }
  if ($("#postCount")) {
    $("#postCount").textContent = `${posts.length} bài viết`;
  }

  const featuredSection = $("#featuredSection");
  const featuredContainer = $("#featuredPosts");
  const postList = $("#postList");
  const emptyMessage = $("#emptyMessage");

  if (!featuredContainer || !postList) return;

  if (posts.length === 0) {
    featuredContainer.innerHTML = "";
    postList.innerHTML = "";

    if (featuredSection) featuredSection.hidden = true;
    if (emptyMessage) emptyMessage.hidden = false;
    return;
  }

  if (featuredSection) featuredSection.hidden = false;
  if (emptyMessage) emptyMessage.hidden = true;

  const featured = posts.slice(0, 3);
  const remaining = posts.slice(3);

  featuredContainer.innerHTML = `
    <article class="featured-main">
      <a href="${getArticleURL(featured[0])}">
        ${getImageHTML(featured[0])}
      </a>
      ${categoryLink(featured[0])}
      <h2>
        <a href="${getArticleURL(featured[0])}">
          ${escapeHTML(featured[0].title)}
        </a>
      </h2>
      <p class="post-meta">
        ${escapeHTML(formatDate(featured[0].publishedAt))}
        ${featured[0].author
          ? " · " + escapeHTML(featured[0].author)
          : ""}
      </p>
      <p class="post-excerpt">
        ${escapeHTML(featured[0].excerpt || "")}
      </p>
    </article>

    <div class="featured-side">
      ${featured.slice(1).map((post) => `
        <article class="featured-side-card">
          <a href="${getArticleURL(post)}">
            ${getImageHTML(post)}
          </a>
          <div>
            ${categoryLink(post)}
            <h3>
              <a href="${getArticleURL(post)}">
                ${escapeHTML(post.title)}
              </a>
            </h3>
            <p class="post-meta">
              ${escapeHTML(formatDate(post.publishedAt))}
            </p>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  postList.innerHTML = remaining.map((post) => `
    <article class="post-card">
      <a href="${getArticleURL(post)}">
        ${getImageHTML(post)}
      </a>
      <div>
        ${categoryLink(post)}
        <h3>
          <a href="${getArticleURL(post)}">
            ${escapeHTML(post.title)}
          </a>
        </h3>
        <p class="post-meta">
          ${escapeHTML(formatDate(post.publishedAt))}
          ${post.author ? " · " + escapeHTML(post.author) : ""}
        </p>
        <p class="post-excerpt">
          ${escapeHTML(post.excerpt || "")}
        </p>
      </div>
    </article>
  `).join("");
}

function renderArticleDetail(identifier) {
  const post = allPosts.find((item) =>
    String(item.id) === identifier ||
    String(item.slug) === identifier
  );

  const main = $(".page-container");
  if (!main) return;

  if (!post) {
    main.innerHTML = `
      <p class="empty-message">
        Không tìm thấy bài viết. Bài viết có thể chưa được thêm
        vào dữ liệu JSON hoặc LocalStorage.
      </p>
      <p><a href="index.html">← Quay lại trang chủ</a></p>
    `;
    return;
  }

  document.title = `${post.title} | TIN TỨC`;

  const content = String(post.content || post.excerpt || "")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`)
    .join("");

  main.innerHTML = `
    <article class="article-detail">
      ${categoryLink(post)}
      <h1>${escapeHTML(post.title)}</h1>

      <p class="post-meta">
        ${post.author ? "Tác giả: " + escapeHTML(post.author) + " · " : ""}
        ${escapeHTML(formatDate(post.publishedAt))}
      </p>

      ${post.image ? getImageHTML(post, "article-cover") : ""}

      ${post.excerpt ? `
        <p class="post-excerpt">
          <strong>${escapeHTML(post.excerpt)}</strong>
        </p>` : ""}

      <div class="article-content">
        ${content || "<p>Nội dung bài viết chưa được cập nhật.</p>"}
      </div>

      ${post.url ? `
        <p class="source-link">
          Nguồn:
          <a href="${escapeHTML(post.url)}"
             target="_blank" rel="noopener noreferrer">
            ${escapeHTML(post.source || "dantri.com.vn")}
          </a>
        </p>` : ""}

      <p><a href="index.html">← Quay lại trang chủ</a></p>
    </article>
  `;
}

document.addEventListener("DOMContentLoaded", initializeSite);
