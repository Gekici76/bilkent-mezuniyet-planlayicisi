// Planlayıcı arayüzü. Hesapların hepsi engine.js'te; burası sadece çizer.
// Kullanıcının transkripti ve seçimleri yalnızca localStorage'da (main.js) durur, dışarı gönderilmez.
import * as E from "./engine.js";
import { ORNEK_TRANSKRIPT } from "./ornek.js";
import { loadState, saveState, clearState } from "./main.js";

const DATA_URL = "data/man/2024.json";
const GRADE_OPTS = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F", "W"];
const FUTURE_OPTS = [["3.00", "B"], ["2.70", "B-"], ["2.30", "C+"], ["2.00", "C"], ["1.70", "C-"]];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = x => (x == null ? "–" : E.r2(x).toFixed(2));

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

let model = null;
let state = null; // { transcript, opts, whatIf } ya da null (örnek gösteriliyor)
let view = { opts: {}, whatIf: {} };

function currentText() { return state?.transcript || ORNEK_TRANSKRIPT; }
function persist() { if (state) saveState(state); }

async function boot() {
  const root = document.getElementById("planner");
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(res.status);
    model = E.buildModel(await res.json());
  } catch (e) {
    root.innerHTML = `<p class="err">Müfredat dosyası yüklenemedi (${esc(DATA_URL)}). Sayfayı yenilemeyi dene.</p>`;
    return;
  }
  state = loadState();
  if (state && !state.transcript) state = null;
  view.opts = { ...(state?.opts || {}) };
  view.whatIf = { ...(state?.whatIf || {}) };
  render();
}

function render() {
  const root = document.getElementById("planner");
  const parsed = E.parseTranscript(currentText());
  if (!parsed.rows.length) {
    root.innerHTML = dataCard(parsed, null) + `<p class="err">Yapıştırdığın metinde ders satırı bulamadım. Satırlar "2024-2025 Fall,MAN 101,Introduction to Business I,3,B+" biçiminde olmalı.</p>`;
    wire(root, null); return;
  }
  const o = view.opts;
  const a = E.analyze(model, parsed.rows, { whatIf: view.whatIf, g: +(o.g || 2.3), maxCr: +(o.maxCr || 19), summers: o.summers !== false, irregular: !!o.irregular, target: o.target != null ? +o.target : null });
  const stars = E.compareStars(a.now.per, parsed.summary);
  root.innerHTML = [
    dataCard(parsed, stars),
    summaryTiles(a),
    `<div class="two">${whatIfCard(a)}${risksCard(a)}</div>`,
    trendCard(a),
    planCard(a),
    curriculumCard(a),
    notesCard(),
  ].join("");
  wire(root, a);
}

