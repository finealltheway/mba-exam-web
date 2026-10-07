/* ============================================================
   MBA 模拟考试系统 —— 交互层
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// 选项字母表。新题型（信息匹配 PartB）是 A–G 的共享选项池，
// 原来各处写死 A–E，导致 F、G 渲染不出来、也选不了。
const OPT_KEYS = 'ABCDEFG'.split('');

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const fmtDur = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return h ? `${h} 小时 ${m} 分` : `${m} 分 ${Math.round(sec % 60)} 秒`;
};
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const State = {
  bank: [], paper: null, answers: {}, cursor: 0,
  remaining: 0, running: false, paused: false, tick: null,
  qStart: {}, lastTick: 0, showPassage: true,
  // 断点续答：pendingSnap 是启动时读到的未完成试卷，等用户决定「继续 / 放弃」；
  // autoTimer 是自动落盘的节流定时器；finished 标记已交卷，避免卸载时又写回快照。
  pendingSnap: null, autoTimer: null, finished: false,
};

/* ---------- 启动 ---------- */
async function boot() {
  const inline = typeof BANK_DATA !== 'undefined' && BANK_DATA;
  try {
    State.bank = await getBank();
  } catch (e) {
    $('#subj-grid').innerHTML = `<div class="empty-state">题库加载失败：${esc(e.message)}<br>` +
      `请确认 data/question_bank.json 存在，或改用内置题库的 index_standalone.html</div>`;
    return;
  }
  window.__DATASRC__ = { inline: !!inline, count: State.bank.length };
  window.__State = State;
  renderHome();
  renderHistory();
  detectResume();          // 检测未完成考试，显示「继续答题」入口
  syncHeaderOffset();      // 量一次真实 header 高度，供答题栏 sticky 偏移
}

/* ---------- 断点续答：检测 / 继续 / 放弃 ---------- */

/** 启动时检查本机是否有未交卷的试卷。 */
function detectResume() {
  const snap = ResumeStore.load();
  if (!snap) return;
  // 校验快照对当前题库仍然有效（题库重建过就会失效）
  if (!ResumeStore.restore(snap, State.bank)) {
    ResumeStore.clear();
    return;
  }
  State.pendingSnap = snap;
  renderResumeCard(snap);
}

function renderResumeCard(snap) {
  const card = $('#resume-card');
  if (!card) return;
  const subj = EXAM[snap.subject];
  const answered = snap.questions.filter(r => {
    const p = subj.parts.find(x => x.key === r.part);
    const a = r.a || {};
    return p && p.subjective ? !!(a.text && a.text.trim()) : !!a.choice;
  }).length;
  const when = snap.savedAt ? new Date(snap.savedAt) : null;
  const ago = when ? humanAgo(Date.now() - when.getTime()) : '';
  $('#resume-title').textContent = `上次「${subj.name}」考试未完成`;
  $('#resume-sub').innerHTML =
    `已答 <b style="color:var(--tx)">${answered}</b> / ${snap.questions.length} 题 · ` +
    `剩余 <b style="color:var(--tx)">${fmtTime(snap.remaining)}</b>` +
    (ago ? ` · 保存于${ago}` : '');
  card.style.display = '';
}

/** 把毫秒差转成「刚刚 / N 分钟前 / N 小时前 / N 天前」。 */
function humanAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return '刚刚';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/** 恢复上次未完成的考试，接着答。 */
function resumeExam() {
  const snap = State.pendingSnap;
  if (!snap) return;
  const r = ResumeStore.restore(snap, State.bank);
  if (!r) { ResumeStore.clear(); dipResumeCard(); alert('上次的试卷已失效（题库可能更新过），请重新开始。'); return; }

  State.paper = r.paper;
  State.answers = r.answers;
  State.cursor = r.cursor;
  State.remaining = r.remaining;
  State.paused = false;
  State.finished = false;
  State.qStart = {};
  State.paper.questions.forEach(q => { State.qStart[q._qid] = Date.now(); });

  dipResumeCard();          // 已进入考试，收起首页的「继续答题」入口
  $('#nav-exam').style.display = '';
  $('#nav-result').style.display = 'none';
  renderExam();
  go('exam');
  startTick();
  State.lastQEnter = Date.now();
  saveProgress(true);       // 恢复后立刻回写一次，刷新时间戳
  window.scrollTo(0, 0);
}

/** 放弃未完成的考试。 */
function discardResume() {
  confirmModal('放弃考试', '将丢弃本次未完成的答题进度，此操作不可撤销。确定放弃吗？', () => {
    ResumeStore.clear();
    State.pendingSnap = null;
    dipResumeCard();
    closeModal();
  });
}

function dipResumeCard() {
  const c = $('#resume-card');
  if (c) c.style.display = 'none';
}

$('#btn-resume').onclick = () => resumeExam();
$('#btn-discard').onclick = () => discardResume();

/* ---------- 断点续答：自动落盘 ---------- */

/**
 * 把当前试卷与答案写进 localStorage。
 * @param {boolean} immediate 立即写（不做节流），用于关键节点
 */
