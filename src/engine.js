// Mezuniyet planlayıcısı motoru. DOM'a dokunmaz; tarayıcıda ve Node'da aynen çalışır.
// Kurallar: Bilkent Lisans ve Ön Lisans Eğitim-Öğretim Yönetmeliği (madde numaraları RULES içinde).

export const GP = { "A+": 4, "A": 4, "A-": 3.7, "B+": 3.3, "B": 3, "B-": 2.7, "C+": 2.3, "C": 2, "C-": 1.7, "D+": 1.3, "D": 1, "F": 0, "FX": 0, "FZ": 0 };
export const LETTERS = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F", "FX", "FZ"];
const FAILS = new Set(["F", "FX", "FZ", "U"]);
const KNOWN = new Set([...Object.keys(GP), "W", "S", "U", "I", ""]);

export const RULES = {
  wLimit: 4,              // Md. 4.10: lisansta en çok 4 dersten çekilme
  gradCgpa: 2.0,          // Md. 6.1
  probationFloor: 1.8,    // Md. 4.14 / 4.17: 1.80-1.99 sınamalı, altı başarısız
  probationNewShare: 0.6, // Md. 4.18: sınamalı yeni ders kredisi en fazla nominal yükün %60'ı
  unsatNewElectives: 1,   // Md. 4.18: başarısız öğrenci sadece 1 yeni seçmeli alabilir
  summerMaxCourses: 2,    // Md. 4.2
  maxYears: 7,            // Md. 3.3
  improveMaxPts: 1.7,     // not yükseltme önerisi: C- ve altı geçer notlar
};

export const isGraded = g => g in GP;
export const isPass = g => (g in GP && !FAILS.has(g)) || g === "S";
export const r2 = x => Math.round(x * 100 + 1e-6) / 100;

// ---------- dönemler ----------
// {y: akademik yılın başladığı yıl, s: 0 Fall, 1 Spring, 2 Summer}
export function parseTerm(str) {
  const m = String(str).match(/(\d{4})\s*-\s*(\d{4})\s+(Fall|Autumn|Spring|Summer)/i);
  if (!m) return null;
  const w = m[3].toLowerCase();
  return { y: +m[1], s: w === "spring" ? 1 : w === "summer" ? 2 : 0 };
}
export const tkey = t => t.y * 3 + t.s;
export const fromKey = k => ({ y: Math.floor(k / 3), s: k % 3 });
export const tnext = t => (t.s < 2 ? { y: t.y, s: t.s + 1 } : { y: t.y + 1, s: 0 });
export const tlabel = t => (t.s === 0 ? `Fall ${t.y}` : t.s === 1 ? `Spring ${t.y + 1}` : `Summer ${t.y + 1}`);
export const tshort = t => (t.s === 0 ? "F" : t.s === 1 ? "S" : "Yz") + String(t.s === 0 ? t.y : t.y + 1).slice(2);

// ---------- önkoşul ifadeleri ----------
export function parsePre(s) {
  if (!s) return null;
  const toks = String(s).match(/\(|\)|\band\b|\bor\b|[A-Z]{2,5} \d{3}[A-Z]?/gi) || [];
  let i = 0;
  const fac = () => { const t = toks[i++]; if (t === "(") { const n = expr(); i++; return n; } return { c: t.toUpperCase() }; };
  const term = () => { let n = fac(); while ((toks[i] || "").toLowerCase() === "and") { i++; n = { and: [n, fac()] }; } return n; };
  const expr = () => { let n = term(); while ((toks[i] || "").toLowerCase() === "or") { i++; n = { or: [n, term()] }; } return n; };
  return toks.length ? expr() : null;
}
export function evalPre(n, has) {
  if (!n) return true;
  if (n.c) return has(n.c);
  if (n.and) return n.and.every(x => evalPre(x, has));
  return n.or.some(x => evalPre(x, has));
}
function preCodes(n, out = new Set()) {
  if (!n) return out;
  if (n.c) out.add(n.c); else (n.and || n.or).forEach(x => preCodes(x, out));
  return out;
}