// ---------- bölümler ----------
function dataCard(parsed, stars) {
  const own = !!state;
  const okCount = stars ? stars.filter(s => s.ok).length : 0;
  const starsLine = stars && stars.length
    ? `<p class="stars ${okCount === stars.length ? "good" : "bad"}">STARS kontrolü: ${okCount}/${stars.length} dönemde GPA ve CGPA birebir tuttu.${okCount === stars.length ? "" : " Tutmayanlar: " + stars.filter(s => !s.ok).map(s => esc(E.tlabel(s.t))).join(", ")}</p>`
    : "";
  return `<section class="card data">
    <div class="data-head">
      <div>
        <p class="eyebrow">İşletme (MAN) · 2024 ve sonrası müfredat · ${model.total} kredi</p>
        <p class="data-status">${own ? `Kendi transkriptin gösteriliyor · ${parsed.rows.length} satır · sadece bu tarayıcıda` : `<span class="pill sample">Örnek</span> Uydurma bir öğrencinin verisi gösteriliyor. Kendi transkriptini yapıştırınca her şey sana göre hesaplanır.`}</p>
      </div>
      <div class="btns">
        <button type="button" class="btn primary" data-act="toggle-paste">${own ? "Transkripti güncelle" : "Transkriptimi yapıştır"}</button>
        ${own ? `<button type="button" class="btn ghost" data-act="clear">Verilerimi sil</button>` : ""}
      </div>
    </div>
    ${starsLine}
    ${parsed.warnings.length ? `<p class="warn-line">${parsed.warnings.map(esc).join("<br>")}</p>` : ""}
    <div class="paste" id="paste-panel" hidden>
      <label for="paste-text">STARS transkriptin (CSV satırları)</label>
      <textarea id="paste-text" rows="8" spellcheck="false" placeholder="donem,ders_kodu,ders_adi,kredi,harf_notu&#10;2024-2025 Fall,MAN 101,Introduction to Business I,3,B+"></textarea>
      <div class="btns">
        <button type="button" class="btn primary" data-act="apply">Hesapla</button>
        <button type="button" class="btn ghost" data-act="toggle-paste">Vazgeç</button>
      </div>
      <details>
        <summary>STARS'tan nasıl alırım?</summary>
        <ol>
          <li>STARS'a kendin giriş yap. Şifreni hiçbir yere yazma.</li>
          <li>Chrome'daki Claude'a (Claude in Chrome) aşağıdaki metni yapıştır. Sadece sayfayı okur, hiçbir şeye tıklamaz.</li>
          <li>Çıkan CSV'yi yukarıdaki kutuya yapıştırıp "Hesapla"ya bas. İkinci tabloyu da eklersen sonuçları STARS'la karşılaştırırım.</li>
        </ol>
        <pre id="stars-prompt">${esc(STARS_PROMPT)}</pre>
        <button type="button" class="btn ghost" data-act="copy-prompt">Metni kopyala</button>
      </details>
    </div>
  </section>`;
}

function stPill(st) { return `<span class="pill st-${st}">${E.STANDING_LABEL[st]}</span>`; }

function summaryTiles(a) {
  const n = a.now, remaining = n.slots.filter(s => s.status !== "done" && s.status !== "ip").length;
  const ipCount = n.slots.filter(s => s.status === "ip").length;
  const pct = Math.round((n.doneCr / model.total) * 100);
  const grad = a.plan.gradKey != null ? E.tlabel(E.fromKey(a.plan.gradKey)) : "Görünmüyor";
  const onTime = a.plan.gradKey != null && a.targetKey != null && a.plan.gradKey <= a.targetKey;
  const wLeft = E.RULES.wLimit - n.wUsed;
  return `<section class="tiles">
    <div class="tile"><p class="t-label">CGPA</p><p class="t-num">${f2(n.cg)}</p><p class="t-sub">${stPill(n.st)} <span>${E.STANDING_EN[n.st]}</span></p></div>
    <div class="tile"><p class="t-label">Tamamlanan</p><p class="t-num">${n.doneCr}<small>/${model.total} kredi</small></p><div class="bar" role="img" aria-label="%${pct} tamamlandı"><span style="width:${pct}%"></span><span class="ip" style="width:${Math.round((n.ipCr / model.total) * 100)}%"></span></div></div>
    <div class="tile"><p class="t-label">Kalan ders</p><p class="t-num">${remaining}</p><p class="t-sub">${ipCount ? `+${ipCount} ders bu dönem sürüyor` : "Bu dönem ders yok"}</p></div>
    <div class="tile ${wLeft <= 1 ? "attn" : ""}"><p class="t-label">W hakkı</p><p class="t-num">${wLeft}<small>/${E.RULES.wLimit} kaldı</small></p><p class="t-sub">${n.wUsed} W kullanıldı</p></div>
    <div class="tile ${onTime ? "" : "attn"}"><p class="t-label">En erken mezuniyet</p><p class="t-num t-term">${esc(grad)}</p><p class="t-sub">Hedef: ${a.targetKey != null ? esc(E.tlabel(E.fromKey(a.targetKey))) : "–"}</p></div>
  </section>`;
}

