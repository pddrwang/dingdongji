/**
 * 二期预留：Agent SDK 无头自动执行。
 *
 * 目标能力（本期不实现）：
 *  - 使用 `@anthropic-ai/claude-agent-sdk` 无头运行 Claude，自动执行管线步骤
 *    （自动检索、自动去重、自动审稿、自动生成 PRISMA 流程图等）。
 *  - 管线步骤的「自动执行」按钮。
 *
 * 注意事项（已在计划中标注）：
 *  - 本机模型走本地代理 `http://127.0.0.1:15721`（ANTHROPIC_BASE_URL，
 *    ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED）。SDK 需验证该代理下的兼容性。
 *  - 安装：`npm i @anthropic-ai/claude-agent-sdk`。
 *
 * 用法骨架（二期启用时实现）：
 *
 *   import { query } from '@anthropic-ai/claude-agent-sdk';
 *   const result = await query({
 *     prompt: '基于管线状态自动执行当前步骤...',
 *     options: {
 *       systemPrompt: pipelineContext(),   // 注入管线上下文
 *       cwd: workspaceRoot,
 *       allowedTools: ['Bash', 'Read', 'Write', 'Edit', ...MCP_TOOLS],
 *     },
 *   });
 */
export type ClaudeSdkRunner = (prompt: string, opts: { cwd: string; tools?: string[] }) => Promise<string>;

export function getSdkRunner(): ClaudeSdkRunner | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require('@anthropic-ai/claude-agent-sdk');
    if (sdk && typeof sdk.query === 'function') {
      return async (prompt, opts) => {
        const res = await sdk.query({
          prompt,
          options: { cwd: opts.cwd, allowedTools: opts.tools },
        });
        return String(res.result?.result ?? '');
      };
    }
  } catch {
    // SDK 未安装 → 二期
  }
  return null;
}
