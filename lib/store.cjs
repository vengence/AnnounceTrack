const fs = require("node:fs/promises");
const path = require("node:path");

const EMPTY_DATA = {
  version: 1,
  tasks: [],
  announcements: [],
  versions: [],
  events: [],
  runs: [],
  deliveries: []
};

class MonitorStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = structuredClone(EMPTY_DATA);
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.data = normalizeData(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const backup = `${this.filePath}.broken-${Date.now()}`;
        await fs.rename(this.filePath, backup).catch(() => {});
      }
      this.data = structuredClone(EMPTY_DATA);
      await this.flush();
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.data);
  }

  // Internal read-only access for hot paths. Runtime code only reads this
  // object; avoiding structuredClone here prevents every scheduled check from
  // duplicating the complete version history in memory.
  view() {
    return this.data;
  }

  async update(mutator) {
    let result;
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      result = await mutator(this.data);
      pruneData(this.data);
      await this.flush();
    });
    await this.writeQueue;
    return result === undefined ? undefined : structuredClone(result);
  }

  async replace(nextData) {
    this.data = normalizeData(structuredClone(nextData));
    pruneData(this.data);
    await this.flush();
    return this.snapshot();
  }

  async flush() {
    const temporary = `${this.filePath}.tmp`;
    // Monitor data can contain many historical versions. Compact JSON cuts
    // disk writes substantially while keeping the file portable and readable.
    await fs.writeFile(temporary, JSON.stringify(this.data), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }
}

function normalizeData(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    announcements: Array.isArray(data.announcements) ? data.announcements : [],
    versions: Array.isArray(data.versions) ? data.versions : [],
    events: Array.isArray(data.events) ? data.events : [],
    runs: Array.isArray(data.runs) ? data.runs : [],
    deliveries: Array.isArray(data.deliveries) ? data.deliveries : []
  };
}

function pruneData(data) {
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  data.runs = data.runs
    .filter((item) => now - Date.parse(item.startedAt || 0) <= ninetyDays)
    .slice(-1500);
  data.deliveries = data.deliveries
    .filter((item) => now - Date.parse(item.createdAt || 0) <= ninetyDays)
    .slice(-1500);
  data.events = data.events.slice(-3000);
  const versionsByAnnouncement = new Map();
  data.versions.forEach((item) => {
    if (!versionsByAnnouncement.has(item.announcementId)) versionsByAnnouncement.set(item.announcementId, []);
    versionsByAnnouncement.get(item.announcementId).push(item);
  });
  const retainedVersionIds = new Set();
  versionsByAnnouncement.forEach((items) => items
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, 20)
    .forEach((item) => retainedVersionIds.add(item.id)));
  data.versions = data.versions.map((item) => {
    if (now - Date.parse(item.createdAt || 0) > thirtyDays) {
      const { raw: _raw, html: _html, ...rest } = item;
      return rest;
    }
    return item;
  }).filter((item) => retainedVersionIds.has(item.id)).slice(-3000);
}

module.exports = { MonitorStore };
