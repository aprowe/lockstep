/**
 * Public surface of the assistant module. Importing this file once at app
 * startup is enough to register the core extension; the panel never has to
 * know which extensions exist.
 */

import { coreExtension } from "./coreTools";
import { geminiExtension } from "./geminiTools";
import { registerExtension } from "./registry";

registerExtension(coreExtension);
registerExtension(geminiExtension);

export { runAssistant } from "./runner";
export { listAllTools, listExtensions } from "./registry";
export type { TranscriptEntry } from "./types";
