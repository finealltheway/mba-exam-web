/* ============================================================
   MBA 模拟考试系统 —— 核心引擎
   抽题（按考点权重）· 判分 · 计时 · 诊断
   ============================================================ */

const EXAM = {
  zg: {
    name: '管理类联考综合能力',
    code: '199',
    duration: 180 * 60,
    full: 200,
    parts: [
      /* minutes = 主流机构建议用时（新东方/启航/海文/品睿 2026 备考资料交叉校准）：
         数学 25 题共 55 分钟（每题约 2.2 分钟，各源建议 55-60）、
         逻辑 30 题 50 分钟、论效 25 + 论说 35（共 60）。
         合计 165 分钟，余 15 分钟涂卡检查，与 180 分钟总时长对齐。 */
      { key: 'math_solving', name: '数学·问题求解', count: 15, score: 3, minutes: 35 },
      { key: 'math_sufficiency', name: '数学·条件充分性判断', count: 10, score: 3, minutes: 20 },
      { key: 'logic', name: '逻辑推理', count: 30, score: 2, minutes: 50 },
      { key: 'writing_effect', name: '写作·论证有效性分析', short: '效', count: 1, score: 30, minutes: 25, subjective: true },
      { key: 'writing_essay', name: '写作·论说文', short: '说', count: 1, score: 35, minutes: 35, subjective: true },
    ],
  },
  en: {
    name: '英语（二）',
    code: '204',
    duration: 180 * 60,
    full: 100,
    parts: [
      /* minutes = 英语二专用建议（新东方/启航/海文 2026 备考资料交叉校准）：
         完形 15（10-20）、阅读 PartA 4 篇 70（60-80，每篇约 17 分钟）、
         新题型 15（15-20）、英译汉 20（20-25）、小作文 15（15-20）、
         大作文 30（25-30）。合计 165 分钟，余 15 分钟涂卡检查。 */
      { key: 'en_cloze', name: '完形填空', count: 20, score: 0.5, minutes: 15 },
      { key: 'en_read_a', name: '阅读理解 PartA', count: 20, score: 2, minutes: 70 },
      { key: 'en_read_b', name: '新题型 PartB', count: 5, score: 2, minutes: 15 },
      { key: 'en_translation', name: '写作·翻译（英译汉）', short: '译', count: 1, score: 15, minutes: 20, subjective: true },
      { key: 'en_writing_small', name: '写作·小作文（应用文）', short: '小', count: 1, score: 10, minutes: 15, subjective: true },
      { key: 'en_writing_big', name: '写作·大作文（图表）', short: '大', count: 1, score: 15, minutes: 30, subjective: true },
    ],
  },
};

/* ---------- 考点权重（依据 2026 大纲 + 2022-2024 逻辑实测） ---------- */
const TAG_WEIGHT = {
  // 数学
  '应用题-行程问题': 6, '应用题-工程问题': 5, '应用题-利润问题': 4,
  '应用题-浓度问题': 3, '应用题-容斥问题': 3, '应用题-年龄问题': 2,
  '应用题-其他': 4,
  '几何-平面几何': 8, '几何-解析几何': 9, '几何-立体几何': 6,
  '数据分析-排列组合': 9, '数据分析-概率': 10, '数据分析-数据描述': 4,
  '代数-方程与不等式': 6, '代数-函数': 7, '代数-数列': 7,
  '代数-算术与数论': 5, '代数-绝对值与不等式': 3,
  '代数-整式与分式': 3, '代数-其他': 4,
  // 逻辑
  '论证逻辑-加强削弱': 33, '论证逻辑-结论推导': 10, '论证逻辑-假设': 8,
  '论证逻辑-解释': 8, '论证逻辑-评价': 4,
  '形式逻辑-假言命题': 8, '形式逻辑-联言选言': 4, '形式逻辑-直言命题': 4,
  '形式逻辑-模态': 3,
  '综合推理-排序': 6, '综合推理-分组匹配': 6, '综合推理-真假话': 4,
  '综合推理-信息处理': 34,
};

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const uid = () => Math.random().toString(36).slice(2, 10);

/** 题目的稳定身份（跨会话可还原，与 ResumeStore 的口径一致）：
    subject|part|year|no。历史完成记录去重、断点续答都靠它。 */
const qKey = (q) => `${q.subject}|${q.part}|${q.year}|${q.no}`;

