const state = {
  createTaskType: "announcement",
  inputs: null,
  listCapture: null,
  detailCapture: null,
  listCandidates: [],
  detailCandidates: [],
  plan: null,
  logs: [],
  createLogs: [],
  createLogActive: false,
  validationItems: [],
  validationDetail: null,
  monitor: { tasks: [], announcements: [], events: [], runs: [], deliveries: [], scheduler: {} },
  selectedTaskId: "",
  announcementHistory: null,
  settings: null,
  authSessionKey: ""
};

const elements = {
  form: document.querySelector("#discovery-form"),
  analyzeButton: document.querySelector("#analyze-button"),
  validateButton: document.querySelector("#validate-button"),
  copyPlan: document.querySelector("#copy-plan"),
  statusCard: document.querySelector("#status-card"),
  statusText: document.querySelector("#status-text"),
  results: document.querySelector("#results"),
  validation: document.querySelector("#validation"),
  candidateDebug: document.querySelector("#candidate-debug"),
  candidateContent: document.querySelector("#candidate-content"),
  planJson: document.querySelector("#plan-json"),
  toast: document.querySelector("#toast")
};

initialize();

async function initialize() {
  window.announcementProbe.getAppVersion().then((version) => {
    document.querySelector("#app-version").textContent = `版本 ${version}`;
  }).catch(() => {});
  elements.form.addEventListener("submit", handleAnalyze);
  elements.validateButton.addEventListener("click", handleValidate);
  elements.copyPlan.addEventListener("click", copyPlanJson);
  document.querySelector("#copy-logs").addEventListener("click", copyRuntimeLogs);
  document.querySelector("#clear-logs").addEventListener("click", clearRuntimeLog);
  document.querySelector("#copy-global-logs").addEventListener("click", copyGlobalLogs);
  document.querySelector("#clear-global-logs").addEventListener("click", clearGlobalLogs);
  window.announcementProbe.onLog((entry) => appendLog(entry));
  window.announcementProbe.onRuntimeEvent(handleRuntimeEvent);

  document.querySelectorAll("[data-view-target]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewTarget)));
  document.querySelectorAll("[data-create-task], #new-task-button, #new-task-sidebar").forEach((button) => button.addEventListener("click", () => openCreateTask("announcement")));
  document.querySelectorAll("#new-page-monitor-button, #new-page-monitor-sidebar").forEach((button) => button.addEventListener("click", () => openCreateTask("page")));
  document.querySelector("#save-task").addEventListener("click", saveTaskFromWizard);
  document.querySelector("#test-wechat").addEventListener("click", () => testNotification("wechat"));
  document.querySelector("#test-email").addEventListener("click", () => testNotification("email"));
  document.querySelector("#preview-wechat").addEventListener("click", () => previewNotification("wechat", "create"));
  document.querySelector("#preview-email").addEventListener("click", () => previewNotification("email", "create"));
  document.querySelector("#edit-preview-wechat").addEventListener("click", () => previewNotification("wechat", "edit"));
  document.querySelector("#edit-preview-email").addEventListener("click", () => previewNotification("email", "edit"));
  document.querySelector("#edit-test-wechat").addEventListener("click", () => testNotification("wechat", "edit"));
  document.querySelector("#edit-test-email").addEventListener("click", () => testNotification("email", "edit"));
  document.querySelector("#preview-close").addEventListener("click", () => document.querySelector("#notification-preview-dialog").close());
  document.querySelectorAll('input[name="monitor-mode"]').forEach((input) => input.addEventListener("change", updateMonitorModeUi));
  document.querySelector("#login-enabled").addEventListener("change", updateLoginUi);
  document.querySelector("#quiet-hours-mode").addEventListener("change", updateQuietHoursUi);
  document.querySelector("#edit-quiet-hours-mode").addEventListener("change", updateEditQuietHoursUi);
  document.querySelector("#settings-quiet-hours-enabled").addEventListener("change", updateSettingsQuietHoursUi);
  document.querySelector("#open-login-window").addEventListener("click", loginForConfiguration);
  document.querySelector("#list-url").addEventListener("input", () => {
    if (!state.authSessionKey) return;
    state.authSessionKey = "";
    updateLoginUi();
  });
  document.querySelector("#task-run-now").addEventListener("click", runSelectedTask);
  document.querySelector("#task-login").addEventListener("click", loginSelectedTask);
  document.querySelector("#task-toggle").addEventListener("click", toggleSelectedTask);
  document.querySelector("#task-edit").addEventListener("click", openTaskEditor);
  document.querySelector("#task-delete").addEventListener("click", deleteSelectedTask);
  document.querySelector("#save-settings-button").addEventListener("click", saveApplicationSettings);
  document.querySelector("#add-wechat-profile").addEventListener("click", () => openNotificationProfileEditor("wechat"));
  document.querySelector("#add-email-profile").addEventListener("click", () => openNotificationProfileEditor("email"));
  document.querySelector("#profile-dialog-close").addEventListener("click", closeNotificationProfileEditor);
  document.querySelector("#profile-cancel").addEventListener("click", closeNotificationProfileEditor);
  document.querySelector("#profile-save").addEventListener("click", saveNotificationProfile);
  document.querySelector("#profile-delete").addEventListener("click", deleteNotificationProfile);
  document.querySelector("#export-backup").addEventListener("click", () => openBackupDialog("export"));
  document.querySelector("#import-backup").addEventListener("click", () => openBackupDialog("import"));
  document.querySelector("#backup-dialog-close").addEventListener("click", closeBackupDialog);
  document.querySelector("#backup-cancel").addEventListener("click", closeBackupDialog);
  document.querySelector("#backup-confirm").addEventListener("click", confirmBackupOperation);
  document.querySelector("#dialog-close").addEventListener("click", () => document.querySelector("#announcement-dialog").close());
  document.querySelector("#dialog-version-select").addEventListener("change", renderSelectedVersion);
  document.querySelector("#dialog-open-source").addEventListener("click", openDialogSource);
  document.querySelector("#task-edit-close").addEventListener("click", closeTaskEditor);
  document.querySelector("#task-edit-cancel").addEventListener("click", closeTaskEditor);
  document.querySelector("#task-edit-save").addEventListener("click", saveTaskEdits);

  const [settings, monitor] = await Promise.all([
    window.announcementProbe.loadSettings().catch(() => null),
    window.announcementProbe.getMonitorState().catch(() => state.monitor)
  ]);
  state.settings = settings;
  state.monitor = monitor || state.monitor;
  populateSettings(settings || {});
  renderMonitorShell();
  showView("dashboard");
}

async function handleAnalyze(event) {
  event.preventDefault();
  const inputs = readInputs();
  if (!inputs) return;

  state.inputs = inputs;
  state.createLogActive = true;
  state.plan = null;
  clearValidationOutput();
  elements.results.classList.add("hidden");
  elements.validation.classList.add("hidden");
  document.querySelector("#notification-section").classList.add("hidden");
  elements.candidateDebug.classList.add("hidden");
  resetProgress();
  clearRuntimeLog();
  appendLog({ scope: "配置", message: "开始分析新的监控对象", level: "info", elapsedMs: 0 });
  setBusy(elements.analyzeButton, true, "正在分析…");

  try {
    setStep("capture-list", "active", "正在打开并采集初始请求");
    setStatus(state.createTaskType === "page" ? "正在采集目标页面和异步请求。" : "正在采集公告列表页，浏览器可能短暂显示调试提示。", "working");
    state.listCapture = await capturePage(inputs.listUrl, inputs.authSessionKey);
    appendLog({ scope: state.createTaskType === "page" ? "目标页" : "列表页", message: `采集完成：${state.listCapture.responses.length} 个响应，DOM 文本 ${state.listCapture.dom.text.length} 字符`, level: "success" });
    setStep("capture-list", "done", `${state.listCapture.responses.length} 个可读响应`);

    if (state.createTaskType === "page") {
      state.detailCapture = state.listCapture;
      setStep("capture-detail", "done", "页面监控无需关联详情页");
    } else if (inputs.monitorMode === "list_and_detail") {
      setStep("capture-detail", "active", "正在打开并采集初始请求");
      const samePageDetail = inputs.detailUrl === inputs.listUrl;
      setStatus(samePageDetail ? "正在检查列表页中是否嵌入了公告详情。" : "列表页已完成，正在采集样例公告详情页。", "working");
      state.detailCapture = samePageDetail ? state.listCapture : await capturePage(inputs.detailUrl, inputs.authSessionKey);
      appendLog({ scope: "详情页", message: `采集完成：${state.detailCapture.responses.length} 个响应，DOM 文本 ${state.detailCapture.dom.text.length} 字符`, level: "success" });
      setStep("capture-detail", "done", samePageDetail ? "复用列表页中的嵌入详情" : `${state.detailCapture.responses.length} 个可读响应`);
    } else {
      state.detailCapture = null;
      setStep("capture-detail", "done", "仅列表模式，已跳过");
    }

    setStep("discover", "active", "正在匹配复制内容");
    setStatus("正在把复制样例与网络响应、页面内容进行模糊匹配。", "working");
    state.listCandidates = state.createTaskType === "page" ? [] : discoverListCandidates(state.listCapture, inputs.listSample);
    state.detailCandidates = state.createTaskType === "page" ? discoverDetailCandidates(state.listCapture, inputs.listSample) : inputs.monitorMode === "list_and_detail" ? discoverDetailCandidates(state.detailCapture, inputs.detailSample) : [];
    appendLog({ scope: "候选匹配", message: `发现列表候选 ${state.listCandidates.length} 个、详情候选 ${state.detailCandidates.length} 个`, level: "info" });

    if (state.createTaskType !== "page" && !state.listCandidates.length) throw new Error("没有找到与列表样例相符的网络响应或页面内容块");
    if (state.createTaskType === "page" && !state.detailCandidates.length) throw new Error("没有找到与监控区域样例相符的网络响应或页面内容区域");
    if (inputs.monitorMode === "list_and_detail" && !state.detailCandidates.length) throw new Error("没有找到与详情正文相符的响应字段或页面文本");

    setStep("discover", "done", state.createTaskType === "page" ? `监控区域 ${state.detailCandidates.length} 个候选` : inputs.monitorMode === "list_only" ? `列表 ${state.listCandidates.length} 个候选` : `列表 ${state.listCandidates.length} 个，详情 ${state.detailCandidates.length} 个候选`);
    renderCandidates();

    setStep("ai", "active", "正在生成结构化配置");
    setStatus("候选已经找到，正在请 DeepSeek 选择数据来源并生成获取方案。", "working");
    const prompt = (state.createTaskType === "page" ? buildPageDeepSeekPrompt(inputs, state.detailCandidates) : buildDeepSeekPrompt(inputs, state.listCandidates, state.detailCandidates)).slice(0, 60_000);
    appendLog({ scope: "DeepSeek", message: `已压缩分析材料：${prompt.length.toLocaleString()} 字符，估算约 ${estimateTokens(prompt).toLocaleString()} tokens`, level: "info" });

    let rawPlan;
    try {
      const aiResult = await window.announcementProbe.analyzeWithDeepSeek({
        prompt
      });
      rawPlan = aiResult.plan;
      if (aiResult.usage) {
        appendLog({
          scope: "DeepSeek",
          message: `实际用量：输入 ${Number(aiResult.usage.prompt_tokens || 0).toLocaleString()}，输出 ${Number(aiResult.usage.completion_tokens || 0).toLocaleString()} tokens`,
          level: "info"
        });
      }
    } catch (error) {
      rawPlan = state.createTaskType === "page"
        ? buildFallbackPagePlan(state.detailCandidates[0], `DeepSeek 调用失败，已使用本地最高分候选：${error.message}`)
        : buildFallbackPlan(state.listCandidates[0], state.detailCandidates[0], `DeepSeek 调用失败，已使用本地最高分候选：${error.message}`, inputs.monitorMode);
      showToast("DeepSeek 调用失败，已生成本地候选方案，可继续验证。", true);
    }

    state.plan = state.createTaskType === "page"
      ? normalizePagePlan(rawPlan, state.detailCandidates)
      : normalizePlan(rawPlan, state.listCandidates, state.detailCandidates, inputs.monitorMode);
    // Candidates retain only compact previews; the raw capture bodies are no
    // longer needed after a plan is normalized and can be released promptly.
    state.listCapture = null;
    state.detailCapture = null;
    appendLog({ scope: "方案", message: `方案生成完成，整体置信度 ${percent(state.plan.confidence)}`, level: "success" });
    setStep("ai", "done", "方案已生成");
    setStatus("获取方案已生成。请重新获取并验证实际内容。", "success");
    renderPlan(state.plan);
    elements.results.classList.remove("hidden");
    elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    appendLog({ scope: "分析失败", message: error.message, level: "error" });
    markActiveStepError(error.message);
    setStatus(error.message, "error");
    showToast(error.message, true);
  } finally {
    state.listCapture = null;
    state.detailCapture = null;
    state.createLogActive = false;
    setBusy(elements.analyzeButton, false, "开始自动分析");
  }
}

async function handleValidate() {
  if (!state.plan || !state.inputs) return;
  setBusy(elements.validateButton, true, "验证中…");
  appendLog({ scope: "方案验证", message: state.createTaskType === "page" ? "开始使用生成的方案重新获取页面监控区域" : "开始使用生成的方案重新获取列表页和详情页", level: "info" });
  elements.validation.classList.remove("hidden");
  setValidationBadge("正在重新获取", "");
  setStatus("正在使用生成的方案重新打开列表页和详情页。", "working");

  try {
    const freshListCapture = await capturePage(state.inputs.listUrl, state.inputs.authSessionKey);
    if (state.createTaskType === "page") {
      refineMatcherFromFreshCapture(state.plan.page, freshListCapture);
      const detail = extractDetailByPlan(state.plan.page, freshListCapture, state.inputs.listSample);
      if (!detail.content || normalizeText(detail.content).length < 20) throw new Error("页面监控方案未能提取出有效内容");
      const detailMatch = sampleMatchRatio(state.inputs.listSample, detailAsText(detail));
      const passed = detailMatch >= 0.2;
      state.validationItems = [{ id: "page-region", title: detail.title || document.querySelector("#task-name").value.trim() || "页面监控区域", date: "", url: state.inputs.listUrl, raw: {} }];
      state.validationDetail = detail;
      renderValidation(state.validationItems, detail, { listMatch: detailMatch, detailMatch });
      appendLog({ scope: "方案验证", message: `页面区域样例匹配 ${percent(detailMatch)}，已提取 ${detail.content.length.toLocaleString()} 字符`, level: passed ? "success" : "error" });
      renderPlan(state.plan);
      setValidationBadge(passed ? "验证通过" : "已获取，样例匹配偏低", passed ? "success" : "error");
      setStatus(passed ? `验证通过：监控区域样例匹配 ${percent(detailMatch)}。` : `内容已获取，但与样例匹配偏低：${percent(detailMatch)}。`, passed ? "success" : "error");
      if (passed) document.querySelector("#notification-section").classList.remove("hidden");
      elements.validation.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    refineMatcherFromFreshCapture(state.plan.list, freshListCapture);
    const listItems = extractListByPlan(state.plan.list, freshListCapture, state.inputs.listUrl);
    if (!listItems.length) throw new Error("列表方案未能提取出公告记录");

    let detail = null;
    if (state.inputs.monitorMode === "list_and_detail") {
      const freshDetailCapture = state.inputs.detailUrl === state.inputs.listUrl
        ? freshListCapture
        : await capturePage(state.inputs.detailUrl, state.inputs.authSessionKey);
      refineMatcherFromFreshCapture(state.plan.detail, freshDetailCapture);
      const validationItem = findSampleListItem(listItems, state.inputs.detailUrl, state.inputs.detailSample);
      detail = extractDetailByPlan(state.plan.detail, freshDetailCapture, state.inputs.detailSample, validationItem);
      if (!detail.content || normalizeText(detail.content).length < 20) throw new Error("详情方案未能提取出有效正文");
    }

    const listMatch = sampleMatchRatio(state.inputs.listSample, listItems.map((item) => `${item.title} ${item.date}`).join("\n"));
    const detailMatch = detail ? sampleMatchRatio(state.inputs.detailSample, detailAsText(detail)) : 1;
    const passed = listMatch >= 0.2 && (state.inputs.monitorMode === "list_only" || detailMatch >= 0.2);
    appendLog({
      scope: "方案验证",
      message: state.inputs.monitorMode === "list_only" ? `提取列表 ${listItems.length} 条；列表样例匹配 ${percent(listMatch)}` : `提取列表 ${listItems.length} 条；列表样例匹配 ${percent(listMatch)}；详情样例匹配 ${percent(detailMatch)}`,
      level: passed ? "success" : "error"
    });

    renderValidation(listItems, detail, { listMatch, detailMatch });
    state.validationItems = listItems;
    state.validationDetail = detail;
    if (state.inputs.monitorMode === "list_and_detail") {
      const matchingItem = findSampleListItem(listItems, state.inputs.detailUrl, state.inputs.detailSample);
      if (!state.plan.relation) state.plan.relation = {};
      if (!state.plan.relation.detailUrlTemplate && matchingItem) {
        state.plan.relation.detailUrlTemplate = buildDetailUrlTemplate(state.inputs.detailUrl, matchingItem.raw);
      }
    }
    renderPlan(state.plan);
    setValidationBadge(
      passed ? "验证通过" : "已获取，样例匹配偏低",
      passed ? "success" : "error"
    );
    setStatus(
      passed
        ? state.inputs.monitorMode === "list_only" ? `验证通过：列表样例匹配 ${percent(listMatch)}。` : `验证通过：列表样例匹配 ${percent(listMatch)}，详情样例匹配 ${percent(detailMatch)}。`
        : state.inputs.monitorMode === "list_only" ? `内容已获取，但列表样例匹配偏低：${percent(listMatch)}。` : `内容已获取，但与样例匹配偏低：列表 ${percent(listMatch)}，详情 ${percent(detailMatch)}。`,
      passed ? "success" : "error"
    );
    if (passed) document.querySelector("#notification-section").classList.remove("hidden");
    elements.validation.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    appendLog({ scope: "验证失败", message: error.message, level: "error" });
    setValidationBadge("验证失败", "error");
    setStatus(error.message, "error");
    showToast(error.message, true);
  } finally {
    state.createLogActive = false;
    setBusy(elements.validateButton, false, "重新获取并验证");
  }
}

function readInputs() {
  const pageMode = state.createTaskType === "page";
  const monitorMode = pageMode ? "page_region" : document.querySelector('input[name="monitor-mode"]:checked')?.value || "list_and_detail";
  const listUrl = document.querySelector("#list-url").value.trim();
  const listSample = document.querySelector("#list-sample").value.trim().slice(0, 60_000);
  const detailUrlInput = document.querySelector("#detail-url").value.trim();
  const detailSample = document.querySelector("#detail-sample").value.trim().slice(0, 60_000);
  const loginEnabled = document.querySelector("#login-enabled").checked;

  try {
    assertWebUrl(listUrl);
    if (!pageMode && monitorMode === "list_and_detail" && detailUrlInput) assertWebUrl(detailUrlInput);
  } catch (error) {
    showToast(error.message, true);
    return null;
  }
  if (listSample.length < 8 || (!pageMode && monitorMode === "list_and_detail" && detailSample.length < 12)) {
    showToast(monitorMode === "list_only" ? "请提供更完整的列表内容样例。" : "请提供更完整的列表和详情内容样例。", true);
    return null;
  }
  if (!state.settings?.deepseekApiKey) {
    showToast("请先在“设置”中配置 DeepSeek API Key。", true);
    return null;
  }
  if (loginEnabled && !state.authSessionKey) {
    showToast("请先打开登录窗口并完成登录。", true);
    return null;
  }
  const detailUrl = !pageMode && monitorMode === "list_and_detail" ? (detailUrlInput || listUrl) : "";
  return { monitorMode, listUrl, listSample, detailUrl, detailSample, loginEnabled, authSessionKey: loginEnabled ? state.authSessionKey : "" };
}

async function capturePage(url, sessionKey = "") {
  return window.announcementProbe.capturePage({ url, settleMs: 4500, sessionKey });
}

function updateMonitorModeUi() {
  const listOnly = document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only";
  document.querySelector("#detail-sample-fields").classList.toggle("hidden", listOnly);
  document.querySelector('[data-step="capture-detail"]').classList.toggle("muted-step", listOnly);
  document.querySelector("#wechat-channel-hint").textContent = listOnly ? "新增、日期及其他列表变化" : "新增公告和重要内容更新";
  document.querySelector("#baseline-note-text").textContent = listOnly
    ? "首次只保存当前列表，不发送已有公告；后续列表新增、日期或排列变化才会通知。"
    : "首次会保存第一页公告的详情正文作为版本 1，但不会发送已有公告；之后出现的新增和更新才会通知。";
}

function updateLoginUi() {
  const enabled = document.querySelector("#login-enabled").checked;
  document.querySelector("#open-login-window").disabled = !enabled;
  document.querySelector("#login-status").textContent = enabled
    ? state.authSessionKey ? "登录会话已准备，将用于配置验证和后台监控" : "请先打开登录窗口，完成登录后直接关闭窗口"
    : "登录会话仅保存在本机浏览器数据中";
}

function updateQuietHoursUi() {
  const mode = document.querySelector("#quiet-hours-mode").value;
  document.querySelector("#quiet-hours-fields").classList.toggle("hidden", mode !== "custom");
  document.querySelector("#quiet-hours-global-note").classList.toggle("hidden", mode !== "global");
  document.querySelector("#quiet-hours-global-note").textContent = globalQuietHoursLabel();
}

function updateEditQuietHoursUi() {
  const mode = document.querySelector("#edit-quiet-hours-mode").value;
  document.querySelector("#edit-quiet-hours-fields").classList.toggle("hidden", mode !== "custom");
  document.querySelector("#edit-quiet-hours-global-note").classList.toggle("hidden", mode !== "global");
  document.querySelector("#edit-quiet-hours-global-note").textContent = globalQuietHoursLabel();
}

function updateSettingsQuietHoursUi() {
  document.querySelector("#settings-quiet-hours-fields").classList.toggle("hidden", !document.querySelector("#settings-quiet-hours-enabled").checked);
}

function globalQuietHoursLabel() {
  const quiet = state.settings?.defaultQuietHours || {};
  return quiet.enabled ? `继承全局设置：${quiet.start || "00:00"}–${quiet.end || "08:00"} 暂停自动抓取。` : "全局暂停抓取当前未启用，此任务将全天正常检查。";
}

async function loginForConfiguration() {
  const url = document.querySelector("#list-url").value.trim();
  try { assertWebUrl(url); } catch (error) { return showToast("请先填写正确的列表页网址。", true); }
  const button = document.querySelector("#open-login-window");
  setBusy(button, true, "等待登录窗口关闭…");
  try {
    const result = await window.announcementProbe.openLoginWindow({ url });
    state.authSessionKey = result.sessionKey;
    updateLoginUi();
    showToast("登录会话已保存，可开始分析页面。");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, "打开登录窗口");
  }
}

async function loginSelectedTask() {
  const task = selectedTask();
  if (!task) return;
  const button = document.querySelector("#task-login");
  setBusy(button, true, "等待登录…");
  try {
    await window.announcementProbe.openLoginWindow({ url: task.listUrl });
    showToast("登录会话已更新，建议立即检查一次。");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, "登录账号");
  }
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  document.querySelectorAll("[data-view-target]").forEach((button) => button.classList.toggle("active", button.dataset.viewTarget === name));
  document.querySelector(".main-content").scrollTop = 0;
  if (name === "dashboard") renderMonitorShell();
  if (name === "task") renderSelectedTask();
  if (name === "logs") renderGlobalLogs();
}

