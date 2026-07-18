const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MonitorStore } = require("../lib/store.cjs");
const { AnnouncementRuntime, isInQuietHours, nextAllowedRunAt, resolveQuietHours } = require("../lib/runtime.cjs");
const { buildDetailUrlTemplate, extractDetail, extractList, formatDate, isFormattingOnlyChange } = require("../lib/monitor-core.cjs");
const { buildEmailHtml, buildEmailText, safeHttpUrl, sanitizeEmailHtml } = require("../lib/notifications.cjs");

test("公告运行时静默建立基线，并只为新增和正文更新生成事件", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "announcement-monitor-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  let list = [
    { id: 1, title: "公告一", modified: 1783939234 },
    { id: 2, title: "公告二", modified: 1783939234 }
  ];
  const details = new Map([
    ["1", { title: "公告一", content: "公告一的正文内容，第一版正文。" }],
    ["2", { title: "公告二", content: "公告二的正文内容，第一版正文。" }],
    ["3", { title: "公告三", content: "公告三是一条新增公告，这是它的完整正文内容。" }]
  ]);
  const captureCalls = [];
  const capture = async (url) => {
    captureCalls.push(url);
    if (url.includes("/list")) return jsonCapture({ data: { items: list } }, url);
    const id = url.split("/").pop();
    return jsonCapture({ data: details.get(id) }, url);
  };
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture,
    summarize: async ({ eventType }) => ({ summary: eventType === "announcement_created" ? "新增公告摘要" : "正文更新摘要", importance: "important", wechatRecommended: true }),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (task) => task,
    emit: () => {}
  });
  const task = testTask();
  await store.update((data) => data.tasks.push(task));

  await runtime.runTask(task.id, "test");
  let state = store.snapshot();
  assert.equal(state.announcements.length, 2);
  assert.equal(state.events.length, 0);
  assert.equal(captureCalls.filter((url) => url.includes("/detail/")).length, 2);
  assert.equal(state.versions.length, 2);

  list = [...list, { id: 3, title: "公告三", modified: 1783939234 }];
  await runtime.runTask(task.id, "test");
  state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "announcement_created").length, 1);
  assert.equal(state.versions.filter((version) => version.title === "公告三").length, 1);
  assert.equal(notifications.length, 1);

  details.set("3", { title: "公告三", content: "公告三的正文已经更新，增加了一项重要执行要求。" });
  await store.update((data) => {
    data.tasks[0].auditCursor = 2;
    data.tasks[0].nextAuditAt = new Date(0).toISOString();
  });
  await runtime.runTask(task.id, "test");
  state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "content_updated").length, 1);
  assert.equal(notifications.length, 2);
  assert.equal(state.runs.filter((run) => run.status === "success").length, 3);

  await store.update((data) => { data.tasks[0].consecutiveFailures = 3; data.tasks[0].lastExceptionAlertAt = new Date().toISOString(); });
  await runtime.runTask(task.id, "test");
  state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "collection_recovered").length, 1);
  assert.equal(state.tasks[0].consecutiveFailures, 0);
  assert.equal(notifications.length, 3);

  await fs.rm(directory, { recursive: true, force: true });
});

test("仅列表模式不采集详情，并通知新增公告和日期变化", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "announcement-list-only-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  let list = [
    { id: 1, title: "公告一", date: "2026-07-01", url: "https://site.example.com/custom/a" },
    { id: 2, title: "公告二", date: "2026-07-02", url: "https://other.example.net/different/b" }
  ];
  const captureCalls = [];
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async (url) => { captureCalls.push(url); return jsonCapture({ data: { items: list } }, url); },
    summarize: async () => { throw new Error("仅列表模式不应调用大模型总结"); },
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (task) => task,
    emit: () => {}
  });
  const task = testTask();
  task.monitorMode = "list_only";
  task.plan.list.extraction.dateField = "date";
  task.plan.list.extraction.urlField = "url";
  task.plan.detail = null;
  await store.update((data) => data.tasks.push(task));

  await runtime.runTask(task.id, "test");
  let state = store.snapshot();
  assert.equal(state.versions.length, 0);
  assert.equal(state.events.length, 0);

  list = [
    { ...list[0], date: "2026-07-18" },
    list[1],
    { id: 3, title: "公告三", date: "2026-07-18", url: "https://third.example.org/news/3" }
  ];
  await runtime.runTask(task.id, "test");
  state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "announcement_created").length, 1);
  assert.equal(state.events.filter((event) => event.type === "announcement_date_changed").length, 1);
  assert.match(state.events.find((event) => event.type === "announcement_date_changed").summary, /可能存在内容更新/);
  assert.equal(notifications.length, 2);
  assert.equal(captureCalls.length, 2);

  await fs.rm(directory, { recursive: true, force: true });
});

