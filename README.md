# Bilkent Mezuniyet Planlayıcısı (resmi olmayan öğrenci projesi)

Bilkent öğrencileri için mezuniyet planlayıcı. **Resmi değildir**; sonuçları STARS ile karşılaştırın.

- Statik site, build adımı yok. Tüm hesaplama tarayıcıda.
- Kullanıcı notları yalnızca `localStorage`'da; sunucuya gönderilmez (`connect-src 'self'` CSP ile de kilitli).
- `main`'e her push GitHub Pages'e otomatik yayınlanır (`.github/workflows/deploy.yml`).
- Müfredat verisi: `data/<bolum>/<katalog-yili>.json`.

Yerelde denemek: `python3 -m http.server 8000` → http://localhost:8000

## Yapı

- `src/engine.js`: hesap motoru (CGPA, tekrar/W kuralları, seçmeli yerleşimi, risk radarı, dönem planı). DOM'a dokunmaz.
- `src/app.js`: arayüz; `src/main.js`: localStorage (`bmp:v1`).
- `src/ornek.js`: uydurma örnek öğrenci (ilk açılışta ve testlerde).
- `data/man/2024.json`: İşletme müfredatı, önkoşullar, yaz okulu bilgisi, seçmeli havuzları.

Testler (Node 20+): `node --test tests/engine.test.mjs`. Testlerde gerçek öğrenci verisi kullanılmaz.