function openCreateTask(type = "announcement") {
  state.createTaskType = type === "page" ? "page" : "announcement";
  elements.form.reset();
  document.querySelector("#task-frequency").value = "15";
  document.querySelector('input[name="monitor-mode"][value="list_and_detail"]').checked = true;
  document.querySelector("#login-enabled").checked = false;
  document.querySelector("#quiet-hours-mode").value = "global";
  document.querySelector("#quiet-hours-start").value = "00:00";
  document.querySelector("#quiet-hours-end").value = "08:00";
  state.authSessionKey = "";
  document.querySelector("#wechat-profile").value = "";
  document.querySelector("#email-profile").value = "";
  populateNotificationProfileSelects();
  state.inputs = null;
  state.plan = null;
  state.listCapture = null;
  state.detailCapture = null;
  state.listCandidates = [];
  state.detailCandidates = [];
  clearValidationOutput();
  elements.results.classList.add("hidden");
  elements.validation.classList.add("hidden");
  elements.candidateDebug.classList.add("hidden");
  document.querySelector("#notification-section").classList.add("hidden");
  resetProgress();
  clearRuntimeLog();
  setStatus("填写样例后开始分析。");
  updateMonitorModeUi();
  updateCreateTaskTypeUi();
  updateLoginUi();
  updateQuietHoursUi();
  showView("create");
}

function clearValidationOutput() {
  state.validationItems = [];
  state.validationDetail = null;
  const body = document.querySelector("#list-result-body");
  if (body) body.textContent = "";
  document.querySelector("#list-result-count").textContent = "0 条";
  document.querySelector("#detail-result-title").textContent = "等待验证";
  document.querySelector("#detail-result-metadata").textContent = "";
  document.querySelector("#detail-result-metadata").classList.add("hidden");
  document.querySelector("#detail-result-content").textContent = "";
  setValidationBadge("等待验证", "");
}

