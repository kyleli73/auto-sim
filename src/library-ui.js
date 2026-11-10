import { ROBOT_KEYS, ROBOT_LABEL, SLOT_COLORS } from './store.js';
import { listAutos, teamsOf, slotOf } from './library.js';
import { drawThumb } from './render.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// Library screen: filters, board strip and the card grid. Mutations go through app.act (main.js).
export function initLibrary(app) {
  const fl = app.filter; // { team, query, sort }
  const field = new Image();
  field.onload = () => render();
  field.src = './field.png';
  let renaming = false;

  const board = () => app.lib.boards[app.lib.activeBoardId];

  function closeMenu() { $('menu').hidden = true; }
  function openMenu(anchor, items, title) {
    const m = $('menu');
    m.textContent = '';
    if (title) m.appendChild(el('small', '', title));
    for (const [label, fn] of items) {
      const b = el('button', '', label);
      b.onclick = e => { e.stopPropagation(); closeMenu(); fn(); };
      m.appendChild(b);
    }
    m.hidden = false;
    const r = anchor.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8))}px`;
  }
  document.addEventListener('click', e => { if (!$('menu').contains(e.target)) closeMenu(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  function card(a) {
    const b = board(), slot = slotOf(b, a.id);
    const c = el('article', 'card' + (slot ? ' inuse' : ''));
    c.tabIndex = 0;
    c.onclick = e => { if (!e.target.closest('button, input')) app.openAuto(a.id); };
    c.onkeydown = e => { if (e.key === 'Enter' && e.target === c) app.openAuto(a.id); };

    const head = el('header');
    const nm = el('span', 'nm', a.name); nm.title = a.name;
    head.appendChild(nm);
    if (a.team) head.appendChild(el('span', 'team', a.team));
    if (slot) { const t = el('span', 'tag', 'IN USE'); t.title = `${ROBOT_LABEL[slot]} on ${b.name}`; head.appendChild(t); }
    c.appendChild(head);

    const cv = el('canvas');
    cv.width = cv.height = 260;
    drawThumb(cv.getContext('2d'), 260, field.complete && field.naturalWidth ? field : null, a.path, a.alliance === 'blue' ? '#60a5fa' : '#f87171');
    c.appendChild(cv);

    const foot = el('div', 'foot'), acts = el('div', 'acts');
    const btn = (label, fn, cls = '') => { const x = el('button', 'btn ' + cls, label); x.onclick = e => { e.stopPropagation(); fn(x); }; acts.appendChild(x); return x; };
    if (slot) btn('Stop using', () => app.act.assign(slot, null));
    else btn('Use in matches', x => openMenu(x, ROBOT_KEYS.map(k => {
      const cur = b.slots[k] && app.lib.autos[b.slots[k]];
      return [`${ROBOT_LABEL[k]}${cur ? ` (replaces ${cur.name})` : ''}`, () => app.act.assign(k, a.id)];
    }), `Use on ${b.name}`), 'accent');
    btn('Rename', () => {
      renaming = true;
      const inp = el('input'); inp.value = a.name; inp.maxLength = 60;
      nm.replaceWith(inp); inp.focus(); inp.select();
      const done = ok => {
        if (!renaming) return;
        renaming = false;
        if (ok && inp.value.trim() && inp.value.trim() !== a.name) app.act.rename(a.id, inp.value.trim()); else render();
      };
      inp.onkeydown = e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
    });
    btn('Duplicate', () => app.act.duplicate(a.id));
    btn('Delete', () => app.act.remove(a.id), 'danger');
    const more = btn('⋯', x => openMenu(x, [['Share link', () => app.shareAuto(a.id)], ['Download .pp', () => app.downloadPP(a.id)]]));
    more.title = 'More'; more.setAttribute('aria-label', 'More actions');
    foot.appendChild(acts);
    foot.appendChild(el('span', 'pts', `${a.path.segments.length + 1} pts`));
    c.appendChild(foot);
    return c;
  }

  function render() {
    if (renaming || $('libraryView').hidden) return;
    const lib = app.lib, b = board();
    const sel = $('boardSel');
    sel.textContent = '';
    for (const x of Object.values(lib.boards)) sel.add(new Option(x.name, x.id, false, x.id === b.id));
    const chips = $('slotChips');
    chips.textContent = '';
    for (const k of ROBOT_KEYS) {
      const a = lib.autos[b.slots[k]], c = el('div', 'slotchip' + (a ? '' : ' empty'));
      c.style.borderLeftColor = SLOT_COLORS[k];
      c.appendChild(el('span', '', `${ROBOT_LABEL[k]}: ${a ? a.name : 'empty'}`));
      if (a) { const x = el('button', '', '×'); x.title = `Stop using ${a.name}`; x.onclick = () => app.act.assign(k, null); c.appendChild(x); }
      chips.appendChild(c);
    }
    const teams = teamsOf(lib);
    if (fl.team && !teams.includes(fl.team)) fl.team = '';
    const seg = $('teamSeg');
    seg.textContent = '';
    for (const t of ['', ...teams]) {
      const x = el('button', t === fl.team ? 'on' : '', t || 'All robots');
      x.onclick = () => { fl.team = t; render(); };
      seg.appendChild(x);
    }
    const grid = $('cards');
    grid.textContent = '';
    const autos = listAutos(lib, fl);
    for (const a of autos) grid.appendChild(card(a));
    if (!autos.length) grid.appendChild(el('p', 'empty-msg', Object.keys(lib.autos).length ? 'No autos match this filter.' : 'No autos yet. Create one, or import a Pedro .pp file or Java OpMode (button, drag-and-drop or Paste).'));
    $('libBack').disabled = !app.lastAutoId || !lib.autos[app.lastAutoId];
  }

  $('q').oninput = e => { fl.query = e.target.value; render(); };
  $('sort').onchange = e => { fl.sort = e.target.value; render(); };
  $('boardSel').onchange = e => app.act.setBoard(e.target.value);
  $('boardNew').onclick = () => { const n = prompt('Board name', 'Q1 vs '); if (n !== null) app.act.newBoard(n.trim() || 'Match board'); };
  $('boardRename').onclick = () => { const n = prompt('Board name', board().name); if (n && n.trim()) app.act.renameBoard(n.trim()); };
  $('boardShare').onclick = () => app.shareBoard();
  $('libBack').onclick = () => app.lastAutoId && app.openAuto(app.lastAutoId);

  $('newAuto').onclick = () => { $('nName').value = 'New auto'; $('nTeam').value = fl.team; $('newDlg').returnValue = ''; $('newDlg').showModal(); $('nName').select(); };
  $('newDlg').onclose = () => {
    if ($('newDlg').returnValue === 'create') app.act.create({ name: $('nName').value.trim() || 'New auto', team: $('nTeam').value.trim(), alliance: $('nAlliance').value });
  };
  $('libImport').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    await app.act.importFiles(files);
  };
  $('libPaste').onclick = () => { $('pTeam').value = fl.team; $('pText').value = ''; $('pName').value = ''; $('pasteDlg').returnValue = ''; $('pasteDlg').showModal(); $('pText').focus(); };
  $('pasteDlg').onclose = () => {
    if ($('pasteDlg').returnValue === 'import') app.act.importTexts([{ name: $('pName').value.trim(), text: $('pText').value }], $('pTeam').value.trim());
  };

  // Drag and drop anywhere, in either view.
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; $('dropHint').hidden = false; } });
  addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; $('dropHint').hidden = true; } });
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; $('dropHint').hidden = true;
    app.act.importFiles([...e.dataTransfer.files]);
  });

  return { render };
}