/* ============================================================
   抽题
   ============================================================

   两类科目的抽题单位不同，必须区别对待：

   · 英语二 —— **以文章为单位**。完形 20 题共用一篇、阅读每 5 题共用一篇，
     抽题时必须整篇抽，不能逐题跨年份拼凑（否则每题挂着不同的文章，
     与真实试卷完全不符）。
   · 管综 —— 数学与逻辑每题相互独立，按考点权重逐题抽即可。

   两者最终都按试卷结构顺序重新编号（1..N），与真实考试的题号一致。
   ============================================================ */

// 试卷内各题型的排列顺序（决定最终题号）
const PART_ORDER = {
  math_solving: 0, math_sufficiency: 1, logic: 2, writing_effect: 3, writing_essay: 4,
  en_cloze: 0, en_read_a: 1, en_read_b: 2,
  en_translation: 3, en_writing_small: 4, en_writing_big: 5,
};

// 英语二以"文章"为单位的题型：每个单元包含整套题目
const EN_ARTICLE_PARTS = [
  { part: 'en_cloze', units: 1, perUnit: 20, label: '完形填空' },
  { part: 'en_read_a', units: 4, perUnit: 5, label: '阅读理解' },
  { part: 'en_read_b', units: 1, perUnit: 5, label: '新题型' },
];


/** 把题库按"文章"分组，只保留题号连续且数量完整的单元。 */
function groupArticles(bank, part, perUnit) {
  const map = new Map();
  for (const q of bank) {
    if (q.subject !== 'en' || q.part !== part) continue;
    if (!q.answer || !q.passage) continue;         // 无答案或无正文 → 不可用
    // 选项必须按题型齐备：完形/阅读 4 项、新题型 7 项（共享选项池）。
    // 少一项整组就没法作答，直接放弃这一篇。
    const needOpt = { en_cloze: 4, en_read_a: 4, en_read_b: 7 }[part] || 3;
    if (!q.options || Object.keys(q.options).length < needOpt
        || Object.values(q.options).some(v => !String(v).trim())) continue;
    const key = part === 'en_read_a' ? `${q.year}·T${q.textNo}` : String(q.year);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(q);
  }
  const out = [];
  for (const [key, qs] of map) {
    if (qs.length !== perUnit) continue;            // 数量不足 → 不完整，弃用
    const arr = qs.slice().sort((a, b) => a.no - b.no);
    let contiguous = true;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].no !== arr[i - 1].no + 1) { contiguous = false; break; }
    }
    if (!contiguous) continue;
    out.push({
      key, year: arr[0].year, questions: arr,
      article: arr[0].passage, tag: arr[0].tag || part,
    });
  }
  return out;
}


/** 从候选文章里挑 n 篇：优先近期年份，尽量让年份分散。 */
/**
 * 按年份权重**加权随机**抽取 n 题。
 *
 * 不能写成「按权重排序后取前 n」——那样权重最高的年份会被每次都选中。
 * 写作题原来就是这么做的，结果 20 次组卷全部抽到 2026（毫无随机性）。
 * 这里给每题权重叠加一个随机扰动，让次新及更早的年份也有机会出现，
 * 同时仍然保持「近期年份概率更高」的倾向。
 */
function weightedPick(pool, n, weightOf) {
  const cand = pool.map(q => ({ q, s: weightOf(q.year) + Math.random() * 0.9 }));
  cand.sort((a, b) => b.s - a.s);
  return cand.slice(0, n).map(x => x.q);
}

function pickArticles(groups, n, weightOf) {
  if (!groups.length) return [];
  const scored = groups.map(g => ({ g, s: weightOf(g.year) + Math.random() * 0.9 }));
  scored.sort((a, b) => b.s - a.s);
  const picked = [];
  const usedYears = new Set();
  // 第一轮：先保证每年份只取一篇，拉开年份跨度
  for (const { g } of scored) {
    if (picked.length >= n) break;
    if (usedYears.has(g.year)) continue;
    picked.push(g); usedYears.add(g.year);
  }
  // 第二轮：不足则补，允许同年份多篇
  for (const { g } of scored) {
    if (picked.length >= n) break;
    if (!picked.includes(g)) picked.push(g);
  }
  return picked.slice(0, n);
}


