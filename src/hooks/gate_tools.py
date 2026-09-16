"""Conservative Claude PreToolUse gate, not a universal agent/OS sandbox."""
import fnmatch
import json
import os
from pathlib import Path
import sys


def decision(reason, hard=True):
    output = {'hookEventName': 'PreToolUse'}
    if hard:
        output.update(permissionDecision='deny', permissionDecisionReason=reason)
    else:
        output['additionalContext'] = reason
    return {'hookSpecificOutput': output}


def evaluate(data):
    if not isinstance(data, dict) or not isinstance(data.get('cwd'), str) or not os.path.isabs(data['cwd']):
        return decision('叮咚鸡无法确认本次工具调用的工作区，拒绝猜测全局项目；请检查 hook 的 cwd。')
    cwd = Path(data['cwd']).resolve()
    root = next((p for p in (cwd, *cwd.parents) if (p / '工程文件/00_pipeline_state.json').exists()), None)
    if root is None:
        return {}
    state_file = root / '工程文件/00_pipeline_state.json'
    if state_file.is_symlink() or root not in state_file.resolve().parents:
        return decision('叮咚鸡管线状态路径越界，需人工检查。')
    try:
        state = json.loads(state_file.read_text(encoding='utf-8'))
        current = next(s for s in state['steps'] if s['id'] == state['current_step'])
        blocked = current.get('blocked_paths') or []
        if not isinstance(blocked, list) or any(not isinstance(p, str) for p in blocked):
            raise ValueError('invalid_blocked_paths')
    except (OSError, ValueError, TypeError, KeyError, StopIteration):
        return decision('叮咚鸡无法读取有效的管线状态；先恢复状态再运行工具。')
    if not blocked:
        return {}
    hard = state.get('enforcement_mode') == 'hard'
    tool = data.get('tool_name')
    if tool == 'Bash':
        return decision('叮咚鸡：本步骤存在禁止路径。不能可靠静态判断任意 shell、脚本、重定向的写入范围；硬约束下暂停 Bash，请改用可检查目标路径的工具，或由研究者确认调整计划。', hard)
    if tool in ('Edit', 'Write'):
        inputs = data.get('tool_input')
        target = inputs.get('file_path') if isinstance(inputs, dict) else None
        if not isinstance(target, str) or not target:
            return decision('叮咚鸡无法确认写入目标。', hard)
        candidate = Path(target).expanduser()
        candidate = candidate if candidate.is_absolute() else cwd / candidate
        lexical = os.path.abspath(candidate)
        resolved = str(candidate.resolve())
        for pattern in blocked:
            for absolute in (lexical, resolved):
                relative = os.path.relpath(absolute, root)
                if fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(absolute, pattern):
                    return decision('叮咚鸡：当前步骤禁止修改 ' + pattern + '；先完成并验收当前步骤。', hard)
    return {}


if __name__ == '__main__':
    try:
        result = evaluate(json.load(sys.stdin))
    except Exception:
        result = decision('叮咚鸡约束检查异常，未放行本次工具调用。')
    print(json.dumps(result, ensure_ascii=False))