function whatIfCard(a) {
  if (!a.ipRows.length) return `<section class="card"><h2>Bu dönem</h2><p class="muted">Transkriptinde notu henüz girilmemiş (devam eden) ders yok.</p></section>`;
  const cur = E.tlabel(E.fromKey(a.curKey));
  const prev = code => { const c = a.now.cm.get(code); return c && c.last ? c.last.grade : null; };
  const rows = a.ipRows.map(r => {
    const sel = view.whatIf[r.code] || "C";
    const p = prev(r.code);
    return `<tr><td><span class="code">${esc(r.code)}</span><span class="cname">${esc(r.name)}</span></td><td class="num">${r.cr}</td><td class="muted">${p ? `önceki ${esc(p)}` : "ilk kez"}</td>
      <td><select data-wi="${esc(r.code)}" aria-label="${esc(r.code)} için beklenen not">${GRADE_OPTS.map(g => `<option${g === sel ? " selected" : ""}>${g}</option>`).join("")}</select></td></tr>`;
  }).join("");
  const nd = k => { const v = a.need[k]; if (v == null) return "–"; if (v <= 0) return "zaten garanti"; if (v > 4) return "bu dönem ulaşılamaz"; return `en az ${v.toFixed(2)} ortalama (≈ ${E.letterFor(v)})`; };
  const delta = a.proj.cg != null && a.now.cg != null ? a.proj.cg - a.now.cg : 0;
  return `<section class="card whatif">
    <h2>${esc(cur)}: şu notları alırsam</h2>
    <div class="quick"><span class="muted">Hepsini</span>${["B", "C+", "C", "C-", "D"].map(g => `<button type="button" class="chip-btn" data-all="${g}">${g}</button>`).join("")}</div>
    <div class="scroll"><table class="wi"><thead><tr><th>Ders</th><th class="num">Kr.</th><th></th><th>Not</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="result">
      <div><p class="t-label">Dönem sonu CGPA</p><p class="big">${f2(a.proj.cg)} <span class="delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta.toFixed(2)}</span></p></div>
      <div><p class="t-label">Gelecek dönem durumu</p><p>${stPill(a.proj.st)}</p></div>
    </div>
    <ul class="need">
      <li><strong>2.00</strong> (normal durum, mezuniyet eşiği) için bu dönem ${nd("2.00")}</li>
      <li><strong>1.80</strong> (sınamalı) için ${nd("1.80")}</li>
    </ul>
    <p class="fine">W seçersen dersin eski notu ortalamada kalır (Md. 4.11) ve W hakkından düşer.</p>
  </section>`;
}

function risksCard(a) {
  const order = { crit: 0, warn: 1, info: 2, ok: 3 };
  const items = [...a.risks].sort((x, y) => order[x.sev] - order[y.sev]).map(r =>
    `<li class="risk sev-${r.sev}"><p class="r-title">${esc(r.title)}</p><p class="r-body">${esc(r.body)}</p></li>`).join("");
  return `<section class="card"><h2>Risk radarı</h2><ul class="risks">${items}</ul></section>`;
}

