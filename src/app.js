// Planlayıcı arayüzü (tasarım prototipindeki 7 ekran). Hesapların hepsi engine.js'te; burası sadece çizer.
// Kullanıcının transkripti ve seçimleri yalnızca localStorage'da (main.js) durur, dışarı gönderilmez.
import * as E from "./engine.js";
import { ORNEK_TRANSKRIPT } from "./ornek.js";
import { loadState, saveState, clearState } from "./main.js";

const DATA_URL = "data/man/2024.json";
const GRADES = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F", "W"];
const FUTURE = [["3.00", "B"], ["2.70", "B-"], ["2.30", "C+"], ["2.00", "C"], ["1.70", "C-"]];
const DEPT = new Set(["Marketing Elective", "Finance Elective", "Unrestricted Major Elective"]);
const CORE = new Set(["Social Science Core Elective", "Arts Core Elective", "Science Core Elective"]);
const ROUTES = ["pano", "dersler", "senaryo", "gpa", "baslangic", "transkript", "secmeli"];
const TAB_OF = { pano: "pano", dersler: "dersler", transkript: "dersler", secmeli: "dersler", senaryo: "senaryo", gpa: "gpa", baslangic: "" };

const STARS_PROMPT = `Açık olan Bilkent STARS sekmesinde sadece okuma yap; hiçbir şeye kaydet/gönder/onayla tıklama, ders ekleme-bırakma yapma, hesabımda hiçbir ayarı değiştirme.

1) Transkript sayfasını aç ve tüm dönemlerdeki dersleri şu CSV formatında ver, tek bir kod bloğu içinde:
donem,ders_kodu,ders_adi,kredi,harf_notu
Örnek: 2024-2025 Fall,MAN 101,Introduction to Business I,3,B+
- W, FX/FZ, S/U gibi notları sayfada nasıl yazıyorsa öyle yaz.
- Tekrar alınmış derslerin her denemesini ayrı satır olarak yaz.
- Şu an devam eden dönemin derslerini harf_notu boş olarak ekle.

2) Her dönem için sayfada görünen dönem GPA'sını, toplam krediyi ve kümülatif CGPA'yı ayrı bir CSV olarak ver:
donem,donem_gpa,donem_kredisi,cgpa,akademik_durum

Ad, soyad ve öğrenci numarasını sonuca koyma.`;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = x => (x == null || isNaN(x) ? "–" : E.r2(x).toFixed(2));
const pill = (t, c, title) => `<span class="pill ${c}"${title ? ` title="${esc(title)}"` : ""}>${esc(t)}</span>`;
const lbl = k => (k == null ? "–" : E.tlabel(E.fromKey(k)));
const ST_PILL = { S: "p-green", P: "p-amber", U: "p-red" };
const stPill = st => pill(E.STANDING_LABEL[st], ST_PILL[st]);

let model = null;
let state = null;                       // { transcript, opts, whatIf } ya da null (örnek öğrenci)
let view = { opts: {}, whatIf: {} };
let ui = { filter: "Tümü", sc: "W", scCourse: null, draft: null, elFilter: "Tümü", elective: null, flash: "" };
let A = null, P = null;                 // son analiz ve ayrıştırma

// ---------- veri ----------
function persist() { if (state) { state.opts = view.opts; state.whatIf = view.whatIf; saveState(state); } }
function optsFor(whatIf) {
  const o = view.opts;
  return { whatIf, g: +(o.g || 2.3), maxCr: +(o.maxCr || 19), summers: o.summers !== false, irregular: !!o.irregular, target: o.target != null ? +o.target : null };
}
function compute() {
  P = E.parseTranscript(state?.transcript || ORNEK_TRANSKRIPT);
  A = P.rows.length ? E.analyze(model, P.rows, optsFor(view.whatIf)) : null;
}
const targetCgpa = () => +(view.opts.targetCgpa || 2.5);
function kindOfSlot(s) { return s.kind !== "elec" ? "Z" : DEPT.has(s.cat) ? "S" : "F"; }
const TYPE = { Z: ["Zorunlu", "p-blue"], S: ["Bölüm seçmelisi", "p-purple"], F: ["Çekirdek / genel", "p-teal"], R: ["Tekrar", "p-amber"], X: ["Müfredat dışı", "p-gray"] };

// ---------- ortak parçalar ----------
function sampleBanner() {
  if (state) return "";
  return `<div class="sample"><span><b>Örnek öğrenci gösteriliyor.</b> <span class="muted">Bu notlar uydurma. Kendi STARS transkriptini yapıştırınca her şey sana göre hesaplanır.</span></span><a class="btn primary" href="#transkript">Transkriptimi ekle</a></div>`;
}
const bar = (l, d, t, col, soft) => `<div class="bar"><div class="r"><span>${l}</span><span class="muted num">${d} / ${t}</span></div><div class="track" style="background:var(${soft})"><i style="width:${t ? Math.round((d / t) * 100) : 0}%;background:var(${col})"></i></div></div>`;
function reqBars(a) {
  const g = { Z: [0, 0], S: [0, 0], C: [0, 0], G: [0, 0] };
  for (const s of a.now.slots) {
    const k = s.kind !== "elec" ? "Z" : DEPT.has(s.cat) ? "S" : CORE.has(s.cat) ? "C" : "G";
    g[k][1]++; if (s.status === "done") g[k][0]++;
  }
  return bar("Zorunlu dersler", ...g.Z, "--blue", "--blue-soft") + bar("Bölüm seçmelileri", ...g.S, "--purple", "--purple-soft") + bar("Çekirdek seçmeliler", ...g.C, "--teal", "--teal-soft") + bar("Genel seçmeli", ...g.G, "--teal", "--teal-soft");
}
function riskList(a, limit) {
  const order = { crit: 0, warn: 1, info: 2, ok: 3 }, cls = { crit: "red", warn: "amber", ok: "green", info: "blue" };
  return [...a.risks].sort((x, y) => order[x.sev] - order[y.sev]).slice(0, limit || 99)
    .map(r => `<div class="risk ${cls[r.sev]}"><div><b>${esc(r.title)}</b><span>${esc(r.body)}</span></div></div>`).join("");
}
function slotPlanKey(plan, s) { const id = s.code || "S" + s.i; const t = plan.terms.find(t => t.picked.some(p => p.it.id === id)); return t ? t.k : null; }
function regularTermsUntil(a, k) { let n = 0; for (let i = a.firstPlanKey; i <= k; i++) if (i % 3 !== 2) n++; return n; }

