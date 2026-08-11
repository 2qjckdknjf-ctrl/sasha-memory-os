export const packageName = 'mcp-gateway' as const;
export { createMcpHandlers, mcpTools } from './tools.js';
export { handleMcpJsonRpc } from './rpc.js';
export type { JsonRpcReq, JsonRpcRes, McpHandlers } from './rpc.js';
// Runnable: pnpm --filter @memory-os/mcp-gateway start  (stdio)
// HTTP:     pnpm --filter @memory-os/mcp-gateway start:http  (POST /mcp)
