import { parentPort } from "node:worker_threads";

import {
  createInventoryEntry,
  deleteInventoryEntry,
  loadInventoryEntries,
  queryInventoryEntries,
  setArchivedEntry,
  syncInventoryWithShared,
  toggleVerifiedEntry,
  updateInventoryEntry,
} from "./inventory-db.mjs";

const ACTIONS = {
  createInventoryEntry,
  deleteInventoryEntry,
  loadInventoryEntries,
  queryInventoryEntries,
  setArchivedEntry,
  syncInventoryWithShared,
  toggleVerifiedEntry,
  updateInventoryEntry,
};

parentPort?.on("message", async (message) => {
  const id = message?.id;
  const action = String(message?.action ?? "");
  const args = Array.isArray(message?.args) ? message.args : [];

  try {
    const handler = ACTIONS[action];
    if (!handler) {
      throw new Error(`Unknown inventory worker action: ${action}`);
    }

    const result = await handler(...args);
    parentPort?.postMessage({ id, result, type: "result" });
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : "Inventory worker failed.",
      id,
      type: "error",
    });
  }
});