// ---------- Yol haritası ----------
const V = {};
V.pano = a => {
  const n = a.now, left = n.slots.filter(s => s.status !== "done" && s.status !== "ip");
  const reqLeft = left.filter(s => s.kind !== "elec").length;
  const crit = a.risks.filter(r => r.sev === "crit").length, warn = a.risks.filter(r => r.sev === "warn").length;
  const pct = Math.round((n.doneCr / model.total) * 100);
  const top = [...a.risks].sort((x, y) => ({ crit: 0, warn: 1, info: 2, ok: 3 }[x.sev] - { crit: 0, warn: 1, info: 2, ok: 3 }[y.sev]))[0];
  const sub = a.targetKey != null ? `${lbl(a.targetKey)} hedefine ${regularTermsUntil(a, a.targetKey)} dönem var. ${top && top.sev !== "ok" ? esc(top.title) + "." : "Plan yolunda."}` : "";
  const cols = [];
  if (a.ipRows.length) {
    const cr = a.ipRows.reduce((s, r) => s + r.cr, 0);
    cols.push(`<div class="term now"><header><h3>${lbl(a.curKey)}</h3><span class="num" style="font-size:12px;font-weight:600;color:var(--faint)">${cr} kr</span></header>${pill("Şu an", "p-blue")}${a.ipRows.map(r => {
      const c = n.cm.get(r.code), slot = n.slots.find(s => s.course && s.course.code === r.code);
      const t = c && c.attempts.length > 1 ? "R" : slot ? kindOfSlot(slot) : "X";
      return chip(t, r.code, slot && slot.kind === "elec" ? (model.cats[slot.cat]?.name || r.name) : r.name, r.cr);
    }).join("")}</div>`);
  }
  for (const t of a.plan.terms) {
    const grad = t.k === a.plan.gradKey, late = a.targetKey != null && t.k > a.targetKey;
    const badge = grad ? pill("Mezuniyet", late ? "p-red" : "p-green") : t.summer ? pill("Yaz okulu", "p-gray") : t.st !== "S" ? stPill(t.st) : "";
    const rule = t.summer ? "En fazla 2 ders" : t.st === "U" ? "Yeni zorunlu ders yok: tekrar + 1 yeni seçmeli" : t.st === "P" ? `Yeni ders en fazla ${E.r2(t.newCap)} kredi` : "";
    cols.push(`<div class="term${t.summer ? " summer" : ""}${late ? " late" : ""}"><header><h3>${esc(E.tlabel(t.t))}</h3><span class="num" style="font-size:12px;font-weight:600;color:var(${t.cr > model.nominal ? "--amber" : "--faint"})">${t.cr} kr</span></header>${badge}${rule ? `<span class="rule">${rule}</span>` : ""}
      ${t.picked.map(({ it, tag }) => chip(tag === "tekrar" ? "R" : it.kind === "elec" ? (DEPT.has(it.cat) ? "S" : "F") : "Z", it.label, it.kind === "elec" && !it.code ? model.cats[it.cat]?.name : it.name || model.cats[it.cat]?.name || "", it.cr, tag === "staj" ? "staj" : "")).join("")}
      ${t.improves.map(im => chip("I", im.code, `Not yükseltme (şu an ${im.from})`, im.cr)).join("")}
      <span class="muted-sm">Dönem sonu CGPA ≈ ${f2(t.cgEnd)}</span></div>`);
  }
  const o = view.opts, tgtOpts = []; for (let k = a.firstPlanKey; k <= a.maxKey; k++) if (k % 3 !== 2) tgtOpts.push(k);
  const res = a.plan.done ? `En erken mezuniyet ${lbl(a.plan.gradKey)}` : "Azami süre içinde mezuniyet görünmüyor";
  const ok = a.plan.done && a.targetKey != null && a.plan.gradKey <= a.targetKey;
  return `${sampleBanner()}
<div class="head"><div><h1>Mezuniyet planın</h1><p class="sub">${sub}</p></div>
<div class="btns"><a class="btn" href="#transkript">${state ? "Transkripti güncelle" : "Transkript yükle"}</a><a class="btn primary" href="#senaryo">Senaryo dene</a></div></div>
<div class="stats">
 <div class="card stat"><span class="label">Tamamlanan kredi</span><div class="val num"><b>${n.doneCr}</b><span class="muted">/ ${model.total}</span></div>${pill(`%${pct} · ${model.total - n.doneCr} kredi kaldı`, "p-blue")}</div>
 <div class="card stat"><span class="label">CGPA</span><div class="val num"><b>${f2(n.cg)}</b></div>${stPill(n.st)}</div>
 <div class="card stat"><span class="label">Kalan dersler</span><div class="val num"><b>${left.length}</b><span class="muted">/ ${model.slots.length}</span></div>${pill(`${reqLeft} zorunlu · ${left.length - reqLeft} seçmeli`, "p-purple")}</div>
 <div class="card stat"><span class="label">Risk radarı</span><div class="val num"><b>${crit + warn}</b><span class="muted">uyarı</span></div>${crit ? pill(`${crit} kritik`, "p-red") : pill("Kritik risk yok", "p-green")}</div>
</div>
<section class="card" aria-labelledby="rm"><div class="head"><div><h2 id="rm">Dönem dönem yol haritası</h2><p class="sub" style="font-size:13px">${pill(res, ok ? "p-green" : "p-red")} Hedeften geriye planlandı; önkoşul zinciri en uzun dersler öne alınır.</p></div>
<div class="legend"><span><i style="background:var(--blue)"></i>Zorunlu</span><span><i style="background:var(--purple)"></i>Bölüm seçmelisi</span><span><i style="background:var(--amber)"></i>Tekrar / not yükseltme</span><span><i style="background:var(--teal)"></i>Çekirdek / genel</span></div></div>
<div class="ctrl">
 <div class="field"><label for="o-target">Hedef mezuniyet</label><select id="o-target" data-opt="target">${tgtOpts.map(k => `<option value="${k}"${k === a.targetKey ? " selected" : ""}>${lbl(k)}</option>`).join("")}</select></div>
 <div class="field"><label for="o-g">Gelecek derslerde ortalaman</label><select id="o-g" data-opt="g">${FUTURE.map(([v, l]) => `<option value="${v}"${(+o.g || 2.3).toFixed(2) === v ? " selected" : ""}>${l} (${v})</option>`).join("")}</select></div>
 <div class="field"><label for="o-cr">Dönem başına en fazla kredi</label><select id="o-cr" data-opt="maxCr">${[15, 16, 17, 18, 19, 20, 21].map(v => `<option${(+o.maxCr || 19) === v ? " selected" : ""}>${v}</option>`).join("")}</select></div>
 <div class="field"><label class="check"><input type="checkbox" data-opt="summers"${o.summers !== false ? " checked" : ""}> Yaz okuluna giderim</label><label class="check"><input type="checkbox" data-opt="irregular"${o.irregular ? " checked" : ""}> Her yıl açılmayan yaz derslerini de say</label></div>
</div>
<div class="scroller"><div class="terms">${cols.join("")}</div></div>
<p class="faint" style="margin:0;font-size:12px">Plan, gelecekteki tüm derslerden geçeceğini ve seçtiğin ortalamayı alacağını varsayar. Başarısız ya da sınamalı dönemlerde C- ve altı geçtiğin dersleri tekrar alıp notunu yükseltmeyi önerir.</p></section>
<div class="cols3">
 <section class="card"><h2>Risk radarı</h2>${riskList(a, 4)}</section>
 <section class="card"><h2>Ya şunları alırsam?</h2>${a.ipRows.length ? `
  <div class="big num"><span class="from">${f2(n.cg)}</span><span class="faint">→</span><span class="to" style="color:var(${(a.proj.cg ?? 0) >= 2 ? "--green" : "--danger"})">${f2(a.proj.cg)}</span></div>
  <p class="muted" style="margin:0">Bu dönemki notlarını <a href="#gpa">GPA hesabı</a> sekmesinde değiştir; plan ve tahmin birlikte güncellenir.</p>
  ${a.ipRows.map(r => `<div class="kv"><span>${esc(r.code)}</span><b class="num">${esc(view.whatIf[r.code] || "C")}</b></div>`).join("")}` : `<p class="muted" style="margin:0">Bu dönem notu girilmemiş ders yok.</p>`}
 </section>
 <section class="card"><h2>Kalan gereksinimler</h2>${reqBars(a)}<a class="btn" href="#dersler">Derslerimi gör →</a></section>
</div>
<p class="faint" style="margin:0;font-size:12px">Müfredat: Bilkent kataloğu, İşletme (22 Ekim 2026). Kurallar: Lisans ve Ön Lisans Eğitim-Öğretim Yönetmeliği.</p>`;
};
function chip(t, code, name, cr, extra) {
  return `<div class="chip ${t}"><div><div class="r"><b>${esc(code)}</b><span>${extra ? esc(extra) : cr ? cr + " kr" : ""}</span></div><span>${esc(name || "")}</span></div></div>`;
}