function saveProgress(immediate) {
  if (!State.paper) return;
  const doSave = () => {
    State.autoTimer = null;
    const snap = ResumeStore.snapshot(State.paper, State.answers, State.remaining, State.cursor);
    const ok = ResumeStore.save(snap);
    paintAutosave(ok);
  };
  if (immediate) {
    if (State.autoTimer) { clearTimeout(State.autoTimer); State.autoTimer = null; }
    doSave();
    return;
  }
  // 节流：最多每 2 秒落一次盘，避免每次输入都写 localStorage
  if (State.autoTimer) return;
  paintAutosave(true, true);
  State.autoTimer = setTimeout(doSave, 2000);
}

function paintAutosave(ok, saving) {
  const box = $('#autosave');
  if (!box) return;
  box.classList.toggle('saving', !!saving);
  const txt = $('#autosave-txt');
  if (txt) txt.textContent = !ok ? '保存失败（存储空间不足）' : (saving ? '保存中…' : '已自动保存');
}


function renderHome() {
  for (const s of ['zg', 'en']) {
    const pool = State.bank.filter(q => q.subject === s && q.answer).length;
    const el2 = $(`#pool-${s}`);
    if (el2) el2.textContent = pool;
    const st = $(`#struct-${s}`);
    if (st) st.innerHTML = EXAM[s].parts.map(p =>
      `<div><span>${p.name}</span><span>${p.count}题 · ${p.score}分</span></div>`).join('');
  }
  $('#rules').innerHTML = `
    <b style="color:var(--tx)">管理类联考综合能力（150 分钟客观题 + 30 分钟写作）</b><br>
    · 数学 25 题按应用题 / 代数 / 几何 / 数据分析约 25% : 30% : 25% : 20% 抽取<br>
    · 逻辑 30 题按论证逻辑约 50%、综合推理约 35%、形式逻辑约 15% 抽取<br>
    · 写作各 1 题，含 2021–2026 全部论效文与论说文真题<br><br>
    <b style="color:var(--tx)">英语（二）</b><br>
    · 完形 20 题、阅读 PartA 20 题、新题型 PartB 5 题<br>
    · 优先抽取最近年份（2026 &gt; 2025 &gt; 2024 …），同考点内随机
  `;
}

/* ---------- 导航 ---------- */
$$('nav button').forEach(b => b.onclick = () => go(b.dataset.pg));
function go(pg) {
  $$('.page').forEach(p => p.classList.toggle('on', p.id === `pg-${pg}`));
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.pg === pg));
  if (pg === 'history') renderHistory();
  if (pg === 'home') $('#nav-exam').style.display = 'none', $('#nav-result').style.display = 'none';
  syncHeaderOffset();
  window.scrollTo(0, 0);
}

/* 把实测的 header 高度写进 --hdr，供 .exam-bar 的 sticky top 使用。
   窄屏下 header 会换行变高，写死像素会让答题栏被盖住，所以这里动态测量。
   两点注意：
   ① 窄屏（≤640px）CSS 已让 header 不 sticky、exam-bar 归零，此处必须写 0，
      否则会用桌面高度把答题栏往下推。
   ② 量不到高度（隐藏/尚未布局，返回 0）时**不要覆盖**，保留 CSS 里的兜底值，
      否则桌面端会被退化成 0，反过来又造成遮挡。 */
function syncHeaderOffset() {
  const hdr = document.querySelector('header');
  if (!hdr) return;
  const root = document.documentElement;
  if (window.innerWidth <= 640) {
    root.style.setProperty('--hdr', '0px');
    return;
  }
  const h = hdr.getBoundingClientRect().height;
  if (h > 0) root.style.setProperty('--hdr', Math.round(h) + 'px');
  else root.style.removeProperty('--hdr');   // 量不到 → 用 :root 的兜底 63px
}
window.addEventListener('resize', syncHeaderOffset);
window.addEventListener('orientationchange', syncHeaderOffset);

/* ---------- 开始考试 ---------- */
$$('.subj').forEach(c => c.onclick = () => startExam(c.dataset.s));

function startExam(subject) {
  const qs = drawQuestions(State.bank, subject, { yearBias: 0.65 });
  if (!qs.length) { alert('题库为空，无法组卷'); return; }

  State.paper = {
    id: uid(), subject,
    createdAt: new Date().toISOString(),
    questions: qs.map((q, i) => ({ ...q, _idx: i })),
  };
  State.answers = {};
  State.cursor = 0;
  State.remaining = EXAM[subject].duration;
  State.paused = false;
  State.finished = false;
  State.qStart = {};
  qs.forEach(q => { State.answers[q._qid] = { choice: null, text: '', selfScore: null, seconds: 0 }; });
  qs.forEach(q => { State.qStart[q._qid] = Date.now(); });

  $('#nav-exam').style.display = '';
  $('#nav-result').style.display = 'none';
  renderExam();
  go('exam');
  startTick();
  State.lastQEnter = Date.now();
  saveProgress(true);        // 开考即落盘，避免刚开考就刷新导致丢卷
  window.scrollTo(0, 0);
}

