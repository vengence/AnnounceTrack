const crypto = require("node:crypto");
const {
  compareLists,
  createTextDiff,
  detailFingerprint,
  extractDetail,
  extractList,
  isFormattingOnlyChange,
  resolveDetailUrl
} = require("./monitor-core.cjs");

class AnnouncementRuntime {
  constructor({ store, capture, summarize, notify, revealTask, getAlertPolicy, getDefaultQuietHours, emit }) {
    this.store = store;
    this.capture = capture;
    this.summarize = summarize;
    this.notify = notify;
    this.revealTask = revealTask;
    this.getAlertPolicy = getAlertPolicy || (() => ({}));
    this.getDefaultQuietHours = getDefaultQuietHours || (() => ({}));
    this.emit = emit || (() => {});
    this.queue = [];
    this.queued = new Set();
    this.running = false;
    this.activeTaskId = "";
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.enqueueDueTasks(), 30_000);
    this.timer.unref?.();
    this.enqueueDueTasks();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueueDueTasks() {
    const now = Date.now();
    const tasks = this.store.view().tasks
      .filter((task) => task.enabled && (!task.nextRunAt || Date.parse(task.nextRunAt) <= now))
      .sort((a, b) => Date.parse(a.nextRunAt || 0) - Date.parse(b.nextRunAt || 0));
    tasks.forEach((task) => this.enqueue(task.id, "schedule"));
  }