/** 英语二：按文章整篇组装 */
function drawEnglish(bank, weightOf, exclude) {
  const out = [];
  for (const { part, units, perUnit, label } of EN_ARTICLE_PARTS) {
    const groups = groupArticles(bank, part, perUnit);
    // 历史去重：整篇里只要有一题做过，这篇就视为「已做」。
    // 优先从没做过的篇目里抽；不够时再用做过的兜底，保证试卷永远凑得齐。
    const fresh = exclude
      ? groups.filter(g => !g.questions.some(q => exclude.has(qKey(q))))
      : groups;
    const chosen = pickArticles(fresh, units, weightOf);
    if (chosen.length < units) {
      const freshKeys = new Set(fresh.map(g => g.key));
      chosen.push(...pickArticles(
        groups.filter(g => !freshKeys.has(g.key)), units - chosen.length, weightOf));
    }
    chosen.forEach((g, gi) => {
      const groupId = `${part}#${gi}`;
      const groupLabel = part === 'en_cloze'
        ? `完形填空 · ${g.year} 年真题`
        : part === 'en_read_b'
          ? `新题型 · ${g.year} 年真题`
          : `Text ${gi + 1} · ${g.year} 年真题`;
      g.questions.forEach((q, qi) => {
        out.push({
          ...q,
          _qid: uid(),
          _group: groupId,          // 同组共用一篇正文
          _groupIdx: gi,
          _first: qi === 0,         // 组内首题负责渲染正文
          _groupLabel: groupLabel,
          _article: g.article,
          _groupId: groupId,
          _gsize: g.questions.length,
        });
      });
    });
  }
  // 主观题：翻译 / 小作文 / 大作文（各 1 题，彼此独立）
  for (const part of ['en_translation', 'en_writing_small', 'en_writing_big']) {
    const pool = bank.filter(q => q.subject === 'en' && q.part === part);
    if (!pool.length) continue;
    // 同样优先没做过的；全部做过才回退到整个池子
    const usable = exclude
      ? (pool.filter(q => !exclude.has(qKey(q))).length ? pool.filter(q => !exclude.has(qKey(q))) : pool)
      : pool;
    const q = weightedPick(usable, 1, weightOf)[0];
    out.push({ ...q, _qid: uid(), _group: part, _groupIdx: 0, _first: true, _gsize: 1 });
  }
  return out;
}


/** 管综：数学与逻辑逐题按考点权重抽（每题相互独立） */
function drawZg(bank, weightOf, exclude) {
  const cfg = EXAM.zg;
  const picked = [];
  const pickedKeys = new Set();

  for (const part of cfg.parts) {
    const pool = bank.filter(q =>
      q.subject === 'zg' && q.part === part.key
      && !q.broken                       // 源文件残缺（选项不全）→ 不可作答
      && (part.subjective || q.answer)
    );
    if (!pool.length) continue;

    // 历史去重：优先从没做过的题里抽。fresh 不足时，
    // 末尾的兜底逻辑会从整个 pool（含做过的）补齐，保证总题量不变。
    const fresh = exclude
      ? pool.filter(q => !exclude.has(qKey(q)))
      : pool;
    const usable = fresh.length ? fresh : pool;

    // 主观题（写作）每题独立、也不参与考点配额，直接按年份加权随机挑，
    // 与英语二的主观题保持一致。原实现走下面的配额逻辑，
    // 结果权重最高的年份把 1 个名额全吃掉 —— 每次都固定抽到最近年份。
    if (part.subjective) {
      for (const q of weightedPick(usable, Math.min(part.count, usable.length), weightOf)) {
        picked.push({ ...q, _qid: uid() });
      }
      continue;
    }

    const byTag = new Map();
    for (const q of usable) {
      const t = q.tag || '其他';
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(q);
    }

    let need = part.count;
    if (part.subjective) need = Math.min(need, pool.length);

    const tags = [...byTag.keys()];
    if (!tags.length) continue;
    const weights = tags.map(t => part.subjective ? 1 : (TAG_WEIGHT[t] || 1));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    const quota = weights.map(w => (w / wsum) * need);
    const alloc = quota.map(Math.floor);
    const rest = need - alloc.reduce((a, b) => a + b, 0);
    if (rest > 0) {
      const order = quota.map((q, i) => ({ i, r: q - Math.floor(q) }))
        .sort((a, b) => b.r - a.r);
      for (let k = 0; k < rest; k++) alloc[order[k % order.length].i]++;
    }

    // 考点内按「年份权重 + 随机扰动」加权随机抽取——近期年份概率更高。
    //
    // **不能**用确定性的年份配额（最大余数法）：数学题的标签是细分子考点
    // （「应用题-工程问题」「代数-绝对值与不等式」…），每个子考点往往只分到
    // 1 个名额；而配额算法在 want=1 时会把这一名额固定给权重最高的年份
    // （小数部分最大的恒为近年份）——实测 15 道数学题里 13 道来自 2026，
    // 试卷第 1 题永远是 2026 第 1 题。
    //
    // 加权随机同样保持「近期优先」，但低年份有机会出现。
    // 某考点题量不足时不影响总题量，末尾有兜底补齐。
    tags.forEach((t, ti) => {
      let want = alloc[ti];
      if (want <= 0) return;
      const cand = (byTag.get(t) || [])
        .map(q => ({ q, s: weightOf(q.year) + Math.random() * 0.9 }))
        .sort((a, b) => b.s - a.s);
      for (const { q } of cand) {
        if (want <= 0) break;
        const key = `${q.subject}|${q.part}|${q.year}|${q.no}`;
        if (pickedKeys.has(key)) continue;
        pickedKeys.add(key);
        picked.push({ ...q, _qid: uid() });
        want--;
      }
    });

    // 容量不足时从该题型剩余池补齐：先补没做过的，再补做过的
    if (picked.filter(q => q.part === part.key).length < part.count) {
      const leftover = pool.filter(q => {
        const key = `${q.subject}|${q.part}|${q.year}|${q.no}`;
        return !pickedKeys.has(key);
      });
      const freshLeft = exclude ? leftover.filter(q => !exclude.has(qKey(q))) : leftover;
      const doneLeft = exclude ? leftover.filter(q => exclude.has(qKey(q))) : [];
      const fallback = shuffle(freshLeft).concat(shuffle(doneLeft));
      for (const q of fallback) {
        if (picked.filter(x => x.part === part.key).length >= part.count) break;
        pickedKeys.add(`${q.subject}|${q.part}|${q.year}|${q.no}`);
        picked.push({ ...q, _qid: uid() });
      }
    }
  }
  return picked;
}


