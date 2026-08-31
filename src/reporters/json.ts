import type { RunResult } from "../types.js";
import { stableJsonStringify } from "./common.js";

export function renderJsonReport(result: RunResult): string {
  return `${stableJsonStringify(result, 2)}\n`;
}