// ---------- Derslerim ----------
V.dersler = a => {
  const n = a.now;
  const slotOf = code => n.slots.find(s => s.course && s.course.code === code);
  const typeOf = code => { const s = slotOf(code); return s ? kindOfSlot(s) : "X"; };
  const statusOf = (r, c) => {
    if (r.grade === "") return ["Alıyor", "p-blue"];
    if (r.grade === "W") return ["W çekildi", "p-gray"];
    const later = c.attempts.some(x => x.k > r.k && x.grade !== "W");
    if (E.isPass(r.grade)) return later ? ["Tekrarlandı", "p-gray"] : ["Geçti", "p-green"];
    return later ? ["Tekrarlandı", "p-amber"] : ["Kaldı", "p-red"];
  };
  const row = (code, name, cr, ty, grade, st, tags) => `<div class="trow c6" data-row="${esc((code + " " + name).toLowerCase())}" data-tags="${tags}"><b>${esc(code)}</b><span>${esc(name)}</span><span class="muted num">${cr}</span>${pill(TYPE[ty][0], TYPE[ty][1])}<b class="num">${grade ? esc(grade) : '<span class="faint">—</span>'}</b>${pill(...st)}</div>`;
  const keys = [...new Set(P.rows.map(r => r.k))].sort((x, y) => x - y);
  let html = "";
  for (const k of keys) {
    const rs = P.rows.filter(r => r.k === k);
    const st = n.per.find(p => p.k === k);
    const meta = k === a.curKey ? `${rs.length} ders · bu dönem` : `${rs.length} ders${st && st.graded ? ` · GPA ${f2(st.gpa)} · CGPA ${f2(st.cgpa)}` : ""}`;
    html += `<div class="grp"><h3>${lbl(k)}</h3><span class="faint" style="font-size:12px">${meta}</span></div>`;
    html += rs.map(r => {
      const c = n.cm.get(r.code), ty = typeOf(r.code), status = statusOf(r, c);
      const tags = [ty === "Z" ? "Zorunlu" : ty === "X" ? "" : "Seçmeli", r.grade === "W" || c.attempts.length > 1 ? "Tekrar / W" : ""].join(" ");
      return row(r.code, r.name, r.cr, c.attempts.length > 1 && ty === "Z" && r.k === c.attempts[c.attempts.length - 1].k && c.attempts.length > 1 ? "R" : ty, r.grade, status, tags);
    }).join("");
  }
  const passed = new Set(n.slots.filter(s => s.status === "done" && s.course).map(s => s.course.code));
  const rest = n.slots.filter(s => s.status === "none" || (s.status === "failed" && !s.course))
    .sort((x, y) => (slotPlanKey(a.plan, x) ?? 1e9) - (slotPlanKey(a.plan, y) ?? 1e9) || x.order - y.order);
  html += `<div class="grp"><h3>Henüz alınmayanlar</h3><span class="faint" style="font-size:12px">${rest.filter(s => s.kind !== "elec").length} zorunlu · ${rest.filter(s => s.kind === "elec").length} seçmeli</span></div>`;
  html += rest.map(s => {
    const locked = !E.evalPre(s.preNode, c => passed.has(c));
    const pk = slotPlanKey(a.plan, s);
    const st = locked ? [pk != null ? `Önkoşul · ${lbl(pk)}` : "Önkoşul eksik", "p-amber", "Önkoşul: " + (s.pre || "")] : [pk != null ? `${lbl(pk)} planlı` : "Planda yok", pk != null ? "p-gray" : "p-red"];
    return row(s.code || model.cats[s.cat]?.short || s.cat, s.code ? s.name : model.cats[s.cat]?.name || s.cat, s.cr, kindOfSlot(s), "", st, `${s.kind === "elec" ? "Seçmeli" : "Zorunlu"} Kalan`);
  }).join("");
  const wNote = n.wUsed ? `<div class="note" style="background:var(--amber-soft)"><b>W hakkı: ${n.wUsed} / ${E.RULES.wLimit}</b><span class="muted">Tekrar alıp çekilirsen önceki not geçerli kalır (Md. 4.11).</span></div>` : "";
  const failed = n.slots.filter(s => s.code && s.status === "failed");
  const fNote = failed.length ? `<div class="note" style="background:var(--danger-soft)"><b>Tekrar alınması gereken: ${failed.map(s => s.code).join(", ")}</b><span class="muted">Takip eden iki yarıyıl içinde yeniden alınmalı (Md. 4.21).</span></div>` : "";
  return `${sampleBanner()}
<div class="head"><div><h1>Derslerim</h1><p class="sub">STARS transkriptindeki tüm dersler, her deneme ayrı satırda. Altta müfredatta kalanlar ve planlandıkları dönem.</p></div>
<div class="btns"><a class="btn" href="#transkript">STARS transkriptinden doldur</a><a class="btn" href="#secmeli">Seçmeli havuzu</a></div></div>
<div class="filters"><label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input id="q" placeholder="Ders kodu veya adı ara" aria-label="Ders ara"></label>
${["Tümü", "Zorunlu", "Seçmeli", "Kalan", "Tekrar / W"].map(f => `<button class="fchip" data-f="${f}" aria-pressed="${ui.filter === f}">${f}</button>`).join("")}</div>
<div class="split"><section class="card tbl" id="tbl"><div class="scrollx"><div class="trow c6 th"><span>Kod</span><span>Ders</span><span>Kredi</span><span>Tür</span><span>Not</span><span>Durum</span></div>${html}</div></section>
<aside class="side"><section class="card"><h2>Özet</h2><div class="val num" style="display:flex;gap:8px;align-items:baseline"><b style="font-size:30px">${n.doneCr}</b><span class="muted">/ ${model.total} kredi tamam</span></div>
${reqBars(a)}${wNote}${fNote}</section>
<section class="card"><h2>Transkriptten doldur</h2><a class="drop" href="#transkript" style="text-decoration:none;color:inherit"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="var(--blue)" stroke-width="2" stroke-linecap="round"/></svg><b>STARS transkriptini yapıştır</b><span class="faint" style="font-size:12px">Notların sadece bu tarayıcıda kalır</span></a></section></aside></div>`;
};