/**
 * 组卷：按科目选择抽题方式，最后统一按试卷结构重新编号。
 * 编号从 1 开始、按题型顺序递增，与真实考试一致
 * （管综 1-15 数学求解 / 16-25 条件充分性 / 26-55 逻辑 / 56-57 写作；
 *   英语二 1-20 完形 / 21-40 阅读 / 41-45 新题型 / 46 翻译 / 47-48 作文）。
 */
function drawQuestions(bank, subject, opts = {}) {
  const yearBias = opts.yearBias ?? 0.5;
  // opts.exclude：Set<subject|part|year|no>，历史记录里已完成的题目。
  // 组卷时优先避开；某题型题量不足时才用做过的题兜底补齐。
  const exclude = opts.exclude instanceof Set ? opts.exclude : null;
  const years = [...new Set(bank.filter(q => q.subject === subject).map(q => q.year))].sort();
  const y0 = years[0], yN = years[years.length - 1];
  const weightOf = (y) => 1 + yearBias * ((y - y0) / Math.max(1, yN - y0));

  let list = subject === 'en' ? drawEnglish(bank, weightOf, exclude) : drawZg(bank, weightOf, exclude);

  // 按题型顺序、组序、**抽取顺序**排列，再统一编号。
  //
  // 末级键必须用抽取顺序而非原题号 a.no - b.no：真题各年的第 1 题都是
  // 应用题，按题号排会让「抽到的题里题号最小的」永远占据试卷第 1 题
  // （表现为第一题固定成某个年份的第 1 题）。
  // 英语二的组内顺序本来就是题号顺序，用抽取顺序同样正确。
  list.forEach((q, i) => { q._ord = i; });
  list.sort((a, b) =>
    (PART_ORDER[a.part] ?? 99) - (PART_ORDER[b.part] ?? 99) ||
    (a._groupIdx ?? 0) - (b._groupIdx ?? 0) ||
    (a._ord - b._ord)
  );
  list.forEach((q, i) => { q._seq = i + 1; });
  return list;
}

/* ---------- 判分 ---------- */

