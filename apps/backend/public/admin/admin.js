// apps/backend/public/admin/admin.js
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    token: localStorage.getItem('admin_token') || '',
    nextSince: null,     // для пагинации (ISO)
    lastFilters: null,   // запомним последние фильтры
  };

  // --- UI helpers ---
  function toast(msg, type = 'info') {
    console.log(`[${type}]`, msg);
    // простая реализация: alert-на-время без блокировки потока
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText =
      'position:fixed;right:16px;top:16px;background:#222;color:#fff;padding:10px 14px;border-radius:8px;z-index:9999;opacity:0.95';
    if (type === 'error') el.style.background = '#b00020';
    if (type === 'success') el.style.background = '#2e7d32';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function setTokenToUi(token) {
    $('#token').value = token || '';
  }

  async function safeFetch(url, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (state.token) headers.set('x-admin-token', state.token);
    headers.set('Accept', 'application/json');
    return fetch(url, { ...opts, headers });
  }

  // --- SETTINGS ---
  async function loadSettings() {
    if (!state.token) {
      // нет токена — не ломаем страницу, просто просим ввести
      toast('Введите ADMIN_TOKEN и сохраните', 'info');
      return;
    }
    const r = await safeFetch('/admin/api/settings');
    if (r.status === 401) { toast('Неверный ADMIN_TOKEN', 'error'); return; }
    if (!r.ok) { toast('Ошибка загрузки настроек', 'error'); return; }
    const js = await r.json();
    const v = Number(js?.TELEGRAM_ALERT_THRESHOLD ?? 0.4);
    $('#alert-threshold').value = isNaN(v) ? 0.4 : v;
  }

  async function saveSettings() {
    const v = Number($('#alert-threshold').value);
    const r = await safeFetch('/admin/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TELEGRAM_ALERT_THRESHOLD: v })
    });
    if (r.status === 401) { toast('Неверный ADMIN_TOKEN', 'error'); return; }
    if (!r.ok) { toast('Не удалось сохранить', 'error'); return; }
    toast('Сохранено', 'success');
  }

  // --- LIST + PAGINATION ---
  function readFilters() {
    const shop = ($('#shop').value || '').trim();
    const sentiment = $('#sentiment').value; // '', 'positive', 'neutral', 'negative'
    const limit = Math.max(1, Math.min(100, Number($('#limit').value || 20)));
    return { shop, sentiment, limit };
  }

  // NEW: генерация HTML для селекта статуса
  function statusSelectHtml(id, value) {
    const v = value || 'new';
    return `
      <select class="status-select" data-id="${id}">
        <option value="new" ${v === 'new' ? 'selected' : ''}>new</option>
        <option value="in_progress" ${v === 'in_progress' ? 'selected' : ''}>in_progress</option>
        <option value="resolved" ${v === 'resolved' ? 'selected' : ''}>resolved</option>
      </select>
    `;
  }

  function rowHtml(item) {
    const dt = new Date(item.timestamp);
    const when = dt.toLocaleString();
    const emo = (item.emotion_score ?? '').toString();
    const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
    const s = item.sentiment;

    // NEW: колонка статуса — берём с бэка, если пришёл; иначе показываем 'new'
    const statusCell = statusSelectHtml(item.id, item.manager_status);

    return `
      <tr data-id="${item.id}">
        <td>${when}</td>
        <td>${item.shop_id || ''}</td>
        <td>${item.device_id || ''}</td>
        <td>${s || ''}</td>
        <td>${emo}</td>
        <td>${tags}</td>
        <td>${statusCell}</td>          <!-- NEW: Статус -->
        <td>
          <button class="btn btn-sm play" data-id="${item.id}">Прослушать</button>
          <button class="btn btn-sm card" data-id="${item.id}">Карточка</button>
        </td>
      </tr>
    `;
  }

  function clearTable() { $('#tbody').innerHTML = ''; }

  function appendRows(items) {
    const html = items.map(rowHtml).join('');
    $('#tbody').insertAdjacentHTML('beforeend', html);
  }

  async function fetchList({ shop, sentiment, limit, since }) {
    // наш публичный роут, токен не нужен
    const params = new URLSearchParams();
    params.set('since', since || '1970-01-01T00:00:00Z');
    params.set('limit', String(limit));
    const r = await fetch(`/feedback/${encodeURIComponent(shop || 'shop_001')}?${params}`);
    if (!r.ok) throw new Error('fetch list failed');
    const arr = await r.json();
    // локальная фильтрация по sentiment (если выбрано в UI)
    const filtered = sentiment ? arr.filter(x => x.sentiment === sentiment) : arr;
    return filtered;
  }

  async function loadFirstPage() {
    const f = readFilters();
    state.lastFilters = f;
    state.nextSince = null;
    clearTable();

    const items = await fetchList({ ...f, since: f.since || '1970-01-01T00:00:00Z' });
    appendRows(items);

    // запомним метку для следующей страницы (берём последний timestamp)
    if (items.length) {
      const lastTs = items[items.length - 1].timestamp;
      // сдвигаемся на 1 мс назад, чтобы не дублировать пограничный
      const prev = new Date(lastTs).getTime() - 1;
      state.nextSince = new Date(prev).toISOString();
    }
  }

  async function loadMore() {
    if (!state.lastFilters) return;
    const f = state.lastFilters;
    const since = state.nextSince || '1970-01-01T00:00:00Z';
    const items = await fetchList({ ...f, since });
    appendRows(items);
    if (items.length) {
      const lastTs = items[items.length - 1].timestamp;
      const prev = new Date(lastTs).getTime() - 1;
      state.nextSince = new Date(prev).toISOString();
    }
  }

  // --- AUDIO ---
  function playById(id) {
    const audio = $('#player');
    audio.src = `/feedback/redirect-audio/${encodeURIComponent(id)}`;
    audio.play().catch(() => {/* автоплей может быть заблокирован браузером */});
  }

  // --- CARD MODAL (минимум, без внешних зависимостей) ---
  async function openCard(id) {
    const r = await fetch(`/feedback/full/${encodeURIComponent(id)}`);
    if (!r.ok) { toast('Не удалось загрузить карточку', 'error'); return; }
    const js = await r.json();
    const d = js.feedback || {};
    const tags = Array.isArray(d.tags) ? d.tags.join(', ') : '';

    const html = `
      <div class="modal-backdrop"></div>
      <div class="modal">
        <div class="modal-hd">
          <strong>Карточка отзыва</strong>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-bd">
          <p><b>ID:</b> ${d.id}</p>
          <p><b>Магазин:</b> ${d.shop_id}</p>
          <p><b>Устройство:</b> ${d.device_id ?? ''}</p>
          <p><b>Время:</b> ${new Date(d.timestamp).toLocaleString()}</p>
          <p><b>Сентимент:</b> ${d.sentiment} (${d.emotion_score})</p>
          <p><b>Теги:</b> ${tags}</p>
          <p><b>Резюме:</b> ${d.summary ?? ''}</p>
          <details><summary>Транскрипт</summary><pre style="white-space:pre-wrap">${d.transcript ?? ''}</pre></details>
        </div>
        <div class="modal-ft">
          <button class="btn play-modal" data-id="${d.id}">▶ Прослушать</button>
          <button class="btn modal-close">Закрыть</button>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-close') || e.target === wrap) wrap.remove();
      if (e.target.classList.contains('play-modal')) playById(e.target.dataset.id);
    });
  }

  // --- CSV ---
  async function exportCsv() {
    const f = readFilters();
    // CSV отдаёт защищённый /admin/api/export => нужен токен в заголовке
    const params = new URLSearchParams();
    if (f.shop) params.set('shop_id', f.shop);
    if (f.limit) params.set('limit', String(f.limit));
    const r = await safeFetch(`/admin/api/export?${params.toString()}`);
    if (r.status === 401) { toast('Неверный ADMIN_TOKEN', 'error'); return; }
    if (!r.ok) { toast('Экспорт не удался', 'error'); return; }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.download = `feedback_${f.shop || 'all'}_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // --- EVENTS ---
  function bindEvents() {
    // токен: загрузить/сохранить/выйти
    setTokenToUi(state.token);

    $('#saveToken').addEventListener('click', () => {
      const t = $('#token').value.trim();
      if (!t) { toast('Токен пустой', 'error'); return; }
      state.token = t;
      localStorage.setItem('admin_token', t);
      toast('Токен сохранён', 'success');
      loadSettings().catch(() => {});
    });

    $('#logout').addEventListener('click', () => {
      localStorage.removeItem('admin_token');
      state.token = '';
      setTokenToUi('');
      toast('Токен удалён', 'success');
    });

    // настройки
    $('#saveSettings').addEventListener('click', () => {
      saveSettings().catch(err => { console.error(err); toast('Ошибка сохранения', 'error'); });
    });

    // лента
    $('#load').addEventListener('click', () => {
      loadFirstPage().catch(err => { console.error(err); toast('Ошибка загрузки ленты', 'error'); });
    });

    $('#more').addEventListener('click', () => {
      loadMore().catch(err => { console.error(err); toast('Не удалось подгрузить ещё', 'error'); });
    });

    // действия в таблице (делегирование)
    $('#tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.classList.contains('play')) return playById(id);
      if (btn.classList.contains('card')) return openCard(id);
    });

    // NEW: делегирование изменения статуса и запоминание предыдущего значения
    $('#tbody').addEventListener('focusin', (e) => {
      const sel = e.target.closest('.status-select');
      if (sel) sel.setAttribute('data-prev', sel.value);
    });

    $('#tbody').addEventListener('change', async (e) => {
      const sel = e.target.closest('.status-select');
      if (!sel) return;
      const id = sel.getAttribute('data-id');
      const status = sel.value;

      try {
        const res = await safeFetch(`/admin/api/feedbacks/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP_${res.status}`);
        }
        toast('Статус обновлён', 'success');
        // опционально можно подсветить строку
        // e.target.closest('tr').dataset.status = status;
      } catch (err) {
        console.error(err);
        toast('Ошибка обновления статуса', 'error');
        // откат значения
        const prev = sel.getAttribute('data-prev') || 'new';
        sel.value = prev;
      }
    });

    // CSV
    $('#exportCsv').addEventListener('click', () => {
      exportCsv().catch(err => { console.error(err); toast('Ошибка экспорта', 'error'); });
    });
  }

  // --- START ---
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    // если токен уже сохранён — тихо подтянем настройки
    if (state.token) loadSettings().catch(() => {});
    // а ленту можно грузить сразу (она публичная)
    loadFirstPage().catch(() => {});
  });
})();