// ---------- Senaryolar ----------
V.senaryo = a => {
  if (!a.ipRows.length) return `<div class="head"><div><h1>Senaryolar</h1><p class="sub">Senaryo için bu dönem notu girilmemiş bir dersin olmalı.</p></div></div>`;
  const code = a.ipRows.some(r => r.code === ui.scCourse) ? ui.scCourse : a.ipRows[0].code;
  const cur = view.whatIf[code] || "C";
  const passGrade = E.isPass(cur) ? cur : "C";
  const scGrade = ui.sc === "W" ? "W" : ui.sc === "F" ? "F" : passGrade;
  const b = E.analyze(model, P.rows, optsFor({ ...view.whatIf, [code]: scGrade }));
  const wBase = a.now.wUsed + a.ipRows.filter(r => (view.whatIf[r.code] || "C") === "W").length;
  const wSc = a.now.wUsed + a.ipRows.filter(r => (r.code === code ? scGrade : view.whatIf[r.code] || "C") === "W").length;
  const peak = an => Math.max(0, ...an.plan.terms.filter(t => !t.summer).map(t => t.cr));
  const gk = x => x.plan.done ? x.plan.gradKey : Infinity;
  const shift = gk(b) - gk(a), shiftTerms = isFinite(shift) ? regularCount(a.plan.gradKey, b.plan.gradKey) : null;
  const badge = !b.plan.done ? ["Mezuniyet görünmüyor", "p-red"] : shift > 0 ? [`Mezuniyet ${shiftTerms || 1} dönem kayar`, "p-red"] : shift < 0 ? ["Mezuniyet öne gelir", "p-green"] : ["Mezuniyet değişmez", "p-gray"];
  const rows = [
    ["Mezuniyet", a.plan.done ? lbl(a.plan.gradKey) : "Görünmüyor", b.plan.done ? lbl(b.plan.gradKey) : "Görünmüyor", shift > 0 || !b.plan.done ? "--danger" : "--green"],
    ["Kullanılan W hakkı", `${wBase} / 4`, `${wSc} / 4`, wSc > wBase ? (wSc >= 4 ? "--danger" : "--amber") : "--text"],
    ["Dönem sonu CGPA", f2(a.proj.cg), f2(b.proj.cg), (b.proj.cg ?? 0) < (a.proj.cg ?? 0) ? "--danger" : (b.proj.cg ?? 0) > (a.proj.cg ?? 0) ? "--green" : "--text"],
    ["Gelecek dönem durumu", E.STANDING_LABEL[a.proj.st], E.STANDING_LABEL[b.proj.st], b.proj.st === "S" ? "--green" : b.proj.st === "P" ? "--amber" : "--danger"],
    ["En yoğun dönem", `${peak(a)} kredi`, `${peak(b)} kredi`, peak(b) > peak(a) ? "--amber" : "--text"],
  ];
  const prev = a.now.cm.get(code)?.last?.grade;
  const why = ui.sc === "W" ? `W ortalamaya girmez ve 4 W hakkından birini kullanır (Md. 4.10).${prev ? ` Daha önce aldığın ${prev} notu ortalamada kalır (Md. 4.11).` : ""}`
    : ui.sc === "F" ? `F ortalamaya 0.00 olarak girer${prev ? ` ve önceki ${prev} notunun yerine geçer` : ""}. Bu dersi takip eden iki yarıyıl içinde yeniden alman gerekir (Md. 4.21).`
    : `${code} ${passGrade} ile geçilirse zincirdeki sonraki ders bir sonraki dönem alınabilir.`;
  const chain = E.downstreamChain(model, code);
  const nodes = chain.map((c, i) => {
    const s0 = i === 0 ? a.curKey : E.plannedKey(a.plan, c), s1 = i === 0 ? (ui.sc === "P" ? a.curKey : E.plannedKey(b.plan, c)) : E.plannedKey(b.plan, c);
    const moved = s0 != null && s1 != null && s1 > s0, gone = s1 == null && i > 0;
    const nm = model.slots.find(s => s.code === c)?.name || a.ipRows.find(r => r.code === c)?.name || "";
    const when = i === 0 ? (ui.sc === "P" ? `<span style="color:var(--green)">${lbl(a.curKey)}</span>` : `<s>${lbl(a.curKey)}</s> <span style="color:var(--danger)">→ ${lbl(E.plannedKey(b.plan, c))}</span>`)
      : moved ? `<s>${lbl(s0)}</s> <span style="color:var(--danger)">→ ${lbl(s1)}</span>` : `<span style="color:var(--green)">${lbl(s1 ?? s0)}</span>`;
    const bad = i === 0 ? ui.sc !== "P" : moved || gone;
    return `${i ? '<span class="arrow">→</span>' : ""}<div class="n ${bad ? "bad" : "ok"}"><b>${esc(c)}</b><span class="muted" style="font-size:12px">${esc(nm)}</span><span style="font-size:12px;font-weight:600">${when}</span></div>`;
  }).join("");
  const anyShift = chain.slice(1).some(c => { const x = E.plannedKey(a.plan, c), y = E.plannedKey(b.plan, c); return x != null && y != null && y > x; });
  return `${sampleBanner()}
<div class="head"><div><h1>Senaryolar</h1><p class="sub">Bu dönemki bir dersten çekilirsen, kalırsan ya da geçersen mezuniyetin ve CGPA'n nasıl değişir?</p></div></div>
<div class="split l"><section class="card"><h2>Senaryo kur</h2>
<div class="field"><label for="sc-course">Ders</label><select id="sc-course">${a.ipRows.map(r => `<option value="${esc(r.code)}"${r.code === code ? " selected" : ""}>${esc(r.code)} · ${esc(r.name)}</option>`).join("")}</select></div>
<div class="field"><label>Ne olursa?</label><div class="seg">${[["W", "W çekersem"], ["F", "Kalırsam (F)"], ["P", `Geçersem (${passGrade})`]].map(([k, l]) => `<button data-sc="${k}" aria-pressed="${ui.sc === k}">${l}</button>`).join("")}</div></div>
<div class="note" style="background:var(--blue-soft)"><b style="color:var(--blue)">Kural hatırlatma</b><span class="muted">W notu GPA'ye girmez, lisansta en fazla 4 dersten çekilebilirsin (Md. 4.10). Tekrar alıp çekilirsen önceki not geçerli olur (Md. 4.11). Kalınan ders takip eden iki dönem içinde yeniden alınmalı (Md. 4.21).</span></div>
<p class="faint" style="margin:0;font-size:12px">Diğer derslerin notları GPA hesabı sekmesindeki seçimlerinden gelir.</p></section>
<div class="view" style="gap:20px"><section class="card" style="padding:0;gap:0;overflow:hidden"><div class="head" style="padding:16px 20px;border-bottom:1px solid var(--border);align-items:center"><h2>${esc(code)}: ${ui.sc === "W" ? "W çekersen" : ui.sc === "F" ? "kalırsan (F)" : `${passGrade} ile geçersen`}</h2>${pill(...badge)}</div>
<div class="cmp"><div><span class="faint" style="font-size:12px;font-weight:600">ŞU ANKİ PLAN</span><dl style="margin:0;display:grid;gap:12px">${rows.map(r => `<div><dt>${r[0]}</dt><dd class="num">${esc(r[1])}</dd></div>`).join("")}</dl></div>
<div><span class="faint" style="font-size:12px;font-weight:600">BU SENARYODA</span><dl style="margin:0;display:grid;gap:12px">${rows.map(r => `<div><dt>${r[0]}</dt><dd class="num" style="color:var(${r[3]})">${esc(r[2])}</dd></div>`).join("")}</dl></div></div>
<p class="muted" style="margin:0;padding:12px 20px 16px;border-top:1px solid var(--border);font-size:13px">${esc(why)}</p></section>
${chain.length > 1 ? `<section class="card"><div class="head" style="align-items:center"><h2>Önkoşul zinciri</h2><span class="faint" style="font-size:12px">${anyShift ? "Kayan dersler kırmızı" : "Zincirde kayan ders yok"}</span></div>
<div class="chain">${nodes}</div>
${anyShift && ui.sc !== "P" ? `<div class="note" style="background:var(--green-soft)"><b>Öneri: mümkünse dersi bitir</b><span class="muted">${esc(code)}'i D ve üstüyle geçersen zincir kaymaz.</span></div>` : ""}</section>` : ""}
</div></div>`;
};
function regularCount(k0, k1) { let n = 0; for (let k = k0 + 1; k <= k1; k++) if (k % 3 !== 2) n++; return n; }

