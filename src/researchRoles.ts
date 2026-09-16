import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const researchRoles = [
  { id: 'research', label: '通用研究', description: '讨论问题、计划与研究推进', skills: [] as string[], instruction: '按用户当前研究任务协作；关键科学决定交由用户确认。' },
  { id: 'reviewer', label: '审稿人', description: '证据、方法、局限与可执行修改意见；默认不改稿', skills: ['peer-review'], instruction: '提供模拟同行评审工作稿，不冒充受邀审稿人或给出编辑部决定。先确认授权、稿件保密级别和期刊 AI 政策，再读取未发表材料。区分重大/次要问题，逐项给出位置、依据、影响和建议；默认只评审，不改原稿。' },
  { id: 'editor', label: '学术编辑', description: '结构、语言、术语与论证一致性', skills: ['scientific-writing'], instruction: '作为作者的学术编辑助手，先确认编辑范围与目标期刊。保留原始数据、效应量与不确定性，区分语言润色和科学实质修改；实质修改先提出建议并征得确认，不擅自投稿。' },
  { id: 'methods', label: '方法学审阅', description: '研究设计、统计假设与可重复性', skills: ['peer-review'], instruction: '聚焦设计与分析的匹配、混杂、缺失值、多重比较、不确定性和可重复性。只按实际证据作判断，不虚构重分析或将报告清单当质量分数；新增计算必须符合当前授权。' },
];
export function researchRole(id?: string) { return researchRoles.find(role => role.id === id) || researchRoles[0]; }
export function roleSkillPath(name: string) { return path.join(os.homedir(), '.codex', 'skills', name, 'SKILL.md'); }
export function roleBrief(id?: string) {
  const role = researchRole(id);
  const skills = role.skills.map(name => {
    const file = roleSkillPath(name);
    return fs.existsSync(file) ? `开始相关工作前读取技能 ${file}，并按任务读取它要求的参考文件。` : `技能 ${name} 当前未安装：说明缺失，不声称已使用。`;
  });
  return `会话角色：${role.label}\n${role.instruction}\n${skills.join('\n')}\n角色不扩大权限，不更改项目作用域，不授权外传材料。内置 Codex 可能使用远程模型，不得把它当成本地保密处理工具；未经授权不要读取或上传保密稿件。`;
}
