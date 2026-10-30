// Planlayıcı motoru buraya bağlanacak. Kural: kullanıcı verisi asla fetch/XHR ile dışarı gönderilmez,
// yalnızca localStorage'da tutulur.
const STORAGE_KEY = "bmp:v1";

export function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null; } catch { return null; }
}
export function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}
export function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