function gradePaper(paper, answers) {
  // answers: { qid: {choice, text, selfScore} }
  const detail = [];
  let score = 0;
  let objectiveFull = 0;
  let subjectiveFull = 0;

  for (const q of paper.questions) {
    const part = EXAM[paper.subject].parts.find(p => p.key === q.part);
    const a = answers[q._qid] || {};
    const rec = {
      qid: q._qid, no: q.no, seq: q._seq, part: q.part, partName: part.name,
      group: q._group || null, groupLabel: q._groupLabel || null,
      tag: q.tag, year: q.year, score: part.score, full: part.score,
      choice: a.choice || null, text: a.text || '', selfScore: a.selfScore ?? null,
      correct: null, gained: 0, seconds: a.seconds || 0,
    };
    if (part.subjective) {
      subjectiveFull += part.score;
      if (a.selfScore != null) {
        rec.gained = Math.max(0, Math.min(part.score, Number(a.selfScore) || 0));
        rec.correct = null;
      }
    } else {
      objectiveFull += part.score;
      if (a.choice) {
        rec.correct = a.choice === q.answer;
        rec.gained = rec.correct ? part.score : 0;
      }
    }
    score += rec.gained;
    detail.push(rec);
  }
  return { score, detail, objectiveFull, subjectiveFull };
}

/* ---------- 知识点诊断 ---------- */

function diagnose(detail, subject) {
  const byTag = new Map();
  for (const d of detail) {
    if (d.part === 'writing_effect' || d.part === 'writing_essay') continue;
    const t = d.tag || '其他';
    if (!byTag.has(t)) byTag.set(t, { tag: t, right: 0, wrong: 0, blank: 0, gain: 0, full: 0, seconds: 0 });
    const g = byTag.get(t);
    g.full += d.full;
    g.seconds += d.seconds;
    if (d.correct === null) g.blank++;
    else if (d.correct) { g.right++; g.gain += d.gained; }
    else g.wrong++;
  }
  const list = [...byTag.values()].map(g => {
    const done = g.right + g.wrong;
    const rate = done ? g.right / done : 0;
    return { ...g, done, rate };
  });
  list.sort((a, b) => a.rate - b.rate);

  const judged = list.filter(x => x.done >= 2);
  const weak = judged.filter(x => x.rate < 0.6);
  const mid = judged.filter(x => x.rate >= 0.6 && x.rate < 0.85);
  const good = judged.filter(x => x.rate >= 0.85);
  return { list, weak, mid, good };
}

/* ---------- 各题型用时统计 ---------- */

function timeByPart(detail, subject) {
  return EXAM[subject].parts.map(p => {
    const rows = detail.filter(d => d.part === p.key);
    const seconds = rows.reduce((s, d) => s + (d.seconds || 0), 0);
    return {
      key: p.key, name: p.name, count: rows.length, seconds,
      planned: p.minutes * 60,
      avgPerQ: rows.length ? seconds / rows.length : 0,
      plannedPerQ: p.minutes * 60 / p.count,
    };
  });
}

/* ---------- 翻译题自动评分 ----------
   依据考研英语二翻译官方评分标准（已联网核实）：
   ① 分档给分：13-15 / 9-12 / 5-8 / 0-4 四档；
   ② 句群采分点制：阅卷把一个句子拆成 3-4 个采分点按点给分
      ——本题库每道翻译题的 scoring.groups 即按句群预置了采分点，
      每个采分点等权（单点分 = 满分 / 全篇采分点总数）；
   ③ 细则：明显扭曲原意的句群得分封顶——漏掉带否定语义的采分点
      （points[].neg）时，该句群最多得一半分；
   ④ 整篇扣分：错别字不个别计分、满 3 个扣 0.5；篇幅明显短于
      参考译文只提示不漏译（缺译句群的采分点本就全部落空，
      不重复扣分）。
   纯本地确定性算法，不依赖网络，离线版同样可用。 */

/* 常见错别字表（错误写法，仅用于计数）。
   收录高频音近/形近误写，命中即按官方规则累计。 */
