#!/bin/bash
# Project-scoped PreToolUse gate. Input is forwarded directly, without temp files.
DDJ_PY="$(command -v python3.12 || command -v python3 || command -v python || true)"
if [ -z "$DDJ_PY" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"叮咚鸡无法运行约束检查：Python 不可用，请先修复环境。"}}'
  exit 0
fi
DDJ_HOOK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$DDJ_PY" "$DDJ_HOOK_DIR/gate_tools.py"
