# Bilkent Mezuniyet Planlayıcısı (resmi olmayan öğrenci projesi)

Bilkent öğrencileri için mezuniyet planlayıcı. **Resmi değildir**; sonuçları STARS ile karşılaştırın.

- Statik site, build adımı yok. Tüm hesaplama tarayıcıda.
- Kullanıcı notları yalnızca `localStorage`'da; sunucuya gönderilmez (`connect-src 'self'` CSP ile de kilitli).
- `main`'e her push GitHub Pages'e otomatik yayınlanır (`.github/workflows/deploy.yml`).
- Müfredat verisi: `data/<bolum>/<katalog-yili>.json`.

Yerelde denemek: `python3 -m http.server 8000` → http://localhost:8000