test("详情地址模板与多种时间戳格式可跨平台复用", () => {
  const template = buildDetailUrlTemplate(
    "https://open.example.com/#/detail?listId=851&itemId=1101514",
    { id: 1101514, articleChannelId: 851, title: "示例" }
  );
  assert.equal(template, "https://open.example.com/#/detail?listId={articleChannelId}&itemId={id}");
  assert.equal(formatDate(1783939234), formatDate(1783939234000));
  assert.equal(formatDate(1783939234000), formatDate(1783939234000000));
  assert.match(formatDate("2026/7/13 8:04"), /^2026-07-13 08:04:00$/);
});

test("无链接重复 DOM 列表可关联同页面内嵌详情", () => {
  const capture = {
    finalUrl: "https://open.example.com/notices",
    dom: {
      title: "平台公告",
      text: "公告列表",
      headings: [],
      links: [],
      blocks: [
        { id: "137", name: "notice", title: "国补凭证API上传操作指导", date: "2025-02-20", href: "", signature: "li > ul.notice-list" },
        { id: "144", name: "notice", title: "关于适配平台识别码调整通知", date: "2026-01-12", href: "", signature: "li > ul.notice-list" }
      ],
      embeddedDetails: [
        { id: "notice137", title: "国补凭证API上传操作指导", date: "2025-02-20", text: "这是国补凭证接口的完整操作指导正文。", html: "<p>这是国补凭证接口的完整操作指导正文。</p>" },
        { id: "notice144", title: "关于适配平台识别码调整通知", date: "2026-01-12", text: "这是平台识别码调整通知的完整正文。", html: "<p>这是平台识别码调整通知的完整正文。</p>" }
      ]
    },
    responses: []
  };
  const listPlan = { sourceType: "dom_blocks", extraction: { domSignature: "li > ul.notice-list" } };
  const detailPlan = { sourceType: "dom_embedded", extraction: { itemIdTemplate: "notice{id}", domId: "notice137" } };
  const list = extractList(listPlan, capture, capture.finalUrl);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "137");
  assert.equal(list[0].url, "");
  const detail = extractDetail(detailPlan, capture, list[1]);
  assert.equal(detail.title, "关于适配平台识别码调整通知");
  assert.match(detail.content, /完整正文/);
});

test("只过滤标点和排版变化，事实文字变化仍保留", () => {
  assert.equal(isFormattingOnlyChange("接口将于 7 月 1 日上线。", "接口将于7月1日上线!"), true);
  assert.equal(isFormattingOnlyChange("接口将于7月1日上线", "接口将于7月2日上线"), false);
});

test("登录会话失效会立即生成专项告警", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "announcement-auth-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  const task = testTask();
  task.authentication = { enabled: true, sessionKey: "test" };
  await store.update((data) => data.tasks.push(task));
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async () => ({ finalUrl: "https://passport.example.com/login", dom: { title: "账号登录", text: "用户名 密码 登录", links: [], blocks: [], embeddedDetails: [] }, responses: [] }),
    summarize: async () => ({}),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (value) => value,
    emit: () => {}
  });
  await assert.rejects(() => runtime.runTask(task.id, "test"), /登录会话已失效/);
  const state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "authentication_expired").length, 1);
  assert.equal(notifications.length, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test("暂停抓取时段支持跨午夜，并把下次时间推到时段结束", () => {
  const quietHours = { enabled: true, start: "00:00", end: "08:00" };
  assert.equal(isInQuietHours(quietHours, new Date(2026, 6, 18, 3, 20)), true);
  assert.equal(isInQuietHours(quietHours, new Date(2026, 6, 18, 9, 0)), false);
  const overnight = { enabled: true, start: "23:00", end: "06:30" };
  assert.equal(isInQuietHours(overnight, new Date(2026, 6, 18, 23, 30)), true);
  assert.equal(isInQuietHours(overnight, new Date(2026, 6, 19, 5, 45)), true);
  assert.equal(isInQuietHours(overnight, new Date(2026, 6, 19, 9, 0)), false);
  const next = new Date(nextAllowedRunAt(overnight, new Date(2026, 6, 18, 23, 30)));
  assert.equal(next.getDate(), 19);
  assert.equal(next.getHours(), 6);
  assert.equal(next.getMinutes(), 30);
});

test("任务可继承、覆盖或关闭全局暂停抓取时段", () => {
  const globalQuiet = { enabled: true, start: "01:00", end: "07:30" };
  assert.deepEqual(resolveQuietHours({ mode: "global" }, globalQuiet), globalQuiet);
  assert.deepEqual(resolveQuietHours({ mode: "custom", start: "23:00", end: "06:00" }, globalQuiet), { enabled: true, start: "23:00", end: "06:00" });
  assert.equal(resolveQuietHours({ mode: "disabled" }, globalQuiet).enabled, false);
});

test("首次详情失败会在后续运行补齐基线且不误发更新通知", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "announcement-backfill-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  let failSecondDetail = true;
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async (url) => {
      if (url.includes("/list")) return jsonCapture({ data: { items: [{ id: 1, title: "公告一" }, { id: 2, title: "公告二" }] } }, url);
      if (url.endsWith("/2") && failSecondDetail) { failSecondDetail = false; throw new Error("详情临时超时"); }
      const id = url.split("/").pop();
      return jsonCapture({ data: { title: `公告${id}`, content: `这是公告${id}的稳定正文内容。` } }, url);
    },
    summarize: async () => ({}),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (value) => value,
    emit: () => {}
  });
  const task = testTask();
  await store.update((data) => data.tasks.push(task));
  await runtime.runTask(task.id, "test");
  assert.equal(store.snapshot().versions.length, 1);
  await runtime.runTask(task.id, "test");
  const state = store.snapshot();
  assert.equal(state.versions.length, 2);
  assert.equal(state.events.length, 0);
  assert.equal(notifications.length, 0);
  await fs.rm(directory, { recursive: true, force: true });
});

