const path = require("node:path");

// electron-builder normally shells out to npm/pnpm just to discover production
// dependencies. Some managed desktop environments provide Node through an
// absolute runtime path without exposing those global commands. Use the
// builder's built-in filesystem traversal collector so release builds remain
// reproducible from the checked-in lockfile and installed node_modules tree.
const electronBuilderPackage = require.resolve("electron-builder/package.json");
const electronBuilderDirectory = path.dirname(electronBuilderPackage);
const appBuilderPackage = require.resolve("app-builder-lib/package.json", { paths: [electronBuilderDirectory] });
const appBuilderDirectory = path.dirname(appBuilderPackage);
const packageManagerModule = require(path.join(appBuilderDirectory, "out/node-module-collector/packageManager.js"));

packageManagerModule.detectPackageManager = async () => ({
  pm: "traversal",
  corepackConfig: undefined,
  resolvedDirectory: process.cwd(),
  detectionMethod: "release build filesystem traversal"
});

const target = process.argv[2] || "dmg";
const buildArguments = target === "win"
  ? ["--win", "nsis", "--x64"]
  : target === "win-portable"
    ? ["--win", "zip", "--x64"]
  : ["--mac", target === "dir" ? "dir" : "dmg", "--arm64"];
process.argv = [process.argv[0], require.resolve("electron-builder/out/cli/cli.js"), ...buildArguments];
require(process.argv[1]);