// ---------- GPA hesabı ----------
V.gpa = a => {
  const n = a.now;
  const term = a.proj.per.find(p => p.k === a.curKey);
  const T = targetCgpa();
  // hedef CGPA için kalan derslerde gereken ortalama
  const after = a.proj, left = after.slots.filter(s => s.status !== "done");
  let C = 0, Pt = 0; for (const p of after.per) { /* son CGPA */ }
  const last = after.per[after.per.length - 1];
  C = last ? last.ccr : 0; Pt = last && last.cgpa != null ? last.cgpa * last.ccr : 0;
  const newCr = left.filter(s => s.status === "none").reduce((x, s) => x + s.cr, 0);
  const failCr = left.filter(s => s.status === "failed").reduce((x, s) => x + (s.course?.cr || s.cr), 0);
  const need = newCr + failCr ? (T * (C + newCr) - Pt) / (newCr + failCr) : null;
  const pos = v => Math.max(0, Math.min(100, (v / 4) * 100));
  const delta = (after.cg ?? 0) - (n.cg ?? 0);
  const passCr = a.ipRows.filter(r => E.isPass(view.whatIf[r.code] || "C")).reduce((x, r) => x + r.cr, 0);
  return `${sampleBanner()}
<div class="head"><div><h1>Ya şunları alırsam?</h1><p class="sub">Bu dönemki derslerine tahmini not ver; CGPA'n, akademik durumun ve planın birlikte güncellenir.</p></div><div class="btns"><button class="btn" data-act="reset">Hepsini C yap</button></div></div>
<div class="split wide"><section class="card" style="padding:0;gap:0"><div class="head" style="padding:18px 20px 12px;align-items:center"><h2>${a.curKey != null ? lbl(a.curKey) + " dersleri" : "Bu dönem"}</h2><span class="faint" style="font-size:13px;font-weight:600">${a.ipRows.reduce((x, r) => x + r.cr, 0)} kredi</span></div>
${a.ipRows.length ? a.ipRows.map(r => {
    const c = n.cm.get(r.code), prev = c?.last?.grade, sel = view.whatIf[r.code] || "C";
    return `<div style="display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;padding:13px 20px;border-top:1px solid var(--border)"><div style="min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(r.code)}</b><span class="faint" style="font-size:12px;font-weight:600">${r.cr} kr</span>${c && c.attempts.length > 1 ? pill("Tekrar", "p-amber") : ""}</div><span class="muted" style="font-size:12px">${esc(r.name)}${prev ? ` · önceki: ${esc(prev)}` : ""}</span></div>
<div class="grades" role="group" aria-label="${esc(r.code)} notu">${GRADES.map(x => `<button data-g="${esc(r.code)}" data-v="${x}" aria-pressed="${sel === x}">${x}</button>`).join("")}</div></div>`;
  }).join("") : `<p class="grp-empty">Bu dönem notu girilmemiş ders yok.</p>`}</section>
<aside class="side"><section class="card navy-card"><span class="lbl">DÖNEM SONU TAHMİNİ</span>
<div class="big num"><span class="from" style="color:var(--navy-sub)">${f2(n.cg)}</span><span style="color:var(--navy-sub)">→</span><span class="to">${f2(after.cg)}</span></div>
${pill(`${delta >= 0 ? "+" : ""}${delta.toFixed(2)} · gelecek dönem ${E.STANDING_LABEL[after.st].toLowerCase()}`, ST_PILL[after.st])}
<div style="display:flex;gap:24px;flex-wrap:wrap">${[["Dönem GPA", f2(term?.gpa)], ["Toplam kredi", `${n.doneCr + passCr} / ${model.total}`], ["Onur listesi", term && term.gpa >= 3.5 ? "Yüksek onur" : term && term.gpa >= 3 ? "Onur" : "3.00 gerek"]].map(([x, y]) => `<div><div class="lbl">${x}</div><b style="font-size:16px" class="num">${y}</b></div>`).join("")}</div></section>
<section class="card"><h2>Eşiklere göre neredesin?</h2>
<div style="position:relative;height:58px;margin:0 6px" aria-hidden="true"><span style="position:absolute;left:${pos(T)}%;top:0;transform:translateX(-50%);font-size:11px;font-weight:600;white-space:nowrap;color:var(--danger)">Hedef ${T.toFixed(2)}</span>
<div class="track" style="position:absolute;top:24px;left:0;right:0"><i style="width:${pos(after.cg ?? 0)}%"></i></div>
${[[1.8, "1.80", "-100%", "--faint"], [2, "2.00", "0", "--faint"], [T, "", "", "--danger"]].map(([v, l, tx, c]) => `<span style="position:absolute;left:${pos(v)}%;top:18px;width:2px;height:18px;background:var(${c})"></span>${l ? `<span style="position:absolute;left:${pos(v)}%;top:40px;transform:translateX(${tx});padding:0 3px;font-size:11px;font-weight:600;white-space:nowrap;color:var(${c})">${l}</span>` : ""}`).join("")}
<span style="position:absolute;left:calc(${pos(after.cg ?? 0)}% - 8px);top:20px;width:16px;height:16px;border-radius:50%;background:var(--surface);border:3px solid var(--blue)"></span></div>
<div class="field"><label>Hedef CGPA</label><div class="opts">${["2.00", "2.50", "3.00", "3.50"].map(v => `<button type="button" class="opt" data-tcg="${v}" aria-pressed="${T.toFixed(2) === v}">${v}</button>`).join("")}</div></div>
<div class="note" style="background:var(${need != null && need > 3.4 ? "--danger-soft" : "--amber-soft"})"><b>Hedef ${T.toFixed(2)} için</b><span class="muted">${need == null ? "Kalan ders yok." : need <= 0 ? "Hedefin garanti; kalan derslerden geçmen yeterli." : need > 4 ? "Kalan derslerin hepsinden A alsan bile bu hedefe ulaşılamıyor." : `Bu dönemden sonra kalan derslerde ortalama ${need.toFixed(2)} (≈ ${E.letterFor(need)}) gerekli.`} Mezuniyet için en az 2.00 gerekir.</span></div></section>
<section class="card" style="gap:6px"><h3>Hesaplama kuralları</h3>${["Tekrarlanan derste son alınan not geçerli olur (Md. 4.13).", "W ve S notları GPA'ye girmez; lisansta en fazla 4 W (Md. 4.10).", "Tekrar alıp çekilirsen önceki not geçerli sayılır (Md. 4.11).", "CGPA 1.80-1.99 sınamalı, altı başarısız; mezuniyet için en az 2.00, azami süre 7 yıl."].map(s => `<span class="muted" style="font-size:12px">• ${s}</span>`).join("")}</section></aside></div>
<section class="card trend" id="trend"></section>`;
};
function trend(a, width) {
  const pts = a.now.per.filter(p => p.graded);
  if (!pts.length) return "";
  const proj = a.ipRows.length ? { t: E.fromKey(a.curKey), cg: a.proj.cg } : null;
  const n = pts.length + (proj ? 1 : 0);
  const W = Math.max(520, Math.round(width)), H = 230, L = 40, R = 16, T = 16, B = 34;
  const x = i => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = v => T + (1 - v / 4) * (H - T - B);
  const grid = [0, 1, 2, 3, 4].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`).join("");
  const thr = [[2, "2.00 mezuniyet"], [1.8, "1.80 sınamalı"]].map(([v, l], i) => `<line class="thr t${i}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="thr-l t${i}" x="${L + 6}" y="${y(v) + (i ? 13 : -5)}">${l}</text>`).join("");
  const dots = pts.map((p, i) => `<circle class="gpa" cx="${x(i)}" cy="${y(p.gpa)}" r="3.5"><title>${E.tlabel(p.t)} dönem GPA ${f2(p.gpa)}</title></circle><circle class="cg" cx="${x(i)}" cy="${y(p.cgpa)}" r="4.5"><title>${E.tlabel(p.t)} CGPA ${f2(p.cgpa)}</title></circle><text class="ax" x="${x(i)}" y="${H - 12}" text-anchor="middle">${E.tshort(p.t)}</text>`).join("");
  const last = pts[pts.length - 1];
  const projSvg = proj ? `<line class="proj" x1="${x(pts.length - 1)}" y1="${y(last.cgpa)}" x2="${x(pts.length)}" y2="${y(proj.cg)}"/><circle class="cg proj-dot" cx="${x(pts.length)}" cy="${y(proj.cg)}" r="5"/><text class="val" x="${x(pts.length)}" y="${y(proj.cg) - 10}" text-anchor="middle">${f2(proj.cg)}</text><text class="ax" x="${x(pts.length)}" y="${H - 12}" text-anchor="middle">${E.tshort(proj.t)}?</text>` : "";
  return `<div class="head" style="align-items:center"><h2>CGPA gidişatı</h2><div class="legend"><span><i style="background:var(--blue)"></i>CGPA</span><span><i style="background:var(--faint)"></i>Dönem GPA</span>${proj ? `<span><i style="background:transparent;border:2px solid var(--blue)"></i>Bu dönem, seçtiğin notlarla</span>` : ""}</div></div>
<div class="scrollx"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dönemlere göre CGPA">${grid}${thr}<polyline class="cgl" points="${pts.map((p, i) => `${x(i)},${y(p.cgpa)}`).join(" ")}"/>${dots}<text class="val" x="${x(pts.length - 1)}" y="${y(last.cgpa) - 10}" text-anchor="middle">${f2(last.cgpa)}</text>${projSvg}</svg></div>`;
}