/* ---------- 计时 ---------- */
function startTick() {
  clearInterval(State.tick);
  State.running = true;
  State.lastTick = Date.now();
  State.tick = setInterval(() => {
    if (State.paused) { State.lastTick = Date.now(); return; }
    const now = Date.now();
    const dt = (now - State.lastTick) / 1000;
    State.lastTick = now;
    State.remaining -= dt;

    // 累计当前题用时
    const cur = State.paper.questions[State.cursor];
    if (cur && State.answers[cur._qid]) {
      State.answers[cur._qid].seconds = (State.answers[cur._qid].seconds || 0) + dt;
      const badge = document.querySelector(`[data-qt="${cur._qid}"]`);
      if (badge) badge.textContent = fmtTime(State.answers[cur._qid].seconds);
    }
    paintTimer();
    if (State.remaining <= 0) {
      State.remaining = 0;
      clearInterval(State.tick); State.running = false;
      confirmModal('时间到', '考试时间已用完，系统自动交卷。', () => finishExam(true));
    }
  }, 1000);
}
function paintTimer() {
  const t = $('#timer');
  t.textContent = fmtTime(State.remaining);
  t.className = 'timer' + (State.remaining <= 0 ? ' over' : State.remaining < 600 ? ' warn' : '');
  const done = State.paper.questions.filter(q => {
    const p = EXAM[State.paper.subject].parts.find(x => x.key === q.part);
    const a = State.answers[q._qid];
    return p.subjective ? (a.text && a.text.trim()) : a.choice;
  }).length;
  $('#prog').innerHTML = `已答 <b>${done}</b> / ${State.paper.questions.length}`;
}
$('#btn-pause').onclick = () => {
  State.paused = !State.paused;
  $('#btn-pause').textContent = State.paused ? '继续' : '暂停';
  if (State.paused) {
    confirmModal('已暂停', '计时已暂停。点击"继续"恢复答题。', () => {}, true);
  } else {
    closeModal();
  }
  paintTimer();
};
$('#btn-submit').onclick = () => {
  const un = State.paper.questions.filter(q => {
    const p = EXAM[State.paper.subject].parts.find(x => x.key === q.part);
    const a = State.answers[q._qid];
    return p.subjective ? !(a.text && a.text.trim()) : !a.choice;
  }).length;
  confirmModal('确认交卷', un ? `还有 ${un} 道题未作答，未答题按 0 分计。确定交卷吗？` : '全部题目已作答，确定交卷吗？', () => finishExam(false));
};

/* ---------- 渲染答题区 ---------- */
function renderExam() {
  const { subject, questions } = State.paper;
  // 题号导航
  const nav = $('#qnav');
  nav.innerHTML = '';
  questions.forEach((q, i) => {
    const p = EXAM[subject].parts.find(x => x.key === q.part);
    const a = State.answers[q._qid];
    const done = p.subjective ? (a.text && a.text.trim()) : a.choice;
    const b = el('button', 'qn' + (done ? ' done' : '') + (i === State.cursor ? ' cur' : '') + (p.subjective ? ' writing' : ''));
    b.textContent = p.subjective ? (p.short || '写') : (q._seq ?? q.no);
    b.onclick = () => { jumpTo(i); };
    nav.appendChild(b);
  });

  const list = $('#qlist');
  list.innerHTML = '';
  let curPart = null, curGroup = null;
  questions.forEach((q, i) => {
    const p = EXAM[subject].parts.find(x => x.key === q.part);
    if (p.key !== curPart) {
      curPart = p.key;
      list.appendChild(el('div', '',
        `<div class="sect-head">${p.name} · ${p.count} 题 · 每题 ${p.score} 分 · 建议 ${p.minutes} 分钟</div>`));
    }
    // 文章整篇抽取：同一组的题目共用一篇原文，只在组首渲染一次
    if (q._group && q._group !== curGroup) {
      curGroup = q._group;
      if (q._first && q._article) list.appendChild(renderArticle(q));
    }
    list.appendChild(renderQ(q, i, p));
  });
  paintTimer();
}

function passageLabel(q) {
  if (q.part === 'en_cloze') return '完形填空全文';
  if (q.part === 'en_read_b') return '新题型文章';
  if (q.part === 'en_read_a') return `阅读 Text ${q.textNo || ((q.no - 21) / 5 | 0) + 1} 原文`;
  return '文章原文';
}

/**
 * 把正文里的空位标记 {{N}} 渲染成可高亮的空位。
 * 完形正文在抽取阶段已把每处空位标成 {{1}}…{{20}}，
 * 这里渲染成带下划线的编号，便于把题目与文章中的位置对上。
 */
function passageHTML(text) {
  return esc(text).replace(/\{\{(\d+)\}\}/g,
    '<span class="cloze-blank" data-n="$1">$1</span>');
}