function updateCreateTaskTypeUi() {
  const pageMode = state.createTaskType === "page";
  document.querySelector("#create-eyebrow").textContent = pageMode ? "页面监控" : "公告监控";
  document.querySelector("#create-title").textContent = pageMode ? "创建页面监控" : "创建监控任务";
  document.querySelector("#create-description").textContent = pageMode
    ? "提供页面网址和希望监控的区域样例，工具会自动发现可重复获取的内容来源。"
    : "提供页面中正确的列表和详情样例，其余交给本机采集器与 DeepSeek。";
  document.querySelector("#announcement-mode-grid").classList.toggle("hidden", pageMode);
  document.querySelector("#detail-sample-fields").classList.toggle("hidden", pageMode || document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only");
  document.querySelector("#source-url-label").textContent = pageMode ? "要监控的页面网址" : "公告列表页网址";
  document.querySelector("#source-sample-label").textContent = pageMode ? "从页面复制的目标区域内容" : "从页面复制的公告列表内容";
  document.querySelector("#list-sample").placeholder = pageMode ? "复制希望监控的完整区域，建议包含标题和有代表性的正文。" : "建议包含至少两条公告标题和日期。";
  document.querySelector("#capture-list-step-title").textContent = pageMode ? "采集目标页面" : "采集列表页";
  document.querySelector("#capture-detail-step-title").textContent = pageMode ? "无需关联详情" : "采集详情页";
  document.querySelector('[data-step="capture-detail"]').classList.toggle("muted-step", pageMode || document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only");
  document.querySelector("#baseline-note-text").textContent = pageMode
    ? "首次会静默保存目标区域的第一个版本；之后区域内容发生事实变化时才会通知。"
    : document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only"
      ? "首次只保存当前列表，不发送已有公告；后续列表新增、日期或排列变化才会通知。"
      : "首次会保存第一页公告的详情正文作为版本 1，但不会发送已有公告；之后出现的新增和更新才会通知。";
  document.querySelector("#wechat-channel-hint").textContent = pageMode ? "页面区域内容发生变化" : document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only" ? "新增、日期及其他列表变化" : "新增公告和重要内容更新";
}

async function refreshMonitorState() {
  state.monitor = await window.announcementProbe.getMonitorState();
  renderMonitorShell();
  if (document.querySelector("#view-task").classList.contains("active")) renderSelectedTask();
}

function renderMonitorShell() {
  const { tasks = [], announcements = [], events = [], runs = [], deliveries = [], scheduler = {} } = state.monitor;
  const active = tasks.filter((task) => task.enabled).length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEvents = events.filter((event) => Date.parse(event.createdAt) >= today.getTime() && ["announcement_created", "content_updated", "metadata_updated"].includes(event.type)).length;
  const errors = tasks.filter((task) => task.status === "error").length + deliveries.filter((item) => item.status === "failed" && Date.now() - Date.parse(item.createdAt) < 24 * 60 * 60 * 1000).length;
  document.querySelector("#stat-active").textContent = active;
  document.querySelector("#stat-events").textContent = todayEvents;
  document.querySelector("#stat-errors").textContent = errors;
  document.querySelector("#stat-announcements").textContent = announcements.length;
  document.querySelector("#sidebar-task-count").textContent = tasks.filter((task) => task.type !== "page").length;
  document.querySelector("#sidebar-page-task-count").textContent = tasks.filter((task) => task.type === "page").length;
  document.querySelector("#sidebar-health").textContent = errors ? `${errors} 项需要处理` : "后台监控正常";
  document.querySelector("#sidebar-queue").textContent = scheduler.queueLength ? `${scheduler.queueLength} 个任务等待执行` : "当前没有等待任务";

  const sidebar = document.querySelector("#sidebar-task-list");
  sidebar.textContent = "";
  const pageSidebar = document.querySelector("#sidebar-page-task-list");
  pageSidebar.textContent = "";
  tasks.forEach((task) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-item sidebar-task ${effectiveTaskStatus(task)}`;
    button.textContent = task.name;
    button.title = task.name;
    button.addEventListener("click", () => openTask(task.id));
    (task.type === "page" ? pageSidebar : sidebar).append(button);
  });

  const taskList = document.querySelector("#dashboard-task-list");
  taskList.textContent = "";
  tasks.forEach((task) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "task-row";
    row.innerHTML = `
      <div class="task-main"><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(hostLabel(task.listUrl))} · ${frequencyLabel(task.frequencyMinutes)}</small></div>
      <div class="task-cell"><span class="status-inline ${escapeHtml(effectiveTaskStatus(task))}">${statusLabel(task)}</span><small>${task.enabled && task.lastError ? escapeHtml(task.lastError).slice(0, 40) : ""}</small></div>
      <div class="task-cell">${escapeHtml(relativeTime(task.lastSuccessAt))}<small>下次 ${escapeHtml(relativeTime(task.nextRunAt))}</small></div>
      <span class="task-arrow">›</span>`;
    row.addEventListener("click", () => openTask(task.id));
    taskList.append(row);
  });
  document.querySelector("#dashboard-empty").classList.toggle("hidden", tasks.length > 0);

  const eventList = document.querySelector("#recent-event-list");
  eventList.textContent = "";
  events.slice(0, 8).forEach((event) => {
    const row = document.createElement("article");
    const iconClass = event.type === "content_updated" ? "update" : ["collection_failed", "collection_config_invalid", "authentication_expired"].includes(event.type) ? "error" : "";
    row.className = "event-row";
    row.innerHTML = `<div class="event-icon ${iconClass}">${event.type === "announcement_created" ? "新" : ["collection_failed", "collection_config_invalid", "authentication_expired"].includes(event.type) ? "!" : "更"}</div><div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.summary || eventTypeLabel(event.type))}</p><small>${escapeHtml(taskName(event.taskId))} · ${escapeHtml(relativeTime(event.createdAt))}</small></div>`;
    if (event.announcementId) row.addEventListener("click", () => openAnnouncement(event.announcementId));
    else row.addEventListener("click", () => openTask(event.taskId));
    eventList.append(row);
  });
  document.querySelector("#events-empty").classList.toggle("hidden", events.length > 0);
}

function openTask(taskId) {
  state.selectedTaskId = taskId;
  renderSelectedTask();
  showView("task");
}

function renderSelectedTask() {
  const task = selectedTask();
  if (!task) return;
  const announcements = state.monitor.announcements.filter((item) => item.taskId === task.id).sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const runs = state.monitor.runs.filter((item) => item.taskId === task.id).slice(0, 30);
  const events = state.monitor.events.filter((item) => item.taskId === task.id);
  document.querySelector("#task-detail-name").textContent = task.name;
  document.querySelector("#task-detail-subtitle").textContent = `${task.type === "page" ? "页面监控" : "公告监控"} · ${hostLabel(task.listUrl)} · ${frequencyLabel(task.frequencyMinutes)} · ${task.enabled ? "已启用" : "已暂停"}`;
  document.querySelector("#task-toggle").textContent = task.enabled ? "暂停监控" : "启用监控";
  document.querySelector("#task-login").classList.toggle("hidden", !task.authentication?.enabled);
  document.querySelector("#task-stat-list").textContent = task.stats?.listCount ?? announcements.length;
  document.querySelector("#task-stat-events").textContent = events.filter((item) => !["order_changed"].includes(item.type)).length;
  document.querySelector("#task-stat-success").textContent = relativeTime(task.lastSuccessAt);
  document.querySelector("#task-stat-next").textContent = task.enabled ? relativeTime(task.nextRunAt) : "已暂停";
  const banner = document.querySelector("#task-health-banner");
  banner.className = `health-banner ${effectiveTaskStatus(task)}`;
  banner.textContent = task.status === "error" ? `采集异常：${task.lastError || "未知错误"}` : task.status === "running" ? task.type === "page" ? "正在检查页面区域，其他任务会在队列中等待。" : "正在检查公告列表，其他任务会在队列中等待。" : task.enabled ? "运行正常。任务会在后台按计划串行执行。" : "任务已暂停，不会进行定时检查。";

  const announcementList = document.querySelector("#task-announcement-list");
  announcementList.textContent = "";
  announcements.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "announcement-row";
    row.innerHTML = `<div><strong>${escapeHtml(item.title)}</strong><small>${item.versionCount ? `${item.versionCount} 个${task.type === "page" ? "页面" : "正文"}版本` : task.monitorMode === "list_only" ? "仅监控列表变化" : task.type === "page" ? "页面基线尚未采集" : "详情正文尚未采集"}</small></div><span class="announcement-date">${escapeHtml(item.date || relativeTime(item.firstSeenAt))}</span><span>›</span>`;
    row.addEventListener("click", () => openAnnouncement(item.id));
    announcementList.append(row);
  });
  document.querySelector("#task-announcement-empty").classList.toggle("hidden", announcements.length > 0);

  const runList = document.querySelector("#task-run-list");
  runList.textContent = "";
  runs.forEach((run) => {
    const row = document.createElement("div");
    row.className = `run-row ${run.status}`;
    row.innerHTML = `<span class="run-marker"></span><div><strong>${run.status === "success" ? "检查完成" : run.status === "failed" ? "检查失败" : "正在检查"} · ${escapeHtml(relativeTime(run.startedAt))}</strong><p>${escapeHtml(run.message || "正在运行…")} ${run.status === "success" ? `· ${run.listCount || 0} 条` : ""}</p></div>`;
    runList.append(row);
  });
  if (!runs.length) runList.innerHTML = '<div class="empty-compact">还没有运行记录</div>';

  const config = document.querySelector("#task-config-details");
  const profileName = (profileId, fallback) => (state.settings?.notificationProfiles || []).find((item) => item.id === profileId)?.name || fallback;
  const notifyLabels = [
    task.notifications?.wechat?.enabled ? profileName(task.notifications.wechat.profileId, "企业微信") : "",
    task.notifications?.email?.enabled ? profileName(task.notifications.email.profileId, "邮件") : ""
  ].filter(Boolean).join("、") || "未启用";
  const configRows = task.type === "page" ? [
    ["监控类型", "页面指定区域"],
    ["检查频率", frequencyLabel(task.frequencyMinutes)],
    ["暂停抓取", taskQuietHoursLabel(task)],
    ["通知渠道", notifyLabels],
    ["内容来源", task.plan?.page?.sourceType === "network_json" ? "网络响应" : "页面内容区域"],
    ["目标页面", task.listUrl],
    ["首次运行", "静默保存区域内容版本 1"],
    ["登录会话", task.authentication?.enabled ? "使用本机持久化登录会话" : "无需登录"],
    ["资源策略", "单区域采集 · 串行执行"]
  ] : [
    ["监控模式", task.monitorMode === "list_only" ? "仅监控列表变化" : "列表与公告详情"],
    ["检查频率", frequencyLabel(task.frequencyMinutes)],
    ["暂停抓取", taskQuietHoursLabel(task)],
    ["通知渠道", notifyLabels],
    ["列表来源", task.plan?.list?.sourceType === "network_json" ? "网络响应" : "页面内容"],
    ["详情来源", task.monitorMode === "list_only" ? "不采集详情" : task.plan?.detail?.sourceType === "network_json" ? "网络响应" : "页面内容"],
    ["列表页", task.listUrl],
    ["详情关联", task.monitorMode === "list_only" ? "使用列表中每条公告的原始 URL" : task.plan?.relation?.detailUrlTemplate || task.plan?.relation?.detailUrlSource || "列表中的链接"],
    ["首次运行", task.monitorMode === "list_only" ? "静默建立列表基线" : "静默建立基线并保存详情版本"],
    ["登录会话", task.authentication?.enabled ? "使用本机持久化登录会话" : "无需登录"],
    ["资源策略", task.monitorMode === "list_only" ? "只采集列表 · 串行执行" : "串行执行 · 每次轮转复查1条"]
  ];
  config.innerHTML = configRows.map(([label, value]) => `<div class="config-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

async function openAnnouncement(announcementId) {
  try {
    state.announcementHistory = await window.announcementProbe.getAnnouncement(announcementId);
    const { announcement, versions, events } = state.announcementHistory;
    document.querySelector("#dialog-title").textContent = announcement.title;
    document.querySelector("#dialog-meta").textContent = `${taskName(announcement.taskId)} · 首次发现 ${formatDateTime(announcement.firstSeenAt)} · ${versions.length} 个版本`;
    const select = document.querySelector("#dialog-version-select");
    select.textContent = "";
    versions.forEach((version, index) => {
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = `版本 ${versions.length - index} · ${formatDateTime(version.createdAt)}`;
      select.append(option);
    });
    document.querySelector("#dialog-version-control").classList.toggle("hidden", versions.length === 0);
    document.querySelector("#dialog-open-source").disabled = !announcement.url;
    const latestEvent = events[0];
    const summary = document.querySelector("#dialog-event-summary");
    summary.textContent = latestEvent?.summary ? `${eventTypeLabel(latestEvent.type)}：${latestEvent.summary}` : "";
    summary.classList.toggle("hidden", !latestEvent?.summary);
    renderSelectedVersion();
    document.querySelector("#announcement-dialog").showModal();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderSelectedVersion() {
  const history = state.announcementHistory;
  if (!history) return;
  const id = document.querySelector("#dialog-version-select").value;
  const version = history.versions.find((item) => item.id === id) || history.versions[0];
  const content = document.querySelector("#dialog-content");
  if (!version) {
    const task = state.monitor.tasks.find((item) => item.id === history.announcement.taskId);
    content.textContent = task?.monitorMode === "list_only" ? "当前任务仅监控公告列表变化，不采集详情正文。可点击“打开原公告”查看。" : "详情正文尚未采集；下一次详情复查会再次尝试获取。";
    return;
  }
  if (version.html) content.innerHTML = sanitizeRenderedHtml(version.html);
  else content.textContent = version.content || "没有正文内容";
}

function sanitizeRenderedHtml(value) {
  const documentFragment = new DOMParser().parseFromString(String(value || ""), "text/html");
  documentFragment.querySelectorAll("script,style,noscript,iframe,object,embed,form,svg,math,template,link,meta,base").forEach((node) => node.remove());
  documentFragment.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes || []).forEach((attribute) => {
      if (/^on/i.test(attribute.name) || attribute.name.toLowerCase() === "style") node.removeAttribute(attribute.name);
    });
    for (const attributeName of ["href", "src"]) {
      const target = node.getAttribute(attributeName);
      if (!target || /^(?:https?:|mailto:|tel:|#)/i.test(target)) continue;
      if (attributeName === "src" && /^data:image\/(?:png|gif|jpe?g|webp);/i.test(target)) continue;
      node.removeAttribute(attributeName);
    }
  });
  return documentFragment.body.innerHTML;
}

function openDialogSource() {
  const url = state.announcementHistory?.announcement?.url;
  if (url) window.announcementProbe.openExternal(url);
}

function openTaskEditor() {
  const task = selectedTask();
  if (!task) return;
  document.querySelector("#edit-task-name").value = task.name || "";
  document.querySelector("#edit-task-frequency").value = String(task.frequencyMinutes || 15);
  document.querySelector("#edit-quiet-hours-mode").value = task.quietHours?.mode || (task.quietHours?.enabled ? "custom" : "disabled");
  document.querySelector("#edit-quiet-hours-start").value = task.quietHours?.start || "00:00";
  document.querySelector("#edit-quiet-hours-end").value = task.quietHours?.end || "08:00";
  updateEditQuietHoursUi();
  const wechat = task.notifications?.wechat || {};
  populateNotificationProfileSelects();
  document.querySelector("#edit-wechat-profile").value = wechat.profileId || "";
  const email = task.notifications?.email || {};
  document.querySelector("#edit-email-profile").value = email.profileId || "";
  document.querySelector("#task-edit-dialog").showModal();
}

function closeTaskEditor() {
  document.querySelector("#task-edit-dialog").close();
}

async function saveTaskEdits() {
  const task = selectedTask();
  if (!task) return;
  const name = document.querySelector("#edit-task-name").value.trim();
  if (!name) return showToast("请填写任务名称。", true);
  const notifications = {
    wechat: {
      enabled: Boolean(document.querySelector("#edit-wechat-profile").value),
      profileId: document.querySelector("#edit-wechat-profile").value,
      eventTypes: mergeEventTypes(task.notifications?.wechat?.eventTypes, defaultWechatEventTypes())
    },
    email: {
      enabled: Boolean(document.querySelector("#edit-email-profile").value),
      profileId: document.querySelector("#edit-email-profile").value,
      eventTypes: mergeEventTypes(task.notifications?.email?.eventTypes, defaultEmailEventTypes())
    }
  };
  const button = document.querySelector("#task-edit-save");
  setBusy(button, true, "正在保存…");
  try {
    await window.announcementProbe.saveTask({
      id: task.id,
      type: task.type || "announcement",
      name,
      monitorMode: task.monitorMode || "list_and_detail",
      frequencyMinutes: Number(document.querySelector("#edit-task-frequency").value),
      quietHours: readQuietHours("edit-"),
      enabled: task.enabled,
      listUrl: task.listUrl,
      plan: task.plan,
      regionName: task.regionName || "",
      authentication: task.authentication || { enabled: false },
      notifications
    });
    await refreshMonitorState();
    closeTaskEditor();
    showToast("任务设置已保存。");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, "保存设置");
  }
}

async function saveTaskFromWizard() {
  if (!state.plan || !state.validationItems.length) return showToast("请先完成分析和验证。", true);
  const name = document.querySelector("#task-name").value.trim();
  if (!name) return showToast("请填写任务名称。", true);
  const notifications = readNotificationConfig();
  const pageMode = state.createTaskType === "page";
  const sampleItem = !pageMode && state.inputs.monitorMode === "list_and_detail" ? findSampleListItem(state.validationItems, state.inputs.detailUrl, state.inputs.detailSample) : null;
  if (!pageMode && state.inputs.monitorMode === "list_and_detail" && !state.plan.list.extraction.urlField && state.plan.list.sourceType !== "dom" && !state.plan.relation?.detailUrlTemplate) {
    return showToast("没有识别出列表到详情页的关联规则，暂时无法保存为监控任务。", true);
  }
  const button = document.querySelector("#save-task");
  setBusy(button, true, "正在保存…");
  try {
    const task = await window.announcementProbe.saveTask({
      type: pageMode ? "page" : "announcement",
      name,
      monitorMode: state.inputs.monitorMode,
      frequencyMinutes: Number(document.querySelector("#task-frequency").value),
      quietHours: readQuietHours(),
      enabled: true,
      listUrl: state.inputs.listUrl,
      sampleDetailUrl: state.inputs.detailUrl,
      sampleListItem: sampleItem?.raw || null,
      plan: state.plan,
      regionName: pageMode ? (state.validationDetail?.title || name) : "",
      authentication: { enabled: state.inputs.loginEnabled, sessionKey: state.inputs.authSessionKey },
      notifications
    });
    await refreshMonitorState();
    showToast("任务已保存，正在静默建立首次基线。");
    openTask(task.id);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, "保存并开始监控");
  }
}

function readNotificationConfig() {
  const listOnly = state.inputs?.monitorMode === "list_only" || document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only";
  const listChangeTypes = ["announcement_created", "announcement_date_changed", "metadata_updated", "order_changed"];
  return {
    wechat: {
      enabled: Boolean(document.querySelector("#wechat-profile").value),
      profileId: document.querySelector("#wechat-profile").value,
      eventTypes: listOnly ? listChangeTypes : defaultWechatEventTypes()
    },
    email: {
      enabled: Boolean(document.querySelector("#email-profile").value),
      profileId: document.querySelector("#email-profile").value,
      eventTypes: listOnly ? listChangeTypes : defaultEmailEventTypes()
    }
  };
}

function readEditNotificationConfig() {
  return {
    wechat: {
      enabled: Boolean(document.querySelector("#edit-wechat-profile").value),
      profileId: document.querySelector("#edit-wechat-profile").value,
      eventTypes: mergeEventTypes(selectedTask()?.notifications?.wechat?.eventTypes, defaultWechatEventTypes())
    },
    email: {
      enabled: Boolean(document.querySelector("#edit-email-profile").value),
      profileId: document.querySelector("#edit-email-profile").value,
      eventTypes: mergeEventTypes(selectedTask()?.notifications?.email?.eventTypes, defaultEmailEventTypes())
    }
  };
}

function readQuietHours(prefix = "") {
  const mode = document.querySelector(`#${prefix}quiet-hours-mode`)?.value || "global";
  const start = document.querySelector(`#${prefix}quiet-hours-start`)?.value || "00:00";
  const end = document.querySelector(`#${prefix}quiet-hours-end`)?.value || "08:00";
  return { mode, enabled: mode === "custom", start, end };
}

function previewNotification(channel, source = "create") {
  const task = source === "edit" ? selectedTask() : null;
  const taskNameValue = task?.name || document.querySelector("#task-name").value.trim() || "示例公告监控";
  const item = state.validationItems[0] || {};
  const title = state.validationDetail?.title || item.title || "这是一条示例公告";
  const listOnly = state.inputs?.monitorMode === "list_only" || (!state.inputs && document.querySelector('input[name="monitor-mode"]:checked')?.value === "list_only");
  const summary = listOnly ? "公告列表中出现了一条新公告。" : "这里会显示 DeepSeek 生成的30至50字公告摘要。";
  const sourceUrl = item.url || state.inputs?.detailUrl || task?.listUrl || "https://example.com/announcement";
  const container = document.querySelector("#preview-content");
  document.querySelector("#preview-title").textContent = channel === "wechat" ? "企业微信消息预览" : "邮件通知预览";
  if (channel === "wechat") {
    container.innerHTML = `<div class="preview-stack"><div class="preview-wechat"><h3>新公告 · ${escapeHtml(taskNameValue)}</h3><p><b>公告：</b>${escapeHtml(title)}</p><p><b>摘要：</b>${escapeHtml(summary)}</p><p><a href="#">查看原公告</a></p><small>发现于 ${escapeHtml(formatDateTime(new Date().toISOString()))}</small></div><div class="preview-wechat"><h3>公告内容更新 · ${escapeHtml(taskNameValue)}</h3><p><b>公告：</b>${escapeHtml(title)}</p><p><b>更新摘要：</b>调整了执行时间和接口范围，其他内容保持不变。</p><p><a href="#">查看原公告</a></p><small>纯标点、排版及不影响事实的错别字不会发送</small></div></div>`;
  } else {
    const excerpt = state.validationDetail?.content?.slice(0, 800) || "邮件中会保留清洗后的公告全文；这里展示的是预览内容。";
    container.innerHTML = `<div class="preview-email"><div class="preview-email-header"><small>${escapeHtml(taskNameValue)} · 新公告</small><h3>${escapeHtml(title)}</h3><div><b>摘要：</b>${escapeHtml(summary)}</div><div><a href="${escapeHtml(sourceUrl)}">查看原公告</a></div></div><div class="preview-email-body">${escapeHtml(excerpt).replace(/\n/g, "<br>")}</div></div>`;
  }
  document.querySelector("#notification-preview-dialog").showModal();
}

