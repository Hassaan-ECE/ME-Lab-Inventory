import { parentPort, workerData } from "node:worker_threads";

import { writeInventoryWorkbook } from "./inventory-export.mjs";

writeInventoryWorkbook(workerData?.runtimeContext, String(workerData?.outputPath ?? ""))
  .then((result) => {
    parentPort?.postMessage({ result, type: "done" });
  })
  .catch((error) => {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : "Excel export failed.",
      type: "error",
    });
  });