function renderArticle(q) {
  const wrap = el('div', 'article-block');
  wrap.id = `art-${q._group.replace(/[#·]/g, '-')}`;
  const isCloze = q.part === 'en_cloze';
  const head = el('div', 'art-head');
  head.innerHTML = `<span class="pico"></span>
    <span class="art-title">${esc(q._groupLabel || '文章原文')}</span>
    <span class="art-meta">${q._gsize || 5} 题共用 · ${q._article.length} 字符${isCloze ? ' · 空位已编号' : ''}</span>
    <button class="art-toggle">收起</button>`;
  const body = el('div', 'art-body');
  body.innerHTML = passageHTML(q._article);
  const btn = head.querySelector('.art-toggle');
  btn.onclick = () => {
    const hid = body.style.display === 'none';
    body.style.display = hid ? '' : 'none';
    btn.textContent = hid ? '收起' : '展开';
  };
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

/** 高亮正文中第 n 空（完形题与文章空位联动）。 */
function highlightBlank(n, scroll) {
  document.querySelectorAll('#qlist .cloze-blank.active')
    .forEach(x => x.classList.remove('active'));
  const t = document.querySelector(`#qlist .cloze-blank[data-n="${n}"]`);
  if (!t) return;
  t.classList.add('active');
  // 旧版浏览器 / 测试环境可能没有 scrollIntoView
  if (scroll && typeof t.scrollIntoView === 'function') {
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderQ(q, i, part) {
  const a = State.answers[q._qid];
  const card = el('div', 'qcard');
  card.dataset.qi = i;
  card.id = `q-${i}`;

  const head = el('div', 'qhead');
  // 完形填空：题号同时标出对应第几空——文章里用同一编号标注，便于定位
  const blankHint = q.part === 'en_cloze'
    ? `<span class="blank-hint">第 ${q._seq ?? q.no} 空</span>` : '';
  head.innerHTML = `<span class="qno">第 ${q._seq ?? q.no} 题</span>
    ${blankHint}
    <span class="qtag">${esc(q.tag || q.part_name || '')}</span>
    <span class="qtag">${q.year} 真题</span>
    <span class="qtime" data-qt="${q._qid}">${fmtTime(a.seconds || 0)}</span>`;
  // 完形题：点击题头高亮文章中的对应空位
  if (q.part === 'en_cloze') {
    const b = el('button', 'blank-jump', '定位空位');
    b.onclick = () => highlightBlank(q._seq ?? q.no, true);
    head.insertBefore(b, head.querySelector('.qtime'));
  }
  // 同组的后续题目提供"回到原文"跳转（原文在组首只渲染一次）
  if (q._group && !q._first && q._article) {
    const back = el('button', 'art-back', '原文 ↑');
    back.onclick = () => {
      const t = document.getElementById(`art-${q._group.replace(/[#·]/g, '-')}`);
      if (!t) return;
      const b = t.querySelector('.art-body');
      if (b) { b.style.display = ''; t.querySelector('.art-toggle').textContent = '收起'; }
      t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    head.insertBefore(back, head.querySelector('.qtime'));
  }
  card.appendChild(head);

  // 题干文字。注意**不能再写成 if/else**：
  // 英语大作文既有 Directions 文字、又有图表，两者都要显示；
  // 数学题则是 stem 为空、只有截图。
  if (q.stem) {
    card.appendChild(el('div', 'stem', esc(q.stem).replace(/_{3,}/g, '<span class="blank"></span>')));
  }
  // 配图（数学题截图 / 英语大作文图表）
  if (q.img) {
    const isChart = q.part === 'en_writing_big';
    const img = el('img', 'qimg' + (isChart ? ' chart' : ''));
    img.src = assetURL(q.img);
    img.alt = isChart ? '作文图表' : `第 ${q.no} 题题面`;
    img.loading = 'lazy';
    card.appendChild(img);
  }
  // 正文由 renderArticle 在组首统一渲染，此处不再重复

  if (part.subjective) {
    const ta = el('textarea', 'writing');
    ta.placeholder = ({
      writing_effect: '在此撰写论证有效性分析（约 600 字）：指出论证中的逻辑缺陷并分析…',
      writing_essay: '在此撰写论说文（约 700 字）：自拟题目，展开论述…',
      en_translation: '在此完成英译汉翻译（约 150 词）：准确、通顺、完整…',
      en_writing_small: '在此撰写小作文（约 100 词）：应用文，注意格式与语气…',
      en_writing_big: '在此撰写大作文（约 150 词）：图表作文，先描述再分析…',
    })[q.part] || '在此作答…';
    ta.value = a.text || '';
    const wc = el('div', 'wc', `${(a.text || '').length} 字`);
    ta.oninput = () => {
      State.answers[q._qid].text = ta.value;
      wc.textContent = `${ta.value.length} 字`;
      saveProgress(false);
    };
    card.appendChild(ta);
    card.appendChild(wc);
    const ss = el('div', 'selfscore');
    ss.innerHTML = `<span style="font-size:13px;color:var(--tx2)">自评得分（0–${part.score}）</span>`;
    const inp = el('input');
    inp.type = 'number'; inp.min = 0; inp.max = part.score; inp.step = 0.5;
    inp.placeholder = '0';
    inp.value = a.selfScore ?? '';
    inp.oninput = () => {
      State.answers[q._qid].selfScore = inp.value === '' ? null : Number(inp.value);
      saveProgress(false);
    };
    ss.appendChild(inp);
    ss.appendChild(el('span', '', `<span style="font-size:12px;color:var(--tx3)">交卷前可留空，交卷时再评</span>`));
    card.appendChild(ss);
  } else {
    const box = el('div', 'opts' + (q.optionsInImage ? ' compact' : ''));
    OPT_KEYS.forEach(k => {
      const v = q.options[k];
      if (v == null) return;
      const o = el('div', 'opt' + (a.choice === k ? ' sel' : ''));
      o.innerHTML = q.optionsInImage
        ? `<span class="k">${k}</span>`
        : `<span class="k">${k}</span><span class="v">${esc(v)}</span>`;
      o.onclick = () => {
        State.answers[q._qid].choice = k;
        $$('.opt', box).forEach(x => x.classList.remove('sel'));
        o.classList.add('sel');
        const nb = document.querySelectorAll('.qn')[i];
        if (nb) nb.classList.add('done');
        paintTimer();
        saveProgress(false);
      };
      box.appendChild(o);
    });
    card.appendChild(box);
  }
  return card;
}

function jumpTo(i) {
  // 结算上一题用时
  const prev = State.paper.questions[State.cursor];
  if (prev && State.answers[prev._qid] && State.running && !State.paused) {
    const dt = (Date.now() - State.lastQEnter) / 1000;
    if (dt > 0 && dt < 3600) State.answers[prev._qid].seconds += dt;
  }
  State.cursor = i;
  State.lastQEnter = Date.now();
  $$('.qn').forEach((b, k) => b.classList.toggle('cur', k === i));
  const t = document.getElementById(`q-${i}`);
  if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  saveProgress(false);
}

/* ---------- 交卷 ---------- */
function finishExam(auto) {
  clearInterval(State.tick);
  State.running = false;
  State.finished = true;
  const { subject, questions } = State.paper;
  // 交卷后试卷已完成，清掉断点快照——否则下次打开还会提示「继续答题」
  ResumeStore.clear();
  State.pendingSnap = null;
  dipResumeCard();
  // 补齐未累计的当前题用时
  if (!State.paused && State.lastQEnter) {
    const cur = questions[State.cursor];
    if (cur) {
      const dt = (Date.now() - State.lastQEnter) / 1000;
      if (dt > 0 && dt < 3600) State.answers[cur._qid].seconds += dt;
    }
  }
  // 主观题未自评则交卷时弹出自评
  const subjQ = questions.filter(q => {
    const p = EXAM[subject].parts.find(x => x.key === q.part);
    return p.subjective && State.answers[q._qid].selfScore == null;
  });
  if (subjQ.length && !auto) {
    const scores = {};
    promptScores(subjQ, scores, () => {
      subjQ.forEach((q, i) => {
        const k = Object.keys(scores)[i];
        if (k && State.answers[k]) State.answers[k].selfScore = scores[k];
      });
      buildResult();
    });
    return;
  }
  subjQ.forEach(q => { if (State.answers[q._qid]) State.answers[q._qid].selfScore = State.answers[q._qid].selfScore ?? 0; });
  buildResult();
}

function promptScores(list, out, done) {
  const subject = State.paper.subject;
  const body = document.createElement('div');
  list.forEach(q => {
    const p = EXAM[subject].parts.find(x => x.key === q.part);
    const qid = q._qid;
    // 兜底：_qid 缺失时回退到题号+年份生成的稳定 id
    const key = qid || (`${subject}-${q.part}-${q.year}-${q.no}`);
    if (!State.answers[key]) State.answers[key] = { choice: null, text: q.stem || '', selfScore: null, seconds: 0 };
    const row = el('div', '', `<div style="font-size:13px;font-weight:500;margin:12px 0 4px">${p.name}（满分 ${p.score}）· ${q.year} 真题</div>
      <div style="font-size:12px;color:var(--tx3);max-height:96px;overflow:auto;padding:8px 10px;background:var(--hover2);border-radius:6px;line-height:1.6">${esc((q.stem || '').slice(0, 320))}</div>
      <div class="selfscore" style="margin-top:6px"><span style="font-size:13px">得分</span>
      <input type="number" min="0" max="${p.score}" step="0.5" data-qid="${key}" style="width:80px;padding:5px 8px;border:1px solid var(--line);border-radius:6px">
      <span style="font-size:12px;color:var(--tx3)">按平时自评即可，不计入客观题正确率</span></div>`);
    body.appendChild(row);
  });
  const m = $('#modal');
  const box = m.querySelector('.box');
  // 复用原有 #m-title / #m-text 节点，避免 confirmModal 后续访问不到
  $('#m-title').textContent = '作文自评';
  $('#m-text').textContent = '主观题无法自动判分，请对照评分区间给出分数。';
  // 移除上一次可能残留的自评区
  const old = box.querySelector('#score-panel');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'score-panel';
  panel.innerHTML = `<div style="max-height:50vh;overflow:auto;margin-top:8px">${body.innerHTML}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn ghost" id="m-cancel2">返回</button>
      <button class="btn" id="m-ok2">查看成绩</button>
    </div>`;
  box.appendChild(panel);
  m.classList.add('on');
  box.querySelector('#m-cancel2').onclick = closeModal;
  box.querySelector('#m-ok2').onclick = () => {
    box.querySelectorAll('input[data-qid]').forEach(i => { out[i.dataset.qid] = Number(i.value) || 0; });
    closeModal(); done();
  };
}

function buildResult() {
  const { subject, questions } = State.paper;
  const r = gradePaper({ subject, questions }, State.answers);
  const total = EXAM[subject].duration - State.remaining;
  const diag = diagnose(r.detail, subject);
  const times = timeByPart(r.detail, subject);

  const rec = {
    id: State.paper.id,
    date: dayKey(new Date()),
    at: new Date().toLocaleString('zh-CN', { hour12: false }),
    subject,
    score: Math.round(r.score * 10) / 10,
    full: EXAM[subject].full,
    seconds: Math.round(total),
    detail: r.detail.map(d => ({
      qid: d.qid, no: d.no, part: d.part, tag: d.tag, year: d.year,
      choice: d.choice, correct: d.correct, gained: d.gained, full: d.full,
      seconds: Math.round(d.seconds), selfScore: d.selfScore,
    })),
    times, diag: { list: diag.list, weak: diag.weak, mid: diag.mid, good: diag.good },
    questions: questions.map(q => ({
      _qid: q._qid, no: q.no, part: q.part, year: q.year, tag: q.tag,
      stem: q.stem, options: q.options, answer: q.answer, img: q.img,
      passage: q.passage, textNo: q.textNo,
      _seq: q._seq, _group: q._group, _first: q._first, _groupLabel: q._groupLabel,
      part_name: q.part_name,
    })),
  };
  Store.save(rec);
  renderResult(rec);
  $('#nav-result').style.display = '';
  go('result');
}

function renderResult(rec) {
  const subject = rec.subject;
  const cfg = EXAM[subject];
  const objQ = rec.detail.filter(d => d.correct !== null);
  const right = objQ.filter(d => d.correct).length;
  const rate = objQ.length ? right / objQ.length : 0;
  const answered = rec.detail.filter(d => d.correct === null || d.choice || d.selfScore != null).length;

  const grade = (s) => s >= 0.85 ? ['优', 'var(--green)'] : s >= 0.6 ? ['中', 'var(--amber)'] : ['弱', 'var(--red)'];

  const d = rec.diag;
  const card = (title, color, rows, sub) => {
    if (!rows.length) return `<div class="dcard"><h3><span class="dot" style="background:${color}"></span>${title}</h3>
      <div class="empty">本次未涉及</div></div>`;
    return `<div class="dcard"><h3><span class="dot" style="background:${color}"></span>${title}
      <span style="margin-left:auto;font-size:12px;color:var(--tx3);font-weight:400">${rows.length} 个考点</span></h3>
      <div class="sub">${sub}</div>
      ${rows.map(x => `<div class="drow">
        <span class="nm">${esc(x.tag)}</span>
        <span class="bar"><i style="width:${Math.round(x.rate * 100)}%;background:${color}"></i></span>
        <span class="pc">${Math.round(x.rate * 100)}%</span>
        <span style="font-size:11px;color:var(--tx3);min-width:56px;text-align:right">${x.right}/${x.done} · ${fmtDur(x.seconds)}</span>
      </div>`).join('')}</div>`;
  };

  $('#result-body').innerHTML = `
    <div class="score-hero">
      <div class="n" style="color:${rate >= 0.6 ? 'var(--tx)' : 'var(--red)'}">${rec.score}<span style="font-size:20px;color:var(--tx3);font-weight:400"> / ${rec.full}</span></div>
      <div class="d">${cfg.name} · ${rec.date} ${rec.at.slice(-8)} · 用时 ${fmtDur(rec.seconds)} / 180 分钟</div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="l">客观题正确率</div><div class="v">${Math.round(rate * 100)}%</div><div class="s">${right} / ${objQ.length} 题</div></div>
      <div class="kpi"><div class="l">已作答</div><div class="v">${answered}<span style="font-size:14px;color:var(--tx3)"> / ${rec.detail.length}</span></div><div class="s">未答按 0 分计</div></div>
      <div class="kpi"><div class="l">总用时</div><div class="v">${fmtDur(rec.seconds)}</div><div class="s">${Math.round(rec.seconds / 60)} 分钟</div></div>
      <div class="kpi"><div class="l">平均每题</div><div class="v">${objQ.length ? Math.round(rec.seconds / objQ.length) : 0}<span style="font-size:14px;color:var(--tx3)"> 秒</span></div><div class="s">客观题</div></div>
    </div>

    <div class="card">
      <h2>知识点诊断</h2>
      <div class="hint">按本次作答正确率划分：低于 60% 为薄弱，60%–85% 为中等，85% 以上为良好</div>
      <div class="diag">
        ${card('薄弱考点', 'var(--red)', d.weak, '正确率低于 60%，优先突破')}
        ${card('中等考点', 'var(--amber)', d.mid, '正确率 60%–85%，重点巩固')}
        ${card('良好考点', 'var(--green)', d.good, '正确率 85% 以上，保持手感')}
      </div>
    </div>

    <div class="card">
      <h2>各题型用时</h2>
      <div class="hint">与建议用时对比，判断时间分配是否合理</div>
      <table>
        <thead><tr><th>题型</th><th>题量</th><th>实际用时</th><th>建议用时</th><th>每题均值</th><th>建议每题</th><th style="width:110px">对比</th></tr></thead>
        <tbody>${rec.times.map(t => {
          const diff = t.planned ? (t.seconds - t.planned) / t.planned : 0;
          const c = Math.abs(diff) < 0.15 ? 'var(--green)' : diff > 0 ? 'var(--red)' : 'var(--blue)';
          const label = Math.abs(diff) < 0.15 ? '合理' : diff > 0 ? `超 ${Math.round(diff * 100)}%` : `快 ${Math.round(-diff * 100)}%`;
          return `<tr>
            <td>${esc(t.name)}</td><td>${t.count}</td>
            <td>${fmtDur(t.seconds)}</td><td>${t.planned} 分钟</td>
            <td>${Math.round(t.avgPerQ)} 秒</td><td>${Math.round(t.plannedPerQ)} 秒</td>
            <td><span class="pill" style="background:color-mix(in srgb, ${c} 12%, transparent);color:${c}">${label}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>逐题明细</h2>
      <div class="hint">点击展开题目与答案解析</div>
      <div id="qdetail"></div>
    </div>

    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn" id="again">再考一次</button>
      <button class="btn ghost" id="back-home">返回首页</button>
    </div>`;

  // 逐题明细
  const box = $('#qdetail');
  const qmap = Object.fromEntries(rec.questions.map(q => [q._qid, q]));
  rec.detail.forEach(d2 => {
    const q = qmap[d2.qid] || {};
    const p = cfg.parts.find(x => x.key === d2.part);
    const isSub = p.subjective;
    const det = el('details');
    const state = isSub
      ? `<span class="pill a">自评 ${d2.gained} / ${d2.full}</span>`
      : d2.choice == null ? `<span class="pill r">未答</span>`
      : d2.correct ? `<span class="pill g">正确</span>`
      : `<span class="pill r">错误</span>`;
    det.innerHTML = `<summary>
      <span style="display:inline-flex;gap:8px;align-items:center;width:100%;padding-right:10px">
        <span style="font-weight:500">第 ${d2.seq ?? d2.no} 题${isSub ? ' ' + esc(p.name.split('·').pop() || '') : ''}</span>
        <span style="font-size:11px;color:var(--tx3)">${esc(d2.tag || '')}</span>
        <span style="margin-left:auto">${state}<span style="font-size:12px;color:var(--tx3);font-weight:400"> · ${fmtDur(d2.seconds)}</span></span>
      </span></summary>
      <div class="ansbox" style="margin-top:8px">
        ${!isSub ? `
          <div style="margin-bottom:10px">
            ${(q._first && q.passage) ? `<details style="margin-bottom:10px"><summary style="font-size:12px;color:var(--blue);cursor:pointer">${esc(q._groupLabel || passageLabel(q))}（${q.passage.length} 字符）</summary>
              <div style="font-size:12.5px;line-height:1.75;color:var(--tx2);background:var(--hover2);padding:10px;border-radius:6px;margin-top:6px;max-height:220px;overflow:auto;white-space:pre-wrap">${passageHTML(q.passage)}</div></details>`
              : (q.passage ? `<div style="font-size:11.5px;color:var(--tx3);margin-bottom:8px">原文见本篇第 1 题（${esc(q._groupLabel || '')}）</div>` : '')}
            ${q.img ? `<img src="${esc(assetURL(q.img))}" style="width:100%;border:1px solid var(--line);border-radius:6px;margin-bottom:10px" alt="题面">`
                    : `<div style="font-size:13px;line-height:1.7;margin-bottom:10px">${esc(q.stem || '')}</div>`}
            <div style="display:flex;flex-direction:column;gap:3px;font-size:13px">
              ${(q.optionsInImage ? OPT_KEYS : OPT_KEYS.filter(k => q.options?.[k] != null)).map(k => {
                const mine = d2.choice === k, right = q.answer === k;
                const col = right ? 'var(--green)' : mine ? 'var(--red)' : 'var(--tx2)';
                const w = right ? 'font-weight:600' : mine ? 'font-weight:600' : 'font-weight:400';
                const label = q.optionsInImage ? `${k}.（选项见题面图）` : `${k}. ${esc(q.options[k])}`;
                return `<div style="color:${col};${w}">${label}${right ? '  ✓' : mine ? '  ✗' : ''}</div>`;
              }).join('')}
            </div>
          </div>
          <div class="lbl">正确答案：<span class="ok">${esc(q.answer || '—')}</span>　你的答案：<span class="${d2.correct ? 'ok' : 'no'}">${esc(d2.choice || '未答')}</span></div>
          ${q.explanation ? `<div class="lbl" style="margin-top:8px">解析</div><div>${esc(q.explanation)}</div>` : ''}
        ` : `
          <div class="lbl">题目</div>
          <div style="font-size:13px;line-height:1.7;white-space:pre-wrap;margin-bottom:10px">${esc(q.stem || '')}</div>
          <div class="lbl">你的作答（${(q._ansText || '').length} 字）</div>
          <div style="font-size:13px;line-height:1.7;color:var(--tx2);white-space:pre-wrap;background:var(--hover);padding:10px;border-radius:6px;max-height:200px;overflow:auto">${esc(q._ansText || '（未作答）')}</div>
          <div class="lbl" style="margin-top:8px">自评得分 <span class="ok">${d2.gained} / ${d2.full}</span></div>
        `}
      </div>`;
    box.appendChild(det);
  });

  $('#again').onclick = () => startExam(subject);
  $('#back-home').onclick = () => go('home');
}

/* ---------- 记录 ---------- */
function renderHistory() {
  const list = Store.all();
  const box = $('#hist-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty-state"><h3>还没有考核记录</h3><div>完成一次模拟考试后，这里会显示日期、科目、得分与用时</div></div>`;
    return;
  }
  box.innerHTML = list.map(r => {
    const cfg = EXAM[r.subject];
    const objQ = r.detail.filter(d => d.correct !== null);
    const right = objQ.filter(d => d.correct).length;
    const rate = objQ.length ? Math.round(right / objQ.length * 100) : 0;
    const weak = r.diag?.weak?.map(x => x.tag) || [];
    return `<div class="rec">
      <div class="rec-h">
        <span style="font-weight:600">${cfg.name}</span>
        <span class="pill ${rate >= 60 ? 'g' : 'r'}">${r.score} / ${r.full}</span>
        <span style="font-size:12px;color:var(--tx2)">正确率 ${rate}%</span>
        <span class="dt">${r.date} ${r.at.slice(-8)}</span>
      </div>
      <div class="ln">
        <span>用时 <b>${fmtDur(r.seconds)}</b></span>
        <span>题数 <b>${r.detail.length}</b></span>
        <span>薄弱 <b>${weak.length ? esc(weak.slice(0, 3).join('、')) : '无'}</b></span>
      </div>
      <details>
        <summary>查看详情</summary>
        <div style="margin-top:8px">
          ${r.times.map(t => `<div style="display:flex;gap:12px;font-size:12px;padding:3px 0;border-bottom:1px solid var(--line)">
            <span style="flex:1">${esc(t.name)}</span><span style="color:var(--tx2)">${fmtDur(t.seconds)} / ${t.planned} 分钟</span></div>`).join('')}
        </div>
      </details>
    </div>`;
  }).join('');
}
$('#btn-clear').onclick = () => confirmModal('清空记录', '将删除全部考核记录，此操作不可撤销。确定继续吗？', () => { Store.clear(); renderHistory(); });

/* ---------- 弹窗 ---------- */
let modalCb = null;
function confirmModal(title, text, cb, hideOk) {
  $('#m-title').textContent = title;
  $('#m-text').textContent = text;
  const ok = $('#m-ok');
  ok.style.display = hideOk ? 'none' : '';
  modalCb = cb;
  $('#modal').classList.add('on');
  if (hideOk) { modalCb = null; }
}
function closeModal() { $('#modal').classList.remove('on'); modalCb = null; }
$('#m-cancel').onclick = closeModal;
$('#m-ok').onclick = () => { const c = modalCb; closeModal(); c && c(); };
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

/* ---------- 快捷键 ---------- */
document.addEventListener('keydown', (e) => {
  if (!State.paper || !$('#pg-exam').classList.contains('on')) return;
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const q = State.paper.questions[State.cursor];
  if (!q) return;
  const p = EXAM[State.paper.subject].parts.find(x => x.key === q.part);
  if (e.key >= '1' && e.key <= '7') {
    const k = OPT_KEYS[+e.key - 1];
    if (!p.subjective && q.options[k] != null) {
      const idx = $$('#qlist .qcard')[State.cursor];
      const opts = $$('.opt', idx);
      const target = opts.find(o => o.querySelector('.k').textContent === k);
      target && target.click();
    }
  }
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); jumpTo(Math.min(State.cursor + 1, State.paper.questions.length - 1)); }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); jumpTo(Math.max(State.cursor - 1, 0)); }
});

/* ---------- 断点续答：离开页面时兜底落盘 ---------- */
// 关闭 / 刷新 / 切到后台时，把节流队列里还没写盘的进度补写一次，
// 否则用户答完最后一题直接关标签页，会丢掉最后 2 秒内的作答。
function flushResume() {
  if (!State.paper || State.finished) return;
  if (!State.running && !State.paused) return;
  try {
    if (State.autoTimer) { clearTimeout(State.autoTimer); State.autoTimer = null; }
    const snap = ResumeStore.snapshot(State.paper, State.answers, State.remaining, State.cursor);
    ResumeStore.save(snap);
  } catch (e) { /* 卸载阶段，静默处理 */ }
}

window.addEventListener('beforeunload', flushResume);
window.addEventListener('pagehide', flushResume);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushResume();
});

State.lastQEnter = Date.now();
boot();
// 测试改动 Wed Oct  7 18:22:56     2026