const TRANS_TYPOS = [
  ['按装'], ['暖昧'], ['甘败下风'], ['自抱自弃'], ['针贬'], ['脉博'], ['松驰'], ['一愁莫展'],
  ['穿流不息'], ['精萃'], ['催毁'], ['震憾'], ['凑和'], ['侯车室'], ['迫不急待'], ['一如继往'],
  ['草管人命'], ['娇揉造作'], ['挖墙角'], ['悬粱刺股'], ['名列前矛'], ['再所不辞'], ['急功进利'],
  ['受益非浅'], ['兴高彩烈'], ['旁证博引'], ['烩炙人口'], ['语无论次'], ['心恢意冷'], ['走头无路'],
  ['原形必露'], ['如火如茶'], ['熙熙嚷嚷'], ['妄费心机'], ['曲高合寡'], ['生死悠关'], ['任劳任愿'],
  ['不知所错'], ['司惯见空'], ['各舒己见'], ['掉以经心'], ['陈词烂调'], ['趁火打铁'], ['发人深醒'],
  ['翻天复地'], ['顾此失被'], ['害人听闻'], ['含糊其词'], ['花团紧簇'], ['援兵之计'], ['记意犹新'],
  ['见义思迁'], ['举世闻明'], ['可哥可泣'], ['莫明其妙'], ['目不瑕接'], ['破斧沉舟'], ['齐心胁力'],
  ['千均一发'], ['情不自尽'], ['锐不可挡'], ['三翻五次'], ['世外桃园'], ['谈笑风声'], ['万籁具寂'],
  ['无原无故'], ['息息相官'], ['义愤填鹰'], ['与日具增'], ['载哥载舞'], ['自期欺人'], ['左顾右畔'],
  ['半途而费'], ['包罗万像'], ['毕恭毕敬'], ['变本加励'], ['不加思索'], ['不屑一故'], ['苍海一粟'],
  ['层出不全'], ['春风话雨'], ['粗制烂造'], ['当务之极'], ['雕粱画栋'], ['东施效频'], ['阿谀风承'],
  ['发号司令'], ['按步就班'], ['白璧无瑕'], ['不加思索'], ['不言而谕'], ['步履惟坚'],
];

/** 中文否定词（用于“否定漏译 → 全文封顶”启发式）。 */
const TRANS_NEGATORS = ['不', '没', '无', '非', '未', '否', '毫无', '并非', '并不', '决不', '绝不'];

/**
 * 翻译题自动评分。
 * @param {object} q    题目（需带 scoring 字段）
 * @param {string} text 学生译文
 * @returns {object|null} 评分结果；无评分数据或译文为空时返回 null
 *   { score, full, tier, tierLabel, groups[], ded[], warns[], typos, points, hitPoints, refLen, textLen, per }
 *   groups[]: { en, base, got, points: [{note, hit, neg}], capped }
 *   ded[]   实际扣分项；warns[] 只提示不扣分（如篇幅偏短疑似漏译）
 */
function scoreTranslation(q, text) {
  const sc = q && q.scoring;
  if (!sc || !Array.isArray(sc.groups) || !sc.groups.length) return null;
  const raw = String(text || '').trim();
  if (!raw) return null;

  const full = sc.full || q.score || 15;
  // 匹配前去掉所有空白（学生可能在采分点内部加空格/换行）
  const norm = raw.replace(/\s+/g, '');
  const hit = (arr) => (arr || []).some(k => norm.includes(String(k).replace(/\s+/g, '')));

  // ① 句群采分点：全篇单点等权
  const totalPts = sc.groups.reduce((s, g) => s + (g.points || []).length, 0);
  if (!totalPts) return null;
  const per = full / totalPts;
  const groups = sc.groups.map(g => {
    const pts = (g.points || []).map(p => ({
      note: p.note || '', hit: hit(p.any), neg: !!p.neg,
    }));
    let got = pts.filter(p => p.hit).length * per;
    // 否定采分点漏译 → 意思被扭曲，该句群封顶一半（官方细则）
    const negMiss = pts.some(p => p.neg && !p.hit);
    const half = per * pts.length / 2;
    const capped = negMiss && got > half;
    if (capped) got = half;
    return {
      en: g.en || '',
      base: Math.round(per * pts.length * 100) / 100,
      got: Math.round(got * 100) / 100,
      points: pts, capped,
    };
  });

  let score = groups.reduce((s, g) => s + g.got, 0);
  const ded = [];

  // ② 错别字：满 3 个扣 0.5（官方：不个别计分，整篇累计）
  let typos = 0;
  for (const [bad] of TRANS_TYPOS) {
    let i = 0;
    while ((i = norm.indexOf(bad, i)) >= 0) { typos++; i += bad.length; }
  }
  if (typos >= 3) {
    const cut = Math.floor(typos / 3) * 0.5;
    score -= cut;
    ded.push({ k: 'typo', label: `错别字 ${typos} 处，满 3 个扣 0.5`, v: -cut });
  }

  // ③ 漏译提示：篇幅明显短于参考译文时给出提示（不另扣分——
  //    缺译句群的采分点本来就全部落空，官方即"缺译按完全译错处理"，
  //    再扣一次属于重复惩罚）。
  const refLen = String(sc.ref || '').replace(/\s+/g, '').length;
  const textLen = norm.length;
  const warns = [];
  if (refLen > 0 && textLen < refLen * 0.6) {
    warns.push(`译文篇幅偏短（${textLen} 字 / 参考 ${refLen} 字），请检查是否漏译`);
  }

  // ④ 否定词整体漏译 → 全文意思可能被扭曲，封顶第 3 档（5-8 分）
  const hasNeg = sc.groups.some(g => (g.points || []).some(p => p.neg));
  if (hasNeg && !TRANS_NEGATORS.some(n => norm.includes(n))) {
    const cap = Math.round(full * 8 / 15 * 2) / 2;   // 第 3 档上限
    if (score > cap) {
      score = cap;
      ded.push({ k: 'neg', label: '全文未见否定词，疑似漏译否定成分（意思可能被扭曲），按第 3 档封顶', v: null });
    }
  }

  score = Math.max(0, Math.min(full, Math.round(score * 2) / 2));   // 半分粒度
  const ratio = score / full;
  const tier = ratio >= 0.867 ? 1 : ratio >= 0.6 ? 2 : ratio >= 0.333 ? 3 : 4;
  const tierLabel = {
    1: '第 1 档（13-15 分）很好地完成了试题规定的任务：理解准确无误，表达通顺清楚',
    2: '第 2 档（9-12 分）基本完成了试题规定的任务：理解基本准确，表达比较通顺',
    3: '第 3 档（5-8 分）未能按要求完成试题规定的任务：理解不够准确，有明显漏译、错译',
    4: '第 4 档（0-4 分）未完成试题规定的任务：表达不通顺，文字支离破碎',
  }[tier];

  const hitPoints = groups.reduce((s, g) => s + g.points.filter(p => p.hit).length, 0);
  return {
    score, full, tier, tierLabel, groups, ded, warns, typos,
    points: totalPts, hitPoints,
    refLen, textLen,
    per: Math.round(per * 100) / 100,
  };
}