async function testNotification(channel, source = "create") {
  const selector = source === "edit" ? (channel === "wechat" ? "#edit-test-wechat" : "#edit-test-email") : (channel === "wechat" ? "#test-wechat" : "#test-email");
  const button = document.querySelector(selector);
  setBusy(button, true, "发送中…");
  try {
    const task = source === "edit" ? selectedTask() : null;
    const notifications = source === "edit" ? readEditNotificationConfig() : readNotificationConfig();
    const profileId = notifications[channel]?.profileId;
    if (!profileId) throw new Error(`请先选择${channel === "wechat" ? "企业微信" : "邮件"}通知配置`);
    const result = await window.announcementProbe.testNotification({ channel, profileId, taskName: task?.name || document.querySelector("#task-name").value.trim() });
    showToast(result.status === "sent" ? "测试通知已发送。" : `发送失败：${result.message}`, result.status !== "sent");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, source === "edit" ? "发送测试" : channel === "wechat" ? "发送测试消息" : "发送测试邮件");
  }
}

function defaultWechatEventTypes() {
  return ["announcement_created", "announcement_date_changed", "content_updated", "metadata_updated", "order_changed"];
}

function defaultEmailEventTypes() {
  return ["announcement_created", "announcement_date_changed", "content_updated", "metadata_updated", "order_changed"];
}

function mergeEventTypes(existing, defaults) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...defaults])];
}

async function runSelectedTask() {
  const task = selectedTask();
  if (!task) return;
  const result = await window.announcementProbe.runTask(task.id);
  showToast(result.queued ? "任务已加入节能执行队列。" : "任务已经在队列或正在运行。", !result.queued);
  await refreshMonitorState();
}

async function toggleSelectedTask() {
  const task = selectedTask();
  if (!task) return;
  await window.announcementProbe.toggleTask(task.id, !task.enabled);
  await refreshMonitorState();
  showToast(task.enabled ? "任务已暂停。" : "任务已启用并加入检查队列。");
}

async function deleteSelectedTask() {
  const task = selectedTask();
  if (!task || !confirm(`确定删除“${task.name}”及其全部历史数据吗？`)) return;
  await window.announcementProbe.deleteTask(task.id);
  state.selectedTaskId = "";
  await refreshMonitorState();
  showView("dashboard");
  showToast("任务及其本地历史已删除。 ");
}

function populateSettings(settings) {
  document.querySelector("#settings-model").value = settings.deepseekModel || "deepseek-v4-flash";
  document.querySelector("#settings-thinking").value = settings.deepseekThinking || "disabled";
  document.querySelector("#settings-remember-key").checked = Boolean(settings.deepseekApiKey);
  document.querySelector("#settings-launch-at-login").checked = Boolean(settings.launchAtLogin);
  document.querySelector("#settings-keep-running").checked = settings.keepRunningInTray !== false;
  document.querySelector("#settings-quiet-hours-enabled").checked = Boolean(settings.defaultQuietHours?.enabled);
  document.querySelector("#settings-quiet-hours-start").value = settings.defaultQuietHours?.start || "00:00";
  document.querySelector("#settings-quiet-hours-end").value = settings.defaultQuietHours?.end || "08:00";
  updateSettingsQuietHoursUi();
  populateNotificationProfileSelects();
  const exceptionAlerts = settings.exceptionAlerts || {};
  document.querySelector("#exception-alerts-enabled").checked = exceptionAlerts.enabled !== false;
  document.querySelector("#exception-failure-threshold").value = String(exceptionAlerts.failureThreshold || 3);
  document.querySelector("#exception-cooldown").value = String(exceptionAlerts.cooldownMinutes || 360);
  document.querySelector("#exception-wechat-profile").value = exceptionAlerts.wechatProfileId || "";
  document.querySelector("#exception-email-profile").value = exceptionAlerts.emailProfileId || "";
  document.querySelector("#exception-collection-failed").checked = exceptionAlerts.collectionFailed !== false;
  document.querySelector("#exception-config-invalid").checked = exceptionAlerts.configurationInvalid !== false;
  document.querySelector("#exception-auth-expired").checked = exceptionAlerts.authenticationExpired !== false;
  document.querySelector("#exception-recovered").checked = exceptionAlerts.recovered !== false;
  renderNotificationProfiles();
}

function populateNotificationProfileSelects() {
  const profiles = state.settings?.notificationProfiles || [];
  [
    ["#wechat-profile", "wechat", "不发送企业微信"],
    ["#edit-wechat-profile", "wechat", "不发送企业微信"],
    ["#exception-wechat-profile", "wechat", "不发送企业微信"],
    ["#email-profile", "email", "不发送邮件"],
    ["#edit-email-profile", "email", "不发送邮件"],
    ["#exception-email-profile", "email", "不发送邮件"]
  ].forEach(([selector, channel, emptyLabel]) => {
    const select = document.querySelector(selector);
    if (!select) return;
    const previous = select.value;
    select.textContent = "";
    select.append(new Option(emptyLabel, ""));
    profiles.filter((item) => item.channel === channel).forEach((profile) => select.append(new Option(profile.name, profile.id)));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  });
}

function renderNotificationProfiles() {
  const container = document.querySelector("#notification-profile-list");
  const profiles = state.settings?.notificationProfiles || [];
  if (!profiles.length) {
    container.innerHTML = '<div class="empty-compact">还没有通知配置，可先添加企业微信机器人或邮件。</div>';
    return;
  }
  container.innerHTML = profiles.map((profile) => `
    <div class="profile-row">
      <span class="profile-icon">${profile.channel === "wechat" ? "微" : "邮"}</span>
      <div><strong>${escapeHtml(profile.name)}</strong><small>${profile.channel === "wechat" ? "企业微信机器人" : `${escapeHtml(profile.user || "邮件账号")} → ${escapeHtml(profile.to || "收件人")}`}</small></div>
      <span class="status-pill success">已配置</span>
      <button class="button secondary small" data-profile-test="${escapeHtml(profile.id)}" type="button">测试</button>
      <button class="button secondary small" data-profile-edit="${escapeHtml(profile.id)}" type="button">编辑</button>
    </div>`).join("");
  container.querySelectorAll("[data-profile-edit]").forEach((button) => button.addEventListener("click", () => {
    const profile = profiles.find((item) => item.id === button.dataset.profileEdit);
    if (profile) openNotificationProfileEditor(profile.channel, profile.id);
  }));
  container.querySelectorAll("[data-profile-test]").forEach((button) => button.addEventListener("click", async () => {
    const profile = profiles.find((item) => item.id === button.dataset.profileTest);
    if (!profile) return;
    setBusy(button, true, "发送中…");
    try {
      const result = await window.announcementProbe.testNotification({ channel: profile.channel, profileId: profile.id, taskName: "通知配置测试" });
      showToast(result.status === "sent" ? "测试通知已发送。" : `发送失败：${result.message}`, result.status !== "sent");
    } catch (error) { showToast(error.message, true); }
    finally { setBusy(button, false, "测试"); }
  }));
}

function openNotificationProfileEditor(channel, profileId = "") {
  const profile = (state.settings?.notificationProfiles || []).find((item) => item.id === profileId);
  document.querySelector("#profile-id").value = profile?.id || "";
  document.querySelector("#profile-channel").value = channel;
  document.querySelector("#profile-dialog-title").textContent = profile ? "编辑通知配置" : `新建${channel === "wechat" ? "企业微信" : "邮件"}配置`;
  document.querySelector("#profile-name").value = profile?.name || "";
  document.querySelector("#profile-wechat-fields").classList.toggle("hidden", channel !== "wechat");
  document.querySelector("#profile-email-fields").classList.toggle("hidden", channel !== "email");
  document.querySelector("#profile-webhook").value = "";
  document.querySelector("#profile-webhook").placeholder = profile ? "已安全保存，留空不修改" : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?...";
  document.querySelector("#profile-smtp-host").value = profile?.host || "";
  document.querySelector("#profile-smtp-port").value = String(profile?.port || 465);
  document.querySelector("#profile-smtp-user").value = profile?.user || "";
  document.querySelector("#profile-smtp-password").value = "";
  document.querySelector("#profile-smtp-password").placeholder = profile ? "已安全保存，留空不修改" : "密码或授权码";
  document.querySelector("#profile-smtp-to").value = profile?.to || "";
  document.querySelector("#profile-smtp-secure").checked = profile?.secure !== false;
  document.querySelector("#profile-delete").classList.toggle("hidden", !profile);
  document.querySelector("#notification-profile-dialog").showModal();
}

function closeNotificationProfileEditor() {
  document.querySelector("#notification-profile-dialog").close();
}

async function saveNotificationProfile() {
  const channel = document.querySelector("#profile-channel").value;
  const button = document.querySelector("#profile-save");
  const payload = {
    id: document.querySelector("#profile-id").value,
    channel,
    name: document.querySelector("#profile-name").value.trim(),
    webhook: document.querySelector("#profile-webhook").value.trim(),
    host: document.querySelector("#profile-smtp-host").value.trim(),
    port: Number(document.querySelector("#profile-smtp-port").value || 465),
    secure: document.querySelector("#profile-smtp-secure").checked,
    user: document.querySelector("#profile-smtp-user").value.trim(),
    password: document.querySelector("#profile-smtp-password").value,
    to: document.querySelector("#profile-smtp-to").value.trim()
  };
  setBusy(button, true, "正在保存…");
  try {
    await window.announcementProbe.saveNotificationProfile(payload);
    state.settings = await window.announcementProbe.loadSettings();
    populateSettings(state.settings);
    closeNotificationProfileEditor();
    showToast("通知配置已保存。");
  } catch (error) { showToast(error.message, true); }
  finally { setBusy(button, false, "保存配置"); }
}

async function deleteNotificationProfile() {
  const profileId = document.querySelector("#profile-id").value;
  if (!profileId || !confirm("确定删除这个通知配置吗？")) return;
  try {
    await window.announcementProbe.deleteNotificationProfile(profileId);
    state.settings = await window.announcementProbe.loadSettings();
    populateSettings(state.settings);
    closeNotificationProfileEditor();
    showToast("通知配置已删除。");
  } catch (error) { showToast(error.message, true); }
}

async function saveApplicationSettings() {
  const button = document.querySelector("#save-settings-button");
  setBusy(button, true, "正在保存…");
  try {
    const apiKey = document.querySelector("#settings-api-key").value.trim();
    await window.announcementProbe.saveSettings({
      apiKey,
      model: document.querySelector("#settings-model").value.trim(),
      thinking: document.querySelector("#settings-thinking").value,
      rememberKey: document.querySelector("#settings-remember-key").checked && Boolean(apiKey || state.settings?.deepseekApiKey),
      launchAtLogin: document.querySelector("#settings-launch-at-login").checked,
      keepRunningInTray: document.querySelector("#settings-keep-running").checked,
      defaultQuietHours: {
        enabled: document.querySelector("#settings-quiet-hours-enabled").checked,
        start: document.querySelector("#settings-quiet-hours-start").value || "00:00",
        end: document.querySelector("#settings-quiet-hours-end").value || "08:00"
      },
      exceptionAlerts: {
        enabled: document.querySelector("#exception-alerts-enabled").checked,
        failureThreshold: Number(document.querySelector("#exception-failure-threshold").value || 3),
        cooldownMinutes: Number(document.querySelector("#exception-cooldown").value || 360),
        wechatProfileId: document.querySelector("#exception-wechat-profile").value,
        emailProfileId: document.querySelector("#exception-email-profile").value,
        collectionFailed: document.querySelector("#exception-collection-failed").checked,
        configurationInvalid: document.querySelector("#exception-config-invalid").checked,
        authenticationExpired: document.querySelector("#exception-auth-expired").checked,
        recovered: document.querySelector("#exception-recovered").checked
      }
    });
    state.settings = await window.announcementProbe.loadSettings();
    showToast("设置已保存。 ");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, "保存设置");
  }
}

function openBackupDialog(mode) {
  const importing = mode === "import";
  document.querySelector("#backup-mode").value = importing ? "import" : "export";
  document.querySelector("#backup-dialog-title").textContent = importing ? "导入完整备份" : "导出完整备份";
  document.querySelector("#backup-dialog-description").textContent = importing
    ? "请输入创建备份时设置的密码，随后选择备份文件。"
    : "备份包含任务、历史数据和凭证，文件会使用此密码加密。";
  document.querySelector("#backup-password").value = "";
  document.querySelector("#backup-password-confirm").value = "";
  document.querySelector("#backup-password-confirm-field").classList.toggle("hidden", importing);
  document.querySelector("#backup-import-warning").classList.toggle("hidden", !importing);
  document.querySelector("#backup-confirm").textContent = importing ? "选择备份并导入" : "选择保存位置";
  document.querySelector("#backup-dialog").showModal();
  document.querySelector("#backup-password").focus();
}

function closeBackupDialog() {
  document.querySelector("#backup-dialog").close();
}

async function confirmBackupOperation() {
  const mode = document.querySelector("#backup-mode").value;
  const password = document.querySelector("#backup-password").value;
  const confirmation = document.querySelector("#backup-password-confirm").value;
  if (password.length < 8) return showToast("备份密码至少需要 8 个字符。", true);
  if (mode === "export" && password !== confirmation) return showToast("两次输入的备份密码不一致。", true);
  if (mode === "import" && !confirm("导入会替换当前全部任务、历史记录和设置，确定继续吗？")) return;
  const button = document.querySelector("#backup-confirm");
  setBusy(button, true, mode === "import" ? "正在导入…" : "正在导出…");
  try {
    const result = mode === "import"
      ? await window.announcementProbe.importBackup({ password })
      : await window.announcementProbe.exportBackup({ password });
    if (result?.canceled) return;
    closeBackupDialog();
    if (mode === "import") {
      const [settings, monitor] = await Promise.all([window.announcementProbe.loadSettings(), window.announcementProbe.getMonitorState()]);
      state.settings = settings;
      state.monitor = monitor;
      populateSettings(settings);
      renderMonitorShell();
      showView("dashboard");
      showToast(`完整备份已导入：${result.taskCount || 0} 个任务。`);
    } else {
      showToast("完整备份已加密导出。请妥善保存备份密码。");
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false, mode === "import" ? "选择备份并导入" : "选择保存位置");
  }
}

function handleRuntimeEvent(event) {
  const { type, detail = {} } = event || {};
  if (["run-started", "run-progress", "run-failed", "run-completed", "run-skipped", "capture-progress", "detail-capture-failed"].includes(type)) {
    const relatedTaskName = detail.taskName || (detail.taskId ? taskName(detail.taskId) : "");
    appendGlobalLog({ scope: relatedTaskName ? `后台监控 · ${relatedTaskName}` : "后台监控", message: detail.message || runtimeEventLabel(type, detail), level: type === "run-failed" ? "error" : type === "run-completed" ? "success" : "info", elapsedMs: detail.elapsedMs || 0, taskId: detail.taskId || "", taskName: relatedTaskName });
  }
  if (["run-failed", "run-completed", "run-skipped", "state-changed"].includes(type)) {
    clearTimeout(handleRuntimeEvent.refreshTimer);
    handleRuntimeEvent.refreshTimer = setTimeout(() => refreshMonitorState().catch(() => {}), 250);
  }
}

function selectedTask() {
  return state.monitor.tasks.find((task) => task.id === state.selectedTaskId);
}

function taskName(taskId) {
  return state.monitor.tasks.find((task) => task.id === taskId)?.name || "公告监控";
}

function findSampleListItem(items, detailUrl, detailSample) {
  const decodedUrl = decodeURIComponent(String(detailUrl || ""));
  return items.find((item) => item.id && decodedUrl.includes(String(item.id)))
    || items.find((item) => Object.values(item.raw || {}).some((value) => ["string", "number"].includes(typeof value) && String(value).length >= 3 && decodedUrl.includes(String(value))))
    || items.find((item) => item.title && normalizeText(detailSample).includes(normalizeText(item.title)))
    || items[0];
}