// ---------- müfredat modeli ----------
function expandPool(str) {
  if (!str) return null;
  const set = new Set(); let prefix = "";
  for (const tok of str.split(",").map(s => s.trim()).filter(Boolean)) {
    const m = tok.match(/^([A-Z]{2,5})\s+(\d{3}[A-Z]?)$/);
    if (m) { prefix = m[1]; set.add(`${m[1]} ${m[2]}`); } else if (/^\d{3}[A-Z]?$/.test(tok) && prefix) set.add(`${prefix} ${tok}`);
  }
  return set;
}
export function buildModel(data) {
  const cats = {};
  for (const [k, v] of Object.entries(data.secmeliler || {})) {
    cats[k] = { key: k, name: v.ad || k, short: v.kisa || v.ad || k, pool: expandPool(v.havuz), pre: v.onkosul || null, preNode: parsePre(v.onkosul) };
  }
  const slots = data.mufredat.map((s, i) => {
    const order = (s.yil - 1) * 2 + (s.donem === "Spring" ? 1 : 0);
    if (s.kod) {
      const meta = (data.dersler || {})[s.kod] || {};
      return { i, order, yil: s.yil, donem: s.donem, kind: s.staj ? "intern" : "req", code: s.kod, name: s.ad, cr: s.kredi,
        pre: meta.onkosul || null, preNode: parsePre(meta.onkosul), summer: meta.yaz || "hayir" };
    }
    const c = cats[s.kategori] || { key: s.kategori, name: s.kategori, short: s.kategori, pool: null, pre: null, preNode: null };
    return { i, order, yil: s.yil, donem: s.donem, kind: "elec", cat: c.key, name: c.name, cr: s.kredi, pre: c.pre, preNode: c.preNode, summer: "duzensiz" };
  });
  const reqCodes = new Set(slots.filter(s => s.code).map(s => s.code));
  return { data, cats, slots, reqCodes, total: data.toplamKredi, nominal: data.nominalYuk || 17 };
}

