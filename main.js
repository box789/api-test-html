(function () {
  const sendBtn = document.getElementById('sendBtn');
  const loading = document.getElementById('loading');
  const requestDisplay = document.getElementById('requestDisplay');
  const statusDisplay = document.getElementById('statusDisplay');
  const headersDisplay = document.getElementById('headersDisplay');
  const cookiesDisplay = document.getElementById('cookiesDisplay');
  const cookieInfo = document.getElementById('cookieInfo');
  const bodyDisplay = document.getElementById('bodyDisplay');
  const urlInput = document.getElementById('url');
  const methodSelect = document.getElementById('method');
  const credentialsSelect = document.getElementById('credentials');
  const bodyTextarea = document.getElementById('body');
  const headersList = document.getElementById('headersList');
  const cookiesEditor = document.getElementById('cookiesEditor');
  const saveCookiesBtn = document.getElementById('saveCookiesBtn');

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  }

  function stripHtml(html) {
    return String(html || '').replace(/<[^>]*>/g, '').trim();
  }

  let saveTimer;
  const respTabs = document.querySelectorAll('.resp-tab');
  const respPanes = document.querySelectorAll('.resp-pane');

  let tabs = [];
  let currentTabId = null;

  // ---- Cookie Store (manual reference, per-domain, persists in localStorage) ----
  let cookieStore = {};

  function loadCookieStore() {
    try { cookieStore = JSON.parse(localStorage.getItem('apiTester_cookies')) || {}; } catch (e) { cookieStore = {}; }
  }

  function saveCookieStore() {
    localStorage.setItem('apiTester_cookies', JSON.stringify(cookieStore));
  }

  function addCookieToStore(domain, name, value, attrs) {
    if (!cookieStore[domain]) cookieStore[domain] = {};
    if (attrs.maxAge !== null && attrs.maxAge <= 0) {
      delete cookieStore[domain][name];
      if (Object.keys(cookieStore[domain]).length === 0) delete cookieStore[domain];
      saveCookieStore();
      return 'deleted';
    }
    cookieStore[domain][name] = {
      value: value,
      path: attrs.path || '/',
      domain: attrs.domain || domain,
      httpOnly: !!attrs.httpOnly,
      secure: !!attrs.secure,
      sameSite: attrs.sameSite || null,
      date: Date.now()
    };
    saveCookieStore();
    return 'saved';
  }

  function renderCookieStore() {
    const domains = Object.keys(cookieStore);
    if (!domains.length) return '<span style="color:#6c7086;">(no cookies stored)</span>';
    let html = '';
    domains.sort().forEach(d => {
      html += '<div class="cookie-domain">[' + escapeHtml(d) + ']</div>';
      Object.entries(cookieStore[d]).forEach(([name, data]) => {
        const flags = [];
        if (data.httpOnly) flags.push('HttpOnly');
        if (data.secure) flags.push('Secure');
        if (data.sameSite) flags.push('SameSite=' + data.sameSite);
        const flagStr = flags.length ? ' <span class="cookie-flags">(' + flags.join(', ') + ')</span>' : '';
        html += '<div class="cookie-entry">' + escapeHtml(name) + ' = ' + escapeHtml(data.value) + flagStr + '</div>';
      });
    });
    return html;
  }

  function getUrlDomain(url) {
    try { return new URL(url).hostname; } catch { return null; }
  }

  // ---- Header helpers ----
  const FORBIDDEN_HEADERS_EXACT = new Set([
    'accept-charset', 'accept-encoding', 'access-control-request-headers',
    'access-control-request-method', 'connection', 'content-length', 'cookie',
    'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
    'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
  ]);
  const FORBIDDEN_HEADERS_PREFIXES = ['proxy-', 'sec-'];
  const CORS_SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type']);

  function isForbiddenHeader(name) {
    const lower = String(name || '').toLowerCase();
    if (FORBIDDEN_HEADERS_EXACT.has(lower)) return true;
    return FORBIDDEN_HEADERS_PREFIXES.some(prefix => lower.startsWith(prefix));
  }

  function getHeaderIgnoreCase(headersObj, targetName) {
    const target = targetName.toLowerCase();
    const key = Object.keys(headersObj).find(k => k.toLowerCase() === target);
    return key ? headersObj[key] : undefined;
  }

  function hasHeaderIgnoreCase(headersObj, targetName) {
    return getHeaderIgnoreCase(headersObj, targetName) !== undefined;
  }

  function getStatusClass(status) {
    if (status >= 200 && status < 300) return 'status-2xx';
    if (status >= 300 && status < 400) return 'status-3xx';
    if (status >= 400 && status < 500) return 'status-4xx';
    if (status >= 500) return 'status-5xx';
    return '';
  }

  function renderStatusHtml(status, statusText) {
    return '<span class="status-badge ' + getStatusClass(status) + '">' + status + ' ' + escapeHtml(statusText || '') + '</span>';
  }

  function normalizeCredentials(value) {
    return ['same-origin', 'include', 'omit'].includes(value) ? value : 'same-origin';
  }

  // ---- Tab management ----
  function generateId() { return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

  function createTabData(name) {
    return {
      id: generateId(),
      name: name || 'New Request',
      url: '',
      method: 'GET',
      credentials: 'same-origin',
      headers: [
        { k: 'Accept', v: '*/*' }
      ],
      body: '',
      response: null
    };
  }

  function saveToStorage() {
    localStorage.setItem('apiTester_tabs', JSON.stringify(tabs));
    localStorage.setItem('apiTester_activeTab', currentTabId);
  }

  function addHeader(key, val) {
    const div = document.createElement('div');
    div.className = 'header-pair';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'hdr-key';
    keyInput.placeholder = 'Header name';
    keyInput.value = key || '';

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'hdr-val';
    valInput.placeholder = 'Value';
    valInput.value = val || '';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => { div.remove(); autoSave(); });

    div.appendChild(keyInput);
    div.appendChild(valInput);
    div.appendChild(removeBtn);
    headersList.appendChild(div);
  }

  function renderHeaders(arr) {
    headersList.innerHTML = '';
    if (!arr || !arr.length) { addHeader('', ''); return; }
    arr.forEach(h => addHeader(h.k, h.v));
  }

  function getHeaders() {
    const pairs = document.querySelectorAll('.header-pair');
    const arr = [];
    pairs.forEach(p => {
      const k = p.querySelector('.hdr-key').value.trim();
      const v = p.querySelector('.hdr-val').value.trim();
      if (k) arr.push({ k, v });
    });
    return arr;
  }

  function collectFormData() {
    return {
      url: urlInput.value,
      method: methodSelect.value,
      credentials: normalizeCredentials(credentialsSelect?.value || 'same-origin'),
      headers: getHeaders(),
      body: bodyTextarea.value
    };
  }

  function applyFormData(data) {
    urlInput.value = data.url || '';
    methodSelect.value = data.method || 'GET';
    if (credentialsSelect) credentialsSelect.value = normalizeCredentials(data.credentials || 'same-origin');
    renderHeaders(data.headers);
    bodyTextarea.value = data.body || '';
    syncBodyState();
  }

  function getCurrentTab() { return tabs.find(t => t.id === currentTabId); }

  function saveCurrentTab() {
    const tab = getCurrentTab();
    if (!tab) return;
    const fd = collectFormData();
    tab.url = fd.url;
    tab.method = fd.method;
    tab.credentials = fd.credentials;
    tab.headers = fd.headers;
    tab.body = fd.body;
  }

  function loadTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    currentTabId = id;
    applyFormData(tab);
    renderTabs();
    showResponse(tab.response);
  }

  function switchTab(id) {
    if (id === currentTabId) return;
    saveCurrentTab();
    loadTab(id);
    saveToStorage();
  }

  function startRenameTab(tab, element) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = tab.name;
    input.style.cssText = 'background:#1e1e2e;border:1px solid #cba6f7;color:#cdd6f4;padding:2px 6px;border-radius:4px;font-size:13px;min-width:70px;max-width:180px;';
    element.replaceWith(input);
    input.focus();
    input.select();

    const finish = (apply) => {
      if (apply) tab.name = input.value.trim() || tab.name;
      renderTabs();
      saveToStorage();
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
  }

  function renderTabs() {
    const bar = document.getElementById('tabBar');
    bar.innerHTML = '';
    tabs.forEach(t => {
      const el = document.createElement('div');
      el.className = 'tab-item' + (t.id === currentTabId ? ' active' : '');
      el.setAttribute('data-id', t.id);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = t.name;
      nameSpan.title = 'Double click to rename';
      nameSpan.addEventListener('dblclick', e => {
        e.stopPropagation();
        startRenameTab(t, nameSpan);
      });
      el.appendChild(nameSpan);

      const close = document.createElement('button');
      close.className = 'close-btn';
      close.textContent = '×';
      close.title = 'Delete tab';
      close.addEventListener('click', e => { e.stopPropagation(); deleteTab(t.id); });
      el.appendChild(close);
      el.addEventListener('click', () => switchTab(t.id));
      bar.appendChild(el);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add new tab';
    addBtn.addEventListener('click', addTab);
    bar.appendChild(addBtn);
  }

  function addTab() {
    saveCurrentTab();
    const tab = createTabData('Request ' + (tabs.length + 1));
    tabs.push(tab);
    currentTabId = tab.id;
    applyFormData(tab);
    renderTabs();
    saveToStorage();
    showResponse(null);
  }

  function deleteTab(id) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    if (currentTabId === id) {
      const next = tabs[Math.min(idx, tabs.length - 1)];
      currentTabId = next.id;
      applyFormData(next);
      showResponse(next.response);
    }
    renderTabs();
    saveToStorage();
  }

  function autoSave() {
    saveCurrentTab();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToStorage, 300);
  }

  function updateCookiesEditor() {
    const domain = getUrlDomain(urlInput.value);
    if (!domain) { cookiesEditor.value = ''; return; }
    loadCookieStore();
    if (!cookieStore[domain] || !Object.keys(cookieStore[domain]).length) {
      cookiesEditor.value = '';
      return;
    }
    cookiesEditor.value = Object.entries(cookieStore[domain])
      .map(([name, data]) => name + '=' + data.value)
      .join('; ');
  }

  function showResponse(resp) {
    updateCookiesEditor();
    if (!resp) {
      requestDisplay.innerHTML = '<span style="color:#6c7086;">No request sent yet.</span>';
      statusDisplay.innerHTML = '<span style="color:#6c7086;">No request sent yet.</span>';
      headersDisplay.innerHTML = '<span style="color:#6c7086;">No request sent yet.</span>';
      cookiesDisplay.innerHTML = '<span style="color:#6c7086;">No request sent yet.</span>';
      cookieInfo.innerHTML = '<span style="color:#6c7086;">No request sent yet.</span>';
      bodyDisplay.innerHTML = '<span style="color:#6c7086;">No request sent yet.</span>';
      return;
    }

    if (resp.error) {
      statusDisplay.innerHTML = '<span class="status-badge" style="background:#f38ba8;color:#1e1e2e;">Error</span>';
      headersDisplay.textContent = '(no headers)';
      cookiesDisplay.innerHTML = renderCookieStore();
      cookieInfo.innerHTML = 'Error: <span class="error-text">' + escapeHtml(resp.error) + '</span>';
      bodyDisplay.textContent = 'Error: ' + resp.error;
      requestDisplay.textContent = resp.requestLog || '';
      return;
    }

    if (typeof resp.statusCode === 'number') {
      statusDisplay.innerHTML = renderStatusHtml(resp.statusCode, resp.statusText || '');
    } else if (resp.statusHtml) {
      statusDisplay.textContent = stripHtml(resp.statusHtml) || 'Status available';
    } else {
      statusDisplay.innerHTML = '<span style="color:#6c7086;">No status</span>';
    }

    headersDisplay.textContent = resp.headersText || '(no headers)';
    cookiesDisplay.innerHTML = resp.cookiesHtml || '<span style="color:#6c7086;">(no cookies stored)</span>';

    if (resp.cookieInfoHtml) {
      cookieInfo.innerHTML = resp.cookieInfoHtml;
    } else {
      cookieInfo.innerHTML = escapeHtml(resp.cookieInfo || '');
    }

    bodyDisplay.textContent = resp.bodyText || '';
    requestDisplay.textContent = resp.requestLog || '';
  }

  function switchRespTab(name) {
    const allowed = new Set(['request', 'status', 'headers', 'cookies', 'body']);
    if (!allowed.has(name)) return;

    respTabs.forEach(t => t.classList.remove('active'));
    respPanes.forEach(p => p.classList.remove('active'));

    const tab = document.querySelector('.resp-tab[data-tab="' + name + '"]');
    const pane = document.getElementById('tab-' + name);
    if (tab) tab.classList.add('active');
    if (pane) pane.classList.add('active');
  }

  function tryFormatJson(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }

  function formatResponseHeaders(response) {
    const parts = [];
    response.headers.forEach((val, key) => { parts.push(key + ': ' + val); });
    return parts.join('\n') + '\n';
  }

  function syncBodyState() {
    const method = methodSelect.value;
    const isNoBodyMethod = ['GET', 'HEAD'].includes(method);
    bodyTextarea.disabled = isNoBodyMethod;
    bodyTextarea.placeholder = isNoBodyMethod ? '(body not applicable for ' + method + ')' : '{"key": "value"}';
  }

  // ---- Send handler ----
  sendBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { alert('Please enter a URL'); return; }

    saveCurrentTab();

    const method = methodSelect.value;
    const body = bodyTextarea.value;
    const domain = getUrlDomain(url);

    const rawHeaders = getHeaders();
    const headers = {};
    rawHeaders.forEach(h => {
      const key = h.k.trim();
      if (!key) return;
      headers[key] = h.v;
    });

    if (!['GET', 'HEAD'].includes(method) && !hasHeaderIgnoreCase(headers, 'Content-Type')) {
      headers['Content-Type'] = 'application/json';
    }

    const forbiddenHeaders = Object.keys(headers).filter(isForbiddenHeader);
    const effectiveHeaders = {};
    Object.entries(headers).forEach(([k, v]) => {
      if (!isForbiddenHeader(k)) effectiveHeaders[k] = v;
    });

    sendBtn.disabled = true;
    loading.classList.add('active');

    const credentials = normalizeCredentials(credentialsSelect?.value || 'same-origin');
    const crossOrigin = (() => { try { return new URL(url).origin !== location.origin; } catch { return false; } })();

    const contentType = String(getHeaderIgnoreCase(effectiveHeaders, 'Content-Type') || '').toLowerCase();
    const isNonSimpleContentType = !!contentType && !['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'].includes(contentType);
    const hasCustomHeaders = Object.keys(effectiveHeaders).some(k => !CORS_SAFE_HEADERS.has(k.toLowerCase()));
    const mayPreflight = !['GET', 'HEAD', 'POST'].includes(method) || isNonSimpleContentType || hasCustomHeaders;

    let requestLog = method + ' ' + url + '\n\n--- Request Headers ---\n';
    Object.entries(headers).forEach(([k, v]) => { requestLog += k + ': ' + v + '\n'; });

    if (forbiddenHeaders.length > 0) {
      requestLog += '\n--- ⚠ Fetch restriction ---\n';
      requestLog += 'These headers are forbidden and will be stripped by browser fetch: ' + forbiddenHeaders.join(', ') + '\n';
    }

    if (body && !['GET', 'HEAD'].includes(method)) {
      requestLog += '\n--- Request Body ---\n' + body + '\n';
    } else if (body && ['GET', 'HEAD'].includes(method)) {
      requestLog += '\n--- Body Note ---\nBody is ignored for ' + method + ' requests.\n';
    }

    if (url.toLowerCase().startsWith('http://')) {
      requestLog += '\n--- ⚠ Security Warning ---\nRequest uses plain HTTP. Headers/body/tokens can be intercepted on the network.\n';
    }

    if (crossOrigin && mayPreflight) {
      requestLog += '\n--- CORS Note ---\nBrowser may send OPTIONS preflight before actual ' + method + '.\nCheck DevTools (F12 > Network) to see both requests.\n';
    }

    requestDisplay.textContent = requestLog;
    switchRespTab('request');

    let respData = { requestLog };

    loadCookieStore();
    const cookiesBefore = document.cookie;

    const fetchOptions = { method, headers: effectiveHeaders, credentials };
    if (!['GET', 'HEAD'].includes(method) && body) fetchOptions.body = body;

    try {
      const response = await fetch(url, fetchOptions);
      const responseStatus = response.status;
      const responseStatusText = response.statusText;

      let responseBodyText = '';
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json') || ct.includes('text/') || ct.includes('xml') || ct.includes('html')) {
        responseBodyText = await response.text();
      } else {
        const blob = await response.blob();
        responseBodyText = '[Binary data: ' + (blob.type || 'unknown type') + ', ' + blob.size + ' bytes]';
      }

      // Set-Cookie is a forbidden response-header name for fetch.
      // Browser JS cannot read it directly. We use document.cookie diff,
      // which only reflects same-origin, non-HttpOnly cookies.
      let cookieResults = [];
      if (!crossOrigin && domain) {
        const cookiesAfter = document.cookie;
        if (cookiesAfter !== cookiesBefore) {
          const before = {};
          cookiesBefore.split(';').map(s => s.trim()).filter(Boolean).forEach(c => {
            const e = c.indexOf('=');
            if (e > 0) before[c.slice(0, e).trim()] = c.slice(e + 1).trim();
          });
          const after = {};
          cookiesAfter.split(';').map(s => s.trim()).filter(Boolean).forEach(c => {
            const e = c.indexOf('=');
            if (e > 0) after[c.slice(0, e).trim()] = c.slice(e + 1).trim();
          });
          for (const [n, v] of Object.entries(after)) {
            if (before[n] === undefined || before[n] !== v) {
              addCookieToStore(domain, n, v, {});
              cookieResults.push({ name: n, action: 'saved' });
            }
          }
        }
      }

      const formattedBody = tryFormatJson(responseBodyText);
      const statusHtml = renderStatusHtml(responseStatus, responseStatusText);
      const headersText = formatResponseHeaders(response) || '(no headers)';
      const cookiesHtml = renderCookieStore();

      const added = cookieResults.filter(r => r.action === 'saved');
      let cookieInfoHtml = '';
      if (added.length > 0) {
        cookieInfoHtml = 'Detected and stored <span>' + added.length + '</span> cookie(s) from same-origin response (';
        cookieInfoHtml += added.map(r => escapeHtml(r.name)).join(', ') + ')';
      }
      if (!cookieInfoHtml) {
        cookieInfoHtml = crossOrigin
          ? 'Cross-origin response: browser does not expose Set-Cookie to JavaScript. Use DevTools (F12 > Network) to inspect cookies.'
          : 'No readable new cookies detected. HttpOnly cookies are not readable via JavaScript.';
      }

      statusDisplay.innerHTML = statusHtml;
      headersDisplay.textContent = headersText;
      cookiesDisplay.innerHTML = cookiesHtml;
      cookieInfo.innerHTML = cookieInfoHtml;
      bodyDisplay.textContent = formattedBody;
      switchRespTab('status');

      respData.statusCode = responseStatus;
      respData.statusText = responseStatusText;
      respData.statusHtml = statusHtml;
      respData.headersText = headersText;
      respData.cookiesHtml = cookiesHtml;
      respData.cookieInfoHtml = cookieInfoHtml;
      respData.bodyText = formattedBody;
      respData.error = null;

      updateCookiesEditor();
    } catch (err) {
      const errMsg = err?.message || String(err);
      statusDisplay.innerHTML = '<span class="status-badge" style="background:#f38ba8;color:#1e1e2e;">Error</span>';
      headersDisplay.textContent = '(no headers)';
      cookiesDisplay.innerHTML = renderCookieStore();
      cookieInfo.innerHTML = 'Error: <span class="error-text">' + escapeHtml(errMsg) + '</span>';
      updateCookiesEditor();
      bodyDisplay.textContent = 'Error: ' + errMsg;
      switchRespTab('status');

      respData.error = errMsg;
    } finally {
      const tab = getCurrentTab();
      if (tab) { tab.response = respData; saveToStorage(); }
      sendBtn.disabled = false;
      loading.classList.remove('active');
    }
  });

  saveCookiesBtn.addEventListener('click', () => {
    const raw = cookiesEditor.value.trim();
    const domain = getUrlDomain(urlInput.value);
    if (!domain) { alert('Enter a URL first to associate cookies with the domain.'); return; }

    loadCookieStore();
    if (!raw) {
      delete cookieStore[domain];
      saveCookieStore();
      cookiesDisplay.innerHTML = renderCookieStore();
      cookieInfo.innerHTML = 'Local cookie reference cleared for <span>' + escapeHtml(domain) + '</span>';
      return;
    }

    const newCookies = {};
    raw.split(';').map(s => s.trim()).filter(Boolean).forEach(pair => {
      const eq = pair.indexOf('=');
      if (eq > 0) newCookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });

    cookieStore[domain] = {};
    Object.entries(newCookies).forEach(([name, value]) => {
      cookieStore[domain][name] = { value, path: '/', domain, httpOnly: false, secure: false, sameSite: null, date: Date.now() };
    });
    saveCookieStore();

    cookiesDisplay.innerHTML = renderCookieStore();
    cookieInfo.innerHTML = 'Saved <span>' + Object.keys(newCookies).length + '</span> local cookie reference value(s) for <span>' + escapeHtml(domain) + '</span>';
  });

  // Auto-save on form changes
  [urlInput, methodSelect, credentialsSelect, bodyTextarea].filter(Boolean).forEach(el => {
    el.addEventListener('input', autoSave);
    el.addEventListener('change', autoSave);
  });
  headersList.addEventListener('input', autoSave);

  methodSelect.addEventListener('change', syncBodyState);

  // Stable delegated help handler
  document.addEventListener('click', e => {
    const target = e.target;
    if (target && target.classList && target.classList.contains('http-only-help')) {
      e.preventDefault();
      alert('Open DevTools (F12) > Application > Cookies and select the domain to view all cookies including HttpOnly.');
    }
  });

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    loadCookieStore();
    const stored = localStorage.getItem('apiTester_tabs');
    if (stored) {
      try {
        tabs = JSON.parse(stored);
        currentTabId = localStorage.getItem('apiTester_activeTab');
        if (!tabs.find(t => t.id === currentTabId)) currentTabId = tabs[0]?.id;
      } catch {
        tabs = [];
      }
    }
    if (!tabs.length) {
      const tab = createTabData('Request 1');
      tabs.push(tab);
      currentTabId = tab.id;
    }
    renderTabs();
    const tab = getCurrentTab();
    if (tab) { applyFormData(tab); showResponse(tab.response); }

    syncBodyState();
  });

  window.addEventListener('beforeunload', () => {
    saveCurrentTab();
    clearTimeout(saveTimer);
    saveToStorage();
  });

  // Expose handlers used by inline HTML attributes
  window.addHeader = addHeader;
  window.switchRespTab = switchRespTab;
})();
