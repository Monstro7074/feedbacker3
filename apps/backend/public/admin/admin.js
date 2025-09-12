// apps/backend/public/admin/admin.js
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ============ API обёртка с токеном ============ */
  const API = {
    get token() {
      return localStorage.getItem('ADMIN_TOKEN') || '';
    },
    set token(v) {
      if (v) localStorage.setItem('ADMIN_TOKEN', v);
      else localStorage.removeItem('ADMIN_TOKEN');
    },
    async fetch(path, opts = {}) {
      const headers = Object.assign(
        {
          'x-admin-token': API.token,
          'Content-Type': 'application/json'
        },
        opts.headers || {}
      );

      const res = await fetch(`/admin${path}`, { ...opts, headers });

      if (res.status === 401) {
        throw new Error('unauthorized');
      }
      // экспорт CSV возвращает text/csv
      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      return ct.includes('application/json') ? res.json() : res.text();
    }
  };

  /* ============ Тосты ============ */
  function toast(msg) { window.alert(msg); } // простой вариант

  /* ============ DOM ============ */
  const tokenInput   = $('#adminToken');
  const saveTokenBtn = $('#btnSaveToken');
  const logoutBtn    = $('#btnLogout');

  const thrInput  = $('#threshold');
  const thrSave   = $('#btnSaveThreshold');

  const shopInput = $('#filterShop');
  const sentSel   = $('#filterSentiment');
  const limitInp  = $('#filterLimit');
  const loadBtn   = $('#btnLoad');
  const moreBtn   = $('#btnMore');
  const exportBtn = $('#btnExport');

  const tbody     = $('#tblBody');
  const player    = $('#player');

  let paging = { nextOffset: 0, lastQuery: null };

  /* ============ Рендер строки таблицы ============ */
  function trHtml(it) {
    const ts = new Date(it.timestamp).toLocaleString();
    const tags = (it.tags || []).join(', ');
    const score = (it.emotion_score ?? '').toString();
    return `
      <tr data-id="${it.id}">
        <td>${ts}</td>
        <td>${it.shop_id || ''}</td>
        <td>${it.device_id || ''}</td>
        <td>${it.sentiment || ''}</td>
        <td>${score}</td>
        <td>${tags}</td>
        <td>
          <button class="btnPlay" data-id="${it.id}">Прослушать</button>
          <button class="btnCard" data-id="${it.id}">Карточка</button>
        </td>
      </tr>
    `;
  }

  function bindRowActions() {
    // плеер
    $$('.btnPlay').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.id;
        player.src = `/feedback/redirect-audio/${id}`;
        player.play().catch(() => {});
      };
    });
    // карточка (пока просто показываем JSON)
    $$('.btnCard').forEach(b => {
      b.onclick = async () => {
        try {
          const id = b.dataset.id;
          const data = await API.fetch(`/api/feedback/${id}`);
          window.alert(JSON.stringify(data, null, 2));
        } catch (e) {
          toast('Не удалось открыть карточку: ' + e.message);
        }
      };
    });
  }

  /* ============ Загрузка списка ============ */
  async function loadList({ append = false } = {}) {
    const qs = new URLSearchParams();
    const shop = shopInput.value.trim();
    const sent = sentSel.value;
    const limit = parseInt(limitInp.value || '20', 10) || 20;

    qs.set('limit', limit);
    if (append && paging.nextOffset) qs.set('offset', paging.nextOffset);
    if (shop) qs.set('shop_id', shop);
    if (sent && sent !== 'any') qs.set('sentiment', sent);

    const queryStr = qs.toString();
    paging.lastQuery = queryStr;

    const res = await API.fetch(`/api/feedbacks?${queryStr}`);
    if (!append) tbody.innerHTML = '';
    (res.items || []).forEach(it => {
      tbody.insertAdjacentHTML('beforeend', trHtml(it));
    });
    bindRowActions();

    paging.nextOffset = res.nextOffset;
    moreBtn.disabled = !paging.nextOffset;
  }

  /* ============ Экспорт CSV ============ */
  function doExport() {
    // Для скачивания используем query-параметр ?token= (т.к. в <a download> нельзя передать заголовок)
    const qs = new URLSearchParams(paging.lastQuery || '');
    if (API.token) qs.set('token', API.token);
    const url = `/admin/api/export?${qs.toString()}`;
    window.open(url, '_blank');
  }

  /* ============ Настройки ============ */
  async function pullSettings() {
    const s = await API.fetch('/api/settings');
    thrInput.value = s.TELEGRAM_ALERT_THRESHOLD ?? '0.4';
  }
  async function pushSettings() {
    const v = parseFloat(thrInput.value);
    if (Number.isNaN(v)) return toast('Введите число');
    await API.fetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ TELEGRAM_ALERT_THRESHOLD: String(v) })
    });
    toast('Сохранено');
  }

  /* ============ Инициализация ============ */
  function initTokenUI() {
    tokenInput.value = API.token || 'ADMIN_TOKEN';
    saveTokenBtn.onclick = async () => {
      API.token = tokenInput.value.trim();
      try {
        await pullSettings();
        await loadList({ append: false });
        toast('Токен принят');
      } catch (e) {
        if (e.message === 'unauthorized') toast('Неверный токен');
        else toast('Ошибка: ' + e.message);
      }
    };
    logoutBtn.onclick = () => {
      API.token = '';
      tokenInput.value = '';
      tbody.innerHTML = '';
      moreBtn.disabled = true;
      player.removeAttribute('src');
      toast('Вышли из админки');
    };
  }

  async function init() {
    initTokenUI();

    loadBtn.onclick = () => loadList({ append: false }).catch(e => {
      if (e.message === 'unauthorized') toast('Введите верный токен и нажмите «Сохранить»');
      else toast('Ошибка загрузки списка: ' + e.message);
    });
    moreBtn.onclick = () => loadList({ append: true }).catch(e => {
      toast('Ошибка подгрузки: ' + e.message);
    });
    exportBtn.onclick = doExport;
    thrSave.onclick = () => pushSettings().catch(e => {
      if (e.message === 'unauthorized') toast('Нужен валидный токен');
      else toast('Ошибка сохранения: ' + e.message);
    });

    // Если токен уже сохранён — сразу пробуем подтянуть настройки и ленту
    if (API.token) {
      try {
        await pullSettings();
      } catch (e) {
        // молча, чтобы не спамить
      }
      try {
        await loadList({ append: false });
      } catch (e) {
        // молча
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
