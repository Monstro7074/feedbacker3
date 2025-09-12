// apps/backend/public/admin.js
// ✅ БЕЗ /api — правильная база
const API_BASE = '/admin';
const tokenKey = 'ADMIN_TOKEN';

function adminToken() { return localStorage.getItem(tokenKey) || ''; }
function setAdminToken(t) { localStorage.setItem(tokenKey, t || ''); }

async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path, window.location.origin);
  Object.entries(params).forEach(([k,v]) => (v!=null && v!=='') && url.searchParams.set(k, v));
  const r = await fetch(url, { headers: { 'X-Admin-Token': adminToken() } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken() },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ---------- toasts ---------- */
function toast(msg) {
  const el = document.querySelector('#toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

/* ---------- settings ---------- */
async function loadSettings() {
  try {
    const s = await apiGet('/settings');
    const v = s.TELEGRAM_ALERT_THRESHOLD ?? '0.4';
    const el = document.querySelector('#threshold');
    if (el) el.value = v;
  } catch (e) {
    // мягко подсказали про токен
    console.warn('settings load error:', e);
    toast('Введите ADMIN_TOKEN и нажмите «Сохранить»');
  }
}
async function saveSettings() {
  const el = document.querySelector('#threshold');
  const v = (el?.value || '').trim();
  await apiPost('/settings', { TELEGRAM_ALERT_THRESHOLD: v });
  toast('Сохранено');
}

/* ---------- list + pagination ---------- */
let currentOffset = 0;

async function loadList({ reset = false } = {}) {
  const shop = document.querySelector('#f-shop')?.value.trim() || '';
  const sentiment = document.querySelector('#f-sentiment')?.value.trim() || '';
  const limit = parseInt(document.querySelector('#f-limit')?.value || '20', 10);

  if (reset) currentOffset = 0;

  const { items, nextOffset } = await apiGet('/list', {
    shop_id: shop, sentiment, limit, offset: currentOffset
  });

  const tbody = document.querySelector('#rows');
  if (!tbody) return;
  if (reset) tbody.innerHTML = '';

  for (const it of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(it.timestamp).toLocaleString()}</td>
      <td>${it.shop_id || ''}</td>
      <td>${it.device_id || ''}</td>
      <td>${it.sentiment || ''}</td>
      <td>${it.emotion_score ?? ''}</td>
      <td>${(it.tags || []).join(', ')}</td>
      <td>
        <button class="btn-play" data-id="${it.id}">Прослушать</button>
        <button class="btn-card" data-id="${it.id}">Карточка</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  const moreBtn = document.querySelector('#btn-more');
  if (moreBtn) {
    if (nextOffset != null) { currentOffset = nextOffset; moreBtn.disabled = false; }
    else { moreBtn.disabled = true; }
  }
}

/* ---------- card modal ---------- */
let currentCardId = null;

async function openCard(id) {
  currentCardId = id;
  const { item, annotation } = await apiGet(`/feedback/${id}`);

  // fill fields
  document.querySelector('#c-time').textContent = new Date(item.timestamp).toLocaleString();
  document.querySelector('#c-shop').textContent = item.shop_id || '';
  document.querySelector('#c-device').textContent = item.device_id || '';
  document.querySelector('#c-sentiment').textContent = item.sentiment || '';
  document.querySelector('#c-score').textContent = item.emotion_score ?? '';
  document.querySelector('#c-tags').textContent = (item.tags || []).join(', ');
  document.querySelector('#c-summary').textContent = item.summary || '';
  document.querySelector('#c-transcript').textContent = item.transcript || '';

  // audio via redirect (без токена в JS)
  const p = document.querySelector('#c-audio');
  if (p) p.src = `/feedback/redirect-audio/${item.id}`;

  // details link
  const link = document.querySelector('#c-details-link');
  if (link) link.href = `/feedback/full/${item.id}`;

  // quick tags
  const managerTags = new Set((annotation?.tags) || []);
  document.querySelectorAll('#qtags .qt').forEach(btn => {
    const tag = btn.dataset.tag;
    if (managerTags.has(tag)) btn.classList.add('active'); else btn.classList.remove('active');
  });
  const note = document.querySelector('#c-note');
  if (note) note.value = annotation?.note || '';

  showModal(true);
}

function collectQuickTags() {
  const tags = [];
  document.querySelectorAll('#qtags .qt.active').forEach(b => tags.push(b.dataset.tag));
  return tags;
}

async function saveAnnotation() {
  if (!currentCardId) return;
  const tags = collectQuickTags();
  const note = document.querySelector('#c-note')?.value || '';
  await apiPost('/annotate', { feedback_id: currentCardId, tags, note });
  toast('Аннотация сохранена');
}

function showModal(v) {
  const m = document.querySelector('#modal');
  if (m) m.classList.toggle('hidden', !v);
}

/* ---------- export CSV ---------- */
async function exportCsv() {
  const shop = document.querySelector('#f-shop')?.value.trim() || '';
  const sentiment = document.querySelector('#f-sentiment')?.value.trim() || '';
  const limit = parseInt(document.querySelector('#f-limit')?.value || '1000', 10);

  const url = new URL(API_BASE + '/export', window.location.origin);
  if (shop) url.searchParams.set('shop_id', shop);
  if (sentiment) url.searchParams.set('sentiment', sentiment);
  url.searchParams.set('limit', String(limit));

  const r = await fetch(url, { headers: { 'X-Admin-Token': adminToken() } });
  if (!r.ok) { toast('Ошибка экспорта'); return; }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `feedback_export_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- event wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // подставим сохранённый токен в инпут, если он есть
  const tokenInput = document.querySelector('#token');
  if (tokenInput) tokenInput.value = adminToken();

  // токен
  document.querySelector('#btn-save-token')?.addEventListener('click', () => {
    setAdminToken(document.querySelector('#token').value.trim());
    toast('Токен сохранён');
    // после сохранения сразу пробуем подгрузить настройки и список
    loadSettings().then(() => loadList({ reset: true })).catch(()=>{});
  });
  document.querySelector('#btn-logout')?.addEventListener('click', () => {
    setAdminToken('');
    toast('Вышли');
  });

  // настройки
  document.querySelector('#btn-save-settings')?.addEventListener('click', () => {
    saveSettings().catch(e => toast('Ошибка: ' + e.message));
  });

  // список
  document.querySelector('#btn-load')?.addEventListener('click', () => {
    loadList({ reset: true }).catch(e => toast('Ошибка: ' + e.message));
  });
  document.querySelector('#btn-more')?.addEventListener('click', () => {
    loadList({ reset: false }).catch(e => toast('Ошибка: ' + e.message));
  });

  // экспорт
  document.querySelector('#btn-export')?.addEventListener('click', () => {
    exportCsv().catch(e => toast('Ошибка: ' + e.message));
  });

  // делегируем действия в таблице
  document.addEventListener('click', (e) => {
    const play = e.target.closest('.btn-play');
    if (play) {
      const id = play.dataset.id;
      // отдельный общий плеер на странице
      const player = document.querySelector('#player') || document.querySelector('#c-audio');
      if (player) {
        player.src = `/feedback/redirect-audio/${id}`;
        player.play?.().catch(()=>{});
      }
      return;
    }
    const card = e.target.closest('.btn-card');
    if (card) {
      openCard(card.dataset.id).catch(err => toast('Ошибка карточки: ' + err.message));
      return;
    }
    const qt = e.target.closest('#qtags .qt');
    if (qt) {
      qt.classList.toggle('active');
      return;
    }
  });

  document.querySelector('#btn-save-anno')?.addEventListener('click', () => {
    saveAnnotation().catch(e => toast('Ошибка сохранения: ' + e.message));
  });

  document.querySelector('#modal-close')?.addEventListener('click', () => showModal(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') showModal(false); });

  // автоинициализация (попробуем — если нет токена, просто покажем тост)
  loadSettings().then(() => loadList({ reset: true })).catch(()=>{});
});
