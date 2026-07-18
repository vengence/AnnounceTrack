const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("邮件发送运行依赖已声明并可加载", () => {
  const packageJson = require("../package.json");
  assert.ok(packageJson.dependencies?.nodemailer, "package.json 必须声明 nodemailer 运行依赖");
  const resolved = require.resolve("nodemailer", { paths: [path.join(__dirname, "..")] });
  assert.match(resolved, /nodemailer/);
  const nodemailer = require(resolved);
  assert.equal(typeof nodemailer.createTransport, "function");
});

test("Windows 11 安装目标使用 x64 NSIS 并提供安装选项", () => {
  const packageJson = require("../package.json");
  assert.equal(packageJson.version, "0.7.1");
  assert.deepEqual(packageJson.build?.win?.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(packageJson.build?.nsis?.oneClick, false);
  assert.equal(packageJson.build?.nsis?.allowToChangeInstallationDirectory, true);
  assert.match(packageJson.build?.nsis?.artifactName || "", /windows/);
  assert.match(packageJson.scripts?.["dist:win:portable"] || "", /win-portable/);
  assert.match(packageJson.build?.win?.artifactName || "", /portable/);
});

test("发布构建不会由 electron-builder 隐式上传", () => {
  const script = require("node:fs").readFileSync(require.resolve("../scripts/build-release.cjs"), "utf8");
  assert.match(script, /"--publish",\s*"never"/);
});