function trendCard(a) {
  const pts = a.now.per.filter(p => p.graded);
  if (!pts.length) return "";
  const proj = a.ipRows.length ? { t: E.fromKey(a.curKey), cg: a.proj.cg } : null;
  const n = pts.length + (proj ? 1 : 0);
  const W = 640, H = 210, L = 40, R = 16, T = 16, B = 34;
  const x = i => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = v => T + (1 - v / 4) * (H - T - B);
  const grid = [0, 1, 2, 3, 4].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`).join("");
  const thr = [[2, "2.00 mezuniyet"], [1.8, "1.80 sınamalı"]].map(([v, l], i) => `<line class="thr t${i}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="thr-l t${i}" x="${L + 6}" y="${y(v) + (i ? 13 : -5)}">${l}</text>`).join("");
  const line = pts.map((p, i) => `${x(i)},${y(p.cgpa)}`).join(" ");
  const dots = pts.map((p, i) => `<circle class="gpa" cx="${x(i)}" cy="${y(p.gpa)}" r="3.5"><title>${E.tlabel(p.t)} dönem GPA ${f2(p.gpa)}</title></circle><circle class="cg" cx="${x(i)}" cy="${y(p.cgpa)}" r="4.5"><title>${E.tlabel(p.t)} CGPA ${f2(p.cgpa)}</title></circle><text class="ax" x="${x(i)}" y="${H - 12}" text-anchor="middle">${E.tshort(p.t)}</text>`).join("");
  const last = pts[pts.length - 1];
  const projSvg = proj ? `<line class="proj" x1="${x(pts.length - 1)}" y1="${y(last.cgpa)}" x2="${x(pts.length)}" y2="${y(proj.cg)}"/><circle class="cg proj-dot" cx="${x(pts.length)}" cy="${y(proj.cg)}" r="5"/><text class="val" x="${x(pts.length)}" y="${y(proj.cg) - 10}" text-anchor="middle">${f2(proj.cg)}</text><text class="ax" x="${x(pts.length)}" y="${H - 12}" text-anchor="middle">${E.tshort(proj.t)}?</text>` : "";
  return `<section class="card trend"><h2>CGPA gidişatı</h2>
    <p class="legend"><span class="lg cg"></span>CGPA <span class="lg gpa"></span>Dönem GPA ${proj ? `<span class="lg proj"></span>Bu dönem, seçtiğin notlarla` : ""}</p>
    <div class="scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dönemlere göre CGPA">${grid}${thr}<polyline class="cgl" points="${line}"/>${dots}<text class="val" x="${x(pts.length - 1)}" y="${y(last.cgpa) - 10}" text-anchor="middle">${f2(last.cgpa)}</text>${projSvg}</svg></div>
  </section>`;
}

function planCard(a) {
  const o = view.opts;
  const first = a.firstPlanKey, opts = [];
  for (let k = first; k <= a.maxKey; k++) if (k % 3 !== 2) opts.push(k);
  const tgt = a.targetKey;
  const sel = `<select id="o-target">${opts.map(k => `<option value="${k}"${k === tgt ? " selected" : ""}>${E.tlabel(E.fromKey(k))}</option>`).join("")}</select>`;
  const gSel = `<select id="o-g">${FUTURE_OPTS.map(([v, l]) => `<option value="${v}"${(+o.g || 2.3).toFixed(2) === v ? " selected" : ""}>${l} (${v})</option>`).join("")}</select>`;
  const crSel = `<select id="o-cr">${[15, 16, 17, 18, 19, 20, 21, 22].map(v => `<option${(+o.maxCr || 19) === v ? " selected" : ""}>${v}</option>`).join("")}</select>`;
  const terms = a.plan.terms.map(t => {
    const tags = t.picked.map(({ it, tag }) => `<li class="c c-${tag}${it.kind === "elec" ? " el" : ""}" title="${esc(it.name || it.label)}${it.pre ? " · önkoşul: " + esc(it.pre) : ""}"><span class="code">${esc(it.label)}</span><span class="tag">${tag === "tekrar" ? "tekrar" : tag === "staj" ? "staj" : it.kind === "elec" ? "seçmeli" : ""}</span><span class="cr">${it.cr || ""}</span></li>`)
      .concat(t.improves.map(im => `<li class="c c-improve" title="Not yükseltme: ${esc(im.from)} yerine"><span class="code">${esc(im.code)}</span><span class="tag">${esc(im.from)} → yükselt</span><span class="cr">${im.cr}</span></li>`)).join("");
    const rule = t.summer ? "Yaz okulu: en fazla 2 ders, durum kısıtı yok" : t.st === "U" ? "Başarısız durum: yeni zorunlu ders yok, tekrar + 1 yeni seçmeli" : t.st === "P" ? `Sınamalı: yeni ders en fazla ${E.r2(t.newCap)} kredi` : "";
    const beyond = a.targetKey != null && t.k > a.targetKey;
    return `<li class="term${t.summer ? " summer" : ""}${beyond ? " late" : ""}">
      <div class="term-h"><p class="term-name">${esc(E.tlabel(t.t))}</p><p class="term-meta">${t.summer ? '<span class="pill yaz">Yaz</span>' : stPill(t.st)} <span class="muted">başta ${f2(t.cgStart)}</span></p>${rule ? `<p class="term-rule">${rule}</p>` : ""}</div>
      <ul class="courses">${tags}</ul>
      <div class="term-f"><p><strong>${t.cr}</strong> kredi</p><p class="muted">sonra ${f2(t.cgEnd)}</p></div></li>`;
  }).join("");
  const res = a.plan.done
    ? `<p class="plan-res ${a.plan.gradKey <= tgt ? "good" : "bad"}">Bu varsayımlarla en erken mezuniyet: <strong>${esc(E.tlabel(E.fromKey(a.plan.gradKey)))}</strong>, CGPA ≈ ${f2(a.plan.finalCg)}.</p>`
    : `<p class="plan-res bad">Bu varsayımlarla azami süre içinde mezuniyet görünmüyor.</p>`;
  return `<section class="card plan"><h2>Dönem dönem yol haritası</h2>
    <div class="controls">
      <label>Hedef dönem ${sel}</label>
      <label>Gelecek derslerde ortalaman ${gSel}</label>
      <label>Dönem başına en fazla kredi ${crSel}</label>
      <label class="chk"><input type="checkbox" id="o-sum"${o.summers !== false ? " checked" : ""}> Yaz okuluna giderim</label>
      <label class="chk"><input type="checkbox" id="o-irr"${o.irregular ? " checked" : ""}> Her yıl açılmayan yaz derslerini de say</label>
    </div>
    ${res}
    <ol class="terms">${terms}</ol>
    <p class="fine">Plan, gelecekteki tüm dersleri geçeceğini ve seçtiğin ortalamayı alacağını varsayar. Önkoşul zinciri en uzun olan dersler öne alınır. Başarısız ya da sınamalı dönemlerde, C- ve altı geçtiğin dersleri tekrar alıp notunu yükseltmeyi önerir.</p>
  </section>`;
}