  enqueue(taskId, reason = "manual") {
    if (!taskId || this.queued.has(taskId) || this.activeTaskId === taskId) return false;
    this.queued.add(taskId);
    this.queue.push({ taskId, reason, queuedAt: new Date().toISOString() });
    this.emitState();
    this.drain();
    return true;
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        this.queued.delete(job.taskId);
        this.activeTaskId = job.taskId;
        await this.runTask(job.taskId, job.reason).catch(() => {});
        this.activeTaskId = "";
      }
    } finally {
      this.running = false;
      this.emitState();
    }
  }

  async runTask(taskId, reason) {
    let task = this.store.view().tasks.find((item) => item.id === taskId);
    if (!task || (!task.enabled && reason !== "manual")) return;
    const defaultQuietHours = await Promise.resolve(this.getDefaultQuietHours()).catch(() => ({}));
    const resolvedQuietHours = resolveQuietHours(task.quietHours, defaultQuietHours);
    if (reason !== "manual" && isInQuietHours(resolvedQuietHours)) {
      const nextAllowed = nextAllowedRunAt(resolvedQuietHours);
      await this.store.update((data) => {
        const stored = data.tasks.find((item) => item.id === taskId);
        if (stored) stored.nextRunAt = nextAllowed;
      });
      this.emit("run-skipped", { taskId, taskName: task.name, message: `处于暂停抓取时段，下次自动检查 ${formatLocalTime(nextAllowed)}` });
      return;
    }
    task = this.revealTask(task);
    const alertPolicy = normalizeAlertPolicy(await Promise.resolve(this.getAlertPolicy()).catch(() => ({})));
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const run = { id: runId, taskId, reason, startedAt, status: "running", listCount: 0, changeCount: 0, message: "" };
    await this.store.update((data) => {
      const stored = data.tasks.find((item) => item.id === taskId);
      if (stored) { stored.status = "running"; stored.lastRunAt = startedAt; }
      data.runs.push(run);
      return run;
    });
    this.emit("run-started", { taskId, taskName: task.name, runId, message: task.type === "page" ? "正在获取页面监控区域" : "正在获取公告列表" });

    try {
      if (task.type === "page") {
        await this.runPageTask(task, runId, resolvedQuietHours, alertPolicy);
        return;
      }
      const listCapture = await this.capture(task.listUrl, task.plan.list, "列表页", task);
      if (looksLikeExpiredLogin(task, listCapture)) throw authenticationExpiredError();
      const items = extractList(task.plan.list, listCapture, task.listUrl);
      if (!items.length) throw configurationInvalidError("获取方案没有提取到公告列表，页面结构或异步接口可能已经变化");
      const storedTask = this.store.view().tasks.find((item) => item.id === taskId);
      const previous = Array.isArray(storedTask?.lastListSnapshot) ? storedTask.lastListSnapshot : [];
      const baseline = previous.length === 0;
      const changes = compareLists(previous, items);
      const candidates = new Map();
      let auditScheduled = false;
      const detailEnabled = task.monitorMode !== "list_only" && Boolean(task.plan?.detail);
      if (baseline && detailEnabled) {
        items.forEach((item) => candidates.set(item.identity, { item, type: "detail_baseline" }));
      } else if (!baseline) {
        changes.added.forEach((item) => candidates.set(item.identity, { item, type: "announcement_created" }));
        changes.metadataChanged.forEach(({ before, after }) => {
          const type = before.date !== after.date ? "announcement_date_changed" : "metadata_updated";
          if (!candidates.has(after.identity)) candidates.set(after.identity, { item: after, type });
        });
      }

      let missingBaselineCount = 0;
      if (detailEnabled && !baseline) {
        const snapshot = this.store.view();
        const addedIds = new Set(changes.added.map((item) => item.identity));
        const missingBaselineItems = items.filter((item) => {
          if (addedIds.has(item.identity)) return false;
          const record = snapshot.announcements.find((entry) => entry.taskId === taskId && entry.identity === item.identity);
          return !record || !snapshot.versions.some((version) => version.announcementId === record.id);
        }).slice(0, 3);
        missingBaselineCount = missingBaselineItems.length;
        missingBaselineItems.forEach((item) => {
          if (!candidates.has(item.identity)) candidates.set(item.identity, { item, type: "detail_baseline" });
        });
      }

      if (detailEnabled && !baseline && missingBaselineCount === 0 && (!storedTask?.nextAuditAt || Date.parse(storedTask.nextAuditAt) <= Date.now())) {
        const auditItem = pickAuditItem(items, storedTask?.auditCursor || 0);
        if (auditItem && !candidates.has(auditItem.identity)) {
          candidates.set(auditItem.identity, { item: auditItem, type: "audit" });
          auditScheduled = true;
        }
      }

      const events = [];
      const detailStats = { attempted: 0, failed: 0 };
      if (!baseline && changes.orderChanged) {
        events.push(await this.recordOrderEvent(task, items));
      }

      for (const candidate of candidates.values()) {
        this.emit("run-progress", { taskId, taskName: task.name, runId, message: `正在检查：${candidate.item.title}` });
        const event = await this.processItem(task, candidate.item, candidate.type, baseline, listCapture, detailStats);
        if (event) events.push(event);
      }

      if (detailStats.attempted > 0 && detailStats.failed === detailStats.attempted) {
        throw configurationInvalidError(`本轮 ${detailStats.attempted} 条公告详情均无法按原方案提取，详情页结构或异步接口可能已经变化`);
      }

      const completedAt = new Date().toISOString();
      const recoveryEvent = !baseline && alertPolicy.enabled && alertPolicy.recovered && storedTask?.lastExceptionAlertAt ? {
        id: crypto.randomUUID(), taskId, announcementId: "", type: "collection_recovered",
        title: `${task.name} 已恢复监控`, summary: "公告列表已重新获取成功，定时监控恢复正常。", importance: "normal",
        url: task.listUrl, createdAt: completedAt
      } : null;
      if (recoveryEvent) events.push(recoveryEvent);
      await this.store.update((data) => {
        const currentTask = data.tasks.find((item) => item.id === taskId);
        if (currentTask) {
          currentTask.lastListSnapshot = items;
          currentTask.lastSuccessAt = completedAt;
          currentTask.status = "healthy";
          currentTask.lastError = "";
          currentTask.consecutiveFailures = 0;
          currentTask.authAlertedAt = "";
          currentTask.lastExceptionAlertAt = "";
          currentTask.lastExceptionAlertType = "";
          currentTask.lastFailureAlertAt = "";
          currentTask.lastConfigAlertAt = "";
          currentTask.lastAuthAlertAt = "";
          if ((baseline && detailEnabled) || auditScheduled) {
            currentTask.auditCursor = ((currentTask.auditCursor || 0) + 1) % Math.max(1, items.length);
            currentTask.nextAuditAt = nextAuditAt(currentTask.frequencyMinutes, items.length);
          }
          currentTask.nextRunAt = nextRunAt(currentTask.frequencyMinutes, resolvedQuietHours);
          currentTask.stats = {
            ...(currentTask.stats || {}),
            listCount: items.length,
            totalRuns: Number(currentTask.stats?.totalRuns || 0) + 1,
            totalEvents: Number(currentTask.stats?.totalEvents || 0) + events.filter(Boolean).length
          };
        }
        items.forEach((item) => {
          const existing = data.announcements.find((record) => record.taskId === taskId && record.identity === item.identity);
          if (existing) {
            existing.lastSeenAt = completedAt;
            existing.title = item.title;
            existing.date = item.date;
            existing.type = item.type;
            if (item.url) existing.url = item.url;
          } else {
            data.announcements.push({
              id: crypto.randomUUID(), taskId, identity: item.identity,
              title: item.title, url: item.url, date: item.date, type: item.type,
              firstSeenAt: completedAt, lastSeenAt: completedAt,
              lastVersionHash: "", versionCount: 0
            });
          }
        });
        const currentRun = data.runs.find((item) => item.id === runId);
        if (currentRun) Object.assign(currentRun, {
          status: "success",
          completedAt,
          listCount: items.length,
          changeCount: events.filter(Boolean).length,
          message: baseline ? `已静默建立基线，共 ${items.length} 条公告` : events.length ? `发现 ${events.length} 项变化` : "没有发现变化"
        });
        if (recoveryEvent) data.events.push(recoveryEvent);
      });
      if (recoveryEvent) await this.deliver(task, recoveryEvent, null);
      this.emit("run-completed", { taskId, taskName: task.name, runId, baseline, listCount: items.length, changeCount: events.length });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      const authenticationExpired = error?.code === "AUTHENTICATION_EXPIRED";
      const configurationInvalid = error?.code === "COLLECTION_RULE_INVALID";
      let failureEvent = null;
      await this.store.update((data) => {
        const currentTask = data.tasks.find((item) => item.id === taskId);
        if (currentTask) {
          const previousFailures = Number(currentTask.consecutiveFailures || 0);
          currentTask.consecutiveFailures = previousFailures + 1;
          currentTask.status = "error";
          currentTask.lastError = message;
          currentTask.nextRunAt = nextRunAt(currentTask.frequencyMinutes, resolvedQuietHours);
          if (authenticationExpired && alertPolicy.enabled && alertPolicy.authenticationExpired && cooldownElapsed(currentTask.lastAuthAlertAt, alertPolicy.cooldownMinutes, completedAt)) {
            currentTask.authAlertedAt = completedAt;
            currentTask.lastAuthAlertAt = completedAt;
            currentTask.lastExceptionAlertAt = completedAt;
            currentTask.lastExceptionAlertType = "authentication_expired";
            failureEvent = {
              id: crypto.randomUUID(), taskId, announcementId: "", type: "authentication_expired",
              title: `${currentTask.name} 登录已失效`, summary: "监控页面跳转到了登录入口，请在客户端重新登录后恢复监控。", importance: "important",
              notify: true, url: currentTask.listUrl, createdAt: completedAt
            };
            data.events.push(failureEvent);
          } else if (configurationInvalid && alertPolicy.enabled && alertPolicy.configurationInvalid && currentTask.consecutiveFailures >= alertPolicy.failureThreshold && cooldownElapsed(currentTask.lastConfigAlertAt, alertPolicy.cooldownMinutes, completedAt)) {
            currentTask.lastConfigAlertAt = completedAt;
            currentTask.lastExceptionAlertAt = completedAt;
            currentTask.lastExceptionAlertType = "collection_config_invalid";
            failureEvent = {
              id: crypto.randomUUID(), taskId, announcementId: "", type: "collection_config_invalid",
              title: `${currentTask.name} 的采集配置可能失效`, summary: `已连续 ${currentTask.consecutiveFailures} 次无法按原方案提取内容：${message}`, importance: "important",
              url: currentTask.listUrl, createdAt: completedAt
            };
            data.events.push(failureEvent);
          } else if (!authenticationExpired && !configurationInvalid && alertPolicy.enabled && alertPolicy.collectionFailed && currentTask.consecutiveFailures >= alertPolicy.failureThreshold && cooldownElapsed(currentTask.lastFailureAlertAt, alertPolicy.cooldownMinutes, completedAt)) {
            currentTask.lastFailureAlertAt = completedAt;
            currentTask.lastExceptionAlertAt = completedAt;
            currentTask.lastExceptionAlertType = "collection_failed";
            failureEvent = {
              id: crypto.randomUUID(), taskId, announcementId: "", type: "collection_failed",
              title: `${currentTask.name} 连续采集失败`, summary: `已连续失败 ${currentTask.consecutiveFailures} 次：${message}`, importance: "important",
              url: currentTask.listUrl, createdAt: completedAt
            };
            data.events.push(failureEvent);
          }
        }
        const currentRun = data.runs.find((item) => item.id === runId);
        if (currentRun) Object.assign(currentRun, { status: "failed", completedAt, message });
      });
      if (failureEvent) await this.deliver(task, failureEvent, null);
      this.emit("run-failed", { taskId, taskName: task.name, runId, message });
      throw error;
    } finally {
      this.emitState();
    }
  }

  async runPageTask(task, runId, resolvedQuietHours, alertPolicy) {
    const capture = await this.capture(task.listUrl, task.plan.page, "目标页面", task);
    if (looksLikeExpiredLogin(task, capture)) throw authenticationExpiredError();
    const detail = extractDetail(task.plan.page, capture, { title: task.regionName || task.name });
    if (!detail || String(detail.content || "").trim().length < 10) {
      throw configurationInvalidError("获取方案没有提取到监控区域，页面结构或异步接口可能已经变化");
    }

    const snapshot = this.store.view();
    let announcement = snapshot.announcements.find((item) => item.taskId === task.id && item.identity === "page-region");
    const now = new Date().toISOString();
    if (!announcement) {
      announcement = {
        id: crypto.randomUUID(), taskId: task.id, identity: "page-region",
        title: detail.title || task.regionName || task.name, url: task.listUrl, date: "", type: "page_region",
        firstSeenAt: now, lastSeenAt: now, lastVersionHash: "", versionCount: 0
      };
    }
    const previousVersion = snapshot.versions
      .filter((version) => version.announcementId === announcement.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
    const hash = detailFingerprint(detail);
    const changed = !previousVersion || previousVersion.hash !== hash;
    const version = changed ? {
      id: crypto.randomUUID(), taskId: task.id, announcementId: announcement.id,
      hash, title: detail.title || task.regionName || task.name, content: detail.content,
      html: detail.html, created: detail.createdAt, updated: detail.updatedAt,
      metadata: detail.metadata || [], sourceUrl: task.listUrl, createdAt: now, raw: detail.raw
    } : null;
    let event = null;
    if (previousVersion && version) {
      const diff = createTextDiff(previousVersion.content, version.content);
      const formattingOnly = isFormattingOnlyChange(previousVersion.content, version.content);
      let analysis = formattingOnly
        ? { summary: "仅标点或排版发生变化，已保存版本但不发送通知。", shouldNotify: false, reason: "无事实变化" }
        : await this.summarize({ task, item: { title: version.title, url: task.listUrl }, detail, previousVersion, version, eventType: "content_updated", diff })
          .catch(() => ({ summary: fallbackSummary(detail.content), importance: "normal", wechatRecommended: true }));
      if (!formattingOnly) {
        event = {
          id: crypto.randomUUID(), taskId: task.id, announcementId: announcement.id, versionId: version.id,
          type: "content_updated", title: version.title, summary: analysis.summary || fallbackSummary(detail.content),
          importance: analysis.importance || "normal", wechatRecommended: analysis.wechatRecommended !== false,
          reason: analysis.reason || "", notify: analysis.shouldNotify !== false, diff, url: task.listUrl, createdAt: now
        };
      }
    }

    const recoveryEvent = alertPolicy.enabled && alertPolicy.recovered && snapshot.tasks.find((item) => item.id === task.id)?.lastExceptionAlertAt ? {
      id: crypto.randomUUID(), taskId: task.id, announcementId: "", type: "collection_recovered",
      title: `${task.name} 已恢复监控`, summary: "监控区域已重新获取成功，定时监控恢复正常。", importance: "normal",
      url: task.listUrl, createdAt: now
    } : null;

    await this.store.update((data) => {
      const currentTask = data.tasks.find((item) => item.id === task.id);
      if (currentTask) {
        currentTask.lastSuccessAt = now;
        currentTask.status = "healthy";
        currentTask.lastError = "";
        currentTask.consecutiveFailures = 0;
        currentTask.authAlertedAt = "";
        currentTask.lastExceptionAlertAt = "";
        currentTask.lastExceptionAlertType = "";
        currentTask.lastFailureAlertAt = "";
        currentTask.lastAuthAlertAt = "";
        currentTask.lastConfigAlertAt = "";
        currentTask.nextRunAt = nextRunAt(currentTask.frequencyMinutes, resolvedQuietHours);
        currentTask.stats = {
          ...(currentTask.stats || {}), listCount: 1,
          totalRuns: Number(currentTask.stats?.totalRuns || 0) + 1,
          totalEvents: Number(currentTask.stats?.totalEvents || 0) + (event ? 1 : 0) + (recoveryEvent ? 1 : 0)
        };
      }
      const existing = data.announcements.find((item) => item.id === announcement.id);
      const nextAnnouncement = {
        ...announcement, title: detail.title || announcement.title, lastSeenAt: now,
        lastVersionHash: version?.hash || announcement.lastVersionHash,
        versionCount: Number(announcement.versionCount || 0) + (version ? 1 : 0)
      };
      if (existing) Object.assign(existing, nextAnnouncement); else data.announcements.push(nextAnnouncement);
      if (version) data.versions.push(version);
      if (event) data.events.push(event);
      if (recoveryEvent) data.events.push(recoveryEvent);
      const currentRun = data.runs.find((item) => item.id === runId);
      if (currentRun) Object.assign(currentRun, {
        status: "success", completedAt: now, listCount: 1, changeCount: event ? 1 : 0,
        message: !previousVersion ? "已静默保存监控区域的第一个版本" : event ? "监控区域发生变化" : "没有发现变化"
      });
    });
    if (event && event.notify !== false) await this.deliver(task, event, version);
    if (recoveryEvent) await this.deliver(task, recoveryEvent, null);
    this.emit("run-completed", { taskId: task.id, taskName: task.name, runId, baseline: !previousVersion, listCount: 1, changeCount: event ? 1 : 0 });
  }

  async processItem(task, item, triggerType, baseline, listCapture = null, detailStats = null) {
    const snapshot = this.store.view();
    let announcement = snapshot.announcements.find((record) => record.taskId === task.id && record.identity === item.identity);
    const detailUrl = resolveDetailUrl(task, item);
    let detail = null;
    if (task.monitorMode !== "list_only" && task.plan?.detail && detailUrl) {
      if (detailStats) detailStats.attempted += 1;
      try {
        const embedded = task.plan.detail.sourceType === "dom_embedded";
        const capture = embedded && listCapture
          ? listCapture
          : await this.capture(detailUrl, task.plan.detail, embedded ? "同页详情" : "详情页", task);
        if (looksLikeExpiredLogin(task, capture)) throw authenticationExpiredError();
        detail = extractDetail(task.plan.detail, capture, item);
        if (!detail && detailStats) detailStats.failed += 1;
      } catch (error) {
        if (error?.code === "AUTHENTICATION_EXPIRED") throw error;
        this.emit("detail-capture-failed", { taskId: task.id, taskName: task.name, message: `详情采集失败：${item.title} · ${error?.message || error}` });
        detail = null;
        if (detailStats) detailStats.failed += 1;
      }
    }

    const now = new Date().toISOString();
    if (!announcement) {
      announcement = {
        id: crypto.randomUUID(), taskId: task.id, identity: item.identity,
        title: item.title, url: detailUrl || item.url, date: item.date, type: item.type,
        firstSeenAt: now, lastSeenAt: now, lastVersionHash: "", versionCount: 0
      };
    }
    const previousVersion = snapshot.versions
      .filter((version) => version.announcementId === announcement.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
    let version = null;
    let eventType = triggerType;
    let diff = null;
    let formattingOnly = false;

    if (detail) {
      const fingerprint = detailFingerprint(detail);
      if (!previousVersion || previousVersion.hash !== fingerprint) {
        version = {
          id: crypto.randomUUID(), taskId: task.id, announcementId: announcement.id,
          hash: fingerprint, title: detail.title || item.title, content: detail.content,
          html: detail.html, created: detail.createdAt, updated: detail.updatedAt,
          metadata: detail.metadata, sourceUrl: detailUrl, createdAt: now, raw: detail.raw
        };
        if (previousVersion) {
          eventType = "content_updated";
          diff = createTextDiff(previousVersion.content, version.content);
          formattingOnly = isFormattingOnlyChange(previousVersion.content, version.content);
        } else if (triggerType === "audit" || triggerType === "detail_baseline" || baseline) {
          eventType = "detail_baseline";
        } else if (triggerType !== "announcement_created") {
          eventType = "metadata_updated";
        }
      } else if (triggerType === "audit") {
        eventType = "no_change";
      }
    } else if (triggerType === "audit") {
      eventType = "no_change";
    }

    const shouldCreateEvent = !baseline && ["announcement_created", "announcement_date_changed", "content_updated", "metadata_updated"].includes(eventType);
    let analysis = {
      summary: eventType === "announcement_date_changed"
        ? `公告日期由 ${announcement.date || "未知"} 变为 ${item.date || "未知"}，可能存在内容更新。`
        : task.monitorMode === "list_only" && eventType === "announcement_created" ? "公告列表中出现了一条新公告。" : "",
      importance: eventType === "announcement_date_changed" ? "important" : "normal",
      wechatRecommended: ["announcement_created", "announcement_date_changed"].includes(eventType)
    };
    if (formattingOnly) {
      analysis = { summary: "仅标点或排版发生变化，已保存版本但不发送通知。", shouldNotify: false, reason: "无事实变化" };
    } else if (shouldCreateEvent && task.monitorMode !== "list_only") {
      analysis = await this.summarize({ task, item, detail, previousVersion, version, eventType, diff }).catch(() => analysis);
    }
    const event = shouldCreateEvent ? {
      id: crypto.randomUUID(), taskId: task.id, announcementId: announcement.id,
      versionId: version?.id || previousVersion?.id || "", type: eventType,
      title: detail?.title || item.title,
      summary: analysis.summary || fallbackSummary(detail?.content || item.title),
      importance: analysis.importance || "normal",
      wechatRecommended: Boolean(analysis.wechatRecommended),
      reason: analysis.reason || "",
      notify: analysis.shouldNotify !== false,
      diff,
      url: detailUrl || item.url,
      createdAt: now
    } : null;

    await this.store.update((data) => {
      const existing = data.announcements.find((record) => record.id === announcement.id);
      const nextAnnouncement = {
        ...announcement,
        title: detail?.title || item.title,
        url: detailUrl || item.url || announcement.url,
        date: item.date,
        type: item.type,
        lastSeenAt: now,
        lastVersionHash: version?.hash || announcement.lastVersionHash,
        versionCount: Number(announcement.versionCount || 0) + (version ? 1 : 0)
      };
      if (existing) Object.assign(existing, nextAnnouncement);
      else data.announcements.push(nextAnnouncement);
      if (version) data.versions.push(version);
      if (event) data.events.push(event);
    });
    if (event && event.notify !== false) await this.deliver(task, event, version || previousVersion);
    return event;
  }

  async recordOrderEvent(task, items) {
    const event = {
      id: crypto.randomUUID(), taskId: task.id, announcementId: "", versionId: "",
      type: "order_changed", title: `${task.name} 的公告顺序发生变化`,
      summary: `当前第一页共 ${items.length} 条公告，已有公告的排列顺序发生变化。`,
      importance: "normal", wechatRecommended: false, url: task.listUrl, createdAt: new Date().toISOString()
    };
    await this.store.update((data) => data.events.push(event));
    await this.deliver(task, event, null);
    return event;
  }

  async deliver(task, event, version) {
    const deliveries = await this.notify(task, event, version);
    if (!deliveries?.length) return;
    await this.store.update((data) => data.deliveries.push(...deliveries));
  }

  emitState() {
    this.emit("queue-state", {
      running: this.running,
      queuedTaskIds: this.queue.map((item) => item.taskId),
      queueLength: this.queue.length
    });
  }
}

function looksLikeExpiredLogin(task, capture) {
  if (!task.authentication?.enabled) return false;
  const url = String(capture.finalUrl || "");
  const title = String(capture.dom?.title || "");
  const text = String(capture.dom?.text || "").slice(0, 5000);
  let hostChanged = false;
  try { hostChanged = new URL(url).hostname !== new URL(task.listUrl).hostname; } catch (_error) {}
  const loginUrl = /login|passport|sso|signin|auth(?:entication)?/i.test(url);
  const loginPage = /(?:账号|用户名|手机号|邮箱).{0,30}(?:密码|验证码).{0,50}(?:登录|登入)/s.test(`${title}\n${text}`);
  return (hostChanged && loginUrl) || loginPage;
}

function authenticationExpiredError() {
  const error = new Error("登录会话已失效，请在客户端重新登录");
  error.code = "AUTHENTICATION_EXPIRED";
  return error;
}

function configurationInvalidError(message) {
  const error = new Error(message || "采集配置可能已经失效");
  error.code = "COLLECTION_RULE_INVALID";
  return error;
}

function nextRunAt(frequencyMinutes = 15, quietHours = null) {
  const frequency = Math.max(5, Math.min(7 * 24 * 60, Number(frequencyMinutes || 15)));
  const jitter = Math.min(60_000, frequency * 60_000 * 0.03) * Math.random();
  const candidate = new Date(Date.now() + frequency * 60_000 + jitter);
  return adjustToAllowedTime(candidate, quietHours).toISOString();
}

function isInQuietHours(quietHours, date = new Date()) {
  if (!quietHours?.enabled) return false;
  const start = parseClock(quietHours.start, 0);
  const end = parseClock(quietHours.end, 8 * 60);
  if (start === end) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function resolveQuietHours(taskQuietHours = {}, defaultQuietHours = {}) {
  const mode = ["global", "custom", "disabled"].includes(taskQuietHours?.mode)
    ? taskQuietHours.mode
    : taskQuietHours?.enabled ? "custom" : "disabled";
  if (mode === "global") return {
    enabled: Boolean(defaultQuietHours?.enabled),
    start: defaultQuietHours?.start || "00:00",
    end: defaultQuietHours?.end || "08:00"
  };
  if (mode === "custom") return { enabled: true, start: taskQuietHours.start || "00:00", end: taskQuietHours.end || "08:00" };
  return { enabled: false, start: "00:00", end: "08:00" };
}

function nextAllowedRunAt(quietHours, date = new Date()) {
  return adjustToAllowedTime(date, quietHours).toISOString();
}

function adjustToAllowedTime(date, quietHours) {
  const candidate = new Date(date);
  if (!isInQuietHours(quietHours, candidate)) return candidate;
  const start = parseClock(quietHours.start, 0);
  const end = parseClock(quietHours.end, 8 * 60);
  const current = candidate.getHours() * 60 + candidate.getMinutes();
  if (start > end && current >= start) candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(Math.floor(end / 60), end % 60, 0, 0);
  return candidate;
}

function parseClock(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

function normalizeAlertPolicy(value = {}) {
  return {
    enabled: value.enabled !== false,
    failureThreshold: Math.max(2, Math.min(20, Number(value.failureThreshold || 3))),
    cooldownMinutes: Math.max(30, Math.min(7 * 24 * 60, Number(value.cooldownMinutes || 360))),
    collectionFailed: value.collectionFailed !== false,
    configurationInvalid: value.configurationInvalid !== false,
    authenticationExpired: value.authenticationExpired !== false,
    recovered: value.recovered !== false
  };
}

function cooldownElapsed(previous, minutes, now = new Date().toISOString()) {
  if (!previous) return true;
  return Date.parse(now) - Date.parse(previous) >= Number(minutes || 360) * 60_000;
}

function formatLocalTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

function pickAuditItem(items, cursor) {
  if (!items.length) return null;
  return items[Math.abs(Number(cursor || 0)) % items.length];
}

function nextAuditAt(frequencyMinutes, itemCount) {
  const spreadMinutes = Math.ceil((24 * 60) / Math.max(1, itemCount));
  const interval = Math.max(Number(frequencyMinutes || 15), spreadMinutes);
  return new Date(Date.now() + interval * 60_000).toISOString();
}

function fallbackSummary(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= 50 ? text : `${text.slice(0, 48)}…`;
}

module.exports = { AnnouncementRuntime, cooldownElapsed, isInQuietHours, nextAllowedRunAt, nextRunAt, resolveQuietHours };