// ---------- Ayarlar / başlangıç ----------
V.baslangic = a => {
  const o = view.opts, opts = []; for (let k = a.firstPlanKey; k <= a.maxKey; k++) if (k % 3 !== 2) opts.push(k);
  return `<div class="ob view"><div style="text-align:center;display:grid;gap:8px;justify-items:center"><span class="mark" style="background:var(--navy)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4 2 9l10 5 10-5-10-5z" fill="#fff"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" stroke="#fff" stroke-width="2"/></svg></span><h1>${state ? "Hedefin ve ayarların" : "Hoş geldin"}</h1><p class="sub" style="margin:0">Hedefini seç, mezuniyete kadar planı birlikte çıkaralım.</p></div>
<div class="card" style="padding:28px;gap:20px">
<div class="two"><div class="field"><label for="ob-dep">Bölüm</label><select id="ob-dep"><option>İşletme (MAN)</option><option disabled>Diğer bölümler yakında</option></select></div><div class="field"><label for="ob-cat">Katalog yılı</label><select id="ob-cat"><option>2024 ve sonrası</option></select></div></div>
<div class="field"><label>Hedef mezuniyet dönemi</label><div class="opts">${opts.slice(0, 8).map(k => `<button type="button" class="opt" data-tgt="${k}" aria-pressed="${k === a.targetKey}">${lbl(k)}</button>`).join("")}</div></div>
<div class="field"><label>Hedef CGPA</label><div class="opts">${["2.00", "2.50", "3.00", "3.50"].map(v => `<button type="button" class="opt" data-tcg="${v}" aria-pressed="${targetCgpa().toFixed(2) === v}">${v}</button>`).join("")}</div><span class="faint" style="font-size:12px">Mezuniyet için en az 2.00. Dönem ortalaması 3.00 ve üstü onur, 3.50 ve üstü yüksek onur listesi.</span></div>
<div class="two"><div class="field"><label for="ob-g">Gelecek derslerde beklediğin ortalama</label><select id="ob-g" data-opt="g">${FUTURE.map(([v, l]) => `<option value="${v}"${(+o.g || 2.3).toFixed(2) === v ? " selected" : ""}>${l} (${v})</option>`).join("")}</select></div>
<div class="field"><label for="ob-cr">Dönem başına en fazla kredi</label><select id="ob-cr" data-opt="maxCr">${[15, 16, 17, 18, 19, 20, 21].map(v => `<option${(+o.maxCr || 19) === v ? " selected" : ""}>${v}</option>`).join("")}</select></div></div>
<div class="head" style="border-top:1px solid var(--border);padding-top:16px;align-items:center">${state ? `<button class="btn" data-act="clear">Verilerimi sil</button>` : `<a class="btn" href="#pano">Geri</a>`}<a class="btn primary" href="${state ? "#pano" : "#transkript"}">${state ? "Planı gör →" : "Devam: transkriptini ekle →"}</a></div>
<p id="confirm" class="note" style="background:var(--danger-soft)" hidden><b>Transkriptin ve seçimlerin bu tarayıcıdan silinecek.</b><span><button class="btn" data-act="do-clear" style="border-color:var(--danger);color:var(--danger)">Evet, sil</button></span></p>
</div></div>`;
};