function buildDetailUrlTemplate(detailUrl, raw) {
  let template = String(detailUrl || "");
  const entries = Object.entries(raw || {})
    .filter(([, value]) => ["string", "number"].includes(typeof value) && String(value).length >= 2)
    .sort((a, b) => String(b[1]).length - String(a[1]).length);
  entries.forEach(([key, value]) => {
    const plain = String(value);
    const encoded = encodeURIComponent(plain);
    if (template.includes(plain)) template = template.split(plain).join(`{${key}}`);
    else if (template.includes(encoded)) template = template.split(encoded).join(`{${key}}`);
  });
  return /\{[^{}]+\}/.test(template) ? template : "";
}

function frequencyLabel(minutes) {
  const value = Number(minutes || 15);
  if (value === 1440) return "每天一次";
  if (value >= 60 && value % 60 === 0) return `每${value / 60}小时`;
  return `每${value}分钟`;
}

function statusLabel(task) {
  if (!task.enabled) return "已暂停";
  return ({ healthy: "运行正常", error: "需要处理", running: "正在检查", idle: "等待首次运行" })[task.status] || "等待运行";
}

function effectiveTaskStatus(task) {
  return task?.enabled ? (task.status || "idle") : "paused";
}

function taskQuietHoursLabel(task) {
  const quiet = task?.quietHours || {};
  const mode = quiet.mode || (quiet.enabled ? "custom" : "disabled");
  if (mode === "global") {
    const globalQuiet = state.settings?.defaultQuietHours || {};
    return globalQuiet.enabled ? `使用全局：${globalQuiet.start || "00:00"}–${globalQuiet.end || "08:00"}` : "使用全局：当前未启用";
  }
  if (mode === "custom") return `单独设置：${quiet.start || "00:00"}–${quiet.end || "08:00"}`;
  return "此任务不暂停";
}

function eventTypeLabel(type) {
  return ({ announcement_created: "新公告", announcement_date_changed: "公告日期变化，可能存在更新", content_updated: "内容更新", metadata_updated: "公告信息更新", order_changed: "顺序变化", authentication_expired: "登录已失效", collection_failed: "监控异常", collection_config_invalid: "采集配置可能失效", collection_recovered: "监控恢复" })[type] || "监控内容变化";
}

