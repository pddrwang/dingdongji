;(() => {
  // Original code-native biomedical icon set. Never transforms user chat/manuscript text.
  const shapes = {
    emblem: '<path d="m12 2 9 5v10l-9 5-9-5V7ZM7 12h10M12 7v10"/><path d="m3 7 9 5 9-5M12 12v10" opacity=".4"/>',
    gallery: '<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="8" cy="9" r="2"/><path d="m4 18 5-5 4 3 3-6 5 8"/>',
    bolt: '<path d="m14 2-9 12h6l-1 8 9-13h-6Z"/>',
    refresh: '<path d="M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5M4 16a9 9 0 0 0 15 3l3-3m0 5v-5h-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
    plug: '<path d="M8 2v5m8-5v5M6 7h12v3a6 6 0 0 1-12 0ZM12 16v6"/>',
    inbox: '<path d="m6 4-4 11v5h20v-5L18 4ZM2 15h6l2 3h4l2-3h6"/>',
    pin: '<path d="M19 9c0 6-7 13-7 13S5 15 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2"/>',
    theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" opacity=".4"/>',
    seed: '<path d="M12 22V11M12 15C2 15 2 8 2 6c8 0 10 4 10 9ZM12 11c0-7 5-9 10-9 0 7-3 9-10 9Z"/>',
    pen: '<path d="m4 16 12-12 4 4L8 20l-5 1ZM14 6l4 4M4 16l4 4"/>',
    cross: '<path d="m6 6 12 12M6 18 18 6"/><circle cx="12" cy="12" r="10"/>',
    next: '<path d="m5 4 10 8L5 20ZM19 4v16"/>',
    back: '<path d="m11 4-8 8 8 8M3 12h18"/>',
    forward: '<path d="m13 4 8 8-8 8M3 12h18"/>',
    pause: '<path d="M7 4v16M17 4v16" stroke-width="4"/>',
    play: '<path d="m6 3 15 9-15 9Z"/>',
    idea: '<path d="M9 18h6m-6 3h6M8 15a6 6 0 1 1 8 0l-1 3H9Z M12 1v2M2 9h2m16 0h2"/>',
    microscope: '<path d="m10 3 5 3-4 7-5-3Zm2 10a5 5 0 0 1 0 10M4 21h16M3 16h9M9 12l-2 3"/>',
    molecule: '<path d="m8 5 8 1 4 8-7 6-9-7Z M8 5l5 15M4 13l12-7"/><circle cx="8" cy="5" r="2"/><circle cx="20" cy="14" r="2"/><circle cx="13" cy="20" r="2"/>',
    folder: '<path d="M3 6h7l2 3h9l-2 11H3ZM3 6V4h7l2 2h8v3"/>',
    library: '<path d="M3 4h4v16H3Zm6 0h4v16H9Zm7 1 4-1 3 15-4 1Z"/>',
    palette: '<path d="M20 14a9 9 0 1 0-8 7c4 0 1-4 3-5 2-1 5 1 5-2Z"/><circle cx="7" cy="9" r="1"/><circle cx="11" cy="6" r="1"/><circle cx="16" cy="8" r="1"/>',
    agent: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3m-2 0h4M8 12v2m8-2v2m-7 3h6M1 11v5m22-5v5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
    warning: '<path d="m12 3 10 18H2ZM12 9v5m0 3v1"/>',
    launch: '<path d="M9 15c-1-6 5-12 12-12 0 7-6 13-12 12Zm0-5H4l-2 6 7-1m5 0v5l-6 2 1-7m-4 4-3 3"/><circle cx="16" cy="8" r="2"/>',
    archive: '<path d="M3 3h18v5H3Zm2 5v13h14V8M9 12h6"/>',
    research: '<path d="M4 3c16 0 0 18 16 18M20 3C4 3 20 21 4 21M7 6h10M9 10h6M9 14h6M7 18h10"/>',
    chart: '<path d="M3 3v18h18M7 16v-5m5 5V6m5 10v-8"/>',
    tools: '<path d="m4 20 8-8m2-9a6 6 0 0 0-3 10 6 6 0 0 0 10-3l-5 1-3-3Z"/>',
    paper: '<path d="M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8M8 16h6"/>',
    network: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="5" cy="20" r="2"/><path d="m6 6 4 4m4 0 4-4M7 18l3-4"/>',
    check: '<path d="m4 12 5 5L20 5M4 4h5M20 16v4h-7"/>',
    settings: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3"/>',
  };
  function icon(kind) { const span = document.createElement('span'); span.className = 'ddj-vector-icon'; span.setAttribute('aria-hidden', 'true'); span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${shapes[kind] || shapes.research}</svg>`; return span; }
  const pictograph = /[\p{Extended_Pictographic}\u2600-\u27bf](?:\uFE0F|\u200D[\p{Extended_Pictographic}])*/gu;
  function decorate() {
    const app = document.querySelector('#app'); if (!app) return;
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT); const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode, parent = n.parentElement;
      if (!parent || parent.closest('input,textarea,pre,code,svg,.ddj-vector-icon,.workspace-bar,.idea-root,.conclusion-card,.idea-empty,.research-next p')) continue;
      if (!parent.closest('button,h1,h2,h3,.sec-title,.rail-ic,.rail-brand-mark,.research-kicker,.tool-icon,.ext-tools-icon,.sh-badge,.ui-icon')) continue;
      pictograph.lastIndex = 0; if (pictograph.test(n.textContent)) nodes.push(n);
    }
    for (const n of nodes) {
      const fragment = document.createDocumentFragment(); let offset = 0;
      pictograph.lastIndex = 0;
      for (const match of n.textContent.matchAll(pictograph)) {
        fragment.append(n.textContent.slice(offset, match.index));
        const groups = [['🐔','emblem'],['🖼','gallery'],['⚡','bolt'],['🔄','refresh'],['🕐','clock'],['🔌','plug'],['📭','inbox'],['📍','pin'],['🌗','theme'],['🌱','seed'],['✍','pen'],['❌','cross'],['⏭','next'],['⬅','back'],['➡↗','forward'],['⏸','pause'],['▶','play'],['💡','idea'],['🔬🧪','microscope'],['⚗🦠','molecule'],['📁📂','folder'],['📚📖','library'],['🎨🖌','palette'],['🤖','agent'],['🌐🌍','globe'],['🔍🔎','search'],['⚠❗','warning'],['🚀','launch'],['📦🗃🗄','archive'],['📊📈📉','chart'],['📄📝','paper'],['⚙','settings'],['🔧🛠','tools'],['✅✔','check'],['🔗','network']];
        const kind = groups.find(([glyphs]) => [...glyphs].some(glyph => match[0].includes(glyph)))?.[1] || 'research';
        fragment.append(icon(kind)); offset = match.index + match[0].length;
      }
      fragment.append(n.textContent.slice(offset)); n.replaceWith(fragment);
    }
  }
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; decorate(); }); } }).observe(document.body, { childList: true, subtree: true });
  window.ddjVectorDecorate = decorate; decorate();
})();
