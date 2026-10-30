// Çalıştırma: node --test tests/engine.test.mjs
// Sadece uydurma veri kullanılır; gerçek öğrenci transkripti repoya konmaz.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as E from "../src/engine.js";
import { ORNEK_TRANSKRIPT } from "../src/ornek.js";

const model = E.buildModel(JSON.parse(fs.readFileSync(new URL("../data/man/2024.json", import.meta.url))));

test("MAN 2024 müfredatı 48 kalem, 139 kredi", () => {
  assert.equal(model.slots.length, 48);
  assert.equal(model.slots.reduce((a, s) => a + s.cr, 0), 139);
});

test("önkoşul ifadeleri", () => {
  const n = E.parsePre("(ECON 221 or MATH 119) and (ECON 225 or MATH 227)");
  assert.equal(E.evalPre(n, c => ["ECON 221", "MATH 227"].includes(c)), true);
  assert.equal(E.evalPre(n, c => ["ECON 221"].includes(c)), false);
});

test("tekrarda son not, W ve S eski notu silmez, 0.345 → 0.35", () => {
  const { rows } = E.parseTranscript(`2024-2025 Fall,MAN 101,X,3,D+
2024-2025 Fall,MATH 105,X,4,FZ
2024-2025 Fall,GE 100,X,1,B
2024-2025 Fall,ECON 101,X,4,FX
2024-2025 Fall,SOC 101,X,3,F
2024-2025 Fall,ENG 101,X,3,FZ
2024-2025 Fall,TURK 101,X,2,FZ
2024-2025 Spring,MATH 105,X,4,W
2024-2025 Spring,ENG 101,X,3,C+`);
  const ts = E.termStats(rows);
  assert.equal(E.r2(ts.per[0].gpa), 0.35);
  assert.equal(ts.per[0].cr, 20);
  assert.equal(E.r2(ts.per[1].gpa), 2.3);
  assert.equal(ts.latest.get("MATH 105").grade, "FZ");
  assert.equal(ts.latest.get("ENG 101").grade, "C+");
});

test("STARS özet satırlarıyla karşılaştırma ve tırnaklı ders adları", () => {
  const p = E.parseTranscript(`2025-2026 Spring,FA 171,&#34;Introduction to Art, Design and Culture I&#34;,3,B-
2025-2026 Spring,MAN 213,Principles of Financial Accounting,4,F ------ donem,donem_gpa
2025-2026 Spring,1.16,7,1.16,UNSATISFACTORY`);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].name, "Introduction to Art, Design and Culture I");
  const a = E.analyze(model, p.rows);
  assert.deepEqual(E.compareStars(a.now.per, p.summary).map(x => x.ok), [true]);
});

test("örnek öğrenci: durum, seçmeli yerleşimi, plan", () => {
  const { rows } = E.parseTranscript(ORNEK_TRANSKRIPT);
  const a = E.analyze(model, rows, { g: 2.3, maxCr: 19 });
  assert.equal(E.r2(a.now.cg), 2.61);
  assert.equal(a.now.st, "S");
  assert.equal(a.now.wUsed, 1);
  assert.equal(a.now.doneCr, 72);
  assert.equal(a.ipRows.length, 6);
  const soc = a.now.slots.find(s => s.cat === "Social Science Core Elective");
  assert.equal(soc.course.code, "HIST 205");
  assert.equal(a.plan.done, true);
  assert.equal(E.tlabel(E.fromKey(a.plan.gradKey)), "Spring 2028");
});

test("başarısız durumda yeni zorunlu ders yok, yaz okulunda var", () => {
  const { rows } = E.parseTranscript(`2024-2025 Fall,MATH 105,X,4,D
2024-2025 Fall,MAN 101,X,3,F
2024-2025 Fall,ECON 101,X,4,F
2024-2025 Fall,SOC 101,X,3,D`);
  const a = E.analyze(model, rows, { g: 2.3, maxCr: 19 });
  const spring = a.plan.terms.find(t => t.t.s === 1);
  assert.equal(spring.st, "U");
  const newReq = spring.picked.filter(p => p.tag === "yeni" && p.it.kind === "req" && p.it.cr > 0);
  assert.equal(newReq.length, 0);
  assert.ok(spring.picked.filter(p => p.tag === "yeni" && p.it.kind === "elec").length <= 1);
  const summer = a.plan.terms.find(t => t.summer);
  assert.ok(summer.picked.some(p => p.tag === "yeni"));
});