test("页面监控静默保存首版，并在事实内容变化时生成版本和通知", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "page-monitor-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  let content = "这是当前页面需要监控的区域内容，执行日期为七月一日。";
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async (url) => ({
      finalUrl: url,
      dom: { title: "服务状态", text: content, headings: [], links: [], blocks: [], regions: [{ id: "status", signature: "section.status", title: "服务状态", text: content, html: `<p>${content}</p>` }] },
      responses: []
    }),
    summarize: async () => ({ summary: "页面执行日期和要求发生变化。", shouldNotify: true, importance: "normal", wechatRecommended: true }),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (value) => value,
    emit: () => {}
  });
  const task = {
    ...testTask(), type: "page", monitorMode: "page_region", regionName: "服务状态",
    plan: { page: { sourceType: "dom_region", requestMatcher: {}, extraction: { contentPath: "dom.regions", domId: "status", domSignature: "section.status" } } }
  };
  await store.update((data) => data.tasks.push(task));
  await runtime.runTask(task.id, "test");
  assert.equal(store.snapshot().versions.length, 1);
  assert.equal(store.snapshot().events.length, 0);
  content = "这是当前页面需要监控的区域内容，执行日期改为七月二日。";
  await runtime.runTask(task.id, "test");
  const state = store.snapshot();
  assert.equal(state.versions.length, 2);
  assert.equal(state.events.filter((event) => event.type === "content_updated").length, 1);
  assert.equal(notifications.length, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test("连续无法按方案提取时发送采集配置失效告警", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "config-invalid-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  const task = testTask();
  await store.update((data) => data.tasks.push(task));
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async (url) => jsonCapture({ data: { renamedItems: [] } }, url),
    summarize: async () => ({}),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (value) => value,
    getAlertPolicy: () => ({ enabled: true, failureThreshold: 2, cooldownMinutes: 360, configurationInvalid: true }),
    emit: () => {}
  });
  await assert.rejects(() => runtime.runTask(task.id, "test"), /可能已经变化/);
  await assert.rejects(() => runtime.runTask(task.id, "test"), /可能已经变化/);
  const state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "collection_config_invalid").length, 1);
  assert.equal(notifications.length, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test("公告列表正常但全部详情失效时也会触发采集配置告警", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "detail-config-invalid-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  const task = testTask();
  await store.update((data) => data.tasks.push(task));
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async (url) => url.includes("/list")
      ? jsonCapture({ data: { items: [{ id: 1, title: "公告一" }] } }, url)
      : jsonCapture({ data: { renamedContent: "详情接口字段已变化" } }, url),
    summarize: async () => ({}),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (value) => value,
    getAlertPolicy: () => ({ enabled: true, failureThreshold: 2, cooldownMinutes: 360, configurationInvalid: true }),
    emit: () => {}
  });
  await assert.rejects(() => runtime.runTask(task.id, "test"), /公告详情均无法按原方案提取/);
  await assert.rejects(() => runtime.runTask(task.id, "test"), /公告详情均无法按原方案提取/);
  const state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "collection_config_invalid").length, 1);
  assert.equal(notifications.length, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test("邮件更新通知只展示受限的差异片段，不嵌入前后两个完整版本", () => {
  const event = {
    type: "content_updated", title: "公告更新", summary: "执行时间和接口范围发生变化。", createdAt: new Date().toISOString(),
    diff: { changed: true, removed: "旧".repeat(2000), added: "新".repeat(2000), summary: "内容变化" }
  };
  const task = { name: "测试任务", monitorMode: "list_and_detail" };
  const version = { content: "当前正文", metadata: [] };
  const html = buildEmailHtml(task, event, version);
  const text = buildEmailText(task, event, version);
  assert.match(html, /版本差异（仅展示变化片段）/);
  assert.match(html, /变化片段已截断/);
  assert.ok(html.length < 8000);
  assert.match(text, /每侧最多 1,200 字/);
  assert.ok(text.length < 4000);
});

test("历史正文和公告链接在界面与邮件使用前会清理危险内容", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("https://example.com/notice?id=1"), "https://example.com/notice?id=1");
  const cleaned = sanitizeEmailHtml('<script>alert(1)</script><p onclick="alert(2)" style="position:fixed">正文</p><a href="javascript:alert(3)">链接</a>');
  assert.doesNotMatch(cleaned, /script|onclick|position:fixed|javascript:/i);
  assert.match(cleaned, /正文/);
});

