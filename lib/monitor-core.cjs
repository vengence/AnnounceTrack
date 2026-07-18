const crypto = require("node:crypto");

const MAX_DETAIL_TEXT_CHARS = 300_000;
const MAX_DETAIL_RAW_CHARS = 120_000;
const MAX_DETAIL_HTML_CHARS = 400_000;

function parseMaybeJson(body) {
  if (!body) return null;
  const text = String(body).trim().replace(/^\uFEFF/, "");
  try { return JSON.parse(text); } catch (_error) {
    const open = text.indexOf("(");
    const close = text.lastIndexOf(")");
    if (open > 0 && close > open) {
      try { return JSON.parse(text.slice(open + 1, close)); } catch (_jsonpError) { return null; }
    }
    return null;
  }
}

function getByPath(root, path) {
  if (!path) return undefined;
  if (["$", "dom.text", "dom.links", "dom.blocks", "dom.embeddedDetails", "dom.regions"].includes(path)) return root;
  const tokens = path
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map((part) => part.replace(/\\u002e/g, "."));
  return tokens.reduce((value, token) => value == null ? undefined : value[token], root);
}

function responseMatches(response, matcher = {}) {
  if (matcher.method && response.method && matcher.method.toUpperCase() !== response.method.toUpperCase()) return false;
  let url;
  try { url = new URL(response.url); } catch (_error) { return false; }
  if (matcher.origin && matcher.origin !== url.origin) return false;
  if (matcher.path && matcher.path !== url.pathname) return false;
  for (const [key, value] of Object.entries(matcher.stableQuery || {})) {
    if (url.searchParams.get(key) !== String(value)) return false;
  }
  return true;
}

function extractList(plan, capture, baseUrl) {
  if (plan.sourceType === "dom_blocks") {
    return (capture.dom?.blocks || [])
      .filter((item) => item.title && (!plan.extraction.domSignature || item.signature === plan.extraction.domSignature))
      .map((item, index) => normalizeItem({
        id: item.id,
        title: item.title,
        date: formatDate(item.date),
        type: item.name || "",
        url: resolveUrl(item.href, baseUrl),
        raw: item,
        position: index
      }))
      .slice(0, 100);
  }
  if (plan.sourceType === "dom") {
    return (capture.dom?.links || [])
      .filter((item) => item.text && item.href && (!plan.extraction.domSignature || item.signature === plan.extraction.domSignature))
      .map((item, index) => normalizeItem({
        id: inferIdFromUrl(item.href),
        title: item.text,
        date: item.date || "",
        type: "",
        url: item.href,
        raw: item,
        position: index
      }))
      .slice(0, 100);
  }

  const responses = prioritizeResponses(capture.responses || [], plan.requestMatcher);
  for (const response of responses) {
    const parsed = parseMaybeJson(response.body);
    if (parsed == null) continue;
    const collection = getByPath(parsed, plan.extraction.collectionPath);
    if (!Array.isArray(collection)) continue;
    const records = collection.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (!records.length) continue;
    return records.slice(0, 100).map((record, index) => normalizeItem({
      id: stringify(fieldValue(record, plan.extraction.idField)),
      title: stringify(fieldValue(record, plan.extraction.titleField)),
      date: formatDate(fieldValue(record, plan.extraction.dateField)),
      type: stringify(fieldValue(record, plan.extraction.typeField)),
      url: resolveUrl(fieldValue(record, plan.extraction.urlField), baseUrl),
      raw: compactRaw(record),
      position: index
    })).filter((item) => item.title);
  }
  return [];
}

