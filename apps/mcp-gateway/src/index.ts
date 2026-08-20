export const packageName = 'mcp-gateway' as const;
export { createMcpHandlers, mcpTools } from './tools.js';
export {
  CHATGPT_PILOT_TOOLS,
  DEFAULT_PROJECT_ID,
  DEFAULT_WORKSPACE_ID,
  getMcpProfile,
  resolveMcpProfileName,
} from './profile.js';
export type { McpProfile, McpProfileName } from './profile.js';
export { handleMcpJsonRpc } from './rpc.js';
export type { JsonRpcReq, JsonRpcRes, McpHandlers } from './rpc.js';
// Runnable: pnpm --filter @memory-os/mcp-gateway start  (stdio)
// HTTP:     pnpm --filter @memory-os/mcp-gateway start:http  (POST /mcp)
// Profile:  MEMORY_OS_MCP_PROFILE=chatgpt|full
