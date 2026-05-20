/**
 * Tool registry. Extensions register themselves at module load time; the
 * assistant runner reads `listAllTools()` to advertise capabilities to the
 * model, and `callTool()` to execute the model's chosen tool.
 *
 * Tool names must be unique across all extensions. Last-write wins so a
 * later-loaded extension can override a built-in tool — useful for testing
 * but easy to misuse, hence the console.warn.
 */

import type { Extension, ToolContext, ToolDef, ToolHandler, ToolResult } from "./types";

interface RegisteredTool {
    extensionId: string;
    def: ToolDef;
    handler: ToolHandler;
}

const tools = new Map<string, RegisteredTool>();
const extensions = new Map<string, Extension>();

export function registerExtension(ext: Extension): void {
    extensions.set(ext.id, ext);
    for (const def of ext.tools) {
        if (tools.has(def.name)) {
            const prev = tools.get(def.name)!;
            console.warn(
                `[assistant] tool "${def.name}" from extension "${prev.extensionId}" ` +
                    `is being overridden by "${ext.id}"`,
            );
        }
        const handler = ext.handlers[def.name];
        if (!handler) {
            console.warn(
                `[assistant] extension "${ext.id}" defines tool "${def.name}" but provides no handler`,
            );
            continue;
        }
        tools.set(def.name, { extensionId: ext.id, def, handler });
    }
}

export function listAllTools(): ToolDef[] {
    return Array.from(tools.values()).map((t) => t.def);
}

export function listExtensions(): Extension[] {
    return Array.from(extensions.values());
}

export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const t = tools.get(name);
    if (!t) {
        return {
            blocks: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
        };
    }
    try {
        return await t.handler(args, ctx);
    } catch (e: unknown) {
        const message =
            typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
        return {
            blocks: [{ type: "text", text: `Tool "${name}" failed: ${message}` }],
            isError: true,
        };
    }
}