function extractDetail(plan, capture, item = null) {
  if (plan.sourceType === "dom_region") {
    const regions = capture.dom?.regions || [];
    const region = regions.find((entry) => plan.extraction?.domId && entry.id === plan.extraction.domId)
      || regions.find((entry) => plan.extraction?.domSignature && entry.signature === plan.extraction.domSignature)
      || regions[0];
    if (!region) return null;
    const content = applyExclusions(String(region.text || "").trim(), plan.exclusions);
    if (content.length < 10) return null;
    return {
      title: region.title || capture.dom?.title || "页面内容",
      content: content.slice(0, MAX_DETAIL_TEXT_CHARS),
      html: detailHtml(region.html, content, capture.finalUrl, plan.exclusions),
      createdAt: "",
      updatedAt: "",
      metadata: [],
      raw: String(region.html || content).slice(0, MAX_DETAIL_RAW_CHARS)
    };
  }
  if (plan.sourceType === "dom_embedded") {
    const details = capture.dom?.embeddedDetails || [];
    const values = { ...(item?.raw || {}), id: item?.id || "", title: item?.title || "", date: item?.date || "" };
    const expectedId = applyTemplate(plan.extraction?.itemIdTemplate || "", values);
    const detail = details.find((entry) => expectedId && entry.id === expectedId)
      || details.find((entry) => plan.extraction?.domId && entry.id === plan.extraction.domId)
      || details.find((entry) => item?.id && entry.id.includes(String(item.id)));
    if (!detail) return null;
    const content = applyExclusions(String(detail.text || "").trim(), plan.exclusions);
    return {
      title: detail.title || item?.title || "公告正文",
      content: content.slice(0, MAX_DETAIL_TEXT_CHARS),
      html: detailHtml(detail.html, content, capture.finalUrl, plan.exclusions),
      createdAt: formatDate(detail.date || item?.date),
      updatedAt: "",
      metadata: [],
      raw: String(detail.html || content).slice(0, MAX_DETAIL_RAW_CHARS)
    };
  }
  if (plan.sourceType === "dom") {
    const content = applyExclusions(String(capture.dom?.text || "").trim(), plan.exclusions);
    return {
      title: capture.dom?.headings?.[0] || capture.dom?.title || "公告正文",
      content: content.slice(0, MAX_DETAIL_TEXT_CHARS),
      html: escapeHtml(content).replace(/\n/g, "<br>"),
      createdAt: "",
      updatedAt: "",
      metadata: [],
      raw: content.slice(0, MAX_DETAIL_RAW_CHARS)
    };
  }
  const responses = prioritizeResponses(capture.responses || [], plan.requestMatcher);
  for (const response of responses) {
    const parsed = parseMaybeJson(response.body);
    if (parsed == null) continue;
    const raw = getByPath(parsed, plan.extraction.contentPath);
    if (typeof raw !== "string" || raw.length < 10) continue;
    const title = stringify(getByPath(parsed, plan.extraction.titlePath)) || capture.dom?.headings?.[0] || capture.dom?.title || "公告正文";
    return {
      title,
      content: applyExclusions(htmlToText(raw), plan.exclusions).slice(0, MAX_DETAIL_TEXT_CHARS),
      html: detailHtml(raw, applyExclusions(htmlToText(raw), plan.exclusions), capture.finalUrl, plan.exclusions),
      createdAt: formatDate(getByPath(parsed, plan.extraction.createdAtPath)),
      updatedAt: formatDate(getByPath(parsed, plan.extraction.updatedAtPath)),
      metadata: (plan.extraction.metadataPaths || []).map((entry) => ({
        label: entry.label || "其他信息",
        value: applyValueMap(getByPath(parsed, entry.path), entry.valueMap)
      })).filter((item) => item.value),
      raw: String(raw).slice(0, MAX_DETAIL_RAW_CHARS)
    };
  }
  return null;
}

function normalizeItem(item) {
  const normalized = {
    id: String(item.id || "").trim(),
    title: String(item.title || "").replace(/\s+/g, " ").trim(),
    date: String(item.date || "").trim(),
    type: String(item.type || "").trim(),
    url: canonicalUrl(item.url),
    raw: item.raw || {},
    position: Number(item.position || 0)
  };
  normalized.identity = announcementIdentity(normalized);
  normalized.metadataHash = hash([normalized.title, normalized.date, normalized.type, normalized.url].join("\n"));
  return normalized;
}

function announcementIdentity(item) {
  if (item.id) return `id:${item.id}`;
  if (item.url) return `url:${canonicalUrl(item.url)}`;
  return `fingerprint:${hash(`${normalizeText(item.title)}|${normalizeText(item.date)}|${normalizeText(item.type)}`)}`;
}

function compareLists(previous = [], current = []) {
  const previousMap = new Map(previous.map((item) => [item.identity, item]));
  const currentMap = new Map(current.map((item) => [item.identity, item]));
  const added = current.filter((item) => !previousMap.has(item.identity));
  const removed = previous.filter((item) => !currentMap.has(item.identity));
  const metadataChanged = current.filter((item) => {
    const old = previousMap.get(item.identity);
    return old && old.metadataHash !== item.metadataHash;
  }).map((item) => ({ before: previousMap.get(item.identity), after: item }));
  const sameSet = !added.length && !removed.length && previous.length === current.length;
  const orderChanged = sameSet && previous.some((item, index) => current[index]?.identity !== item.identity);
  return { added, removed, metadataChanged, orderChanged };
}

