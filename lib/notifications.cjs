const { escapeHtml } = require("./monitor-core.cjs");

async function sendWechat(webhook, task, event) {
  if (!webhook) throw new Error("企业微信 Webhook 未配置");
  const url = new URL(webhook);
  if (url.protocol !== "https:") throw new Error("企业微信 Webhook 必须使用 HTTPS");
  const typeLabel = eventTypeLabel(event.type);
  const eventUrl = safeHttpUrl(event.url);
  const lines = [
    `### ${escapeMarkdown(typeLabel)} · ${escapeMarkdown(task.name)}`,
    `> **公告：** ${escapeMarkdown(event.title || "未命名公告")}`,
    event.summary ? `> **摘要：** ${escapeMarkdown(event.summary)}` : "",
    eventUrl ? `[查看原公告](${escapeMarkdownUrl(eventUrl)})` : "",
    `<font color=\"comment\">发现于 ${formatLocal(event.createdAt)}</font>`
  ].filter(Boolean);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content: lines.join("\n") } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Number(payload.errcode || 0) !== 0) {
    throw new Error(payload.errmsg || `企业微信发送失败（${response.status}）`);
  }
  return payload;
}

async function sendEmail(config, task, event, version) {
  const nodemailer = require("nodemailer");
  validateEmailConfig(config);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port || (config.secure ? 465 : 587)),
    secure: Boolean(config.secure),
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000
  });
  const subject = `【${eventTypeLabel(event.type)}】${task.name} · ${event.title || "公告更新"}`;
  const html = buildEmailHtml(task, event, version);
  const text = buildEmailText(task, event, version);
  return transporter.sendMail({
    from: config.from || config.user,
    to: config.to,
    subject,
    text,
    html
  });
}

function buildEmailHtml(task, event, version) {
  const eventUrl = safeHttpUrl(event.url);
  const metadata = (version?.metadata || []).map((item) => `<span style="display:inline-block;margin-right:18px;color:#59645c"><b>${escapeHtml(item.label)}：</b>${escapeHtml(item.value)}</span>`).join("");
  const removed = clipDiffText(event.diff?.removed, 1200);
  const added = clipDiffText(event.diff?.added, 1200);
  const diff = event.diff?.changed ? `
    <div style="margin:22px 0;padding:16px 18px;background:#fffaf0;border:1px solid #ead9af;border-radius:10px">
      <div style="font-weight:700;margin-bottom:8px">版本差异（仅展示变化片段）</div>
      <div style="color:#7d3f0a;white-space:pre-wrap;margin-bottom:${removed || added ? "14px" : "0"}">${escapeHtml(event.summary || event.diff.summary)}</div>
      ${removed ? `<div style="margin-top:9px"><div style="font-size:12px;font-weight:700;color:#a33b32;margin-bottom:5px">− 删除或替换</div><div style="padding:10px 12px;background:#fff0ee;border-radius:7px;color:#7e2f29;white-space:pre-wrap">${escapeHtml(removed)}</div></div>` : ""}
      ${added ? `<div style="margin-top:9px"><div style="font-size:12px;font-weight:700;color:#267044;margin-bottom:5px">＋ 新增或替换</div><div style="padding:10px 12px;background:#eaf6ee;border-radius:7px;color:#245b38;white-space:pre-wrap">${escapeHtml(added)}</div></div>` : ""}
      <div style="margin-top:10px;color:#8b8171;font-size:12px">为控制邮件长度，每侧最多展示 1,200 字；公告全文仅展示当前版本。</div>
    </div>` : "";
  const emptyBody = task.monitorMode === "list_only" ? "此任务仅监控公告列表变化，不采集详情正文。" : task.type === "page" ? "未能获取页面监控区域内容" : "未能获取公告全文";
  const body = version?.html ? sanitizeEmailHtml(version.html) : `<div style="white-space:pre-wrap">${escapeHtml(version?.content || emptyBody)}</div>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f5f3;color:#18201a;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
    <div style="max-width:820px;margin:0 auto;padding:32px 18px">
      <div style="background:#fff;border:1px solid #dfe4df;border-radius:14px;overflow:hidden">
        <div style="padding:26px 30px;border-bottom:1px solid #e5e9e5">
          <div style="font-size:12px;color:#69736c;margin-bottom:9px">${escapeHtml(task.name)} · ${escapeHtml(eventTypeLabel(event.type))}</div>
          <h1 style="font-size:24px;line-height:1.4;margin:0 0 13px">${escapeHtml(event.title || "公告更新")}</h1>
          <div style="font-size:13px;color:#59645c;line-height:1.8">${metadata}</div>
          ${event.summary ? `<p style="font-size:15px;line-height:1.8;margin:18px 0 0"><b>摘要：</b>${escapeHtml(event.summary)}</p>` : ""}
          ${eventUrl ? `<p style="margin:15px 0 0"><a href="${escapeHtml(eventUrl)}" style="color:#166534">查看原公告</a></p>` : ""}
        </div>
        <div style="padding:4px 30px 34px;line-height:1.85;font-size:14px">
          ${diff}
          <div style="margin-top:24px">${body}</div>
        </div>
      </div>
      <p style="text-align:center;color:#8a938c;font-size:12px">由公告监控助手于 ${formatLocal(event.createdAt)} 采集</p>
    </div>
  </body></html>`;
}