function curriculumCard(a) {
  const passed = new Set(a.now.slots.filter(s => s.status === "done" && s.code).map(s => s.code));
  for (const s of a.now.slots) if (s.status === "done" && s.course) passed.add(s.course.code);
  const cols = [];
  for (let y = 1; y <= 4; y++) for (const d of ["Fall", "Spring"]) cols.push({ y, d, items: a.now.slots.filter(s => s.yil === y && s.donem === d) });
  const lab = { done: "tamam", ip: "sürüyor", failed: "kaldı", none: "" };
  const html = cols.map(c => `<div class="col"><p class="col-h">${c.y}. yıl · ${c.d === "Fall" ? "Güz" : "Bahar"}</p><ul>${c.items.map(s => {
    const locked = s.status === "none" && !E.evalPre(s.preNode, x => passed.has(x));
    const name = s.code || (model.cats[s.cat]?.short || s.cat);
    const sub = s.course && !s.code ? s.course.code : s.course?.last && s.status !== "ip" ? s.course.last.grade : lab[s.status];
    return `<li class="slot s-${s.status}${locked ? " locked" : ""}${s.kind === "elec" ? " el" : ""}" title="${esc(s.name || "")}${s.pre ? " · önkoşul: " + esc(s.pre) : ""}"><span class="code">${esc(name)}</span><span class="sub">${esc(locked ? "önkoşul eksik" : sub || "")}</span></li>`;
  }).join("")}</ul></div>`).join("");
  return `<section class="card curr"><h2>Müfredat haritası</h2>
    <p class="legend"><span class="sw s-done"></span>tamam <span class="sw s-ip"></span>sürüyor <span class="sw s-failed"></span>kaldı <span class="sw s-none"></span>alınmadı <span class="sw locked"></span>önkoşul eksik</p>
    <div class="scroll"><div class="grid8">${html}</div></div></section>`;
}

