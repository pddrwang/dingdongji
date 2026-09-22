;(() => {
  const host = { postMessage: message => window.ddjHost.postMessage({ ...message, sessionId }) };
  let workspace = '', busy = false, external = false, switching = false, managing = false, hasDeleted = false, sessionId = '';
  const drafts = new Map(Object.entries(window.ddjHost.getState?.()?.fusionDrafts || {}));
  function saveDraft() {
    drafts.set(workspace + ':' + sessionId, input.value);
    window.ddjHost.setState?.({ ...(window.ddjHost.getState?.() || {}), fusionDrafts: Object.fromEntries(drafts) });
    if (workspace && sessionId) host.postMessage({ command: 'fusionDraft', workspace, text: input.value });
  }
  const chat = document.createElement('section');
  chat.id = 'fusion-chat';
  chat.innerHTML = `<header class="fusion-heading"><span>DDJ / BIOMEDICAL RESEARCH</span><h1>生物医学整合研究平台</h1><p>从一个问题开始，连接每一步研究。</p></header>
    <div class="fusion-channel"><b>CODEX · 项目会话</b><span id="fusion-status" role="status">等待项目连接</span></div>
    <div class="fusion-toolbar"><button id="fusion-mode">切换到外挂 Codex</button><button id="fusion-new">新会话</button><button id="fusion-rename">重命名</button><button id="fusion-archive">归档</button><button id="fusion-export">导出</button></div>
    <label class="fusion-history-label" for="fusion-history">项目会话与归档</label><select id="fusion-history" aria-label="项目会话与归档"></select>
    <input id="fusion-search" placeholder="搜索当前会话的完整历史" aria-label="搜索当前会话的完整历史">
    <div id="fusion-workspace"></div><div id="fusion-attachments"></div>
    <div id="fusion-messages" role="log" aria-label="项目多智能体对话"></div>
    <div id="fusion-error" role="alert"></div>
    <form id="fusion-form"><label for="fusion-input">与你的研究智能体对话</label><textarea id="fusion-input" placeholder="描述科学问题、数据或需要推进的任务…" rows="4" maxlength="32000"></textarea><div class="fusion-actions"><small>Ctrl / ⌘ + Enter 发送</small><button type="button" id="fusion-stop" disabled>停止</button><button id="fusion-send" type="submit">发送指令 ↗</button></div></form>`;
  document.body.appendChild(chat);
  const platformBar = document.createElement('header'); platformBar.id = 'fusion-platform-bar';
  platformBar.setAttribute('aria-label', '平台与当前项目');
  platformBar.innerHTML = '<div class="platform-brand"><strong>叮咚鸡 · 生物医学整合研究平台</strong><span>从一个问题开始，连接每一步研究。</span></div><div class="platform-project"><small>当前项目</small><b id="fusion-project-name">等待项目连接</b></div><nav aria-label="平台快捷操作"><button data-quick="refresh">刷新</button><button data-quick="check">自检</button><button data-quick="new">＋ 新对话</button><button data-quick="mode">切换外挂</button></nav>';
  document.body.appendChild(platformBar);
  const biomedicalMark = document.createElement('span'); biomedicalMark.className = 'platform-biomedical-mark'; biomedicalMark.setAttribute('aria-hidden', 'true');
  biomedicalMark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5 9 2l3 2 3-2-1 3M5 12a7 7 0 1 1 14 0v3a7 6 0 0 1-14 0ZM5 13l-3 2 3 2m14-4 3 2-3 2M9 21v1m6-1v1"/><circle cx="9" cy="10" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r=".7" fill="currentColor" stroke="none"/><path d="m10 13 2 2 2-2Z"/></svg>';
  platformBar.querySelector('.platform-brand>span').textContent = '让灵感破壳，让研究有据。';
  platformBar.querySelector('.platform-brand').appendChild(biomedicalMark);
  new ResizeObserver(() => document.body.style.setProperty('--platform-bar-height', platformBar.getBoundingClientRect().height + 'px')).observe(platformBar);
  platformBar.querySelector('[data-quick="refresh"]').onclick = () => host.postMessage({ command: 'getAll' });
  platformBar.querySelector('[data-quick="check"]').onclick = () => chat.querySelector('#fusion-check').click();
  platformBar.querySelector('[data-quick="new"]').onclick = () => chat.querySelector('#fusion-new').click();
  platformBar.querySelector('[data-quick="mode"]').onclick = () => chat.querySelector('#fusion-mode').click();
  // Original terminal insignia, not a game logo or an operational status indicator.
  const insignia = document.createElement('div'); insignia.className = 'fusion-insignia'; insignia.setAttribute('aria-hidden', 'true');
  insignia.innerHTML = '<svg viewBox="0 0 76 42" fill="none"><path d="M2 12V2h12M62 2h12v10M74 30v10H62M14 40H2V30" stroke="currentColor"/><path d="M24 21 38 7l14 14-14 14Z" stroke="currentColor"/><path d="m29 21 9-9 9 9-9 9Z" fill="currentColor" opacity=".18"/><path d="M17 21h13m16 0h13M38 1v12m0 16v12" stroke="currentColor"/><circle cx="38" cy="21" r="3" fill="currentColor"/></svg><span>DDJ / RESEARCH</span>';
  chat.querySelector('.fusion-heading').appendChild(insignia);
  const ticks = document.createElement('span'); ticks.className = 'fusion-signal-ticks'; ticks.setAttribute('aria-hidden', 'true');
  ticks.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  chat.querySelector('.fusion-channel b').prepend(ticks);
  const divider = document.createElement('div'); divider.id = 'fusion-divider'; divider.tabIndex = 0;
  divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'vertical'); divider.setAttribute('aria-label', '调整仪表盘与对话区宽度');
  divider.setAttribute('aria-valuemin', '25'); divider.setAttribute('aria-valuemax', '65');
  document.body.appendChild(divider);
  let ratio = Number(window.ddjHost.getState?.()?.fusionRatioV2) || 1 / 3;
  function resize(value, persist = false) {
    ratio = Math.max(.25, Math.min(.65, value));
    document.body.style.setProperty('--fusion-ratio', String(ratio));
    document.body.style.setProperty('--fusion-split', `${ratio * 100}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    if (persist) window.ddjHost.setState?.({ ...(window.ddjHost.getState?.() || {}), fusionRatioV2: ratio });
  }
  resize(ratio);
  divider.onpointerdown = e => { divider.setPointerCapture(e.pointerId); document.body.classList.add('fusion-resizing'); };
  divider.onpointermove = e => { if (divider.hasPointerCapture(e.pointerId)) resize((e.clientX - 58) / (window.innerWidth - 58)); };
  divider.onpointerup = e => { divider.releasePointerCapture(e.pointerId); resize(ratio, true); document.body.classList.remove('fusion-resizing'); };
  divider.onpointercancel = () => document.body.classList.remove('fusion-resizing');
  divider.ondblclick = () => resize(1 / 3, true);
  divider.onkeydown = e => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) { e.preventDefault(); resize(e.key === 'Home' ? 1 / 3 : ratio + (e.key === 'ArrowLeft' ? -.02 : .02), true); } };
  const toolbar = chat.querySelector('.fusion-toolbar');
  for (const [action,label] of [['delete','删除'],['restore','恢复删除']]) {
    const button = document.createElement('button'); button.id = 'fusion-' + action; button.textContent = label;
    button.onclick = () => host.postMessage({ command: 'fusionManage', action, workspace }); toolbar.appendChild(button);
  }
  const check = document.createElement('button'); check.id = 'fusion-check'; check.textContent = '连接自检'; toolbar.appendChild(check);
  const checkResult = document.createElement('div'); checkResult.id = 'fusion-check-result'; checkResult.setAttribute('role','status'); toolbar.after(checkResult);
  check.onclick = () => startCheck();
  const guide = document.createElement('details'); guide.className = 'fusion-guide';
  guide.innerHTML = '<summary>工作台操作指引</summary><p>① 核对项目路径，选择或新建会话。② 添加文件并描述任务。③ 查看执行记录和左侧研究产物。</p><p>拖动中间分隔线调整宽度；双击恢复。删除移入回收区，可恢复最近删除的会话。</p>';
  checkResult.after(guide);
  // Locally embedded Lucide activity icon (ISC); see THIRD_PARTY_NOTICES.md.
  const telemetry = document.createElement('section'); telemetry.className = 'fusion-telemetry';
  telemetry.innerHTML = '<div class="fusion-telemetry-title"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg><span>研究运行信息</span><span id="fusion-counts">0 条记录</span></div><label id="fusion-progress-label" for="fusion-progress">尚未绑定研究管线</label><progress id="fusion-progress" max="1" value="0"></progress><div id="fusion-runtime">Codex 尚未握手 · 首次发送时连接</div><div class="fusion-run-track" aria-hidden="true"><i></i></div>';
  chat.querySelector('.fusion-channel').after(telemetry);
  const management = document.createElement('section'); management.id = 'fusion-management';
  management.setAttribute('aria-label', '会话管理');
  toolbar.before(management);
  for (const el of [toolbar, checkResult, guide, chat.querySelector('.fusion-history-label'), chat.querySelector('#fusion-history'), chat.querySelector('#fusion-search'), chat.querySelector('#fusion-workspace')]) management.appendChild(el);
  const managementHeader = document.createElement('div'); managementHeader.className = 'fusion-management-header';
  managementHeader.innerHTML = '<span>会话控制台</span><small>SESSION / 项目隔离</small><button id="fusion-management-reset" title="恢复默认高度">重置</button><button id="fusion-management-collapse" aria-controls="fusion-management" aria-expanded="true">收起</button>';
  management.before(managementHeader);
  management.prepend(telemetry);
  const quick = document.createElement('div'); quick.className = 'fusion-quick-session';
  quick.append(chat.querySelector('#fusion-history'), chat.querySelector('#fusion-new'));
  const more = document.createElement('details'); more.className = 'fusion-more';
  more.innerHTML = '<summary>管理与运行详情</summary>';
  for (const el of [...management.children]) more.appendChild(el);
  management.append(quick, more);
  const roleBadge = document.createElement('span'); roleBadge.id = 'fusion-role-badge'; roleBadge.textContent = '通用研究';
  roleBadge.title = '会话角色在新建时选择，不自动更改已有会话';
  managementHeader.querySelector('span').after(roleBadge);
  chat.querySelector('#fusion-new').textContent = '＋ 新对话';
  chat.querySelector('#fusion-new').title = '新建会话并选择角色';
  const boot = document.createElement('div'); boot.className = 'fusion-boot'; boot.setAttribute('role', 'status');
  boot.innerHTML = '<span class="fusion-boot-orbit" aria-hidden="true"></span><div><b>工作台自检</b><span class="fusion-boot-summary">等待项目状态</span></div><i aria-hidden="true"></i>';
  managementHeader.before(boot);
  let checkSequence = 0, checkTimer, checkedWorkspace;
  function startCheck() {
    platformBar.querySelector('[data-quick="check"]').disabled = true;
    clearTimeout(checkTimer); const requestId = ++checkSequence;
    check.disabled = true; boot.classList.add('checking'); boot.classList.remove('warning');
    boot.querySelector('.fusion-boot-summary').textContent = '正在检测工作区 · 信任状态 · 后端 · Codex 扩展';
    checkResult.textContent = '检查中；不调用模型，不修改项目。';
    host.postMessage({ command: 'fusionCheck', requestId });
    checkTimer = setTimeout(() => {
      ++checkSequence; check.disabled = false; boot.classList.remove('checking'); boot.classList.add('warning');
      platformBar.querySelector('[data-quick="check"]').disabled = false;
      boot.querySelector('.fusion-boot-summary').textContent = '自检超时 · 可在管理详情中重试';
      checkResult.textContent = '未收到检查结果，不能确认连接可用。';
    }, 10000);
  }
  const size = document.createElement('div'); size.id = 'fusion-management-divider'; size.tabIndex = 0;
  size.setAttribute('role', 'separator'); size.setAttribute('aria-orientation', 'horizontal');
  size.setAttribute('aria-label', '拖动调整信息区与对话区高度'); size.title = '上下拖动调整高度；双击恢复默认';
  management.after(size);
  let managementHeight = Number(window.ddjHost.getState?.()?.fusionCompactManagementHeight) || 94;
  function managementSize(value, persist = false) {
    const style = getComputedStyle(chat);
    const occupied = [...chat.children].filter(el => el !== management && el.id !== 'fusion-messages').reduce((sum, el) => {
      const css = getComputedStyle(el);
      return sum + el.getBoundingClientRect().height + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
    }, 0);
    const max = Math.max(70, chat.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - occupied - 160);
    managementHeight = Math.max(70, Math.min(max, Number(value) || 94));
    chat.style.setProperty('--management-height', managementHeight + 'px');
    size.setAttribute('aria-valuemin', '70'); size.setAttribute('aria-valuemax', String(max));
    size.setAttribute('aria-valuenow', String(Math.round(managementHeight)));
    if (persist) window.ddjHost.setState?.({ ...(window.ddjHost.getState?.() || {}), fusionCompactManagementHeight: managementHeight });
  }
  let dragStart = 0, dragHeight = 0;
  size.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); dragStart = e.clientY; dragHeight = managementHeight; size.setPointerCapture(e.pointerId); document.body.classList.add('fusion-resizing'); };
  size.onpointermove = e => { if (size.hasPointerCapture(e.pointerId)) managementSize(dragHeight + e.clientY - dragStart); };
  size.onpointerup = e => { if (size.hasPointerCapture(e.pointerId)) size.releasePointerCapture(e.pointerId); managementSize(managementHeight, true); document.body.classList.remove('fusion-resizing'); };
  size.onlostpointercapture = () => document.body.classList.remove('fusion-resizing');
  size.onkeydown = e => { if (['ArrowUp','ArrowDown','Home'].includes(e.key)) { e.preventDefault(); managementSize(e.key === 'Home' ? 94 : managementHeight + (e.key === 'ArrowUp' ? -20 : 20), true); } };
  size.ondblclick = () => managementSize(94, true);
  let managementCollapsed = !!window.ddjHost.getState?.()?.fusionManagementCollapsed;
  const collapseButton = managementHeader.querySelector('#fusion-management-collapse');
  function setManagementCollapsed(value) {
    managementCollapsed = value;
    management.hidden = value; size.hidden = value;
    chat.classList.toggle('management-collapsed', value);
    collapseButton.textContent = value ? '展开' : '收起';
    collapseButton.setAttribute('aria-expanded', String(!value));
    window.ddjHost.setState?.({ ...(window.ddjHost.getState?.() || {}), fusionManagementCollapsed: value });
    if (!value) managementSize(managementHeight);
  }
  collapseButton.onclick = () => setManagementCollapsed(!managementCollapsed);
  managementHeader.querySelector('#fusion-management-reset').onclick = () => { setManagementCollapsed(false); more.open = false; managementSize(94, true); };
  setManagementCollapsed(managementCollapsed);
  more.addEventListener('toggle', () => { if (more.open && managementHeight < 200) managementSize(280); });
  new ResizeObserver(() => managementSize(managementHeight)).observe(chat);
  new ResizeObserver(() => managementSize(managementHeight)).observe(chat.querySelector('#fusion-form'));
  for (const id of ['fusion-attachments', 'fusion-error']) new ResizeObserver(() => managementSize(managementHeight)).observe(chat.querySelector('#' + id));
  managementSize(managementHeight);
  function enterPage() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of [document.querySelector('#panel'), chat.querySelector('.fusion-heading')].filter(Boolean)) {
      el.getAnimations().forEach(animation => animation.cancel());
      el.animate([{ opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) enterPage(); });
  document.addEventListener('click', e => { if (e.target.closest('.rail-btn[data-tab], .rail-brand, [data-stage]')) requestAnimationFrame(enterPage); });
  requestAnimationFrame(enterPage);
  const input = chat.querySelector('#fusion-input');
  const runtime = document.createElement('div'); runtime.className = 'fusion-runtime-options';
  runtime.setAttribute('aria-label', '当前对话智能体与模型设置');
  runtime.innerHTML = '<button type="button" data-option="agent" id="fusion-agent">切换智能体 · Codex</button><button type="button" data-option="model">模型：配置默认</button><button type="button" data-option="effort">推理：默认</button><button type="button" data-option="permission">权限：项目写入</button><button type="button" data-option="refresh">查询余量 / 状态</button><span id="fusion-quota" role="status">余量尚未读取</span>';
  chat.querySelector('#fusion-form').prepend(runtime);
  runtime.querySelectorAll('button').forEach(button => button.onclick = () => host.postMessage({ command: 'fusionOptions', workspace, action: button.dataset.option }));

  // ── 智能体提问组件（内置对话窗口内的 ask-user-question）──
  // 由扩展把 Codex 的 requestUserInput 转成会话内卡片，用户选择/输入后回传。
  const askSection = document.createElement('section');
  askSection.id = 'fusion-ask'; askSection.hidden = true;
  askSection.setAttribute('role', 'group'); askSection.setAttribute('aria-label', '智能体提问');
  chat.querySelector('#fusion-form').before(askSection);
  let askState = null;
  function syncInteractionClass() { chat.classList.toggle('has-interaction', !askSection.hidden || !approvalSection.hidden); }
  function clearAsk() { askState = null; askSection.hidden = true; askSection.replaceChildren(); syncInteractionClass(); }
  function askProgress() {
    if (!askState) return;
    const total = askState.questions.length;
    const answered = askState.questions.filter(q => Object.prototype.hasOwnProperty.call(askState.answers, q.id)).length;
    const note = askSection.querySelector('.fusion-ask-progress');
    if (note) note.textContent = answered === total ? `已回答全部 ${total} 个问题` : `已回答 ${answered} / ${total}`;
    const submit = askSection.querySelector('.fusion-ask-submit');
    if (submit) submit.disabled = answered !== total;
  }
  function selectOption(question, value, multi, button) {
    if (multi) {
      const current = askState.answers[question.id] || [];
      askState.answers[question.id] = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      if (!askState.answers[question.id].length) delete askState.answers[question.id];
    } else {
      askState.answers[question.id] = [value];
    }
    const field = button.closest('.fusion-ask-question');
    field.querySelectorAll('.fusion-ask-option').forEach(option => {
      const on = (askState.answers[question.id] || []).includes(option.dataset.value);
      option.classList.toggle('selected', on); option.setAttribute('aria-pressed', String(on));
    });
    field.querySelector('.fusion-ask-custom').value = multi ? '' : value;
    field.classList.remove('skipped');
    askProgress();
  }
  function renderAsk(message) {
    const questions = (message.questions || []).filter(q => q && q.id);
    if (!questions.length) return;
    askState = { requestId: message.requestId, questions, answers: {} };
    askSection.replaceChildren();
    const header = document.createElement('header'); header.className = 'fusion-ask-head';
    header.innerHTML = '<span class="fusion-ask-eyebrow">' + (message.demo ? 'AGENT ASK · 预览（合成数据）' : 'AGENT ASK · 需要你的选择') + '</span><span class="fusion-ask-progress" role="status"></span>';
    const form = document.createElement('form'); form.className = 'fusion-ask-form';
    const askBody = document.createElement('div'); askBody.className = 'fusion-ask-body';
    questions.forEach((q, index) => {
      const multi = q.multiSelect === true || q.multiple === true;
      const field = document.createElement('fieldset'); field.className = 'fusion-ask-question';
      const legend = document.createElement('legend');
      const badge = document.createElement('span'); badge.className = 'fusion-ask-index'; badge.textContent = 'Q' + (index + 1);
      legend.append(badge, document.createTextNode(String(q.header || q.question || '')));
      const text = document.createElement('p'); text.className = 'fusion-ask-text'; text.textContent = String(q.question || '');
      field.append(legend, text);
      const options = document.createElement('div');
      options.className = 'fusion-ask-options'; options.setAttribute('role', multi ? 'group' : 'radiogroup');
      options.setAttribute('aria-label', String(q.question || '选项'));
      (q.options || []).forEach(option => {
        const value = String(option.label ?? option.value ?? '');
        if (!value) return;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'fusion-ask-option';
        button.dataset.value = value; button.setAttribute('aria-pressed', 'false');
        const label = document.createElement('b'); label.textContent = value;
        button.appendChild(label);
        if (option.description) { const desc = document.createElement('span'); desc.textContent = String(option.description); button.appendChild(desc); }
        button.onclick = () => selectOption(q, value, multi, button);
        options.appendChild(button);
      });
      field.appendChild(options);
      const custom = document.createElement('input');
      custom.className = 'fusion-ask-custom'; custom.type = 'text'; custom.maxLength = 2000;
      custom.placeholder = (q.options || []).length ? '或输入自定义回答…' : '输入你的回答…';
      custom.setAttribute('aria-label', String(q.question || '自定义回答'));
      custom.oninput = () => {
        const value = custom.value.trim();
        field.querySelectorAll('.fusion-ask-option').forEach(option => { option.classList.remove('selected'); option.setAttribute('aria-pressed', 'false'); });
        if (value) askState.answers[q.id] = [value]; else delete askState.answers[q.id];
        field.classList.remove('skipped'); askProgress();
      };
      custom.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!askSection.querySelector('.fusion-ask-submit').disabled) form.requestSubmit(); } };
      field.appendChild(custom);
      const skip = document.createElement('button');
      skip.type = 'button'; skip.className = 'fusion-ask-skip'; skip.textContent = '跳过此题';
      skip.onclick = () => {
        askState.answers[q.id] = []; field.classList.add('skipped');
        field.querySelectorAll('.fusion-ask-option').forEach(option => { option.classList.remove('selected'); option.setAttribute('aria-pressed', 'false'); });
        custom.value = ''; askProgress();
      };
      field.appendChild(skip);
      askBody.appendChild(field);
    });
    const actions = document.createElement('div'); actions.className = 'fusion-ask-actions';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'fusion-ask-submit'; submit.textContent = '提交回答'; submit.disabled = true;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'fusion-ask-cancel'; cancel.textContent = '取消本次提问';
    cancel.onclick = () => { const requestId = askState.requestId; clearAsk(); host.postMessage({ command: 'fusionAskUserResponse', requestId, workspace, cancelled: true }); };
    actions.append(submit, cancel); form.append(askBody, actions);
    form.onsubmit = event => {
      event.preventDefault();
      if (submit.disabled) return;
      const requestId = askState.requestId;
      const answers = {};
      for (const q of questions) answers[q.id] = { answers: askState.answers[q.id] || [] };
      clearAsk();
      host.postMessage({ command: 'fusionAskUserResponse', requestId, workspace, answers });
    };
    askSection.append(header, form);
    askSection.hidden = false;
    syncInteractionClass();
    host.postMessage({ command: 'fusionInteractionAck', requestId: askState.requestId });
    askProgress();
    const target = form.querySelector('.fusion-ask-option, .fusion-ask-custom');
    if (target) target.focus({ preventScroll: true });
    askSection.scrollIntoView({ block: 'nearest' });
  }

  // ── 审批卡片（DSH session/request_permission）──
  const approvalSection = document.createElement('section');
  approvalSection.id = 'fusion-approval'; approvalSection.hidden = true;
  approvalSection.setAttribute('role', 'group'); approvalSection.setAttribute('aria-label', '智能体审批');
  chat.querySelector('#fusion-form').before(approvalSection);
  let approvalState = null;
  function clearApproval() { approvalState = null; approvalSection.hidden = true; approvalSection.replaceChildren(); syncInteractionClass(); }
  const APPROVAL_LABEL = { allow_once: '批准本次', allow_always: '始终允许', reject_once: '拒绝本次', reject_always: '始终拒绝' };
  function toolDetail(tool) {
    const pick = { kind: tool.kind, title: tool.title, name: tool.name, command: tool.command, path: tool.path, reason: tool.reason, rawInput: tool.rawInput, content: tool.content, diff: tool.diff };
    for (const key of Object.keys(pick)) if (pick[key] === undefined || pick[key] === null || pick[key] === '') delete pick[key];
    return JSON.stringify(pick, null, 2).slice(0, 4000);
  }
  function renderApproval(message) {
    const options = (message.options || []).filter(o => o && typeof o.optionId === 'string');
    approvalState = { requestId: message.requestId, options };
    approvalSection.replaceChildren();
    const header = document.createElement('header'); header.className = 'fusion-ask-head';
    header.innerHTML = '<span class="fusion-ask-eyebrow">' + (message.demo ? 'AGENT APPROVAL · 预览（合成数据）' : 'AGENT APPROVAL · 需要你的批准') + '</span><span class="fusion-ask-progress">Harness 原生权限策略</span>';
    const tool = message.toolCall || {};
    const title = document.createElement('p'); title.className = 'fusion-ask-text';
    title.textContent = String(tool.title || tool.name || tool.kind || '工具调用请求批准');
    const detail = document.createElement('pre'); detail.className = 'fusion-approval-detail'; detail.textContent = toolDetail(tool);
    const note = document.createElement('p'); note.className = 'fusion-approval-note';
    note.textContent = '请核对工具与参数后再决定；批准只对本次请求生效（若 Harness 提供“始终允许”，会明确标注）。';
    const actions = document.createElement('div'); actions.className = 'fusion-ask-actions fusion-approval-actions';
    for (const option of options) {
      const kind = String(option.kind || '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fusion-ask-option' + (kind === 'allow_always' ? ' danger' : '');
      button.dataset.optionId = option.optionId;
      const label = document.createElement('b'); label.textContent = option.name || APPROVAL_LABEL[kind] || kind || '选项';
      const desc = document.createElement('span'); desc.textContent = kind;
      button.append(label, desc);
      button.onclick = () => {
        const requestId = approvalState.requestId;
        clearApproval();
        host.postMessage({ command: 'fusionApprovalResponse', requestId, workspace, outcome: { optionId: option.optionId } });
      };
      actions.appendChild(button);
    }
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'fusion-ask-cancel'; cancel.textContent = '取消（视为拒绝）';
    cancel.onclick = () => { const requestId = approvalState.requestId; clearApproval(); host.postMessage({ command: 'fusionApprovalResponse', requestId, workspace, cancelled: true }); };
    actions.appendChild(cancel);
    const approvalBody = document.createElement('div'); approvalBody.className = 'fusion-ask-body';
    approvalBody.append(title, detail, note);
    approvalSection.append(header, approvalBody, actions);
    approvalSection.hidden = false;
    syncInteractionClass();
    host.postMessage({ command: 'fusionInteractionAck', requestId: approvalState.requestId });
    const focus = approvalSection.querySelector('.fusion-ask-option');
    if (focus) focus.focus({ preventScroll: true });
    approvalSection.scrollIntoView({ block: 'nearest' });
  }
  const documents = document.createElement('div'); documents.className = 'fusion-document-actions';
  for (const [label, command, action] of [['刷新当前工作区手稿','fusionManuscripts','list'],['手稿预览','fusionManuscripts','preview'],['原生 docx 窗口','fusionManuscripts','native'],['作者信息','fusionAuthors','list'],['添加作者','fusionAuthors','add'],['编辑作者库','fusionAuthors','edit'],['写入手稿署名','fusionAuthors','insert']]) {
    const button = document.createElement('button'); button.textContent = label;
    button.dataset.projectScoped = String(command === 'fusionManuscripts' || action === 'insert');
    button.onclick = () => { if (command === 'fusionManuscripts' && action === 'list') { gallery.textContent = '正在刷新当前工作区…'; preview.close(); } host.postMessage({ command, action, workspace }); }; documents.appendChild(button);
  }
  const submissions = document.createElement('section'); submissions.id = 'fusion-submissions';
  submissions.innerHTML = '<header><strong>投稿管理 <small>全局作者库 / 当前工作区手稿</small></strong></header><p>刷新提取当前工作区的手稿，点击卡片进行人工初审。读取「手稿文书」及「结果文件/manuscript」，不复制、不自动审查或修改文件。</p><p id="submission-workspace"></p><div class="submission-map"><span>01 / 刷新手稿</span><span>02 / 人工初审</span><span>03 / 署名确认</span></div>';
  submissions.appendChild(documents);
  const gallery = document.createElement('div'); gallery.className = 'submission-gallery'; submissions.appendChild(gallery);
  window.ddjRenderSubmissions = panel => { panel.replaceChildren(submissions); submissions.querySelector('#submission-workspace').textContent = workspace || '请先打开工作区'; gallery.textContent = '点击「刷新当前工作区手稿」读取最新文件。'; };
  const preview = document.createElement('dialog'); preview.id = 'fusion-preview';
  preview.innerHTML = '<header><strong>全局投稿管理</strong><button type="button">关闭</button></header><div class="fusion-preview-content"></div>';
  document.body.appendChild(preview); preview.querySelector('button').onclick = () => preview.close();
  preview.addEventListener('click', e => { if (e.target === preview) { const r = preview.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) preview.close(); } });
  const openOriginal = document.createElement('button'); openOriginal.textContent = '在编辑器中打开';
  const openNative = document.createElement('button'); openNative.textContent = '原生 docx 窗口'; openNative.hidden = true;
  openNative.title = '用已安装的 WPS / Office 查看器打开真正的 docx（不改动文件）';
  preview.append(openOriginal, openNative);
  let previewPath;
  openOriginal.onclick = () => host.postMessage({ command: 'fusionManuscripts', action: 'open', path: previewPath, workspace });
  openNative.onclick = () => host.postMessage({ command: 'fusionManuscripts', action: 'native', path: previewPath, workspace });
  const attach = document.createElement('button'); attach.type = 'button'; attach.textContent = '＋ 附件';
  chat.querySelector('.fusion-actions').prepend(attach);
  attach.onclick = () => host.postMessage({ command: 'fusionAttach', workspace });
  chat.querySelector('#fusion-mode').onclick = () => host.postMessage({ command: 'fusionMode', external: !external });
  for (const action of ['new', 'rename', 'archive', 'export']) chat.querySelector('#fusion-' + action).onclick = () => host.postMessage({ command: 'fusionManage', action, workspace });
  chat.querySelector('#fusion-history').onchange = e => host.postMessage({ command: 'fusionManage', action: 'switch', id: e.target.value, workspace });
  function filterHistory() { const q = chat.querySelector('#fusion-search').value.toLowerCase(); messages.querySelectorAll('.fusion-message').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(q); }); }
  function summarizeRounds(items, rounds) {
    const result = []; let cursor = 0;
    for (const round of rounds || []) {
      if (!Number.isInteger(round.start) || !Number.isInteger(round.end) || round.start < cursor || round.end > items.length || round.end < round.start) continue;
      result.push(...items.slice(cursor, round.start));
      const work = items.slice(round.start, round.end);
      result.push(...work.filter(item => item.role === 'user'));
      const details = work.filter(item => item.role !== 'user');
      if (details.length) result.push({ role: 'work-summary', id: round.id + '-work', agent: round.agent, text: details.map(item => `[${item.role}]\n${item.text || ''}`).join('\n\n'), title: `工作细节 · ${details.length} 条记录 · 点击展开` });
      const state = {completed:'本轮结束',failed:'本轮失败',interrupted:'本轮已中断',unknown:'状态待核对'}[round.status] || '状态待核对';
      result.push({ role: 'report', id: round.id + '-report', agent: round.agent, text: round.report || '未收到最终汇报，请核对原始记录。', title: state + ' · 汇报', status: round.status });
      cursor = round.end;
    }
    result.push(...items.slice(cursor)); return result;
  }
  chat.querySelector('#fusion-search').oninput = filterHistory;
  const messages = chat.querySelector('#fusion-messages');
  const error = chat.querySelector('#fusion-error');
  function controls() {
    runtime.querySelectorAll('button').forEach(b => b.disabled = busy || managing || switching || external || !workspace);
    documents.querySelectorAll('button').forEach(b => b.disabled = switching || external || (b.dataset.projectScoped === 'true' && !workspace));
    for (const id of ['new','archive','delete','restore','history','rename','export']) chat.querySelector('#fusion-' + id).disabled = managing || !workspace || (busy && !['rename','export'].includes(id));
    chat.querySelector('#fusion-restore').disabled = managing || busy || !workspace || !hasDeleted;
    management.setAttribute('aria-busy', String(managing));
    chat.classList.toggle('is-running', busy);
    chat.querySelector('#fusion-send').disabled = external || switching || managing || busy || !workspace || !input.value.trim();
    chat.querySelector('#fusion-mode').disabled = switching;
    platformBar.querySelector('[data-quick="mode"]').disabled = switching;
    platformBar.querySelector('[data-quick="mode"]').textContent = external ? '切回内置' : '切换外挂';
    platformBar.querySelector('[data-quick="new"]').disabled = managing || busy || !workspace;
    chat.querySelector('#fusion-stop').disabled = !busy;
    chat.querySelector('#fusion-status').textContent = busy ? '执行中' : workspace ? '等待指令' : '请打开项目';
  }
  input.addEventListener('input', () => { saveDraft(); controls(); });
  chat.querySelector('#fusion-form').onsubmit = e => {
    e.preventDefault(); if (external || switching || managing || busy || !workspace || !input.value.trim()) return;
    const text = input.value.trim();
    const stage = document.querySelector('[data-stage].active')?.dataset.stage || 'questions';
    error.textContent = ''; busy = true; controls();
    host.postMessage({ command: 'fusionSend', workspace, text, stage });
    saveDraft(); // Keep the draft until the host confirms turn/start was accepted.
  };
  input.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); chat.querySelector('#fusion-form').requestSubmit(); } };
  chat.querySelector('#fusion-stop').onclick = () => host.postMessage({ command: 'fusionStop', workspace });
  document.addEventListener('click', e => {
    if (e.target.closest('#researchAgentStart')) { e.preventDefault(); e.stopImmediatePropagation(); input.focus(); }
  }, true);
  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'fusionAskUser' && (m.workspace === workspace || !workspace)) { renderAsk(m); return; }
    if (m.type === 'fusionApproval' && (m.workspace === workspace || !workspace)) { renderApproval(m); return; }
    if (m.type === 'fusionInteractionClose') {
      if (askState && askState.requestId === m.requestId) clearAsk();
      if (approvalState && approvalState.requestId === m.requestId) clearApproval();
      return;
    }
    if (m.type === 'fusionManuscriptList' && workspace && m.workspace === workspace) {
      gallery.replaceChildren();
      for (const file of m.files || []) {
        const card = document.createElement('button'); card.className = 'submission-card';
        const mark = document.createElement('span'); mark.className = 'submission-paper'; mark.textContent = file.split('.').pop().toUpperCase();
        const label = document.createElement('span'); label.textContent = file.split('/').pop();
        const nativeDoc = /\.(docx|doc|docm)$/i.test(file);
        card.append(mark, label); card.title = (nativeDoc ? '点击打开原生 docx 窗口 · ' : '点击放大预览 · ') + file;
        card.onclick = () => host.postMessage({ command: 'fusionManuscripts', action: nativeDoc ? 'native' : 'preview', path: file, workspace });
        gallery.appendChild(card);
      }
      if (!gallery.children.length) gallery.textContent = '当前工作区未发现手稿。请将文件放入「手稿文书」或「结果文件/manuscript」后刷新。';
    }
    if ((m.type === 'fusionManuscript' && workspace && m.workspace === workspace) || (m.type === 'fusionAuthorList' && m.scope === 'global')) {
      previewPath = m.sourcePath; openOriginal.hidden = !previewPath;
      openNative.hidden = !(previewPath && /\.(docx|doc|docm)$/i.test(previewPath));
      const body = preview.querySelector('.fusion-preview-content'); body.replaceChildren();
      if (m.type === 'fusionManuscript') { preview.querySelector('strong').textContent = m.path; renderMessage(body, m.text); }
      else { preview.querySelector('strong').textContent = '全局作者库'; for (const a of m.authors || []) { const p = document.createElement('p'); p.textContent = `${a.name}${a.corresponding ? '（通讯作者）' : ''} — ${a.affiliation}\nORCID：${a.orcid || '未提供'}\n贡献：${a.contribution || '待确认'}`; body.appendChild(p); } if (!body.children.length) body.textContent = '尚未添加作者。'; }
      if (!preview.open) preview.showModal();
    }
    if (m.type === 'fusionAccepted') {
      const key = m.workspace + ':' + m.sessionId;
      if ((drafts.get(key) || '').trim() === m.text) {
        drafts.set(key, '');
        if (workspace === m.workspace && sessionId === m.sessionId && input.value.trim() === m.text) input.value = '';
        window.ddjHost.setState?.({ ...(window.ddjHost.getState?.() || {}), fusionDrafts: Object.fromEntries(drafts) });
      }
      controls();
    }
    if (m.type === 'fusionEnter') enterPage();
    if (m.type === 'fusionCheckResult' && m.workspace === workspace && m.requestId === checkSequence) {
      platformBar.querySelector('[data-quick="check"]').disabled = false;
      clearTimeout(checkTimer);
      const good = !!m.workspace && m.trusted && m.backend && m.codexInstalled;
      boot.classList.remove('checking'); boot.classList.toggle('warning', !good);
      boot.querySelector('.fusion-boot-summary').textContent = good ? '基础检查通过 · 模型连接将在发送时验证' : '存在待处理项 · 展开管理详情查看';
      check.disabled = false;
      checkResult.textContent = `${m.checkedAt} · 项目${m.workspace ? '已绑定' : '未选择'} / 工作区${m.trusted ? '已信任' : '未信任'} / 后端${m.backend ? '可达' : '未就绪'} / Codex 扩展${m.codexInstalled ? '已安装' : '未检测到'}。此检查不调用模型。`;
    }
    if (m.type === 'fusionMode') {
      external = m.external;
      switching = !!m.switching;
      error.textContent = m.message || '';
      chat.querySelector('#fusion-mode').textContent = external ? '切换到内置 Codex' : '切换到外挂 Codex';
      input.placeholder = external ? '外挂模式：请在官方 Codex 窗口继续对话；内置会话保留。' : '描述科学问题、数据或需要推进的任务…';
      controls();
    }
    if (m.type === 'state') {
      const project = platformBar.querySelector('#fusion-project-name');
      project.textContent = m.workspacePath ? m.projectName || m.workspacePath.split(/[\\/]/).filter(Boolean).pop() : '未打开项目';
      project.title = m.workspacePath || '请在 VS Code 中打开项目文件夹';
      const steps = Array.isArray(m.pipeline?.steps) ? m.pipeline.steps : [];
      const done = steps.filter(step => step.status === 'done').length;
      const progress = chat.querySelector('#fusion-progress'); progress.max = steps.length || 1; progress.value = done;
      chat.querySelector('#fusion-progress-label').textContent = steps.length ? `管线验收 ${done} / ${steps.length} · ${Math.round(done / steps.length * 100)}%` : '尚未绑定研究管线';
      if (workspace !== m.workspacePath) {
        preview.close(); previewPath = undefined; preview.querySelector('.fusion-preview-content').replaceChildren();
        gallery.textContent = '项目已切换，请刷新当前工作区手稿。';
        submissions.querySelector('#submission-workspace').textContent = m.workspacePath || '请先打开工作区';
        runtime.querySelector('#fusion-quota').textContent = '余量尚未读取';
        saveDraft(); workspace = m.workspacePath || ''; sessionId = '';
        input.value = ''; messages.replaceChildren(); busy = false; managing = false; hasDeleted = false;
        clearAsk(); clearApproval();
        error.textContent = ''; chat.querySelector('#fusion-history').replaceChildren(); chat.querySelector('#fusion-attachments').replaceChildren();
        chat.querySelector('#fusion-search').value = ''; chat.querySelector('#fusion-workspace').textContent = workspace;
        chat.querySelector('#fusion-counts').textContent = '等待项目会话'; chat.querySelector('#fusion-runtime').textContent = '等待当前项目连接';
        host.postMessage({ command: 'fusionStatus' });
      }
      controls();
    }
    if (m.type === 'state' && checkedWorkspace !== workspace) { checkedWorkspace = workspace; startCheck(); }
    if (m.type === 'fusionState') {
      if (m.workspace !== workspace) return; // Only authoritative project state can change scope.
      const agentLabel = m.agent === 'deepseek' ? 'DeepSeek Harness' : 'Codex';
      runtime.querySelector('[data-option="agent"]').textContent = '切换智能体 · ' + agentLabel;
      chat.querySelector('.fusion-channel b').replaceChildren(ticks, document.createTextNode(agentLabel + ' · 项目协作会话'));
      managing = !!m.managementPending; hasDeleted = (m.sessions || []).some(e => e.deletedAt);
      runtime.querySelector('[data-option="model"]').textContent = '模型：' + (m.settings?.model || '配置默认');
      runtime.querySelector('[data-option="effort"]').textContent = '推理：' + (m.settings?.effort || '默认');
      runtime.querySelector('[data-option="permission"]').textContent = m.agent === 'deepseek' ? '权限：Harness 原生审批' : '权限：' + ({read:'只读',workspace:'项目写入',full:'完全访问'}[m.settings?.permission] || '项目写入');
      const windows = [m.quota?.primary, m.quota?.secondary].filter(w => typeof w?.usedPercent === 'number');
      const quota = runtime.querySelector('#fusion-quota');
      quota.textContent = windows.length ? windows.map(w => `${w.windowDurationMins ? w.windowDurationMins + '分钟窗口' : '限额窗口'}剩余 ${Math.max(0, Math.min(100, 100 - w.usedPercent))}%`).join(' / ') : m.quotaNote || '余量尚未读取';
      if (m.compaction) quota.textContent += ' · ' + m.compaction;
      quota.title = windows.map(w => w.resetsAt ? '重置：' + new Date(w.resetsAt * 1000).toLocaleString() : '重置时间未知').join('\n') + '\nChatGPT 限额，非 API 余额';
      chat.querySelector('#fusion-counts').textContent = `${(m.messages || []).length} 条记录 · ${(m.attachments || []).length} 个附件`;
      chat.querySelector('#fusion-runtime').textContent = m.connection ? `${agentLabel} · ${m.connection.status}${m.connection.userAgent ? ' · ' + m.connection.userAgent : ''}` : `${agentLabel} 尚未握手 · 首次发送时连接`;
      if (m.workspace !== workspace) {
        drafts.set(workspace + ':' + sessionId, input.value); workspace = m.workspace || '';
        sessionId = ''; input.value = ''; messages.replaceChildren();
      }
      const changedSession = sessionId !== m.sessionId;
      if (changedSession) { saveDraft(); sessionId = m.sessionId || ''; clearAsk(); clearApproval(); input.value = drafts.get(workspace + ':' + sessionId) ?? m.draft ?? ''; messages.replaceChildren(); error.textContent = ''; chat.querySelector('#fusion-search').value = ''; }
      chat.querySelector('#fusion-workspace').textContent = workspace || '未选择工作区';
      const labels = { research: '通用研究', reviewer: '审稿人', editor: '学术编辑', methods: '方法学审阅' };
      const entries = (m.sessions || []).filter(e => !e.deletedAt);
      const activeEntry = entries.find(e => e.id === sessionId);
      roleBadge.textContent = labels[activeEntry?.role] || '通用研究';
      const history = chat.querySelector('#fusion-history');
      const indexSignature = JSON.stringify(entries);
      if (history.dataset.signature !== indexSignature) {
        history.replaceChildren(); history.dataset.signature = indexSignature;
        for (const archived of [false, true]) {
          const group = document.createElement('optgroup'); group.label = archived ? '已归档' : '进行中的会话';
          for (const entry of entries.filter(e => !!e.archived === archived)) { const option = document.createElement('option'); option.value = entry.id; option.textContent = `${entry.title} · ${labels[entry.role] || '通用研究'}`; group.appendChild(option); }
          if (group.children.length) history.appendChild(group);
        }
      }
      chat.querySelector('#fusion-restore').disabled = busy || !(m.sessions || []).some(e => e.deletedAt);
      chat.querySelector('#fusion-archive').textContent = (m.sessions || []).find(e => e.id === sessionId)?.archived ? '取消归档' : '归档';
      history.value = sessionId;
      const attachments = chat.querySelector('#fusion-attachments'); attachments.replaceChildren();
      for (const path of m.attachments || []) { const remove = document.createElement('button'); remove.textContent = path.split(/[\\/]/).pop() + ' ×'; remove.title = path; remove.onclick = () => host.postMessage({ command: 'fusionRemoveAttachment', workspace, path }); attachments.appendChild(remove); }
      const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      const wasBusy = busy; busy = m.busy;
      if (!busy) { if (askState) clearAsk(); if (approvalState) clearApproval(); }
      messages.querySelector('.fusion-empty')?.remove();
      if (!m.messages.length) {
        messages.replaceChildren();
        const empty = document.createElement('div'); empty.className = 'fusion-empty';
        empty.innerHTML = '<span>PROJECT / AGENTS</span><h2>今天，我们研究什么？</h2><p>会话留在项目中，可切换智能体接续协作。描述问题或附上文件开始。</p>'; messages.appendChild(empty);
      }
      const visibleMessages = summarizeRounds(m.messages, m.rounds);
      for (const [index, item] of visibleMessages.entries()) {
        const signature = JSON.stringify(item);
        const previous = messages.children[index];
        if (previous?.dataset.signature === signature) continue;
        const row = document.createElement('article'); row.className = 'fusion-message ' + item.role;
        row.dataset.signature = signature;
        if (!previous) row.classList.add('fusion-message-enter');
        const source = item.agent === 'deepseek' ? 'DeepSeek Harness' : 'Codex';
        const label = document.createElement('b'); label.textContent = ({user:'你',assistant:source,activity:'执行事件 · ' + source,system:'连接提示'})[item.role] || '事件';
        if (item.role === 'report') { label.textContent = source + ' · ' + item.title; row.dataset.outcome = item.status; }
        const text = document.createElement('div'); renderMessage(text, item.text || '');
        const copy = document.createElement('button'); copy.className = 'fusion-copy'; copy.textContent = '复制';
        copy.onclick = () => { navigator.clipboard.writeText(item.text || '').then(() => { copy.textContent = '已复制'; }, () => { error.textContent = '复制失败，请选择文本复制。'; }); };
        if (item.role === 'activity' || item.role === 'work-summary') { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = item.title || source + ' · ' + item.text.split('\n')[0]; details.append(summary, text); row.append(details); }
        else row.append(label, text, copy);
        if (previous) { const expanded = previous.querySelector('details')?.open; if (expanded && row.querySelector('details')) row.querySelector('details').open = true; previous.replaceWith(row); }
        else messages.appendChild(row);
      }
      while (visibleMessages.length && messages.children.length > visibleMessages.length) messages.lastElementChild.remove();
      if (nearBottom || changedSession) messages.scrollTop = messages.scrollHeight;
      filterHistory();
      if (wasBusy && !busy) host.postMessage({ command: 'getAll' });
      controls();
    }
    if (m.type === 'fusionError' && m.workspace === workspace && m.sessionId === sessionId) { error.textContent = m.message; host.postMessage({ command: 'fusionStatus' }); controls(); }
  });
  controls(); host.postMessage({ command: 'fusionModeStatus' }); host.postMessage({ command: 'getAll' });
  function renderMessage(container, content) {
    // DOM-only rendering: model HTML is never interpreted as markup.
    const chunks = content.split(/(```[\s\S]*?```)/g);
    for (const chunk of chunks) {
      if (chunk.startsWith('```')) {
        const pre = document.createElement('pre'); const code = document.createElement('code');
        code.textContent = chunk.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''); pre.appendChild(code); container.appendChild(pre);
      } else {
        for (const line of chunk.split('\n')) {
          const heading = /^(#{1,3})\s+(.+)$/.exec(line);
          const p = document.createElement(heading ? 'h' + (heading[1].length + 2) : 'p');
          const parts = (heading ? heading[2] : line).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
          for (const part of parts) { const el = document.createElement(part.startsWith('**') ? 'strong' : part.startsWith('`') ? 'code' : 'span'); el.textContent = part.startsWith('**') ? part.slice(2,-2) : part.startsWith('`') ? part.slice(1,-1) : part; p.appendChild(el); }
          container.appendChild(p);
        }
      }
    }
  }
})();
