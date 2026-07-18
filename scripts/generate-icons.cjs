const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, nativeImage } = require("electron");

app.whenReady().then(async () => {
  const assets = path.join(__dirname, "..", "assets");
  const window = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { contextIsolation: true, sandbox: true } });
  await renderSvg(window, path.join(assets, "monitor-icon.svg"), path.join(assets, "monitor-icon.png"), 1024);
  const largeTray = path.join(assets, "tray-icon-large.png");
  await renderSvg(window, path.join(assets, "tray-iconTemplate.svg"), largeTray, 1024);
  const tray = nativeImage.createFromPath(largeTray);
  fs.writeFileSync(path.join(assets, "tray-iconTemplate.png"), tray.resize({ width: 16, height: 16, quality: "best" }).toPNG());
  fs.writeFileSync(path.join(assets, "tray-iconTemplate@2x.png"), tray.resize({ width: 32, height: 32, quality: "best" }).toPNG());
  fs.unlinkSync(largeTray);
  window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });

async function renderSvg(window, source, target, size) {
  const svg = fs.readFileSync(source);
  const sourceUrl = `data:image/svg+xml;base64,${svg.toString("base64")}`;
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><img id="source" width="${size}" height="${size}" src="${sourceUrl}"><canvas id="canvas" width="${size}" height="${size}" style="display:none"></canvas></body></html>`;
  const temporaryHtml = path.join(app.getPath("temp"), `monitor-icon-${size}-${process.pid}.html`);
  fs.writeFileSync(temporaryHtml, html);
  await window.loadFile(temporaryHtml);
  const dataUrl = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const image = document.querySelector('#source'); const render = () => { const canvas = document.querySelector('#canvas'); canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size}); resolve(canvas.toDataURL('image/png')); }; if (image.complete) render(); else { image.onload = render; image.onerror = () => reject(new Error('SVG render failed')); } })`);
  fs.unlinkSync(temporaryHtml);
  fs.writeFileSync(target, Buffer.from(dataUrl.split(",")[1], "base64"));
}