function relativeTime(value) {
  if (!value) return "尚未运行";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const diff = time - Date.now();
  const absolute = Math.abs(diff);
  if (absolute < 60_000) return diff > 0 ? "不到1分钟后" : "刚刚";
  if (absolute < 60 * 60_000) return `${Math.round(absolute / 60_000)}分钟${diff > 0 ? "后" : "前"}`;
  if (absolute < 24 * 60 * 60_000) return `${Math.round(absolute / 3_600_000)}小时${diff > 0 ? "后" : "前"}`;
  return formatDateTime(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function hostLabel(value) {
  try { return new URL(value).hostname; } catch (_error) { return value || "—"; }
}

function runtimeEventLabel(type, detail) {
  if (type === "run-started") return "开始执行监控任务";
  if (type === "run-completed") return `检查完成：${detail.listCount || 0} 条公告，${detail.changeCount || 0} 项变化`;
  if (type === "run-failed") return detail.message || "任务运行失败";
  if (type === "run-skipped") return detail.message || "处于暂停抓取时段，已跳过";
  return detail.message || type;
}

function discoverListCandidates(capture, sampleText) {
  const candidates = [];
  const sampleNormalized = normalizeText(sampleText);

  capture.responses.forEach((response, responseIndex) => {
    const parsed = parseMaybeJson(response.body);
    if (parsed == null) return;

    walkJson(parsed, "$", (value, path) => {
      if (!Array.isArray(value) || value.length < 2 || value.length > 5000) return;
      const records = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
      if (records.length < Math.min(2, value.length) || records.length / value.length < 0.65) return;

      const sampleRecords = records.slice(0, 8);
      const fields = inferListFields(sampleRecords, sampleText);
      const primitiveText = sampleRecords.map(flattenPrimitiveValues).flat().join(" ");
      const overlap = sampleMatchRatio(sampleText, primitiveText);
      const homogeneity = structureSimilarity(sampleRecords);
      const semanticBonus = [fields.titleField, fields.idField, fields.urlField, fields.dateField].filter(Boolean).length * 0.055;
      const lengthBonus = value.length >= 5 && value.length <= 100 ? 0.08 : 0.02;
      const score = clamp(overlap * 0.72 + homogeneity * 0.14 + semanticBonus + lengthBonus, 0, 1);

      candidates.push({
        id: `list-network-${responseIndex}-${candidates.length}`,
        sourceType: "network_json",
        score,
        responseIndex,
        url: response.url,
        method: response.method,
        resourceType: response.resourceType,
        collectionPath: path,
        length: value.length,
        fields,
        sampleRecords: sampleRecords.slice(0, 2).map((item) => compactRecord(item)),
        matchPreview: bestMatchingValues(sampleNormalized, sampleRecords)
      });
    }, 7);
  });

  const pageLinks = capture.dom.links
    .filter((item) => item.text.length >= 4 && item.text.length <= 240)
    .map((item) => ({ title: item.text, url: item.href, date: item.date || "", context: item.context || "", signature: item.signature || "a" }));
  const linkGroups = pageLinks.reduce((groups, item) => {
    if (!groups.has(item.signature)) groups.set(item.signature, []);
    groups.get(item.signature).push(item);
    return groups;
  }, new Map());
  [...linkGroups.entries()].forEach(([signature, group], groupIndex) => {
    const matchingLinks = group.filter((item) => fuzzyContains(sampleText, item.title));
    if (group.length < 2 || !matchingLinks.length) return;
    candidates.push({
      id: `list-dom-${groupIndex}`,
      sourceType: "dom",
      score: clamp(sampleMatchRatio(sampleText, group.map((item) => `${item.title} ${item.date}`).join("\n")) + 0.12, 0, 1),
      responseIndex: null,
      url: capture.finalUrl,
      method: "GET",
      collectionPath: "dom.links",
      domSignature: signature,
      length: group.length,
      fields: { idField: "", titleField: "title", urlField: "url", dateField: "date", typeField: "" },
      sampleRecords: matchingLinks.slice(0, 3),
      matchPreview: matchingLinks.slice(0, 4).map((item) => item.title)
    });
  });

  const pageBlocks = (capture.dom.blocks || []).filter((item) => item.title?.length >= 4 && item.title.length <= 240);
  const blockGroups = pageBlocks.reduce((groups, item) => {
    if (!groups.has(item.signature)) groups.set(item.signature, []);
    groups.get(item.signature).push(item);
    return groups;
  }, new Map());
  [...blockGroups.entries()].forEach(([signature, group], groupIndex) => {
    const matchingBlocks = group.filter((item) => fuzzyContains(sampleText, item.title));
    if (group.length < 2 || !matchingBlocks.length) return;
    candidates.push({
      id: `list-dom-blocks-${groupIndex}`,
      sourceType: "dom_blocks",
      score: clamp(sampleMatchRatio(sampleText, group.map((item) => `${item.title} ${item.date}`).join("\n")) + 0.14, 0, 1),
      responseIndex: null,
      url: capture.finalUrl,
      method: "GET",
      collectionPath: "dom.blocks",
      domSignature: signature,
      length: group.length,
      fields: { idField: "id", titleField: "title", urlField: "href", dateField: "date", typeField: "name" },
      records: group.slice(0, 30),
      sampleRecords: matchingBlocks.slice(0, 3),
      matchPreview: matchingBlocks.slice(0, 4).map((item) => item.title)
    });
  });

  return dedupeCandidates(candidates)
    .filter((candidate) => candidate.score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function discoverDetailCandidates(capture, sampleText) {
  const candidates = [];

  capture.responses.forEach((response, responseIndex) => {
    const parsed = parseMaybeJson(response.body);
    if (parsed == null) return;

    walkJson(parsed, "$", (value, path) => {
      if (typeof value !== "string" || value.length < 80) return;
      const readable = htmlToText(value).slice(0, 80_000);
      if (normalizeText(readable).length < 60) return;
      const fields = inferDetailFields(parsed, path, sampleText);
      const assembled = detailCandidateAsText(fields, readable);
      const overlap = sampleMatchRatio(sampleText, assembled);
      const bodyOverlap = sampleMatchRatio(sampleText, readable);
      const lengthBonus = readable.length >= 300 ? 0.08 : 0.02;
      candidates.push({
        id: `detail-network-${responseIndex}-${candidates.length}`,
        sourceType: "network_json",
        score: clamp(overlap * 0.82 + bodyOverlap * 0.08 + lengthBonus, 0, 1),
        responseIndex,
        url: response.url,
        method: response.method,
        resourceType: response.resourceType,
        contentPath: path,
        fields,
        siblingFields: fields.siblingFields,
        sampleCoverage: overlap,
        missingSampleLines: missingSampleLines(sampleText, assembled),
        contentLength: readable.length,
        preview: readable.slice(0, 900)
      });
    }, 8);
  });

  if (capture.dom.text && normalizeText(capture.dom.text).length >= 80) {
    candidates.push({
      id: "detail-dom-text",
      sourceType: "dom",
      score: clamp(sampleMatchRatio(sampleText, capture.dom.text) * 0.72 + 0.02, 0, 0.76),
      responseIndex: null,
      url: capture.finalUrl,
      method: "GET",
      contentPath: "dom.text",
      fields: {
        titlePath: "",
        idPath: "",
        createdAtPath: "",
        updatedAtPath: "",
        metadataPaths: [],
        siblingFields: []
      },
      contentLength: capture.dom.text.length,
      preview: capture.dom.text.slice(0, 900)
    });
  }

  (capture.dom.embeddedDetails || []).forEach((detail, index) => {
    const score = sampleMatchRatio(sampleText, `${detail.title || ""}\n${detail.date || ""}\n${detail.text || ""}`);
    if (score < 0.08) return;
    candidates.push({
      id: `detail-dom-embedded-${index}`,
      sourceType: "dom_embedded",
      score: clamp(score + 0.12, 0, 1),
      responseIndex: null,
      url: capture.finalUrl,
      method: "GET",
      contentPath: "dom.embeddedDetails",
      domSignature: detail.signature || "",
      domId: detail.id,
      fields: {
        titlePath: "title",
        idPath: "id",
        createdAtPath: "date",
        updatedAtPath: "",
        metadataPaths: [],
        siblingFields: []
      },
      contentLength: detail.text.length,
      preview: detail.text.slice(0, 900)
    });
  });

  (capture.dom.regions || []).forEach((region, index) => {
    const score = sampleMatchRatio(sampleText, `${region.title || ""}\n${region.text || ""}`);
    if (score < 0.08) return;
    candidates.push({
      id: `detail-dom-region-${index}`,
      sourceType: "dom_region",
      score: clamp(score + 0.1, 0, 1),
      responseIndex: null,
      url: capture.finalUrl,
      method: "GET",
      contentPath: "dom.regions",
      domSignature: region.signature || "",
      domId: region.id || "",
      fields: { titlePath: "title", idPath: "id", createdAtPath: "", updatedAtPath: "", metadataPaths: [], siblingFields: [] },
      contentLength: region.text.length,
      preview: region.text.slice(0, 900)
    });
  });

  return dedupeCandidates(candidates)
    .filter((candidate) => candidate.score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function buildPageDeepSeekPrompt(inputs, detailCandidates) {
  const payload = {
    task: "从候选中选择最能稳定代表用户复制区域的一个页面内容来源。这个任务直接监控一个页面区域，不涉及公告列表。",
    constraints: [
      "只能选择提供的 candidateId，禁止编造候选。",
      "优先选择结构化网络 JSON；静态页面可选择 DOM 区域。",
      "Token、签名、时间戳、Cookie、鉴权参数不得作为稳定匹配条件。",
      "必须输出 JSON，不要输出 Markdown。"
    ],
    page: {
      url: sanitizeUrl(inputs.listUrl),
      copiedSample: compactSample(inputs.listSample, 1500),
      candidates: detailCandidates.slice(0, 3).map(candidateForPrompt)
    },
    requiredJsonShape: {
      version: 1,
      page: { candidateId: "必须来自候选", confidence: 0.9, reasoning: "简短理由" },
      confidence: 0.9,
      reasoning: "一句整体判断",
      warnings: []
    }
  };
  return `请分析以下数据并严格按 requiredJsonShape 输出 JSON：\n${JSON.stringify(payload)}`;
}

function normalizePagePlan(rawPlan, detailCandidates) {
  const selected = detailCandidates.find((item) => item.id === rawPlan?.page?.candidateId) || detailCandidates[0];
  const fallback = buildFallbackPagePlan(selected);
  const matcher = selected.sourceType === "network_json" ? buildRequestMatcher(selected) : fallback.page.requestMatcher;
  const knownPaths = new Set((selected.siblingFields || []).map((item) => item.path));
  return {
    version: 1,
    monitorType: "page",
    page: {
      sourceType: selected.sourceType,
      candidateId: selected.id,
      requestMatcher: mergeMatcher(matcher, rawPlan?.page?.requestMatcher),
      extraction: {
        contentPath: selected.contentPath,
        domSignature: selected.domSignature || "",
        domId: selected.domId || "",
        titlePath: selectKnownPath(rawPlan?.page?.extraction?.titlePath, selected.fields?.titlePath, knownPaths),
        createdAtPath: selectKnownPath(rawPlan?.page?.extraction?.createdAtPath, selected.fields?.createdAtPath, knownPaths),
        updatedAtPath: selectKnownPath(rawPlan?.page?.extraction?.updatedAtPath, selected.fields?.updatedAtPath, knownPaths),
        metadataPaths: normalizeMetadataPaths(rawPlan?.page?.extraction?.metadataPaths, selected.fields?.metadataPaths, knownPaths)
      },
      confidence: clamp(Number(rawPlan?.page?.confidence ?? selected.score), 0, 1),
      reasoning: rawPlan?.page?.reasoning || "选择与复制区域样例匹配度最高的候选。"
    },
    confidence: clamp(Number(rawPlan?.confidence ?? selected.score), 0, 1),
    reasoning: rawPlan?.reasoning || "依据复制样例与候选内容的文字重合度生成。",
    warnings: Array.isArray(rawPlan?.warnings) ? rawPlan.warnings.slice(0, 8) : []
  };
}

function buildFallbackPagePlan(candidate, warning = "") {
  return {
    version: 1,
    monitorType: "page",
    page: {
      sourceType: candidate.sourceType,
      candidateId: candidate.id,
      requestMatcher: buildRequestMatcher(candidate),
      extraction: {
        contentPath: candidate.contentPath,
        domSignature: candidate.domSignature || "",
        domId: candidate.domId || "",
        titlePath: candidate.fields?.titlePath || "",
        createdAtPath: candidate.fields?.createdAtPath || "",
        updatedAtPath: candidate.fields?.updatedAtPath || "",
        metadataPaths: candidate.fields?.metadataPaths || []
      },
      confidence: candidate.score,
      reasoning: "本地规则选择了与页面区域样例匹配分最高的候选。"
    },
    confidence: candidate.score,
    reasoning: "依据复制样例生成页面区域监控方案。",
    warnings: warning ? [warning] : []
  };
}

function buildDeepSeekPrompt(inputs, listCandidates, detailCandidates) {
  const compactListCandidates = listCandidates.slice(0, 2);
  const compactDetailCandidates = detailCandidates.slice(0, 2);
  const listOnly = inputs.monitorMode === "list_only";
  const payload = {
    task: listOnly ? "只选择公告主列表候选。本任务仅监控列表新增和日期变化，不采集公告详情。" : "只选择公告主列表和公告详情候选，并判断二者关系。本地程序会依据候选自动生成请求匹配与提取路径，不要重复抄写这些字段。",
    constraints: [
      "只能选择提供的 candidateId，禁止编造候选。",
      "优先选择结构化网络 JSON；只有网络候选匹配不足时才选择 DOM。",
      "Token、签名、时间戳、Cookie、鉴权参数不得作为稳定匹配条件。",
      "复制样例可能格式混乱，以标题、日期、正文语义和字符串重合为判断依据。",
      ...(listOnly ? [] : [
        "详情样例中的标题、标签、创建时间、更新时间也属于必须提取的内容，不能只匹配正文。",
        "详情候选的 inferredFields 和 siblingFields 来自正文同级对象；优先复用这些真实路径，禁止编造不存在的路径。",
        "如果样例的重要行未被正文覆盖，应从同级字段中补齐，并用 metadataPaths 描述其他元数据。"
      ]),
      "必须输出 JSON，不要输出 Markdown。"
    ],
    listPage: {
      url: sanitizeUrl(inputs.listUrl),
      copiedSample: compactSample(inputs.listSample, 700),
      candidates: compactListCandidates.map(candidateForPrompt)
    },
    detailPage: listOnly ? null : {
      url: sanitizeUrl(inputs.detailUrl),
      copiedSample: compactSample(inputs.detailSample, 1100),
      candidates: compactDetailCandidates.map(candidateForPrompt)
    },
    requiredJsonShape: {
      version: 1,
      list: {
        candidateId: "必须来自列表候选",
        confidence: 0.9,
        reasoning: "简短理由"
      },
      detail: listOnly ? null : {
        candidateId: "必须来自详情候选",
        extraction: {
          metadataPaths: [
            { label: "仅在样例标签需要代码映射时填写", path: "必须来自 siblingFields", valueMap: { "1": "示例标签" } }
          ]
        },
        confidence: 0.9,
        reasoning: "简短理由"
      },
      relation: listOnly ? {} : {
        detailUrlSource: "列表的 url 字段、ID模板或用户提供的详情URL",
        explanation: "列表项如何关联详情页"
      },
      confidence: 0.9,
      reasoning: "一句整体判断",
      warnings: []
    }
  };
  return `请分析以下数据并严格按 requiredJsonShape 输出 JSON：\n${JSON.stringify(payload)}`;
}

function candidateForPrompt(candidate) {
  if (candidate.sourceType !== "network_json") {
    return {
      candidateId: candidate.id,
      sourceType: candidate.sourceType,
      score: round(candidate.score),
      pageUrl: sanitizeUrl(candidate.url),
      collectionPath: candidate.collectionPath,
      contentPath: candidate.contentPath,
      domSignature: candidate.domSignature,
      domId: candidate.domId,
      length: candidate.length || candidate.contentLength,
      inferredFields: compactInferredFields(candidate.fields),
      samples: compactCandidateSamples(candidate)
    };
  }
  return {
    candidateId: candidate.id,
    sourceType: candidate.sourceType,
    score: round(candidate.score),
    request: requestSummary(candidate),
    collectionPath: candidate.collectionPath,
    contentPath: candidate.contentPath,
    length: candidate.length || candidate.contentLength,
    inferredFields: compactInferredFields(candidate.fields),
    siblingFields: (candidate.siblingFields || []).slice(0, 12).map((item) => ({
      path: item.path,
      key: item.key,
      value: compactValue(item.value, 100),
      formattedValue: compactValue(item.formattedValue, 100),
      appearsInSample: item.appearsInSample
    })),
    sampleCoverage: candidate.sampleCoverage,
    missingSampleLines: (candidate.missingSampleLines || []).slice(0, 6).map((value) => compactValue(value, 140)),
    samples: compactCandidateSamples(candidate),
    matchedValues: (candidate.matchPreview || []).slice(0, 5).map((value) => compactValue(value, 180))
  };
}

function normalizePlan(rawPlan, listCandidates, detailCandidates, monitorMode = "list_and_detail") {
  const fallback = buildFallbackPlan(listCandidates[0], detailCandidates[0], "", monitorMode);
  const selectedList = listCandidates.find((item) => item.id === rawPlan?.list?.candidateId) || listCandidates[0];
  if (monitorMode === "list_only") {
    const listMatcher = selectedList.sourceType !== "network_json" ? fallback.list.requestMatcher : buildRequestMatcher(selectedList);
    return {
      version: 2,
      monitorMode,
      list: {
        ...fallback.list,
        sourceType: selectedList.sourceType,
        candidateId: selectedList.id,
        requestMatcher: mergeMatcher(listMatcher, rawPlan?.list?.requestMatcher),
        confidence: clamp(Number(rawPlan?.list?.confidence ?? selectedList.score), 0, 1),
        reasoning: rawPlan?.list?.reasoning || fallback.list.reasoning
      },
      detail: null,
      relation: {},
      confidence: clamp(Number(rawPlan?.confidence ?? selectedList.score), 0, 1),
      reasoning: rawPlan?.reasoning || "仅监控公告列表中的新增、日期及排列变化。",
      warnings: Array.isArray(rawPlan?.warnings) ? rawPlan.warnings.slice(0, 8) : []
    };
  }
  const selectedDetail = detailCandidates.find((item) => item.id === rawPlan?.detail?.candidateId) || detailCandidates[0];

  const listMatcher = selectedList.sourceType !== "network_json" ? fallback.list.requestMatcher : buildRequestMatcher(selectedList);
  const detailMatcher = selectedDetail.sourceType !== "network_json" ? fallback.detail.requestMatcher : buildRequestMatcher(selectedDetail);
  const knownDetailPaths = new Set((selectedDetail.siblingFields || []).map((item) => item.path));
  const embeddedIdTemplate = buildEmbeddedDetailIdTemplate(selectedList, selectedDetail);

  return {
    version: 1,
    list: {
      sourceType: selectedList.sourceType,
      candidateId: selectedList.id,
      requestMatcher: mergeMatcher(listMatcher, rawPlan?.list?.requestMatcher),
      extraction: {
        collectionPath: selectedList.collectionPath,
        domSignature: selectedList.domSignature || "",
        idField: rawPlan?.list?.extraction?.idField || selectedList.fields?.idField || "",
        titleField: rawPlan?.list?.extraction?.titleField || selectedList.fields?.titleField || "title",
        urlField: rawPlan?.list?.extraction?.urlField || selectedList.fields?.urlField || "",
        dateField: rawPlan?.list?.extraction?.dateField || selectedList.fields?.dateField || "",
        typeField: rawPlan?.list?.extraction?.typeField || selectedList.fields?.typeField || ""
      },
      confidence: clamp(Number(rawPlan?.list?.confidence ?? selectedList.score), 0, 1),
      reasoning: rawPlan?.list?.reasoning || "选择与复制列表样例匹配度最高的候选。"
    },
    detail: {
      sourceType: selectedDetail.sourceType,
      candidateId: selectedDetail.id,
      requestMatcher: mergeMatcher(detailMatcher, rawPlan?.detail?.requestMatcher),
      extraction: {
        contentPath: selectedDetail.contentPath,
        domSignature: selectedDetail.domSignature || "",
        domId: selectedDetail.domId || "",
        itemIdTemplate: embeddedIdTemplate,
        titlePath: selectKnownPath(rawPlan?.detail?.extraction?.titlePath, selectedDetail.fields?.titlePath, knownDetailPaths),
        idPath: selectKnownPath(rawPlan?.detail?.extraction?.idPath, selectedDetail.fields?.idPath, knownDetailPaths),
        createdAtPath: selectKnownPath(rawPlan?.detail?.extraction?.createdAtPath, selectedDetail.fields?.createdAtPath, knownDetailPaths),
        updatedAtPath: selectKnownPath(rawPlan?.detail?.extraction?.updatedAtPath || rawPlan?.detail?.extraction?.datePath, selectedDetail.fields?.updatedAtPath, knownDetailPaths),
        metadataPaths: normalizeMetadataPaths(
          rawPlan?.detail?.extraction?.metadataPaths,
          selectedDetail.fields?.metadataPaths,
          knownDetailPaths
        )
      },
      confidence: clamp(Number(rawPlan?.detail?.confidence ?? selectedDetail.score), 0, 1),
      reasoning: rawPlan?.detail?.reasoning || "选择与复制正文样例匹配度最高的候选。"
    },
    relation: selectedDetail.sourceType === "dom_embedded" ? {
      detailUrlSource: "列表页内嵌正文",
      explanation: `列表项通过 ${embeddedIdTemplate || selectedDetail.domId} 关联同一页面中的公告正文。`
    } : rawPlan?.relation || fallback.relation,
    confidence: clamp(Number(rawPlan?.confidence ?? ((selectedList.score + selectedDetail.score) / 2)), 0, 1),
    reasoning: rawPlan?.reasoning || fallback.reasoning,
    warnings: Array.isArray(rawPlan?.warnings) ? rawPlan.warnings.slice(0, 8) : []
  };
}

function buildFallbackPlan(listCandidate, detailCandidate, warning = "", monitorMode = "list_and_detail") {
  const list = {
      sourceType: listCandidate.sourceType,
      candidateId: listCandidate.id,
      requestMatcher: buildRequestMatcher(listCandidate),
      extraction: {
        collectionPath: listCandidate.collectionPath,
        domSignature: listCandidate.domSignature || "",
        idField: listCandidate.fields?.idField || "",
        titleField: listCandidate.fields?.titleField || "title",
        urlField: listCandidate.fields?.urlField || "",
        dateField: listCandidate.fields?.dateField || "",
        typeField: listCandidate.fields?.typeField || ""
      },
      confidence: listCandidate.score,
      reasoning: "本地规则选择了与列表样例匹配分最高的候选。"
  };
  if (monitorMode === "list_only") return {
    version: 2,
    monitorMode,
    list,
    detail: null,
    relation: {},
    confidence: listCandidate.score,
    reasoning: "依据复制样例生成仅列表监控方案。",
    warnings: warning ? [warning] : []
  };
  return {
    version: 1,
    list,
    detail: {
      sourceType: detailCandidate.sourceType,
      candidateId: detailCandidate.id,
      requestMatcher: buildRequestMatcher(detailCandidate),
      extraction: {
        contentPath: detailCandidate.contentPath,
        domSignature: detailCandidate.domSignature || "",
        domId: detailCandidate.domId || "",
        itemIdTemplate: buildEmbeddedDetailIdTemplate(listCandidate, detailCandidate),
        titlePath: detailCandidate.fields?.titlePath || "",
        idPath: detailCandidate.fields?.idPath || "",
        createdAtPath: detailCandidate.fields?.createdAtPath || "",
        updatedAtPath: detailCandidate.fields?.updatedAtPath || "",
        metadataPaths: detailCandidate.fields?.metadataPaths || []
      },
      confidence: detailCandidate.score,
      reasoning: "本地规则选择了与正文样例匹配分最高的候选。"
    },
    relation: detailCandidate.sourceType === "dom_embedded" ? {
      detailUrlSource: "列表页内嵌正文",
      explanation: `列表项通过 ${buildEmbeddedDetailIdTemplate(listCandidate, detailCandidate) || detailCandidate.domId} 关联同一页面中的公告正文。`
    } : {
      detailUrlSource: "用户提供的详情 URL；后续运行优先使用列表的 URL 字段",
      explanation: "验证阶段使用样例详情 URL，正式监控时由列表记录的 URL 字段打开详情页。"
    },
    confidence: (listCandidate.score + detailCandidate.score) / 2,
    reasoning: "依据复制样例与候选内容的文字重合度生成。",
    warnings: warning ? [warning] : []
  };
}

function buildEmbeddedDetailIdTemplate(listCandidate, detailCandidate) {
  if (detailCandidate?.sourceType !== "dom_embedded" || !detailCandidate.domId) return "";
  const records = listCandidate?.records || listCandidate?.sampleRecords || [];
  const matching = records.find((record) => record.id && detailCandidate.domId.includes(String(record.id)));
  if (!matching?.id) return "";
  return detailCandidate.domId.split(String(matching.id)).join("{id}");
}

function extractListByPlan(plan, capture, baseUrl) {
  if (plan.sourceType === "dom_blocks") {
    return (capture.dom.blocks || [])
      .filter((item) => item.title && (!plan.extraction.domSignature || item.signature === plan.extraction.domSignature))
      .map((item) => ({ id: item.id || "", title: item.title, date: formatListDate(item.date), type: item.name || "", url: resolveUrl(item.href, baseUrl), raw: item }))
      .slice(0, 200);
  }
  if (plan.sourceType === "dom") {
    return capture.dom.links
      .filter((item) => item.text && item.href && (!plan.extraction.domSignature || item.signature === plan.extraction.domSignature))
      .map((item) => ({ id: inferIdFromUrl(item.href), title: item.text, date: formatListDate(item.date), url: item.href, raw: item }))
      .slice(0, 80);
  }

  const responses = prioritizedResponses(capture.responses, plan.requestMatcher);
  for (const response of responses) {
    const parsed = parseMaybeJson(response.body);
    if (parsed == null) continue;
    const collection = getByPath(parsed, plan.extraction.collectionPath);
    if (!Array.isArray(collection)) continue;
    const records = collection.filter((item) => item && typeof item === "object");
    if (!records.length) continue;
    return records.slice(0, 200).map((record) => {
      const rawUrl = fieldValue(record, plan.extraction.urlField);
      return {
        id: stringifyValue(fieldValue(record, plan.extraction.idField)),
        title: stringifyValue(fieldValue(record, plan.extraction.titleField)),
        date: formatListDate(fieldValue(record, plan.extraction.dateField)),
        type: stringifyValue(fieldValue(record, plan.extraction.typeField)),
        url: resolveUrl(rawUrl, baseUrl),
        raw: record
      };
    }).filter((item) => item.title);
  }
  return [];
}

function extractDetailByPlan(plan, capture, sampleText = "", item = null) {
  if (plan.sourceType === "dom_region") {
    const regions = capture.dom.regions || [];
    const region = regions.find((entry) => plan.extraction.domId && entry.id === plan.extraction.domId)
      || regions.find((entry) => plan.extraction.domSignature && entry.signature === plan.extraction.domSignature)
      || regions[0];
    if (!region) return { title: "", content: "", createdAt: "", updatedAt: "", metadata: [], raw: "" };
    return {
      title: region.title || inferTitleFromSample(sampleText, region.text) || capture.dom.title || "页面内容",
      content: region.text || "",
      createdAt: "",
      updatedAt: "",
      metadata: [],
      raw: region.html || region.text || ""
    };
  }
  if (plan.sourceType === "dom_embedded") {
    const values = { ...(item?.raw || {}), id: item?.id || "", title: item?.title || "", date: item?.date || "" };
    const expectedId = String(plan.extraction.itemIdTemplate || "").replace(/\{([^{}]+)\}/g, (_match, key) => stringifyValue(fieldValue(values, key)));
    const embedded = (capture.dom.embeddedDetails || []).find((entry) => expectedId && entry.id === expectedId)
      || (capture.dom.embeddedDetails || []).find((entry) => entry.id === plan.extraction.domId)
      || (capture.dom.embeddedDetails || []).find((entry) => item?.id && entry.id.includes(String(item.id)));
    if (!embedded) return { title: "", content: "", createdAt: "", updatedAt: "", metadata: [], raw: "" };
    return {
      title: embedded.title || item?.title || inferTitleFromSample(sampleText, embedded.text) || "公告正文",
      content: embedded.text || "",
      createdAt: formatListDate(embedded.date || item?.date),
      updatedAt: "",
      metadata: [],
      raw: embedded.html || embedded.text || ""
    };
  }
  if (plan.sourceType === "dom") {
    return { title: capture.dom.title || "公告正文", content: capture.dom.text || "", createdAt: "", updatedAt: "", metadata: [], raw: capture.dom.text || "" };
  }

  const responses = prioritizedResponses(capture.responses, plan.requestMatcher);
  for (const response of responses) {
    const parsed = parseMaybeJson(response.body);
    if (parsed == null) continue;
    const raw = getByPath(parsed, plan.extraction.contentPath);
    if (typeof raw !== "string" || raw.length < 20) continue;
    const content = htmlToText(raw);
    const title = formatDetailValue(getByPath(parsed, plan.extraction.titlePath), "title") || inferTitleFromSample(sampleText, content, capture.dom.text) || capture.dom.title || "公告正文";
    const createdAt = formatDetailValue(getByPath(parsed, plan.extraction.createdAtPath), "createdAt");
    const updatedAt = formatDetailValue(getByPath(parsed, plan.extraction.updatedAtPath), "updatedAt");
    const metadata = (plan.extraction.metadataPaths || []).map((entry) => ({
      label: entry.label || "其他信息",
      value: applyValueMap(getByPath(parsed, entry.path), entry.valueMap, entry.path)
    })).filter((entry) => entry.value);
    const fallbackLines = sampleHeaderLines(sampleText, content, capture.dom.text)
      .filter((line) => !fuzzyContains(line, title) && !fuzzyContains(title, line))
      .filter((line) => !fuzzyContains(line, createdAt) && !fuzzyContains(line, updatedAt))
      .filter((line) => !metadata.some((entry) => valueAppearsInSample(line, entry.value) || valueAppearsInSample(entry.value, line)));
    fallbackLines.forEach((value) => metadata.push({ label: "页面信息", value }));
    return {
      title,
      content,
      createdAt,
      updatedAt,
      metadata,
      raw
    };
  }
  return { title: "", content: "", createdAt: "", updatedAt: "", metadata: [], raw: "" };
}

function prioritizedResponses(responses, matcher) {
  const matched = responses.filter((response) => responseMatchesMatcher(response, matcher));
  return matched.length ? matched : responses;
}

function responseMatchesMatcher(response, matcher = {}) {
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

function renderPlan(plan) {
  const pageMode = state.createTaskType === "page" || plan.monitorType === "page";
  const list = pageMode ? plan.page : plan.list;
  const detail = pageMode ? null : plan.detail;
  document.querySelector("#list-scheme-label").textContent = pageMode ? "监控区域" : "列表";
  document.querySelector("#list-scheme-title").textContent = sourceTitle(list.sourceType);
  document.querySelector("#detail-scheme-card").classList.toggle("hidden", !detail);
  renderDefinitionList(document.querySelector("#list-scheme-details"), pageMode ? [
    ["请求", matcherLabel(list.requestMatcher)],
    ["内容路径", list.extraction.contentPath],
    ["页面区域", list.extraction.domSignature || list.extraction.domId || "—"],
    ["标题路径", list.extraction.titlePath || "未识别"]
  ] : [
    ["请求", matcherLabel(list.requestMatcher)],
    ["列表路径", list.extraction.collectionPath],
    ["标题字段", list.extraction.titleField || "未识别"],
    ["ID 字段", list.extraction.idField || "未识别"],
    ["日期字段", list.extraction.dateField || "未识别"],
    ["地址字段", list.extraction.urlField || "未识别"]
  ]);
  if (detail) {
    document.querySelector("#detail-scheme-title").textContent = sourceTitle(detail.sourceType);
    renderDefinitionList(document.querySelector("#detail-scheme-details"), [
      ["请求", matcherLabel(detail.requestMatcher)],
      ["正文路径", detail.extraction.contentPath],
      ["标题路径", detail.extraction.titlePath || "未识别"],
      ["创建时间路径", detail.extraction.createdAtPath || "未识别"],
      ["更新时间路径", detail.extraction.updatedAtPath || "未识别"],
      ["其他元数据", (detail.extraction.metadataPaths || []).map((item) => `${item.label}: ${item.path}`).join("；") || "未识别"],
      ["忽略参数", (detail.requestMatcher.ignoreQueryKeys || []).join(", ") || "无"]
    ]);
  }
  document.querySelector("#confidence-value").textContent = percent(plan.confidence);
  document.querySelector("#confidence-bar").style.width = percent(plan.confidence);
  document.querySelector("#plan-reasoning").textContent = [plan.reasoning, ...(plan.warnings || [])].filter(Boolean).join(" · ");
  elements.planJson.textContent = JSON.stringify(plan, null, 2);
}

function renderValidation(items, detail, scores) {
  const pageMode = state.createTaskType === "page";
  document.querySelector("#list-validation-card").classList.toggle("hidden", pageMode);
  const body = document.querySelector("#list-result-body");
  body.textContent = "";
  items.slice(0, 80).forEach((item) => {
    const row = document.createElement("tr");
    const titleCell = document.createElement("td");
    if (item.url) {
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = item.title;
      titleCell.append(link);
    } else {
      titleCell.textContent = item.title;
    }
    const dateCell = document.createElement("td");
    dateCell.textContent = item.date || "—";
    const idCell = document.createElement("td");
    idCell.textContent = item.id || "—";
    row.append(titleCell, dateCell, idCell);
    body.append(row);
  });
  document.querySelector("#list-result-count").textContent = `${items.length} 条 · 匹配 ${percent(scores.listMatch)}`;
  document.querySelector("#detail-validation-card").classList.toggle("hidden", !detail);
  if (!detail) return;
  document.querySelector("#detail-result-title").textContent = `${detail.title || "已提取"} · 匹配 ${percent(scores.detailMatch)}`;
  renderDetailMetadata(detail);
  document.querySelector("#detail-result-content").textContent = detail.content.slice(0, 120_000);
}

function renderDetailMetadata(detail) {
  const container = document.querySelector("#detail-result-metadata");
  container.textContent = "";
  const rows = [
    detail.createdAt ? ["创建于", detail.createdAt] : null,
    detail.updatedAt ? ["更新于", detail.updatedAt] : null,
    ...(detail.metadata || []).map((item) => [item.label, item.value])
  ].filter(Boolean);
  rows.forEach(([label, value]) => {
    const item = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = label;
    item.append(name, document.createTextNode(value));
    container.append(item);
  });
  container.classList.toggle("hidden", rows.length === 0);
}

function renderCandidates() {
  const rows = [
    ...state.listCandidates.map((item) => ({ kind: "列表", ...item })),
    ...state.detailCandidates.map((item) => ({ kind: "详情", ...item }))
  ];
  elements.candidateContent.innerHTML = `
    <table class="candidate-table">
      <thead><tr><th>类型</th><th>分数</th><th>来源</th><th>数据路径</th></tr></thead>
      <tbody>${rows.map((item) => `
        <tr>
          <td>${escapeHtml(item.kind)}</td>
          <td>${escapeHtml(percent(item.score))}</td>
          <td class="candidate-source">${escapeHtml(item.sourceType === "network_json" ? sanitizeUrl(item.url) : sourceTitle(item.sourceType))}</td>
          <td class="candidate-source">${escapeHtml(item.collectionPath || item.contentPath || "—")}</td>
        </tr>`).join("")}</tbody>
    </table>`;
  elements.candidateDebug.classList.remove("hidden");
}

function renderDefinitionList(container, rows) {
  container.textContent = "";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "—";
    container.append(dt, dd);
  });
}

function requestSummary(candidate) {
  const matcher = buildRequestMatcher(candidate);
  return {
    method: matcher.method,
    origin: matcher.origin,
    path: matcher.path,
    stableQuery: matcher.stableQuery,
    ignoreQueryKeys: matcher.ignoreQueryKeys
  };
}

function buildRequestMatcher(candidate) {
  let parsed;
  try { parsed = new URL(candidate.url); } catch (_error) { parsed = null; }
  const stableQuery = {};
  const ignoreQueryKeys = [];
  if (parsed) {
    parsed.searchParams.forEach((value, key) => {
      if (isVolatileKey(key) || looksSecret(value)) ignoreQueryKeys.push(key);
      else stableQuery[key] = value;
    });
  }
  return {
    method: candidate.method || "GET",
    origin: parsed?.origin || "",
    path: parsed?.pathname || "",
    stableQuery,
    ignoreQueryKeys: [...new Set(ignoreQueryKeys)]
  };
}

function mergeMatcher(base, suggested = {}) {
  const safeSuggestedQuery = Object.fromEntries(
    Object.entries(suggested.stableQuery || {}).filter(([key, value]) =>
      Object.prototype.hasOwnProperty.call(base.stableQuery || {}, key) && !isVolatileKey(key) && !looksSecret(value)
    )
  );
  return {
    method: base.method || suggested.method || "GET",
    origin: base.origin || suggested.origin || "",
    path: base.path || suggested.path || "",
    stableQuery: { ...base.stableQuery, ...safeSuggestedQuery },
    ignoreQueryKeys: [...new Set([...(base.ignoreQueryKeys || []), ...(suggested.ignoreQueryKeys || [])])]
  };
}

function refineMatcherFromFreshCapture(planPart, capture) {
  if (planPart.sourceType !== "network_json") return;
  const matcher = planPart.requestMatcher || {};
  const pathKey = planPart.extraction.collectionPath || planPart.extraction.contentPath;
  const compatible = capture.responses.filter((response) => {
    let url;
    try { url = new URL(response.url); } catch (_error) { return false; }
    if (matcher.method && response.method && matcher.method.toUpperCase() !== response.method.toUpperCase()) return false;
    if (matcher.origin && url.origin !== matcher.origin) return false;
    if (matcher.path && url.pathname !== matcher.path) return false;
    const parsed = parseMaybeJson(response.body);
    return parsed != null && getByPath(parsed, pathKey) != null;
  });
  if (!compatible.length) return;

  const freshUrl = new URL(compatible[0].url);
  Object.entries({ ...(matcher.stableQuery || {}) }).forEach(([key, oldValue]) => {
    const nextValue = freshUrl.searchParams.get(key);
    if (nextValue !== String(oldValue)) {
      delete matcher.stableQuery[key];
      matcher.ignoreQueryKeys = [...new Set([...(matcher.ignoreQueryKeys || []), key])];
    }
  });
}

function inferListFields(records, sampleText) {
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const primitiveKeys = keys.filter((key) => records.some((record) => isPrimitive(record[key])));
  const titleField = pickField(primitiveKeys, records, [
    [/title|subject|headline|topic|notice.*name|article.*name/i, 8],
    [/name|text|label/i, 3]
  ], (value) => typeof value === "string" && value.length >= 4 && value.length <= 240, sampleText);
  const idField = pickField(primitiveKeys, records, [
    [/(^|_)(id|docid|articleid|noticeid)($|_)/i, 8],
    [/id|code|key/i, 3]
  ], (value) => typeof value === "number" || /^[\w-]{2,80}$/.test(String(value || "")), "");
  const urlField = pickField(primitiveKeys, records, [
    [/url|href|link|target/i, 8],
    [/path|route/i, 3]
  ], (value) => typeof value === "string" && (/^https?:\/\//.test(value) || /^\//.test(value)), "");
  const dateField = pickField(primitiveKeys, records, [
    [/publish.*time|create.*time|modified|update.*time|gmt|date|time/i, 7]
  ], (value) => looksDate(value), sampleText);
  const typeField = pickField(primitiveKeys, records, [
    [/type|category|channel|class|label/i, 6]
  ], () => true, "");
  return { idField, titleField, urlField, dateField, typeField };
}

function inferDetailFields(root, contentPath, sampleText) {
  const parentPath = contentPath.replace(/(?:\.[^.\[]+|\[\d+\])$/, "") || "$";
  const parent = getByPath(root, parentPath);
  const entries = parent && typeof parent === "object" && !Array.isArray(parent)
    ? Object.entries(parent)
      .filter(([, value]) => isPrimitive(value) || (Array.isArray(value) && value.every(isPrimitive)))
      .map(([key, value]) => {
        const formattedValue = formatDetailValue(value, key);
        return {
          key,
          path: `${parentPath}.${escapePathSegment(key)}`,
          value: compactValue(value, 260),
          formattedValue,
          appearsInSample: valueAppearsInSample(sampleText, formattedValue) || valueAppearsInSample(sampleText, stringifyValue(value))
        };
      })
    : [];

  const contentKey = contentPath.match(/\.([^.[\]]+)$/)?.[1] || "";
  const available = entries.filter((entry) => entry.key !== contentKey);
  const title = pickDetailEntry(available, sampleText, [
    [/title|subject|headline|topic|notice.*name|article.*name/i, 12],
    [/name|label/i, 3]
  ], (entry) => typeof getByPath(root, entry.path) === "string" && entry.formattedValue.length >= 4 && entry.formattedValue.length <= 300);
  const id = pickDetailEntry(available, "", [
    [/(^|_)(id|docid|articleid|noticeid)($|_)/i, 10],
    [/id|code/i, 3]
  ], (entry) => /^[\w-]{1,100}$/.test(entry.formattedValue));
  const created = pickDetailEntry(available, sampleText, [
    [/created|create.*time|publish.*time|published|gmt.*create/i, 12],
    [/date|time/i, 2]
  ], (entry) => looksDate(getByPath(root, entry.path)));
  const updated = pickDetailEntry(available, sampleText, [
    [/modified|updated|update.*time|gmt.*modified|content.*modified/i, 12],
    [/date|time/i, 2]
  ], (entry) => looksDate(getByPath(root, entry.path)));
  const selected = new Set([title?.path, id?.path, created?.path, updated?.path].filter(Boolean));
  const metadataPaths = available
    .filter((entry) => !selected.has(entry.path))
    .filter((entry) => /tag|label|category|type|channel|scope|audience|business.*model|scene|version/i.test(entry.key))
    .filter((entry) => entry.formattedValue && entry.formattedValue.length <= 300)
    .filter((entry) => entry.appearsInSample || !/^\d+(?:\s*[,，|、]\s*\d+)*$/.test(entry.formattedValue))
    .slice(0, 8)
    .map((entry) => ({ label: detailFieldLabel(entry.key), path: entry.path, valueMap: {} }));

  return {
    titlePath: title?.path || "",
    idPath: id?.path || "",
    createdAtPath: created?.path || "",
    updatedAtPath: updated?.path || "",
    metadataPaths,
    siblingFields: available.slice(0, 40)
  };
}

function pickDetailEntry(entries, sampleText, rules, predicate) {
  let best = null;
  entries.forEach((entry) => {
    if (!predicate(entry)) return;
    let score = 0;
    rules.forEach(([pattern, points]) => { if (pattern.test(entry.key)) score += points; });
    if (sampleText && entry.appearsInSample) score += 9;
    if (!best || score > best.score) best = { ...entry, score };
  });
  return best && best.score >= 3 ? best : null;
}

function detailCandidateAsText(fields, content) {
  const importantPaths = new Set([
    fields.titlePath,
    fields.createdAtPath,
    fields.updatedAtPath,
    ...(fields.metadataPaths || []).map((item) => item.path)
  ].filter(Boolean));
  const header = (fields.siblingFields || [])
    .filter((entry) => importantPaths.has(entry.path) || entry.appearsInSample)
    .map((entry) => entry.formattedValue)
    .filter(Boolean);
  return [...new Set(header), content].join("\n");
}

function missingSampleLines(sampleText, candidateText) {
  const normalizedCandidate = normalizeText(candidateText);
  return sampleLines(sampleText)
    .filter((line) => !normalizedCandidate.includes(normalizeText(line)))
    .slice(0, 10);
}

function sampleLines(value) {
  return String(value || "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => normalizeText(line).length >= 2);
}

function valueAppearsInSample(sampleText, value) {
  const raw = String(value || "").trim();
  if (/^\d+(?:\s*[,，|、]\s*\d+)*$/.test(raw)) {
    return String(sampleText || "").replace(/\s+/g, "").includes(raw.replace(/\s+/g, ""));
  }
  const normalized = normalizeText(value);
  return normalized.length >= 2 && normalizeText(sampleText).includes(normalized);
}

function selectKnownPath(primary, fallback, knownPaths) {
  if (typeof primary === "string" && primary && knownPaths.has(primary)) return primary;
  return typeof fallback === "string" ? fallback : "";
}

function normalizeMetadataPaths(primary, fallback = [], knownPaths = new Set()) {
  const combined = [
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(fallback) ? fallback : [])
  ];
  const seen = new Set();
  return combined.filter((item) => {
    if (!item || typeof item.path !== "string" || !item.path || seen.has(item.path) || (knownPaths.size && !knownPaths.has(item.path))) return false;
    seen.add(item.path);
    return true;
  }).slice(0, 12).map((item) => ({
    label: String(item.label || "其他信息").slice(0, 40),
    path: item.path,
    valueMap: item.valueMap && typeof item.valueMap === "object" && !Array.isArray(item.valueMap) ? item.valueMap : {}
  }));
}

function applyValueMap(value, valueMap, path = "") {
  if (value == null || value === "") return "";
  const map = valueMap && typeof valueMap === "object" ? valueMap : {};
  const parts = Array.isArray(value) ? value : String(value).split(/[,，|]/).map((item) => item.trim()).filter(Boolean);
  const mapped = parts.map((item) => map[String(item)] ?? item);
  return formatDetailValue(mapped, path);
}

function formatListDate(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  if (/^\d{10,19}$/.test(text)) return formatTimestamp(Number(text));
  if (/T\d{1,2}:\d{2}/.test(text) && /(Z|[+\-]\d{2}:?\d{2})$/i.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return formatTimestamp(parsed.getTime());
  }
  const parts = text.match(/^(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})(?:日)?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (parts) {
    const date = `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
    return parts[4] ? `${date} ${parts[4].padStart(2, "0")}:${parts[5]}:${parts[6] || "00"}` : date;
  }
  return text;
}

function formatDetailValue(value, key = "") {
  if (value == null || value === "") return "";
  if ((typeof value === "number" || /^\d{10,19}$/.test(String(value))) && /time|date|created|updated|modified|publish/i.test(key)) {
    return formatTimestamp(Number(value));
  }
  if (Array.isArray(value)) return value.map((item) => stringifyValue(item)).filter(Boolean).join("、");
  return stringifyValue(value);
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return String(value || "");
  let milliseconds = value;
  while (milliseconds >= 100_000_000_000_000) milliseconds /= 1000;
  if (milliseconds < 100_000_000_000) milliseconds *= 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function detailFieldLabel(key) {
  if (/business.*model|scope|audience/i.test(key)) return "适用范围";
  if (/tag|label/i.test(key)) return "标签";
  if (/category|type|channel/i.test(key)) return "分类";
  if (/version/i.test(key)) return "版本";
  return key;
}

function inferTitleFromSample(sampleText, content, domText) {
  const contentNorm = normalizeText(content);
  const domNorm = normalizeText(domText);
  return sampleLines(sampleText).find((line) => {
    const normalized = normalizeText(line);
    return normalized.length >= 4 && normalized.length <= 240 && !contentNorm.includes(normalized) && domNorm.includes(normalized) && !looksDate(line);
  }) || "";
}

function sampleHeaderLines(sampleText, content, domText) {
  const contentNorm = normalizeText(content);
  const domNorm = normalizeText(domText);
  return sampleLines(sampleText).filter((line) => {
    const normalized = normalizeText(line);
    return !contentNorm.includes(normalized) && domNorm.includes(normalized);
  }).slice(0, 12);
}

function detailAsText(detail) {
  return [
    detail.title,
    ...(detail.metadata || []).map((item) => `${item.label} ${item.value}`),
    detail.createdAt ? `创建于 ${detail.createdAt}` : "",
    detail.updatedAt ? `更新于 ${detail.updatedAt}` : "",
    detail.content
  ].filter(Boolean).join("\n");
}

function compactSample(value, maxLength) {
  const text = htmlToText(String(value || ""));
  if (text.length <= maxLength) return text;
  const headLength = Math.floor(maxLength * 0.72);
  const tailLength = maxLength - headLength;
  return `${text.slice(0, headLength)}\n…[已省略 ${text.length - maxLength} 字符]…\n${text.slice(-tailLength)}`;
}

function compactCandidateSamples(candidate) {
  if (candidate.sampleRecords) {
    return candidate.sampleRecords.slice(0, 1).map((record) => compactRecord(record));
  }
  return compactValue(candidate.preview, 360);
}

function compactInferredFields(fields) {
  if (!fields || typeof fields !== "object") return fields;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "siblingFields"));
}

function compactRecord(record) {
  if (!record || typeof record !== "object") return compactValue(htmlToText(String(record || "")), 360);
  const output = {};
  Object.entries(record).slice(0, 40).forEach(([key, value]) => {
    if (!isPrimitive(value)) return;
    if (typeof value === "string" && value.length > 320) return;
    output[key] = compactValue(value, 180);
  });
  return output;
}

function compactValue(value, maxLength) {
  const text = typeof value === "string" ? value : stringifyValue(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function estimateTokens(text) {
  const chinese = (String(text).match(/[\u3400-\u9fff]/g) || []).length;
  return Math.ceil(chinese * 0.7 + (String(text).length - chinese) / 4);
}

function pickField(keys, records, nameRules, valueRule, sampleText) {
  let best = { key: "", score: 0 };
  keys.forEach((key) => {
    let score = 0;
    nameRules.forEach(([pattern, points]) => { if (pattern.test(key)) score += points; });
    const values = records.map((record) => record[key]).filter(isPrimitive);
    if (!values.length) return;
    score += values.filter(valueRule).length / values.length * 4;
    if (sampleText) {
      score += values.filter((value) => fuzzyContains(sampleText, String(value))).length / values.length * 7;
    }
    if (score > best.score) best = { key, score };
  });
  return best.score >= 3 ? best.key : "";
}

function walkJson(value, path, visitor, maxDepth, depth = 0, seen = new WeakSet()) {
  visitor(value, path);
  if (depth >= maxDepth || value == null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item, index) => walkJson(item, `${path}[${index}]`, visitor, maxDepth, depth + 1, seen));
  } else {
    Object.entries(value).slice(0, 160).forEach(([key, item]) => {
      walkJson(item, `${path}.${escapePathSegment(key)}`, visitor, maxDepth, depth + 1, seen);
    });
  }
}

function parseMaybeJson(body) {
  if (!body) return null;
  const text = body.trim().replace(/^\uFEFF/, "");
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
    .map(unescapePathSegment);
  return tokens.reduce((value, token) => value == null ? undefined : value[token], root);
}

function fieldValue(record, field) {
  if (!field) return "";
  return field.includes(".") ? getByPath(record, field) : record?.[field];
}

function htmlToText(value) {
  if (!value) return "";
  const source = String(value);
  if (!/[<>]/.test(source)) return source.replace(/\s+/g, " ").trim();
  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(source, "text/html");
  documentFragment.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
  documentFragment.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  documentFragment.querySelectorAll("p,div,li,h1,h2,h3,h4,tr").forEach((node) => node.append("\n"));
  documentFragment.querySelectorAll("td,th").forEach((node) => node.append("\t"));
  return (documentFragment.body.textContent || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sampleMatchRatio(sample, candidate) {
  const sampleNorm = normalizeText(sample);
  const candidateNorm = normalizeText(candidate);
  if (!sampleNorm || !candidateNorm) return 0;

  const anchors = extractAnchors(sample);
  const anchorScores = anchors.map((anchor) => {
    const normalized = normalizeText(anchor);
    if (!normalized) return 0;
    if (candidateNorm.includes(normalized)) return 1;
    return ngramSimilarity(normalized, candidateNorm, Math.min(4, Math.max(2, Math.floor(normalized.length / 6))));
  });
  const anchorScore = anchorScores.length ? anchorScores.reduce((sum, value) => sum + value, 0) / anchorScores.length : 0;
  const globalScore = ngramSimilarity(sampleNorm.slice(0, 3000), candidateNorm.slice(0, 80_000), 4);
  return clamp(anchorScore * 0.72 + globalScore * 0.28, 0, 1);
}

function extractAnchors(text) {
  const lines = String(text || "")
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter((line) => normalizeText(line).length >= 4)
    .slice(0, 30);
  if (lines.length >= 2) return lines;
  return String(text || "")
    .split(/[。！？!?；;]/)
    .map((item) => item.trim())
    .filter((item) => normalizeText(item).length >= 6)
    .slice(0, 20);
}

function ngramSimilarity(needle, haystack, size) {
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 1;
  if (needle.length < size) return haystack.includes(needle) ? 1 : 0;
  const grams = new Set();
  for (let i = 0; i <= needle.length - size; i += Math.max(1, Math.floor(size / 2))) grams.add(needle.slice(i, i + size));
  let hits = 0;
  grams.forEach((gram) => { if (haystack.includes(gram)) hits += 1; });
  return grams.size ? hits / grams.size : 0;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&nbsp;|\u00a0/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function fuzzyContains(container, value) {
  const a = normalizeText(container);
  const b = normalizeText(value);
  if (b.length < 4) return false;
  return a.includes(b) || (b.length > 14 && ngramSimilarity(b, a, 4) >= 0.72);
}

function structureSimilarity(records) {
  if (records.length < 2) return 0;
  const first = new Set(Object.keys(records[0]));
  const scores = records.slice(1).map((record) => {
    const current = new Set(Object.keys(record));
    const intersection = [...first].filter((key) => current.has(key)).length;
    const union = new Set([...first, ...current]).size;
    return union ? intersection / union : 0;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function flattenPrimitiveValues(value, depth = 0) {
  if (depth > 3 || value == null) return [];
  if (isPrimitive(value)) return [String(value)];
  if (Array.isArray(value)) return value.slice(0, 10).flatMap((item) => flattenPrimitiveValues(item, depth + 1));
  if (typeof value === "object") return Object.values(value).slice(0, 80).flatMap((item) => flattenPrimitiveValues(item, depth + 1));
  return [];
}

function bestMatchingValues(sampleNormalized, records) {
  return [...new Set(records.flatMap(flattenPrimitiveValues))]
    .filter((value) => value.length >= 4 && fuzzyContains(sampleNormalized, value))
    .slice(0, 8);
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceType}|${candidate.url}|${candidate.collectionPath || candidate.contentPath}|${["dom_embedded", "dom_region"].includes(candidate.sourceType) ? candidate.domId || candidate.domSignature || "" : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truncateObject(value, maxLength) {
  let text;
  try { text = JSON.stringify(value); } catch (_error) { return String(value).slice(0, maxLength); }
  if (text.length <= maxLength) return value;
  return `${text.slice(0, maxLength)}…`;
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      const current = url.searchParams.get(key) || "";
      if (isVolatileKey(key) || looksSecret(current)) url.searchParams.set(key, "[REDACTED]");
    });
    return url.toString();
  } catch (_error) {
    return String(value || "").slice(0, 500);
  }
}

function isVolatileKey(key) {
  return /token|sign|signature|timestamp|nonce|auth|cookie|secret|password|session|ticket|csrf|_t$|msToken/i.test(String(key));
}

function looksSecret(value) {
  const text = String(value || "");
  return text.length > 48 && /^[A-Za-z0-9_\-+/=.]+$/.test(text);
}

function looksDate(value) {
  const text = String(value || "");
  return /^\d{4}[-/.年]\d{1,2}/.test(text) || /^1\d{9,18}$/.test(text);
}

function isPrimitive(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function stringifyValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function resolveUrl(value, base) {
  if (!value) return "";
  try {
    const resolved = new URL(String(value), base);
    return /^https?:$/.test(resolved.protocol) ? resolved.toString() : "";
  } catch (_error) {
    return "";
  }
}

function inferIdFromUrl(value) {
  try {
    const url = new URL(value);
    for (const key of ["id", "docId", "articleId", "noticeId", "newsId"]) {
      if (url.searchParams.get(key)) return url.searchParams.get(key);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const numeric = [...segments].reverse().find((segment) => /^\d{2,}$/.test(segment));
    return numeric || "";
  } catch (_error) {
    return "";
  }
}

function escapePathSegment(value) {
  return String(value).replace(/\./g, "\\u002e");
}

function unescapePathSegment(value) {
  return String(value).replace(/\\u002e/g, ".");
}

function sourceTitle(sourceType) {
  return ({
    network_json: "浏览器网络响应",
    dom: "渲染后的页面 DOM",
    dom_blocks: "页面重复内容块",
    dom_embedded: "列表页内嵌正文",
    dom_region: "页面指定内容区域"
  })[sourceType] || "页面内容";
}

function matcherLabel(matcher = {}) {
  if (!matcher.path) return "页面自身内容";
  const query = Object.entries(matcher.stableQuery || {}).map(([key, value]) => `${key}=${value}`).join("&");
  return `${matcher.method || "GET"} ${matcher.path}${query ? `?${query}` : ""}`;
}

function setStep(step, status, detail) {
  const row = document.querySelector(`[data-step="${step}"]`);
  row.classList.remove("active", "done", "error");
  if (status) row.classList.add(status);
  row.querySelector("small").textContent = detail;
}

function resetProgress() {
  document.querySelectorAll("#progress-list li").forEach((row) => {
    row.classList.remove("active", "done", "error");
    row.querySelector("small").textContent = "等待开始";
  });
}

function markActiveStepError(message) {
  const active = document.querySelector("#progress-list li.active");
  if (!active) return;
  active.classList.remove("active");
  active.classList.add("error");
  active.querySelector("small").textContent = message;
}

function setStatus(message, kind = "") {
  elements.statusCard.classList.remove("working", "success", "error");
  if (kind) elements.statusCard.classList.add(kind);
  elements.statusText.textContent = message;
}

function setValidationBadge(text, kind) {
  const badge = document.querySelector("#validation-badge");
  badge.className = `status-pill ${kind || ""}`.trim();
  badge.textContent = text;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  const span = button.querySelector("span");
  if (span) span.textContent = label;
  else button.textContent = label;
}

async function copyPlanJson() {
  if (!state.plan) return;
  await navigator.clipboard.writeText(JSON.stringify(state.plan, null, 2));
  showToast("方案 JSON 已复制");
}

function showToast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3600);
}

function appendLog(entry = {}) {
  const normalized = {
    timestamp: entry.timestamp || new Date().toISOString(),
    scope: entry.scope || "应用",
    message: entry.message || "",
    level: entry.level || "info",
    elapsedMs: Number(entry.elapsedMs || 0)
  };
  appendGlobalLog(normalized);
  if (!state.createLogActive) return;
  state.createLogs.push(normalized);
  if (state.createLogs.length > 300) state.createLogs.shift();

  renderCreateLogs();
}

function renderCreateLogs() {
  const list = document.querySelector("#runtime-log-list");
  list.textContent = "";
  state.createLogs.forEach((item) => {
    const row = document.createElement("li");
    row.className = `log-entry ${item.level}`;
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    const scope = document.createElement("span");
    scope.className = "log-scope";
    scope.textContent = item.scope;
    const message = document.createElement("span");
    message.className = "log-message";
    message.textContent = item.message;
    const elapsed = document.createElement("span");
    elapsed.className = "log-elapsed";
    elapsed.textContent = item.elapsedMs ? formatDuration(item.elapsedMs) : "";
    row.append(time, scope, message, elapsed);
    list.append(row);
  });
  document.querySelector("#log-count").textContent = `${state.createLogs.length} 条`;
  list.scrollTop = list.scrollHeight;
}

function clearRuntimeLog() {
  state.createLogs = [];
  document.querySelector("#runtime-log-list").textContent = "";
  document.querySelector("#log-count").textContent = "0 条";
}

async function copyRuntimeLogs() {
  const text = state.createLogs.map((item) => {
    const elapsed = item.elapsedMs ? ` +${formatDuration(item.elapsedMs)}` : "";
    return `${item.timestamp} [${item.scope}] ${item.message}${elapsed}`;
  }).join("\n");
  await navigator.clipboard.writeText(text);
  showToast("运行日志已复制");
}

function appendGlobalLog(entry = {}) {
  const normalized = {
    timestamp: entry.timestamp || new Date().toISOString(),
    scope: entry.scope || "应用",
    message: entry.message || "",
    level: entry.level || "info",
    elapsedMs: Number(entry.elapsedMs || 0)
  };
  state.logs.push(normalized);
  if (state.logs.length > 500) state.logs.shift();
  if (document.querySelector("#view-logs").classList.contains("active")) renderGlobalLogs();
}

function renderGlobalLogs() {
  const list = document.querySelector("#global-log-list");
  list.textContent = "";
  state.logs.slice().reverse().forEach((item) => {
    const row = document.createElement("li");
    row.className = `global-log-row ${item.level}`;
    row.innerHTML = `<time>${escapeHtml(formatDateTime(item.timestamp))}</time><span>${escapeHtml(item.scope)}</span><p>${escapeHtml(item.message)}</p><small>${item.elapsedMs ? escapeHtml(formatDuration(item.elapsedMs)) : ""}</small>`;
    list.append(row);
  });
  document.querySelector("#global-log-count").textContent = `${state.logs.length} 条记录`;
  document.querySelector("#global-log-empty").classList.toggle("hidden", state.logs.length > 0);
}

async function copyGlobalLogs() {
  const text = state.logs.map((item) => `${item.timestamp} [${item.scope}] ${item.message}${item.elapsedMs ? ` +${formatDuration(item.elapsedMs)}` : ""}`).join("\n");
  await navigator.clipboard.writeText(text);
  showToast("全局日志已复制");
}

function clearGlobalLogs() {
  state.logs = [];
  renderGlobalLogs();
  showToast("全局日志已清空");
}

function formatDuration(value) {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

function assertWebUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw new Error("请输入完整的 http 或 https 网址。"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("目前只支持 http 和 https 页面。");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function percent(value) {
  return `${Math.round(clamp(Number(value || 0), 0, 1) * 100)}%`;
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
  state.createLogActive = true;