function notesCard() {
  return `<section class="card notes"><h2>Varsayımlar ve kaynaklar</h2>
    <ul>
      <li>Kurallar: <a href="https://w3.bilkent.edu.tr/www/lisans-ve-on-lisans-egitim-ogretim-yonetmeligi/" rel="noopener" target="_blank">Lisans ve Ön Lisans Eğitim-Öğretim Yönetmeliği</a>. Tekrarda en son not geçerli (4.13), W ortalamaya girmez ve eski notu silmez (4.11), en çok 4 W (4.10), sınamalı/başarısız ders yükü (4.18), yaz okulunda en çok 2 ders (4.2), mezuniyet için CGPA 2.00 (6.1), azami süre 7 yıl (3.3).</li>
      <li>Müfredat: <a href="https://catalog.bilkent.edu.tr/dep/d31.html" rel="noopener" target="_blank">Bilkent Academic Catalog, Management</a> (son güncelleme 22 Ekim 2026). Yaz okulu bilgisi STARS Offerings 2022-23 ile 2026-27 Fall arası.</li>
      <li>Seçmeli havuzları tam değil: sadece 2026-27 Fall'da açılan dersleri biliyoruz. Listede olmayan bir dersin hangi kategoriye sayılacağına STARS karar verir.</li>
      <li>Eşdeğer dersler, bölüm başkanı onaylı ek ders (4.19) ve ilk yıl istisnaları henüz hesaba katılmıyor.</li>
      <li>Resmi değildir. Kararlarını STARS ve danışmanınla karşılaştırarak ver.</li>
    </ul></section>`;
}

// ---------- etkileşim ----------
function wire(root, a) {
  root.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act)));
  root.querySelectorAll("[data-wi]").forEach(s => s.addEventListener("change", () => { view.whatIf[s.dataset.wi] = s.value; if (state) { state.whatIf = view.whatIf; persist(); } render(); }));
  root.querySelectorAll("[data-all]").forEach(b => b.addEventListener("click", () => { if (!a) return; for (const r of a.ipRows) view.whatIf[r.code] = b.dataset.all; if (state) { state.whatIf = view.whatIf; persist(); } render(); }));
  const bind = (id, key, fn) => { const el = root.querySelector("#" + id); if (el) el.addEventListener("change", () => { view.opts[key] = fn(el); if (state) { state.opts = view.opts; persist(); } render(); }); };
  bind("o-target", "target", el => +el.value);
  bind("o-g", "g", el => +el.value);
  bind("o-cr", "maxCr", el => +el.value);
  bind("o-sum", "summers", el => el.checked);
  bind("o-irr", "irregular", el => el.checked);
}

function act(name) {
  const panel = document.getElementById("paste-panel");
  if (name === "toggle-paste") { panel.hidden = !panel.hidden; if (!panel.hidden) document.getElementById("paste-text").focus(); }
  if (name === "apply") {
    const text = document.getElementById("paste-text").value;
    if (!E.parseTranscript(text).rows.length) { alertLine("Bu metinde ders satırı bulamadım. Satırlar \"2024-2025 Fall,MAN 101,...,3,B+\" biçiminde olmalı."); return; }
    state = { transcript: text, opts: view.opts, whatIf: {} };
    view.whatIf = {};
    persist(); render();
  }
  if (name === "clear") {
    if (!document.getElementById("confirm-clear")) {
      const p = document.createElement("p");
      p.id = "confirm-clear"; p.className = "warn-line";
      p.innerHTML = `Transkriptin ve seçimlerin bu tarayıcıdan silinecek. <button type="button" class="btn danger" id="do-clear">Evet, sil</button>`;
      document.querySelector(".data-head").after(p);
      document.getElementById("do-clear").addEventListener("click", () => { clearState(); state = null; view = { opts: {}, whatIf: {} }; render(); });
    }
  }
  if (name === "copy-prompt") {
    const pre = document.getElementById("stars-prompt");
    const done = () => alertLine("Metin kopyalandı.");
    try { navigator.clipboard.writeText(STARS_PROMPT).then(done, () => selectText(pre)); } catch { selectText(pre); }
  }
}
function selectText(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); alertLine("Metni seçtim, kopyalamak için Ctrl+C / Cmd+C."); }
function alertLine(msg) {
  let el = document.getElementById("flash");
  if (!el) { el = document.createElement("p"); el.id = "flash"; el.className = "flash"; el.setAttribute("role", "status"); document.querySelector(".card.data").append(el); }
  el.textContent = msg;
}

boot();
