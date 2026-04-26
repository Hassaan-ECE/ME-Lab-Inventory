import { createHash } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parentPort, workerData } from "node:worker_threads";

const PROGRESS_INTERVAL_MS = 500;
const PROGRESS_INCREMENT = 0.01;

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
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error("Update download requires a valid SHA-256 checksum.");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error("Update installer could not be found on the shared drive.");
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath) && (await installerMatchesExpectedHash(outputPath, expectedHash))) {
    const outputStats = await fsp.stat(outputPath);
    postProgress("ready", 1);
    return buildDownloadResult({ expectedHash, outputPath, outputStats, reused: true });
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
  return buildDownloadResult({
    expectedHash,
    outputPath,
    outputStats: await fsp.stat(outputPath),
    reused: false,
  });
}

async function copyInstallerToTempFile({ expectedHash, sourcePath, tempPath }) {
  const sourceStats = await fsp.stat(sourcePath);
  const totalBytes = sourceStats.size;
  const hash = createHash("sha256");
  let copiedBytes = 0;
  let lastProgressAt = 0;
  let lastProgress = 0;

  postProgress("copying", 0);

  const readStream = fs.createReadStream(sourcePath);
  readStream.on("data", (chunk) => {
    copiedBytes += chunk.length;
    hash.update(chunk);

    const now = Date.now();
    const progress = totalBytes > 0 ? copiedBytes / totalBytes : 1;
    if (
      (now - lastProgressAt >= PROGRESS_INTERVAL_MS && progress - lastProgress >= PROGRESS_INCREMENT) ||
      copiedBytes === totalBytes
    ) {
      lastProgressAt = now;
      lastProgress = progress;
      postProgress("copying", progress);
    }
  });

  await pipeline(readStream, fs.createWriteStream(tempPath));

  postProgress("verifying", 1);
  const actualHash = hash.digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error("Downloaded update did not match the expected checksum.");
  }
}

function buildDownloadResult({ expectedHash, outputPath, outputStats, reused }) {
  return {
    mtimeMs: outputStats.mtimeMs,
    outputPath,
    reused,
    sha256: expectedHash,
    size: outputStats.size,
  };
}

async function installerMatchesExpectedHash(installerPath, expectedHash) {
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