function buildEmailText(task, event, version) {
  const eventUrl = safeHttpUrl(event.url);
  const diffText = event.diff?.changed ? [
    "版本差异（仅展示变化片段，每侧最多 1,200 字）",
    event.diff.removed ? `- 删除或替换：\n${clipDiffText(event.diff.removed, 1200)}` : "",
    event.diff.added ? `+ 新增或替换：\n${clipDiffText(event.diff.added, 1200)}` : ""
  ].filter(Boolean).join("\n\n") : "";
  return [
    `${task.name} · ${eventTypeLabel(event.type)}`,
    event.title,
    event.summary ? `摘要：${event.summary}` : "",
    eventUrl ? `原公告：${eventUrl}` : "",
    diffText,
    "",
    version?.content || (task.monitorMode === "list_only" ? "此任务仅监控公告列表变化，不采集详情正文。" : task.type === "page" ? "未能获取页面监控区域内容" : "未能获取公告全文")
  ].filter(Boolean).join("\n");
}

function clipDiffText(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…（变化片段已截断）`;
}

function validateEmailConfig(config = {}) {
  if (!config.host) throw new Error("SMTP 服务器未配置");
  if (!config.to) throw new Error("收件人未配置");
  if (!config.from && !config.user) throw new Error("发件人未配置");
}

function eventTypeLabel(type) {
  return ({
    announcement_created: "新公告",
    announcement_date_changed: "公告日期变化，可能存在更新",
    content_updated: "公告内容更新",
    metadata_updated: "公告信息更新",
    order_changed: "公告顺序变化",
    collection_failed: "监控异常",
    collection_config_invalid: "采集配置可能失效",
    authentication_expired: "登录已失效",
    collection_recovered: "监控恢复"
  })[type] || "公告变化";
}

function formatLocal(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

function escapeMarkdown(value) {
  return String(value || "").replace(/[>*_`#\[\]]/g, "\\$&");
}

function escapeMarkdownUrl(value) {
  return String(value || "").replace(/[()\\\s]/g, (character) => encodeURIComponent(character));
}

function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function sanitizeEmailHtml(value) {
  return String(value || "")
    .replace(/<(script|style|noscript|iframe|object|embed|form|svg|math|template|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|noscript|iframe|object|embed|form|svg|math|template|link|meta|base)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s(?:on\w+|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("|')\s*(?:javascript:|vbscript:|data:(?!image\/(?:png|gif|jpe?g|webp);))[^"']*\2/gi, "");
}

module.exports = { buildEmailHtml, buildEmailText, eventTypeLabel, safeHttpUrl, sanitizeEmailHtml, sendEmail, sendWechat };