function resolveDetailUrl(task, item) {
  if (task.plan?.detail?.sourceType === "dom_embedded" || task.plan?.relation?.detailInteraction === "click_item") return task.listUrl;
  if (item.url) return item.url;
  const template = task.plan?.relation?.detailUrlTemplate || "";
  if (!template) return "";
  const values = { ...(item.raw || {}), id: item.id, title: item.title, date: item.date, type: item.type };
  const result = template.replace(/\{([^{}]+)\}/g, (_match, key) => {
    const value = fieldValue(values, key);
    return value == null ? "" : encodeURIComponent(String(value));
  });
  try {
    const url = new URL(result, task.listUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function normalizeExclusions(exclusions) {
  if (Array.isArray(exclusions)) return exclusions.map((value) => String(value || "").trim()).filter((value) => value.length >= 2).slice(0, 30);
  return String(exclusions || "").split(/\n{2,}/).map((value) => value.trim()).filter((value) => value.length >= 2).slice(0, 30);
}

function applyExclusions(content, exclusions) {
  let result = String(content || "");
  for (const value of normalizeExclusions(exclusions)) result = result.split(value).join("");
  return result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function detailHtml(rawHtml, content, baseUrl, exclusions) {
  if (normalizeExclusions(exclusions).length) return escapeHtml(content).replace(/\n/g, "<br>");
  return sanitizeHtml(rawHtml || escapeHtml(content).replace(/\n/g, "<br>"), baseUrl);
}

function applyTemplate(template, values) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, key) => {
    const value = fieldValue(values, key);
    return value == null ? "" : String(value);
  });
}

function buildDetailUrlTemplate(detailUrl, item) {
  const record = item?.raw && typeof item.raw === "object" ? item.raw : item;
  if (!detailUrl || !record || typeof record !== "object") return "";
  let template = String(detailUrl);
  const entries = Object.entries(record)
    .filter(([, value]) => ["string", "number"].includes(typeof value))
    .filter(([, value]) => String(value).length >= 2)
    .sort((a, b) => String(b[1]).length - String(a[1]).length);
  for (const [key, value] of entries) {
    const raw = String(value);
    const encoded = encodeURIComponent(raw);
    if (template.includes(raw)) template = template.split(raw).join(`{${key}}`);
    else if (template.includes(encoded)) template = template.split(encoded).join(`{${key}}`);
  }
  return /\{[^{}]+\}/.test(template) ? template : "";
}

function detailFingerprint(detail) {
  return hash([
    normalizeText(detail.title),
    normalizeText(detail.createdAt),
    normalizeText(detail.updatedAt),
    normalizeText(detail.content),
    ...(detail.metadata || []).map((item) => `${normalizeText(item.label)}:${normalizeText(item.value)}`)
  ].join("\n"));
}

function createTextDiff(before = "", after = "") {
  const oldText = String(before || "");
  const newText = String(after || "");
  if (oldText === newText) return { changed: false, before: "", after: "", summary: "" };
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix += 1;
  const oldChanged = oldText.slice(prefix, oldText.length - suffix).trim();
  const newChanged = newText.slice(prefix, newText.length - suffix).trim();
  const contextStart = Math.max(0, prefix - 120);
  const contextEndOld = Math.min(oldText.length, oldText.length - suffix + 120);
  const contextEndNew = Math.min(newText.length, newText.length - suffix + 120);
  return {
    changed: true,
    before: oldText.slice(contextStart, contextEndOld).slice(0, 3000),
    after: newText.slice(contextStart, contextEndNew).slice(0, 3000),
    removed: oldChanged.slice(0, 1800),
    added: newChanged.slice(0, 1800),
    summary: `删除或替换 ${oldChanged.length} 字，新增或替换 ${newChanged.length} 字`
  };
}

function isFormattingOnlyChange(before = "", after = "") {
  const normalize = (value) => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  const oldValue = normalize(before);
  const newValue = normalize(after);
  return Boolean(oldValue && oldValue === newValue);
}

function prioritizeResponses(responses, matcher) {
  const matched = responses.filter((response) => responseMatches(response, matcher));
  return matched.length ? matched : responses;
}

function fieldValue(record, field) {
  if (!field) return "";
  return field.includes(".") ? getByPath(record, field) : record?.[field];
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function applyValueMap(value, valueMap = {}) {
  if (value == null || value === "") return "";
  const parts = Array.isArray(value) ? value : String(value).split(/[,，|]/).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => valueMap[String(part)] ?? part).join("、");
}

function formatDate(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  if (/^\d{10,19}$/.test(text)) return formatTimestamp(Number(text));
  if (/T\d{1,2}:\d{2}/.test(text) && /(Z|[+\-]\d{2}:?\d{2})$/i.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return formatTimestamp(parsed.getTime());
  }
  const parts = text.match(/^(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})(?:日)?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!parts) return text;
  const date = `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
  return parts[4] ? `${date} ${parts[4].padStart(2, "0")}:${parts[5]}:${parts[6] || "00"}` : date;
}

function formatTimestamp(value) {
  let milliseconds = value;
  while (milliseconds >= 100_000_000_000_000) milliseconds /= 1000;
  if (milliseconds < 100_000_000_000) milliseconds *= 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function htmlToText(value) {
  return decodeEntities(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim());
}

function sanitizeHtml(value, baseUrl = "") {
  const source = String(value || "");
  if (!/[<>]/.test(source)) return escapeHtml(source).replace(/\n/g, "<br>");
  return source
    .replace(/<(script|style|noscript|iframe|object|embed|form|svg|math|template|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|noscript|iframe|object|embed|form|svg|math|template|link|meta|base)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s(?:on\w+|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])([^"']+)\2/gi, (match, attribute, quote, target) => {
      const allowed = attribute.toLowerCase() === "src"
        ? /^(https?:|data:image\/(?:png|gif|jpe?g|webp);|#)/i
        : /^(https?:|mailto:|tel:|#)/i;
      if (allowed.test(target)) return match;
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) return "";
      try {
        const resolved = new URL(target, baseUrl);
        return ["http:", "https:"].includes(resolved.protocol) ? ` ${attribute}=${quote}${resolved.toString()}${quote}` : "";
      } catch (_error) {
        return "";
      }
    })
    .slice(0, MAX_DETAIL_HTML_CHARS);
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/&nbsp;|\u00a0/g, "").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function canonicalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|spm|source|from|timestamp|_t|token|sign)/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = url.hash.replace(/([?&])(utm_[^=&]+|spm|source|from|timestamp|_t|token|sign)=[^&]*/gi, "$1").replace(/[?&]+$/, "");
    return url.toString();
  } catch (_error) {
    return String(value);
  }
}

function resolveUrl(value, base) {
  if (!value) return "";
  try {
    const url = new URL(String(value), base);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch (_error) { return ""; }
}

function inferIdFromUrl(value) {
  try {
    const url = new URL(value);
    for (const key of ["id", "docId", "articleId", "noticeId", "newsId", "itemId"]) {
      if (url.searchParams.get(key)) return url.searchParams.get(key);
    }
    const hashQuery = url.hash.split("?")[1] || "";
    const hashParams = new URLSearchParams(hashQuery);
    for (const key of ["id", "docId", "articleId", "noticeId", "newsId", "itemId"]) {
      if (hashParams.get(key)) return hashParams.get(key);
    }
    return [...url.pathname.split("/").filter(Boolean)].reverse().find((part) => /^\d{2,}$/.test(part)) || "";
  } catch (_error) { return ""; }
}

function compactRaw(value, depth = 0) {
  if (depth > 3 || value == null) return value;
  if (["string", "number", "boolean"].includes(typeof value)) return typeof value === "string" ? value.slice(0, 500) : value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => compactRaw(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, compactRaw(item, depth + 1)]));
  }
  return "";
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

module.exports = {
  announcementIdentity,
  buildDetailUrlTemplate,
  canonicalUrl,
  compareLists,
  createTextDiff,
  detailFingerprint,
  escapeHtml,
  extractDetail,
  extractList,
  formatDate,
  getByPath,
  hash,
  isFormattingOnlyChange,
  normalizeText,
  parseMaybeJson,
  resolveDetailUrl,
  applyExclusions,
  responseMatches,
  sanitizeHtml
};