test("监控数据保留策略限制历史版本和大字段，并使用紧凑 JSON", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "announcement-store-retention-test-"));
  const filePath = path.join(directory, "data.json");
  const store = new MonitorStore(filePath);
  await store.initialize();
  const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await store.update((data) => {
    data.announcements.push({ id: "announcement-1", taskId: "task-1", title: "测试公告" });
    for (let index = 0; index < 28; index += 1) {
      data.versions.push({
        id: `version-${index}`,
        announcementId: "announcement-1",
        createdAt: index === 27 ? new Date().toISOString() : oldTime,
        content: `正文 ${index}`,
        raw: "原始响应",
        html: "<p>正文</p>"
      });
    }
  });
  const view = store.view();
  assert.equal(view.versions.length, 20);
  assert.equal(view.versions.filter((item) => item.raw || item.html).length, 1);
  assert.strictEqual(store.view(), view, "内部只读视图不应复制完整历史");
  const serialized = await fs.readFile(filePath, "utf8");
  assert.doesNotMatch(serialized, /\n\s+\"tasks\"/);
  await fs.rm(directory, { recursive: true, force: true });
});

test("抓取异常达到全局阈值才提醒，并受重复提醒间隔限制", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "announcement-failure-policy-test-"));
  const store = new MonitorStore(path.join(directory, "data.json"));
  await store.initialize();
  const task = testTask();
  await store.update((data) => data.tasks.push(task));
  const notifications = [];
  const runtime = new AnnouncementRuntime({
    store,
    capture: async () => { throw new Error("网络超时"); },
    summarize: async () => ({}),
    notify: async (_task, event) => { notifications.push(event); return []; },
    revealTask: (value) => value,
    getAlertPolicy: () => ({ enabled: true, failureThreshold: 3, cooldownMinutes: 360, collectionFailed: true }),
    emit: () => {}
  });
  for (let index = 0; index < 4; index += 1) await assert.rejects(() => runtime.runTask(task.id, "test"), /网络超时/);
  let state = store.snapshot();
  assert.equal(state.tasks[0].consecutiveFailures, 4);
  assert.equal(state.events.filter((event) => event.type === "collection_failed").length, 1);
  assert.equal(notifications.length, 1);
  await store.update((data) => { data.tasks[0].lastFailureAlertAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); });
  await assert.rejects(() => runtime.runTask(task.id, "test"), /网络超时/);
  state = store.snapshot();
  assert.equal(state.events.filter((event) => event.type === "collection_failed").length, 2);
  assert.equal(notifications.length, 2);
  await fs.rm(directory, { recursive: true, force: true });
});

function jsonCapture(payload, url) {
  return {
    finalUrl: url,
    dom: { title: "", text: "", headings: [], links: [] },
    responses: [{ url: "https://api.example.com/data", method: "GET", body: JSON.stringify(payload) }]
  };
}

function testTask() {
  return {
    id: "task-1",
    name: "测试公告",
    type: "announcement",
    enabled: true,
    status: "idle",
    frequencyMinutes: 15,
    listUrl: "https://site.example.com/list",
    plan: {
      list: {
        sourceType: "network_json",
        requestMatcher: {},
        extraction: { collectionPath: "$.data.items", idField: "id", titleField: "title", dateField: "modified", typeField: "", urlField: "" }
      },
      detail: {
        sourceType: "network_json",
        requestMatcher: {},
        extraction: { contentPath: "$.data.content", titlePath: "$.data.title", idPath: "", createdAtPath: "", updatedAtPath: "", metadataPaths: [] }
      },
      relation: { detailUrlTemplate: "https://site.example.com/detail/{id}" }
    },
    notifications: { wechat: { enabled: false }, email: { enabled: false } },
    createdAt: new Date().toISOString(),
    nextRunAt: new Date().toISOString()
  };
}
