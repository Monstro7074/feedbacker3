// простой SPA без сборщика
const tokenKey = 'ADMIN_TOKEN';

// --- helpers ---
function adminToken() { return localStorage.getItem(tokenKey) || ''; }
function setAdminToken(v) { localStorage.setItem(tokenKey, v || ''); }
function toast(msg) {
  const el = document.querySelector('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 1700);
}
async function apiGet(path, params={}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([k,v]) => (v!=='' && v!=null) && url.searchParams.set(k,v));
  const r = await fetch(url, { headers: { 'X-Admin-Token': adminToken() } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPut(path, body={}) {
  const r = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json', 'X-Admin-Token': adminToken() },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// --- settings ---
async function loadSettings() {
  try {
    const s = await apiGet('/admin/api/settings');
    document.querySelector('#threshold').value = s.TELEGRAM_ALERT_THRESHOLD ?? '0.4';
  } catch (e) {
    toast('Ошибка загрузки настроек');
  }
}
async function saveSettings() {
  try {
    const v = (document.querySelector('#threshold').value || '').trim();
    await apiPut('/admin/api/settings', { TELEGRAM_ALERT_THRESHOLD: v });
    toast('Сохранено');
  } catch (e) {
    toast('Ошибка сохранения');
  }
}

// --- list + pagination ---
let currentOffset = 0;
async function loadList({ reset=false } = {}) {
  const shop = document.querySelector('#f-shop').value.trim();
  const sentiment = document.querySelector('#f-sentiment').value.trim();
  const limit = parseInt(document.querySelector('#f-limit').value || '20', 10);

  if (reset) currentOffset = 0;

  const { items, nextOffset } = await apiGet('/admin/api/feedbacks', {
    shop_id: shop, sentiment, limit, offset: currentOffset
  });

  const tbody = document.querySelector('#rows');
  if (reset) tbody.innerHTML = '';

  for (const it of (items || [])) {
    const tr = document.createElement('tr');
    const ts = new Date(it.timestamp).toLocaleString();
    const tags = (it.tags || []).map(t => `<span class="pill">${t}</span>`).join(' ');
    tr.innerHTML = `
      <td>${ts}</td>
      <td>${it.shop_id || ''}</td>
      <td>${it.device_id || ''}</td>
      <td>${it.sentiment || ''}</td>
      <td>${it.emotion_score ?? ''}</td>
      <td>${tags}</td>
      <td class="right">
        <button class="btn btn-play" data-id="${it.id}">Прослушать</button>
        <a class="btn" href="/feedback/full/${it.id}" target="_blank">Детали</a>
      </td>
    `;
    tbody.appendChild(tr);
  }

  const moreBtn = document.querySelector('#btn-more');
  if (nextOffset != null) {
    currentOffset = nextOffset;
    moreBtn.disabled = false;
  } else {
    moreBtn.disabled = true;
  }
}

// делегирование: Прослушать -> ставим src на redirect
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-play');
  if (!btn) return;
  const id = btn.dataset.id;
  const player = document.querySelector('#player');
  player.src = `/feedback/redirect-audio/${id}`; // без токенов в JS
  player.play().catch(()=>{});
});

// --- wiring ---
document.addEventListener('DOMContentLoaded', () => {
  // токен
  document.querySelector('#token').value = adminToken();
  document.querySelector('#btn-save-token').addEventListener('click', () => {
    setAdminToken(document.querySelector('#token').value.trim());
    toast('Токен сохранён');
  });
  document.querySelector('#btn-logout').addEventListener('click', () => {
    setAdminToken(''); document.querySelector('#token').value = '';
    toast('Вышли');
  });

  // настройки
  document.querySelector('#btn-save-settings').addEventListener('click', () => {
    saveSettings();
  });

  // лента
  document.querySelector('#btn-load').addEventListener('click', () => loadList({ reset:true }).catch(e => toast('Ошибка загрузки')));
  document.querySelector('#btn-more').addEventListener('click', () => loadList().catch(e => toast('Ошибка загрузки')));

  // автозагрузка
  loadSettings();
});
