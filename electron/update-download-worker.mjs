import { createHash } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parentPort, workerData } from "node:worker_threads";

const PROGRESS_INTERVAL_MS = 150;

run()
  .then((result) => {
    parentPort?.postMessage({ ...result, type: "done" });
  })
  .catch((error) => {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : "Update download failed.",
      type: "error",
    });
  });

async function run() {
  const sourcePath = String(workerData?.sourcePath ?? "");
  const outputPath = String(workerData?.outputPath ?? "");
  const expectedHash = normalizeHash(workerData?.expectedHash);

  if (!sourcePath || !outputPath) {
    throw new Error("Update download worker is missing a source or output path.");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error("Update installer could not be found on the shared drive.");
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath) && (await installerMatchesExpectedHash(outputPath, expectedHash))) {
    postProgress("ready", 1);
    return { outputPath, reused: true };
  }

  const tempPath = `${outputPath}.partial`;
  await fsp.rm(tempPath, { force: true });

  try {
    await copyInstallerToTempFile({ expectedHash, sourcePath, tempPath });
    await fsp.rm(outputPath, { force: true });
    await fsp.rename(tempPath, outputPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }

  postProgress("ready", 1);
  return { outputPath, reused: false };
}

async function copyInstallerToTempFile({ expectedHash, sourcePath, tempPath }) {
  const sourceStats = await fsp.stat(sourcePath);
  const totalBytes = sourceStats.size;
  const hash = expectedHash ? createHash("sha256") : null;
  let copiedBytes = 0;
  let lastProgressAt = 0;

  postProgress("copying", 0);

  const readStream = fs.createReadStream(sourcePath);
  readStream.on("data", (chunk) => {
    copiedBytes += chunk.length;
    hash?.update(chunk);

    const now = Date.now();
    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS || copiedBytes === totalBytes) {
      lastProgressAt = now;
      postProgress("copying", totalBytes > 0 ? copiedBytes / totalBytes : 1);
    }
  });

  await pipeline(readStream, fs.createWriteStream(tempPath));

  if (!expectedHash) {
    return;
  }

  postProgress("verifying", 1);
  const actualHash = hash.digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error("Downloaded update did not match the expected checksum.");
  }
}

async function installerMatchesExpectedHash(installerPath, expectedHash) {
  if (!expectedHash) {
    return true;
  }

  return (await hashFile(installerPath)) === expectedHash;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function postProgress(phase, progress) {
  parentPort?.postMessage({
    phase,
    progress: Math.max(0, Math.min(1, Number(progress) || 0)),
    type: "progress",
  });
}

function normalizeHash(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