/* ---------- 本地存储 ---------- */

/* 当前账号（站点账号层，会话由根目录 auth.js 写入 mba_auth）。
   所有持久化键都带账号后缀——「记录与数据以账号为单位」。
   无会话（本地单文件版 / 测试环境）回落到 local，行为与旧版一致。 */
const AUTH_USER = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('mba_auth') || 'null');
    return (s && s.u) || 'local';
  } catch { return 'local'; }
})();

/* 旧版数据（无账号后缀时代）一次性迁移：搬到当前账号名下后删除原键。
   放在 Store 定义之前，boot 前完成，读写两端都只见新键。 */
(function migrateLegacyStores() {
  for (const base of ['mba_exam_records_v1', 'mba_exam_resume_v1']) {
    try {
      const legacy = localStorage.getItem(base);
      if (legacy == null) continue;
      const acct = base + ':' + AUTH_USER;
      if (localStorage.getItem(acct) == null) localStorage.setItem(acct, legacy);
      localStorage.removeItem(base);
    } catch { /* 存储不可用时忽略，Store 自身还有兜底 */ }
  }
})();

const Store = {
  get key() { return 'mba_exam_records_v1:' + AUTH_USER; },
  all() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
    catch { return []; }
  },
  save(rec) {
    const list = this.all();
    list.unshift(rec);
    // 记录里带题目原文与解析，体积较大；localStorage 写满时逐批丢弃最旧记录，
    // 保证 newest 记录一定能存下（而不是整个抛异常导致交卷后无成绩可看）。
    let keep = list.slice(0, 200);
    while (keep.length) {
      try {
        localStorage.setItem(this.key, JSON.stringify(keep));
        return;
      } catch {
        keep = keep.slice(0, Math.max(0, keep.length - 10));
      }
    }
  },
  remove(id) {
    localStorage.setItem(this.key, JSON.stringify(this.all().filter(r => r.id !== id)));
  },
  clear() { localStorage.removeItem(this.key); },
};

/* ---------- 未完成考试（断点续答）----------
   考试中途刷新页面 / 关掉浏览器 / 误关标签页后，重新打开时应能接着答。
   持久化的东西必须**能跨会话还原**，所以不能存 `_qid`（每次组卷都随机生成），
   而要存「题目的稳定身份」`subject|part|year|no`，以及组卷时派生的
   题目顺序与分组字段。恢复时按顺序重建 paper，并按稳定身份把答案对回去。

   只保留最近一份未完成试卷（key 里带 v1）；交卷或手动放弃时清除。 */