// ---------- Transkript ----------
V.transkript = () => {
  const text = ui.draft ?? state?.transcript ?? "";
  const p = text ? E.parseTranscript(text) : { rows: [], summary: [], warnings: [] };
  let preview = "";
  if (p.rows.length) {
    const a = E.analyze(model, p.rows, optsFor({}));
    const stars = E.compareStars(a.now.per, p.summary);
    const place = r => { const s = a.now.slots.find(s => s.course && s.course.code === r.code); return s ? `${s.yil}. yıl ${s.donem === "Fall" ? "Güz" : "Bahar"} · ${s.kind === "elec" ? (model.cats[s.cat]?.name || "seçmeli") : "zorunlu"}` : "Müfredata yerleşmedi"; };
    const stOf = r => { const s = a.now.slots.find(s => s.course && s.course.code === r.code); if (r.grade === "W") return ["W sayıldı", "p-amber"]; if (r.grade === "") return ["Devam ediyor", "p-blue"]; if (r.grade === "S") return ["Kredi sayılır, GPA'ye girmez", "p-amber"]; return s ? ["✓ Eşleşti", "p-green"] : ["Kontrol et", "p-amber"]; };
    const unmatched = p.rows.filter(r => stOf(r)[1] === "p-amber" && stOf(r)[0] === "Kontrol et").length;
    const okStars = stars.filter(s => s.ok).length;
    preview = `<div class="card" style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:14px 16px"><div style="flex:1;min-width:180px"><b>${p.rows.length} satır okundu</b><div class="muted" style="font-size:12px">${new Set(p.rows.map(r => r.k)).size} dönem · CGPA ${f2(a.now.cg)}</div></div>
${pill(`${p.rows.length - unmatched} eşleşti`, "p-green")}${unmatched ? pill(`${unmatched} kontrol et`, "p-amber") : ""}${stars.length ? pill(`STARS kontrolü ${okStars}/${stars.length} dönem tuttu`, okStars === stars.length ? "p-green" : "p-red") : pill("STARS özet tablosu eklenmedi", "p-gray")}</div>
${p.warnings.length ? `<div class="note" style="background:var(--amber-soft)">${p.warnings.map(w => `<span>${esc(w)}</span>`).join("")}</div>` : ""}
<section class="card tbl"><div class="scrollx"><div style="min-width:760px"><div class="trow th" style="grid-template-columns:110px minmax(0,1fr) 56px 56px 190px 190px"><span>Dönem</span><span>Ders</span><span>Kredi</span><span>Not</span><span>Müfredattaki yeri</span><span>Durum</span></div>
${p.rows.map(r => `<div class="trow" style="grid-template-columns:110px minmax(0,1fr) 56px 56px 190px 190px"><span class="muted">${lbl(r.k)}</span><span><b>${esc(r.code)}</b> <span class="muted">${esc(r.name)}</span></span><span class="num muted">${r.cr}</span><b class="num">${esc(r.grade || "—")}</b><span class="muted" style="font-size:12px">${esc(place(r))}</span>${pill(...stOf(r))}</div>`).join("")}
</div></div></section>`;
  }
  const isDraft = ui.draft != null && p.rows.length;
  return `<div class="faint" style="font-size:13px"><a href="#dersler">Derslerim</a> / Transkript</div>
<div class="head"><div><h1>${p.rows.length ? (isDraft ? `Transkriptinde ${p.rows.length} satır bulduk` : "Kayıtlı transkriptin") : "STARS transkriptini ekle"}</h1><p class="sub">${isDraft ? "Kontrol et, sonra onayla. Onaylamadan hiçbir şey kaydedilmez." : "Notların sadece bu tarayıcıda kalır; hiçbir sunucuya gönderilmez."}</p></div>
<div class="btns">${isDraft ? `<button class="btn" data-act="cancel-draft">Vazgeç</button><button class="btn primary" data-act="confirm">${p.rows.length} satırı onayla</button>` : ""}</div></div>
<div class="split wide"><section class="card"><h2>Metni yapıştır</h2>
<textarea id="paste" rows="9" spellcheck="false" placeholder="donem,ders_kodu,ders_adi,kredi,harf_notu&#10;2024-2025 Fall,MAN 101,Introduction to Business I,3,B+">${esc(ui.draft ?? "")}</textarea>
<div class="btns"><button class="btn primary" data-act="preview">Önizle</button>${ui.flash ? `<span class="flash" role="status">${esc(ui.flash)}</span>` : ""}</div></section>
<aside class="card"><h2>STARS'tan nasıl alırım?</h2>
<ol style="margin:0;padding-left:18px;display:grid;gap:6px;font-size:13px"><li>STARS'a kendin giriş yap. Şifreni hiçbir yere yazma.</li><li>Chrome'daki Claude'a (Claude in Chrome) aşağıdaki metni yapıştır. Sadece sayfayı okur, hiçbir şeye tıklamaz.</li><li>Çıkan iki tabloyu soldaki kutuya yapıştır ve Önizle'ye bas. İkinci tablo, hesabın STARS'la tuttuğunu kontrol etmemizi sağlar.</li></ol>
<details><summary>Claude'a yapıştırılacak metin</summary><pre class="prompt" id="stars-prompt">${esc(STARS_PROMPT)}</pre></details>
<button class="btn" data-act="copy">Metni kopyala</button></aside></div>
${preview}`;
};

