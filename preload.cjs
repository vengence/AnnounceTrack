const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("announcementProbe", {
  getAppVersion: () => ipcRenderer.invoke("app-version"),
  capturePage: (options) => ipcRenderer.invoke("capture-page", options),
  analyzeWithDeepSeek: (options) => ipcRenderer.invoke("deepseek-analyze", options),
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  getStorageUsage: () => ipcRenderer.invoke("storage-usage"),
  saveSettings: (options) => ipcRenderer.invoke("save-settings", options),
  saveNotificationProfile: (options) => ipcRenderer.invoke("notification-profile-save", options),
  deleteNotificationProfile: (profileId) => ipcRenderer.invoke("notification-profile-delete", profileId),
  getMonitorState: () => ipcRenderer.invoke("monitor-state"),
  saveTask: (task) => ipcRenderer.invoke("monitor-save-task", task),
  deleteTask: (taskId) => ipcRenderer.invoke("monitor-delete-task", taskId),
  toggleTask: (taskId, enabled) => ipcRenderer.invoke("monitor-toggle-task", { taskId, enabled }),
  runTask: (taskId) => ipcRenderer.invoke("monitor-run-task", taskId),
  getAnnouncement: (announcementId) => ipcRenderer.invoke("monitor-announcement", announcementId),
  testNotification: (options) => ipcRenderer.invoke("monitor-test-notification", options),
  exportBackup: (options) => ipcRenderer.invoke("backup-export", options),
  importBackup: (options) => ipcRenderer.invoke("backup-import", options),
  openLoginWindow: (options) => ipcRenderer.invoke("auth-open-login", options),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on("operation-log", listener);
    return () => ipcRenderer.removeListener("operation-log", listener);
  },
  onRuntimeEvent: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on("runtime-event", listener);
    return () => ipcRenderer.removeListener("runtime-event", listener);
  }
});