// ---------- transkript ----------
const decode = s => s.replace(/&#34;|&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const normCode = c => c.toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]+)(\d)/, "$1 $2");

// STARS'tan alınan "donem,ders_kodu,ders_adi,kredi,harf_notu" satırlarını ve
// isteğe bağlı "donem,donem_gpa,donem_kredisi,cgpa,akademik_durum" satırlarını okur.
export function parseTranscript(text) {
  const rows = [], summary = [], warnings = [];
  const clean = decode(String(text || "")).replace(/-{3,}/g, "\n");
  for (let line of clean.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const f = line.split(",").map(x => x.trim());
    const t = parseTerm(f[0] || "");
    if (!t) continue;
    const code = (f[1] || "").replace(/\s+/g, " ");
    if (/^[A-Z]{2,5} ?\d{3}[A-Z]?$/i.test(code) && f.length >= 4) {
      let grade = (f[f.length - 1] || "").toUpperCase();
      const cr = parseFloat(f[f.length - 2]);
      const name = line.split(",").slice(2, -2).join(",").trim().replace(/^"+|"+$/g, "");
      if (!KNOWN.has(grade)) { warnings.push(`${tlabel(t)} ${normCode(code)}: "${grade}" notu tanınmadı, boş sayıldı.`); grade = ""; }
      rows.push({ t, k: tkey(t), code: normCode(code), name, cr: isNaN(cr) ? 0 : cr, grade });
    } else if (f.length >= 4 && /^(\d+(\.\d+)?|-)$/.test(f[1])) {
      summary.push({ t, k: tkey(t), gpa: parseFloat(f[1]), cr: parseFloat(f[2]), cgpa: parseFloat(f[3]), st: (f[4] || "").toUpperCase() });
    }
  }
  return { rows, summary, warnings };
}

// ---------- hesaplar ----------
function sumLatest(latest) {
  let c = 0, p = 0;
  for (const v of latest.values()) if (v.cr > 0) { c += v.cr; p += v.cr * v.pts; }
  return { c, p, cg: c ? p / c : null };
}
export const cgpaOf = latest => sumLatest(latest).cg;

// Her dönemin GPA'sı ve dönem sonu CGPA'sı. Tekrarda en son notlu deneme geçerli (Md. 4.13);
// W ve S eski notun yerine geçmez (Md. 4.11).
export function termStats(rows) {
  const keys = [...new Set(rows.map(r => r.k))].sort((a, b) => a - b);
  const latest = new Map(), per = [];
  for (const k of keys) {
    const tr = rows.filter(r => r.k === k);
    let c = 0, p = 0;
    for (const r of tr) if (isGraded(r.grade) && r.cr > 0) { c += r.cr; p += r.cr * GP[r.grade]; }
    for (const r of tr) if (isGraded(r.grade)) latest.set(r.code, { cr: r.cr, pts: GP[r.grade], grade: r.grade });
    const s = sumLatest(latest);
    per.push({ k, t: fromKey(k), gpa: c ? p / c : null, cr: c, cgpa: c ? s.cg : null, ccr: s.c, graded: c > 0 });
  }
  return { per, latest };
}

export function courseMap(rows) {
  const m = new Map();
  for (const r of [...rows].sort((a, b) => a.k - b.k)) {
    if (!m.has(r.code)) m.set(r.code, { code: r.code, name: r.name, cr: r.cr, attempts: [] });
    const c = m.get(r.code);
    c.attempts.push(r); if (r.name) c.name = r.name; c.cr = r.cr;
  }
  for (const c of m.values()) {
    const graded = c.attempts.filter(a => isGraded(a.grade) || a.grade === "S" || a.grade === "U");
    c.last = graded[graded.length - 1] || null;
    c.ip = c.attempts.some(a => a.grade === "");
    c.first = c.attempts[0].k;
    c.wCount = c.attempts.filter(a => a.grade === "W").length;
    c.status = c.ip ? "ip" : c.last ? (isPass(c.last.grade) ? "done" : "failed") : "none";
  }
  return m;
}

// Transkriptteki dersleri müfredat kalemlerine yerleştirir. Seçmeliler önce en dar havuza gider.
export function assignSlots(model, cm) {
  const slots = model.slots.map(s => ({ ...s, course: null, status: "none" }));
  for (const s of slots) if (s.code) { const c = cm.get(s.code); if (c) { s.course = c; s.status = c.status; } }
  const rank = c => (c.status === "failed" ? 1 : 0);
  const extra = [...cm.values()].filter(c => !model.reqCodes.has(c.code) && (c.last || c.ip))
    .sort((a, b) => rank(a) - rank(b) || a.first - b.first);
  const unassigned = [];
  for (const c of extra) {
    const keys = Object.values(model.cats).filter(k => k.pool && k.pool.has(c.code)).sort((a, b) => a.pool.size - b.pool.size).map(k => k.key);
    for (const k of Object.values(model.cats)) if (!k.pool && !keys.includes(k.key)) keys.push(k.key);
    const slot = keys.map(k => slots.find(s => s.cat === k && !s.course)).find(Boolean);
    if (slot) { slot.course = c; slot.status = c.status; } else unassigned.push(c);
  }
  return { slots, unassigned };
}

export function standing(cg) {
  if (cg == null) return "S";
  return cg >= RULES.gradCgpa - 1e-9 ? "S" : cg >= RULES.probationFloor - 1e-9 ? "P" : "U";
}
export const STANDING_LABEL = { S: "Normal", P: "Sınamalı", U: "Başarısız" };
export const STANDING_EN = { S: "Satisfactory", P: "Probation", U: "Unsatisfactory" };

export function letterFor(g) {
  const asc = ["D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A"];
  return asc.find(l => GP[l] >= g - 1e-9) || null;
}

// ---------- ana analiz ----------
// opts: { whatIf: {kod: not}, g: gelecekteki ortalama, maxCr, summers, irregular, target: dönem anahtarı }
export function analyze(model, rows, opts = {}) {
  const o = Object.assign({ whatIf: {}, g: 2.3, maxCr: 19, summers: true, irregular: false, target: null }, opts);
  const keys = [...new Set(rows.map(r => r.k))].sort((a, b) => a - b);
  const curKey = [...keys].reverse().find(k => rows.some(r => r.k === k && r.grade === "")) ?? null;
  const ipRows = curKey == null ? [] : rows.filter(r => r.k === curKey && r.grade === "");
  const entryKey = keys.length ? keys[0] : null;

  // bugünkü durum
  const ts = termStats(rows);
  const cm = courseMap(rows);
  const { slots, unassigned } = assignSlots(model, cm);
  const cgNow = cgpaOf(ts.latest);
  const wUsed = rows.filter(r => r.grade === "W").length;
  const doneCr = slots.filter(s => s.status === "done").reduce((a, s) => a + s.cr, 0);
  const ipCr = slots.filter(s => s.status === "ip").reduce((a, s) => a + s.cr, 0);

  // "bu dönem şu notları alırsam"
  const projRows = rows.map(r => (r.k === curKey && r.grade === "" ? { ...r, grade: o.whatIf[r.code] || "C" } : r));
  const tsP = termStats(projRows);
  const cgProj = cgpaOf(tsP.latest);
  const need = {};
  if (ipRows.length) {
    const base = termStats(rows.filter(r => r.grade !== "")).latest;
    const ipCodes = new Set(ipRows.filter(r => r.cr > 0).map(r => r.code));
    let cO = 0, pO = 0;
    for (const [code, v] of base) if (!ipCodes.has(code) && v.cr > 0) { cO += v.cr; pO += v.cr * v.pts; }
    const cI = ipRows.filter(r => r.cr > 0).reduce((a, r) => a + r.cr, 0);
    for (const T of [RULES.gradCgpa, RULES.probationFloor]) need[T.toFixed(2)] = cI ? (T * (cO + cI) - pO) / cI : null;
  }

  // dönem planı (bu dönemin varsayılan notlarıyla başlar)
  const cmP = courseMap(projRows);
  const slP = assignSlots(model, cmP).slots;
  const startKey = curKey != null ? curKey : keys.length ? keys[keys.length - 1] : null;
  const firstPlanT = startKey == null ? { y: 2024, s: 0 } : tnext(fromKey(startKey));
  const maxKey = entryKey == null ? tkey(firstPlanT) + 21 : tkey({ y: fromKey(entryKey).y + RULES.maxYears - 1, s: 1 });
  const targetKey = o.target != null ? o.target : (entryKey == null ? null : tkey({ y: fromKey(entryKey).y + 4 - 1, s: 1 }));
  const plan = planTerms(model, projRows, cmP, slP, tsP.latest, { ...o, firstPlanT, maxKey });

  // kritik zincir (planın başındaki kalan kalemlerle)
  const chain = plan.chain;
  let regularToTarget = 0;
  if (targetKey != null) for (let k = tkey(firstPlanT); k <= targetKey; k++) if (k % 3 !== 2) regularToTarget++;

  // STARS karşılaştırması
  const starsCheck = [];
  return {
    curKey, ipRows, entryKey, maxKey, targetKey, firstPlanKey: tkey(firstPlanT),
    now: { per: ts.per, cg: cgNow, st: standing(cgNow), slots, unassigned, doneCr, ipCr, wUsed, cm },
    proj: { per: tsP.per, cg: cgProj, st: standing(cgProj), slots: slP },
    need, plan, chain, regularToTarget, starsCheck,
    risks: buildRisks(model, { rows, cm, slots, unassigned, cgNow, cgProj, wUsed, curKey, plan, chain, targetKey, regularToTarget, maxKey, firstPlanT }),
  };
}

export function compareStars(per, summary) {
  const out = [];
  for (const s of summary) {
    if (isNaN(s.gpa)) continue;
    const p = per.find(x => x.k === s.k);
    if (!p || !p.graded) { out.push({ t: s.t, ok: false, msg: "Bu dönem transkriptte yok" }); continue; }
    const okG = r2(p.gpa) === r2(s.gpa), okC = isNaN(s.cgpa) || r2(p.cgpa) === r2(s.cgpa);
    out.push({ t: s.t, ok: okG && okC, mine: { gpa: r2(p.gpa), cgpa: r2(p.cgpa) }, stars: { gpa: s.gpa, cgpa: s.cgpa } });
  }
  return out;
}

function planTerms(model, rows, cm, slots, latest0, o) {
  const g = o.g;
  const latest = new Map(latest0);
  const attempted = new Set(rows.map(r => r.code));
  const passed = new Set([...cm.values()].filter(c => c.status === "done").map(c => c.code));
  const has = c => passed.has(c);

  const items = [];
  for (const s of slots) {
    if (s.status === "done") continue;
    if (s.kind === "elec") {
      if (s.course && s.status === "failed") items.push({ id: "S" + s.i, kind: "elec", code: s.course.code, label: s.course.code, cat: s.cat, cr: s.course.cr || s.cr, preNode: null, summer: "duzensiz", repeat: true, mustRetake: false, order: s.order });
      else items.push({ id: "S" + s.i, kind: "elec", code: null, label: model.cats[s.cat] ? model.cats[s.cat].short : s.cat, cat: s.cat, cr: s.cr, preNode: s.preNode, pre: s.pre, summer: "duzensiz", repeat: false, mustRetake: false, order: s.order });
    } else {
      items.push({ id: s.code, kind: s.kind, code: s.code, label: s.code, name: s.name, cr: s.cr, preNode: s.preNode, pre: s.pre, summer: s.summer, repeat: attempted.has(s.code), mustRetake: s.status === "failed", order: s.order });
    }
  }

  // kritik yol derinliği: bu kalemden sonra sırayla alınması gereken en uzun ders zinciri
  const deps = new Map(items.map(it => [it.id, []]));
  for (const it of items) for (const c of preCodes(it.preNode)) { const src = items.find(x => x.code === c); if (src) deps.get(src.id).push(it); }
  const depth = new Map();
  const dfs = it => { if (depth.has(it.id)) return depth.get(it.id); depth.set(it.id, 1); const d = 1 + Math.max(0, ...deps.get(it.id).map(dfs)); depth.set(it.id, d); return d; };
  items.forEach(dfs);
  let chain = [];
  if (items.length) {
    let cur = items.reduce((a, b) => (depth.get(b.id) > depth.get(a.id) || (depth.get(b.id) === depth.get(a.id) && b.order < a.order) ? b : a));
    while (cur) { chain.push(cur.label); const nx = deps.get(cur.id).sort((a, b) => depth.get(b.id) - depth.get(a.id))[0]; cur = nx && depth.get(nx.id) === depth.get(cur.id) - 1 ? nx : null; }
  }

  const remaining = [...items];
  const terms = [];
  let t = o.firstPlanT, idle = 0;
  const newCap = model.nominal * RULES.probationNewShare;
  while ((remaining.length || (cgpaOf(latest) ?? 4) < RULES.gradCgpa - 1e-9) && tkey(t) <= o.maxKey + 1) {
    const summer = t.s === 2;
    if (summer && !o.summers) { t = tnext(t); continue; }
    const cgStart = cgpaOf(latest), st = summer ? "yaz" : standing(cgStart);
    const seasonOk = it => it.kind === "intern" ? summer : !summer || it.summer === "evet" || (it.summer === "duzensiz" && o.irregular);
    const elig = remaining.filter(it => seasonOk(it) && evalPre(it.preNode, has))
      .sort((a, b) => (b.mustRetake - a.mustRetake) || (depth.get(b.id) - depth.get(a.id)) || ((a.kind === "elec") - (b.kind === "elec")) || (a.order - b.order));
    const picked = []; let cr = 0, newCr = 0, newElec = 0, count = 0;
    for (const it of elig) {
      if (it.kind === "intern") { picked.push({ it, tag: "staj" }); continue; }
      if (summer) { if (count >= RULES.summerMaxCourses) continue; picked.push({ it, tag: it.repeat ? "tekrar" : "yeni" }); count++; cr += it.cr; continue; }
      if (cr + it.cr > o.maxCr) continue;
      if (!it.repeat && it.cr > 0) {
        if (st === "U") { if (it.kind !== "elec" || newElec >= RULES.unsatNewElectives) continue; newElec++; }
        else if (st === "P" && newCr + it.cr > newCap + 1e-9) continue;
        newCr += it.cr;
      }
      picked.push({ it, tag: it.repeat ? "tekrar" : "yeni" }); cr += it.cr;
    }
    const improves = [];
    if (!summer && st !== "S") {
      const cand = [...latest.entries()].filter(([code, v]) => !code.startsWith("#") && v.cr > 0 && v.pts > 0 && v.pts <= RULES.improveMaxPts && g > v.pts && !picked.some(p => p.it.code === code))
        .sort((a, b) => (g - b[1].pts) * b[1].cr - (g - a[1].pts) * a[1].cr);
      for (const [code, v] of cand) { if (cr + v.cr > o.maxCr) continue; improves.push({ code, cr: v.cr, from: v.grade }); cr += v.cr; }
    }
    if (!picked.length && !improves.length) {
      if (!summer && ++idle >= 2) break;
      t = tnext(t); continue;
    }
    idle = 0;
    for (const { it } of picked) {
      const i = remaining.indexOf(it); remaining.splice(i, 1);
      if (it.kind === "intern") { passed.add(it.code); continue; }
      latest.set(it.code || "#" + it.id, { cr: it.cr, pts: g, grade: letterFor(g) });
      if (it.code) { passed.add(it.code); attempted.add(it.code); }
    }
    for (const im of improves) latest.set(im.code, { cr: im.cr, pts: g, grade: letterFor(g) });
    terms.push({ t, k: tkey(t), summer, st, cgStart, cgEnd: cgpaOf(latest), cr, picked, improves, newCap: st === "P" ? newCap : null });
    t = tnext(t);
  }
  const done = remaining.length === 0 && (cgpaOf(latest) ?? 0) >= RULES.gradCgpa - 1e-9;
  return { terms, done, remaining, gradKey: done && terms.length ? terms[terms.length - 1].k : null, finalCg: cgpaOf(latest), chain, chainLen: chain.length };
}

function buildRisks(model, x) {
  const R = [];
  const left = RULES.wLimit - x.wUsed;
  R.push({ sev: left <= 0 ? "crit" : left === 1 ? "warn" : "ok", title: `W hakkı: ${x.wUsed}/${RULES.wLimit} kullanıldı`,
    body: left <= 0 ? "Artık hiçbir dersten çekilemezsin (Md. 4.10)." : left === 1 ? "Sadece 1 W hakkın kaldı. Bir dersi bırakmadan önce bunu hesaba kat (Md. 4.10)." : `${left} W hakkın var (Md. 4.10).` });

  const wOnRepeat = [...x.cm.values()].filter(c => !c.ip && c.attempts.some((a, i) => a.grade === "W" && c.attempts.slice(0, i).some(b => isGraded(b.grade))));
  if (wOnRepeat.length) R.push({ sev: "info", title: "Tekrarda W eski notu silmez",
    body: wOnRepeat.map(c => `${c.code}: ${c.last ? c.last.grade : "-"} hâlâ ortalamada`).join(" · ") + " (Md. 4.11)." });

  const stP = standing(x.cgProj);
  if (x.curKey != null && x.cgProj != null) {
    const nextLabel = tlabel(x.firstPlanT.s === 2 ? tnext(x.firstPlanT) : x.firstPlanT);
    if (stP === "U") R.push({ sev: "crit", title: `Bu notlarla ${nextLabel} başarısız durumda başlar`,
      body: "Yeni zorunlu ders alamazsın: sadece tekrar dersleri ve 1 yeni seçmeli (Md. 4.18). Yaz okulunda bu sınır yok, en fazla 2 ders (Md. 4.2)." });
    else if (stP === "P") R.push({ sev: "warn", title: `Bu notlarla ${nextLabel} sınamalı başlar`,
      body: `Yeni ders kredin en fazla ${r2(model.nominal * RULES.probationNewShare)} olur (nominal ${model.nominal} kredinin %60'ı, Md. 4.18). Tekrar dersleri bu sınıra girmez.` });
    else R.push({ sev: "ok", title: `Bu notlarla ${nextLabel} normal durumda başlar`, body: "Yeni ders sınırlaması kalkar; tam yükle ilerleyebilirsin." });
  }

  const failedReq = x.slots.filter(s => s.code && s.status === "failed");
  if (failedReq.length) R.push({ sev: "warn", title: "Tekrar alınması zorunlu dersler",
    body: failedReq.map(s => s.code).join(", ") + ": takip eden iki yarıyıl içinde tekrar almalısın (Md. 4.21)." });
  const failedEl = x.slots.filter(s => s.kind === "elec" && s.status === "failed");
  if (failedEl.length) R.push({ sev: "info", title: "Başarısız seçmeli",
    body: failedEl.map(s => s.course.code).join(", ") + ": aynı dersi tekrar alabilir ya da aynı seçmeli kümesinden başka bir dersle notunu değiştirebilirsin (Md. 4.21)." });

  if (x.chain.length && x.targetKey != null) {
    const slack = x.regularToTarget - x.chain.length;
    R.push({ sev: slack < 0 ? "crit" : slack === 0 ? "warn" : "ok", title: `Kritik ders zinciri: ${x.chain.length} dönem`,
      body: `${x.chain.join(" → ")}. Hedefe kadar ${x.regularToTarget} normal dönem var; ` + (slack < 0 ? "zincir sığmıyor, yaz okulu şart." : slack === 0 ? "hiç payın yok: bu zincirde tek bir F ya da W hedefi bir dönem kaydırır." : `${slack} dönem payın var.`) });
  }
  const p = x.plan;
  if (x.targetKey != null) {
    if (!p.done) R.push({ sev: "crit", title: "Bu varsayımlarla mezuniyet görünmüyor", body: `Azami süre (${tlabel(fromKey(x.maxKey))}, Md. 3.3) içinde tüm dersler ve 2.00 CGPA tamamlanamıyor. Gelecek not ortalaması varsayımını ya da dönem yükünü değiştirip tekrar bak.` });
    else if (p.gradKey > x.targetKey) R.push({ sev: "crit", title: `Hedef tutmuyor: en erken ${tlabel(fromKey(p.gradKey))}`, body: `Hedefin ${tlabel(fromKey(x.targetKey))}. Yaz okullarını açmak, dönem yükünü artırmak ya da bu dönemki notları yükseltmek planı öne çeker.` });
    else R.push({ sev: "ok", title: `Hedef tutuyor: ${tlabel(fromKey(p.gradKey))}`, body: `Bu varsayımlarla ${tlabel(fromKey(x.targetKey))} hedefine ulaşıyorsun.` });
  }
  if (x.unassigned.length) R.push({ sev: "info", title: "Müfredata yerleşmeyen dersler", body: x.unassigned.map(c => c.code).join(", ") + ": seçmeli kalemlerinin hepsi dolu. Bu dersler ortalamaya girer ama kredi saymaz." });
  return R;
}