// ---------- Seçmeli havuzu ----------
V.secmeli = a => {
  const cats = Object.values(model.cats).filter(c => c.pool);
  const slotsOf = k => a.now.slots.filter(s => s.cat === k);
  const fill = k => `${slotsOf(k).filter(s => s.status === "done").length}/${slotsOf(k).length}`;
  const groups = [["Tümü", ["Marketing Elective", "Finance Elective", "Social Science Core Elective", "Arts Core Elective", "Science Core Elective"]], ...cats.map(c => [c.key, [c.key]])];
  const sel = groups.find(g => g[0] === ui.elFilter) || groups[0];
  const cards = sel[1].flatMap(k => [...(model.cats[k].pool || [])].map(code => ({ code, cat: k })));
  const seen = new Set(), list = cards.filter(c => !seen.has(c.code) && seen.add(c.code));
  const cur = list.find(c => c.code === ui.elective) || list[0];
  const passed = new Set(a.now.slots.filter(s => s.status === "done" && s.course).map(s => s.course.code));
  const taken = code => a.now.cm.get(code);
  const detail = cur ? (() => {
    const c = model.cats[cur.cat], pre = c.pre;
    const preDone = pre ? E.evalPre(c.preNode, x => passed.has(x)) : true;
    const preCode = pre ? pre.split(/\s+(?:and|or)\s+/i).pop() : null;
    const prePlan = preCode ? E.plannedKey(a.plan, preCode) : null;
    const slotTerm = a.plan.terms.find(t => t.picked.some(p => p.it.cat === cur.cat && !p.it.code));
    const tk = taken(cur.code);
    return `<aside class="card" style="padding:24px;gap:18px"><div><span class="faint" style="font-size:13px;font-weight:600">${esc(c.name)} · 3 kredi</span><h2 style="font-size:24px">${esc(cur.code)}</h2></div>
<div style="display:flex;gap:6px;flex-wrap:wrap">${pill(c.name, DEPT.has(cur.cat) ? "p-purple" : "p-teal")}${tk ? pill(tk.status === "done" ? `Aldın: ${tk.last.grade}` : tk.status === "ip" ? "Bu dönem alıyorsun" : "Daha önce alındı", tk.status === "done" ? "p-green" : "p-blue") : ""}</div>
<div style="display:grid;gap:8px"><span class="faint" style="font-size:11px;font-weight:600;letter-spacing:.05em">ÖN KOŞUL</span><div class="kv note" style="background:var(--blue-soft)"><b>${pre ? esc(pre) : "Yok"}</b><span style="color:var(--blue);font-weight:600">${!pre ? "" : preDone ? "Karşılandı" : taken(preCode)?.status === "ip" ? "Bu dönem alıyorsun" : prePlan != null ? `${lbl(prePlan)}'de planlı` : "Henüz planda değil"}</span></div></div>
<div style="display:grid;gap:8px"><span class="faint" style="font-size:11px;font-weight:600;letter-spacing:.05em">PLANINA ETKİSİ</span><div class="note" style="background:var(--bg);gap:6px"><div class="kv"><span class="muted">${esc(c.name)} için ayrılan dönem</span><b>${slotTerm ? esc(E.tlabel(slotTerm.t)) : fill(cur.cat).split("/")[0] === fill(cur.cat).split("/")[1] ? "Doldu" : "–"}</b></div><div class="kv"><span class="muted">Doluluk</span><b>${fill(cur.cat)}</b></div></div></div>
<p class="muted" style="margin:0;font-size:12px">Md. 4.21: Bir seçmelinin notunu aynı seçmeli kümesinden başka bir ders alarak değiştirebilirsin; önceki ders transkriptte kalır ama ortalamaya girmez.</p>
<a class="btn" href="${esc(model.data.kaynak)}" target="_blank" rel="noopener">Katalogda aç</a></aside>`;
  })() : "";
  return `<div class="faint" style="font-size:13px"><a href="#dersler">Derslerim</a> / Seçmeli havuzu</div>
<div class="split wide"><div class="view" style="gap:18px"><div><h1>Seçmeli havuzu</h1><p class="sub">Hangi seçmelinin hangi kategoriye sayıldığını, önkoşulunu ve planda hangi döneme ayrıldığını gör.</p></div>
<div class="filters">${groups.map(([k]) => `<button class="fchip" data-ef="${esc(k)}" aria-pressed="${sel[0] === k}">${esc(k === "Tümü" ? "Tümü" : model.cats[k].short)}${k === "Tümü" ? "" : " · " + fill(k)}</button>`).join("")}</div>
<div class="note" style="background:var(--amber-soft);font-size:13px"><span class="muted">Liste şimdilik sadece 2026-27 Fall'da açılan dersleri içeriyor, tam havuz değil. Listede olmayan bir dersin hangi kategoriye sayılacağına STARS karar verir.</span></div>
<div class="ecards">${list.map(x => { const tk = taken(x.code); return `<button class="card ecard" data-el="${esc(x.code)}" aria-pressed="${cur && x.code === cur.code}"><div class="kv"><span class="faint" style="font-weight:600">3 kredi</span>${tk ? pill(tk.status === "done" ? "Alındı" : tk.status === "ip" ? "Alıyorsun" : "Alındı, geçilmedi", tk.status === "done" ? "p-green" : tk.status === "ip" ? "p-blue" : "p-red") : model.cats[x.cat].pre ? pill(model.cats[x.cat].pre + " sonrası", "p-amber") : ""}</div><b style="font-size:18px">${esc(x.code)}</b><span class="muted" style="font-size:12px">${esc(model.cats[x.cat].name)}</span></button>`; }).join("")}</div></div>
${detail}</div>`;
};

// ---------- yönlendirme ve olaylar ----------
function route() { const r = location.hash.slice(1); return ROUTES.includes(r) ? r : "pano"; }
function render() {
  const app = document.getElementById("app");
  compute();
  const r = route();
  if (!A && r !== "transkript") { app.innerHTML = `<div class="view"><p class="muted">Kayıtlı transkriptte ders satırı bulunamadı. <a href="#transkript">Transkriptini yeniden ekle</a>.</p></div>`; }
  else app.innerHTML = `<div class="view">${V[r](A)}</div>`;
  document.querySelectorAll("#tabs a,#mtabs a").forEach(a => (a.getAttribute("href") === "#" + TAB_OF[r] ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  ui.flash = "";
  applyFilter();
  drawTrend();
}
function drawTrend() {
  const box = document.getElementById("trend"); if (!box || !A) return;
  const cs = getComputedStyle(box), html = trend(A, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  box.hidden = !html; box.innerHTML = html;
}
function applyFilter() {
  const tbl = document.getElementById("tbl"); if (!tbl) return;
  const q = (document.getElementById("q")?.value || "").toLowerCase();
  tbl.querySelectorAll(".trow[data-row]").forEach(r => { r.hidden = !(r.dataset.row.includes(q) && (ui.filter === "Tümü" || r.dataset.tags.includes(ui.filter))); });
  tbl.querySelectorAll(".grp").forEach(g => { let el = g.nextElementSibling, any = false; while (el && !el.classList.contains("grp")) { if (!el.hidden) any = true; el = el.nextElementSibling; } g.hidden = !any; });
}
function setOpt(k, v) { view.opts[k] = v; persist(); render(); }

function wire() {
  const app = document.getElementById("app");
  app.addEventListener("click", e => {
    const t = e.target.closest("button,[data-act]"); if (!t) return;
    const d = t.dataset;
    if (d.g) { view.whatIf[d.g] = d.v; persist(); render(); }
    else if (d.f) { ui.filter = d.f; app.querySelectorAll("[data-f]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === d.f))); applyFilter(); }
    else if (d.sc) { ui.sc = d.sc; render(); }
    else if (d.ef) { ui.elFilter = d.ef; ui.elective = null; render(); }
    else if (d.el) { ui.elective = d.el; render(); }
    else if (d.tgt) setOpt("target", +d.tgt);
    else if (d.tcg) setOpt("targetCgpa", +d.tcg);
    else if (d.act) act(d.act);
  });
  app.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sc-course") { ui.scCourse = t.value; render(); }
    else if (t.dataset.opt) setOpt(t.dataset.opt, t.type === "checkbox" ? t.checked : +t.value);
  });
  app.addEventListener("input", e => { if (e.target.id === "q") applyFilter(); if (e.target.id === "paste") ui.draft = e.target.value; });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawTrend, 150); });
}
function act(name) {
  if (name === "reset") { view.whatIf = {}; persist(); render(); }
  if (name === "preview") {
    ui.draft = document.getElementById("paste").value;
    if (!E.parseTranscript(ui.draft).rows.length) ui.flash = "Bu metinde ders satırı bulamadım. Satırlar \"2024-2025 Fall,MAN 101,...,3,B+\" biçiminde olmalı.";
    render();
  }
  if (name === "cancel-draft") { ui.draft = null; render(); }
  if (name === "confirm") { state = { transcript: ui.draft, opts: view.opts, whatIf: {} }; view.whatIf = {}; ui.draft = null; persist(); location.hash = "#pano"; render(); }
  if (name === "clear") document.getElementById("confirm").hidden = false;
  if (name === "do-clear") { clearState(); state = null; view = { opts: {}, whatIf: {} }; location.hash = "#pano"; render(); }
  if (name === "copy") {
    const done = () => { ui.flash = "Metin kopyalandı."; const d = ui.draft; render(); ui.draft = d; };
    const fallback = () => { const pre = document.getElementById("stars-prompt"); pre.closest("details").open = true; const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    try { navigator.clipboard.writeText(STARS_PROMPT).then(done, fallback); } catch { fallback(); }
  }
}

async function boot() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(res.status);
    model = E.buildModel(await res.json());
  } catch {
    document.getElementById("app").innerHTML = `<p>Müfredat dosyası yüklenemedi (${esc(DATA_URL)}). Sayfayı yenilemeyi dene.</p>`;
    return;
  }
  state = loadState();
  if (state && !state.transcript) state = null;
  view.opts = { ...(state?.opts || {}) };
  view.whatIf = { ...(state?.whatIf || {}) };
  wire();
  render();
}
boot();