const ResumeStore = {
  get key() { return 'mba_exam_resume_v1:' + AUTH_USER; },

  /** 把当前试卷压成可持久化的最小快照。 */
  snapshot(paper, answers, remaining, cursor) {
    const groupFields = ['_group', '_groupIdx', '_first', '_gsize',
                         '_article', '_groupLabel', '_seq', '_idx', '_ord'];
    // 逐题落盘：题目身份 + 派生字段 + 该题答案。
    // 答案**跟着题目一起存**（而不是单独一张按 _qid 索引的表）——
    // 因为 _qid 每次组卷都随机生成，跨会话对不上；绑定到题目顺序才可靠。
    const questions = paper.questions.map(q => {
      const a = answers[q._qid] || {};
      const row = {
        subject: q.subject, part: q.part, year: q.year, no: q.no,
        textNo: q.textNo ?? null,
        a: { choice: a.choice ?? null, text: a.text || '',
             selfScore: a.selfScore ?? null, seconds: a.seconds || 0,
             autoScored: !!a.autoScored },
      };
      for (const f of groupFields) if (q[f] !== undefined) row[f] = q[f];
      return row;
    });
    return {
      v: 1,
      paperId: paper.id,
      subject: paper.subject,
      mode: paper.mode || 'random',     // 组卷模式（随机 / 指定年份真题）
      year: paper.year ?? null,         // 年份模式下的真题年份
      createdAt: paper.createdAt,
      savedAt: new Date().toISOString(),
      remaining: Math.max(0, remaining),
      cursor: cursor || 0,
      questions,
    };
  },

  save(snap) {
    try { localStorage.setItem(this.key, JSON.stringify(snap)); return true; }
    catch { return false; }
  },

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || !s.subject || !Array.isArray(s.questions) || !s.questions.length) {
        return null;
      }
      return s;
    } catch { return null; }
  },

  clear() { try { localStorage.removeItem(this.key); } catch (e) { /* 忽略 */ } },

  /** 把快照还原成运行时结构：重建 paper（含新 _qid）并把答案对回来。 */
  restore(snap, bank) {
    const byId = new Map();
    for (const q of bank) {
      byId.set(`${q.subject}|${q.part}|${q.year}|${q.no}`, q);
    }
    const questions = [], answers = {};
    for (const row of snap.questions) {
      const id = `${row.subject}|${row.part}|${row.year}|${row.no}`;
      const src = byId.get(id);
      if (!src) return null;              // 题库已变（重建过），快照失效
      const q = { ...src, _qid: uid(), _idx: row._idx };
      for (const f of ['_group', '_groupIdx', '_first', '_gsize',
                       '_article', '_groupLabel', '_seq', '_ord']) {
        if (row[f] !== undefined) q[f] = row[f];
      }
      if (row.textNo != null) q.textNo = row.textNo;
      questions.push(q);
      const a = row.a || {};
      answers[q._qid] = {
        choice: a.choice ?? null, text: a.text || '',
        selfScore: a.selfScore ?? null, seconds: a.seconds || 0,
        autoScored: !!a.autoScored,
      };
    }
    return {
      paper: { id: snap.paperId, subject: snap.subject,
               mode: snap.mode || 'random', year: snap.year ?? null,
               createdAt: snap.createdAt, questions },
      answers,
      remaining: snap.remaining,
      cursor: Math.min(snap.cursor || 0, questions.length - 1),
      savedAt: snap.savedAt,
    };
  },
};

/* ---------- 数据源 ----------
   题库与图片都可以由构建脚本内联成 JS 常量（BANK_DATA / ASSETS）。
   内联后页面是自包含的，双击 index.html 就能用，不再需要 HTTP 服务器
   —— 浏览器同源策略只拦 fetch file://，不拦普通 <script>。
   两个常量都不存在时（开发态）回退到 fetch，行为与改造前完全一致。 */
const getBank = async () => {
  if (typeof BANK_DATA !== 'undefined' && BANK_DATA) return BANK_DATA;
  const res = await fetch('data/question_bank.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/* 把题库里的相对路径解析成可直接渲染的 src。
   内联态命中 ASSETS 表；开发态拼回 data/ 前缀。 */
const assetURL = (rel) => {
  if (!rel) return '';
  if (/^(data:|https?:|\/)/.test(rel)) return rel;
  if (typeof ASSETS !== 'undefined' && ASSETS[rel]) return ASSETS[rel];
  return 'data/' + rel;
};

/* 供 Node 自检脚本读取（浏览器中无副作用） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EXAM, TAG_WEIGHT, drawQuestions, gradePaper, diagnose, timeByPart, Store, ResumeStore, shuffle, getBank, assetURL };
}
