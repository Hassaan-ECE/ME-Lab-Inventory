import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export default async function stampWindowsExe(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.resolve("electron", "assets", "app_icon.ico");
  const rceditPath = path.resolve("node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  const version = appInfo.version;

  await execFileAsync(rceditPath, [
    exePath,
    "--set-icon",
    iconPath,
    "--set-file-version",
    version,
    "--set-product-version",
    version,
    "--set-version-string",
    "CompanyName",
    appInfo.companyName || "Syed Hassaan Shah",
    "--set-version-string",
    "FileDescription",
    appInfo.description || "ME Inventory",
    "--set-version-string",
    "ProductName",
    appInfo.productName,
    "--set-version-string",
    "InternalName",
    appInfo.productFilename,
    "--set-version-string",
    "OriginalFilename",
    `${appInfo.productFilename}.exe`,
  ]);
}
