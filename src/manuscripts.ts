import * as fs from 'fs';
import * as path from 'path';
export type Author = { name: string; affiliation: string; orcid: string; contribution: string; corresponding: boolean };
export function projectPath(ws: string, relative: string): string {
  const root = fs.realpathSync(ws), target = path.resolve(root, relative);
  const within = (p: string) => p === root || (!path.relative(root, p).startsWith('..' + path.sep) && path.relative(root, p) !== '..' && !path.isAbsolute(path.relative(root, p)));
  if (!within(target)) throw new Error('路径不属于当前项目');
  let ancestor = target; while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!within(fs.realpathSync(ancestor))) throw new Error('禁止通过符号链接读取其他项目');
  return target;
}
export function manuscriptList(ws: string): string[] {
  ws = fs.realpathSync(ws);
  const result: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 4 || result.length >= 200 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else if (/\.(md|txt|docx|pdf)$/i.test(e.name) && result.length < 200) result.push(path.relative(ws, full));
    }
  };
  for (const dir of ['手稿文书', '结果文件/manuscript']) visit(projectPath(ws, dir), 0);
  return result.sort();
}
export function readAuthors(ws: string): Author[] {
  const file = projectPath(ws, '工程文件/authors.json');
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('作者库过大');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data) || data.some(a => !a || typeof a.name !== 'string' || typeof a.affiliation !== 'string')) throw new Error('作者库格式无效，请保留文件并修正');
  return data;
}
export function authorBlock(authors: Author[]) {
  const clean = (s: unknown) => String(s || '').replace(/[\r\n<>]/g, ' ').trim();
  return '<!-- DDJ AUTHORS START -->\n## 作者信息（待全体作者确认）\n\n' + authors.map((a, i) => `${i + 1}. ${clean(a.name)}${a.corresponding ? '（通讯作者）' : ''} — ${clean(a.affiliation)}\n   ORCID：${clean(a.orcid) || '未提供'}；贡献：${clean(a.contribution) || '待确认'}`).join('\n\n') + '\n<!-- DDJ AUTHORS END -->\n';
}
