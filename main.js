(function () {
  const sendBtn = document.getElementById('sendBtn');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const requestDisplay = document.getElementById('requestDisplay');
  const requestDetails = document.getElementById('requestDetails');
  const statusBar = document.getElementById('statusBar');
  const statusStrip = document.getElementById('statusStrip');
  const statusBarBadge = document.getElementById('statusBarBadge');
  const statusBarTime = document.getElementById('statusBarTime');
  const statusBarSize = document.getElementById('statusBarSize');
  const headersDisplay = document.getElementById('headersDisplay');
  const cookiesDisplay = document.getElementById('cookiesDisplay');
  const cookieInfo = document.getElementById('cookieInfo');
  const bodyDisplay = document.getElementById('bodyDisplay');
  const urlInput = document.getElementById('url');
  const urlError = document.getElementById('urlError');
  const methodSelect = document.getElementById('method');
  const credentialsSelect = document.getElementById('credentials');
  const bodyTextarea = document.getElementById('body');
  const headersList = document.getElementById('headersList');
  const cookiesEditor = document.getElementById('cookiesEditor');
  const saveCookiesBtn = document.getElementById('saveCookiesBtn');
  const addHeaderBtn = document.getElementById('addHeaderBtn');
  const respTabButtons = document.querySelectorAll('.resp-tab[role="tab"]');

  // ---- HTML escaping ----
  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  }

  function stripHtml(html) {
    return String(html || '').replace(/<[^>]*>/g, '').trim();
  }

  // ---- State ----
  let saveTimer;
  let tabs = [];
  let currentTabId = null;
  let cookieStore = {};
  let lastResponseMeta = null; // { status, statusText, duration, size, stripClass }

  // ---- Cookie Store ----
  function loadCookieStore() {
    try { cookieStore = JSON.parse(localStorage.getItem('apiTester_cookies')) || {}; } catch (e) { cookieStore = {}; }
  }

  function saveCookieStore() {
    try {
      localStorage.setItem('apiTester_cookies', JSON.stringify(cookieStore));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('Cookie store: localStorage quota exceeded');
      }
    }
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
    if (!domains.length) return '<span style="color:var(--text-subtle);">(no cookies stored)</span>';
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

  function getStripClass(status) {
    if (status >= 200 && status < 300) return 'strip-2xx';
    if (status >= 300 && status < 400) return 'strip-3xx';
    if (status >= 400 && status < 500) return 'strip-4xx';
    if (status >= 500) return 'strip-5xx';
    return 'strip-err';
  }

  function renderStatusBadge(status, statusText) {
    return '<span class="status-badge ' + getStatusClass(status) + '">' + status + ' ' + escapeHtml(statusText || '') + '</span>';
  }

  function normalizeCredentials(value) {
    return ['same-origin', 'include', 'omit'].includes(value) ? value : 'same-origin';
  }

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
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
      headers: [{ k: 'Accept', v: '*/*' }],
      body: '',
      response: null,
      responseMeta: null
    };
  }

  function saveToStorage() {
    try {
      localStorage.setItem('apiTester_tabs', JSON.stringify(tabs));
      localStorage.setItem('apiTester_activeTab', currentTabId);
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('Tab storage: localStorage quota exceeded.');
      }
    }
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
    removeBtn.setAttribute('aria-label', 'Remove header');
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
    clearUrlError();
    lastResponseMeta = data.responseMeta || null;
    updateStatusBar();
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
    showResponse(tab.response, tab.responseMeta);
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
    input.style.cssText = 'background:var(--bg-base);border:1px solid var(--accent);color:var(--text-primary);padding:2px 6px;border-radius:4px;font-size:13px;min-width:70px;max-width:180px;';

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
      el.setAttribute('tabindex', '0');

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
      close.setAttribute('aria-label', 'Delete tab');
      close.addEventListener('click', e => { e.stopPropagation(); deleteTab(t.id); });
      el.appendChild(close);
      el.addEventListener('click', () => switchTab(t.id));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') switchTab(t.id); });
      bar.appendChild(el);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add new tab';
    addBtn.setAttribute('aria-label', 'Add new tab');
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
      showResponse(next.response, next.responseMeta);
    }
    renderTabs();
    saveToStorage();
  }

  function autoSave() {
    saveCurrentTab();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToStorage, 300);
  }

  // ---- URL error ----
  function showUrlError(msg) {
    urlError.textContent = msg;
    urlError.classList.add('active');
  }

  function clearUrlError() {
    urlError.textContent = '';
    urlError.classList.remove('active');
  }

  // ---- Status bar ----
  function updateStatusBar() {
    if (lastResponseMeta) {
      const meta = lastResponseMeta;
      statusBarBadge.innerHTML = renderStatusBadge(meta.status, meta.statusText || '');
      statusBarTime.textContent = meta.duration !== null ? formatDuration(meta.duration) : '';
      statusBarSize.textContent = meta.size !== null ? formatBytes(meta.size) : '';
      statusBar.classList.add('active');
      statusStrip.className = 'status-strip active ' + (meta.stripClass || '');
    } else {
      statusBar.classList.remove('active');
      statusStrip.className = 'status-strip';
    }
  }

  function setResponseMeta(status, statusText, duration, size) {
    lastResponseMeta = {
      status: status,
      statusText: statusText || '',
      duration: duration !== undefined ? duration : null,
      size: size !== undefined ? size : null,
      stripClass: getStripClass(status)
    };
    updateStatusBar();

    const tab = getCurrentTab();
    if (tab) {
      tab.responseMeta = lastResponseMeta;
      saveToStorage();
    }
  }

  // ---- Cookies editor dirty flag ----
  let cookiesEditorDirty = false;

  cookiesEditor.addEventListener('input', () => { cookiesEditorDirty = true; });

  function updateCookiesEditor() {
    if (cookiesEditorDirty) return;
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

  function markCookiesEditorClean() {
    cookiesEditorDirty = false;
  }

  // ---- Response display ----
  function showResponse(resp, respMeta) {
    markCookiesEditorClean();
    updateCookiesEditor();

    if (respMeta) {
      lastResponseMeta = respMeta;
      updateStatusBar();
    } else if (!resp) {
      lastResponseMeta = null;
      updateStatusBar();
    }

    if (!resp) {
      requestDisplay.innerHTML = '<span class="empty-state">No request sent yet.</span>';
      headersDisplay.innerHTML = '<span class="empty-state">No request sent yet.</span>';
      cookiesDisplay.innerHTML = '<span class="empty-state">No request sent yet.</span>';
      cookieInfo.innerHTML = '<span class="empty-state">No request sent yet.</span>';
      bodyDisplay.innerHTML = '<span class="empty-state">Enter a URL above and click Send to see the response here.</span>';
      if (requestDetails) requestDetails.open = false;
      return;
    }

    if (resp.error) {
      requestDisplay.textContent = resp.requestLog || '(no request)';
      headersDisplay.textContent = '(no headers)';
      cookiesDisplay.innerHTML = renderCookieStore();
      cookieInfo.innerHTML = 'Error: <span class="error-text">' + escapeHtml(resp.error) + '</span>';
      bodyDisplay.textContent = 'Error: ' + resp.error;
      if (requestDetails) requestDetails.open = true;
      return;
    }

    requestDisplay.textContent = resp.requestLog || '';
    headersDisplay.textContent = resp.headersText || '(no headers)';
    cookiesDisplay.innerHTML = resp.cookiesHtml || '<span style="color:var(--text-subtle);">(no cookies stored)</span>';

    if (resp.cookieInfoHtml) {
      cookieInfo.innerHTML = resp.cookieInfoHtml;
    } else {
      cookieInfo.innerHTML = escapeHtml(resp.cookieInfo || '');
    }

    bodyDisplay.textContent = resp.bodyText || '';
    if (requestDetails) requestDetails.open = false;
  }

  // ---- Response tab switching ----
  function switchRespTab(name) {
    const allowed = new Set(['body', 'headers', 'cookies']);
    if (!allowed.has(name)) return;

    const tabs = document.querySelectorAll('.resp-tab[role="tab"]');
    const panes = document.querySelectorAll('.resp-pane[role="tabpanel"]');

    tabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    panes.forEach(p => p.classList.remove('active'));

    const tabBtn = document.getElementById('tab-btn-' + name);
    const pane = document.getElementById('tab-pane-' + name);

    if (tabBtn) {
      tabBtn.classList.add('active');
      tabBtn.setAttribute('aria-selected', 'true');
      tabBtn.setAttribute('tabindex', '0');
      tabBtn.focus();
    }
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
  async function doSend() {
    const url = urlInput.value.trim();
    clearUrlError();

    if (!url) {
      showUrlError('Enter a URL');
      urlInput.focus();
      return;
    }

    let validUrl;
    try {
      validUrl = new URL(url);
    } catch {
      showUrlError('Invalid URL format');
      urlInput.focus();
      return;
    }

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
    loadingSpinner.classList.add('active');
    clearUrlError();

    const credentials = normalizeCredentials(credentialsSelect?.value || 'same-origin');
    const crossOrigin = validUrl.origin !== location.origin;

    const contentType = String(getHeaderIgnoreCase(effectiveHeaders, 'Content-Type') || '').toLowerCase();
    const isNonSimpleContentType = !!contentType && !['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'].includes(contentType);
    const hasCustomHeaders = Object.keys(effectiveHeaders).some(k => !CORS_SAFE_HEADERS.has(k.toLowerCase()));
    const mayPreflight = !['GET', 'HEAD', 'POST'].includes(method) || isNonSimpleContentType || hasCustomHeaders;

    let requestLog = method + ' ' + url + '\n\n--- Request Headers ---\n';
    Object.entries(headers).forEach(([k, v]) => { requestLog += k + ': ' + v + '\n'; });

    if (forbiddenHeaders.length > 0) {
      requestLog += '\n--- Fetch restriction ---\n';
      requestLog += 'These headers are forbidden and will be stripped by browser fetch: ' + forbiddenHeaders.join(', ') + '\n';
    }

    if (body && !['GET', 'HEAD'].includes(method)) {
      requestLog += '\n--- Request Body ---\n' + body + '\n';
    } else if (body && ['GET', 'HEAD'].includes(method)) {
      requestLog += '\n--- Body Note ---\nBody is ignored for ' + method + ' requests.\n';
    }

    if (url.toLowerCase().startsWith('http://')) {
      requestLog += '\n--- Security Warning ---\nRequest uses plain HTTP. Headers/body/tokens can be intercepted on the network.\n';
    }

    if (crossOrigin && mayPreflight) {
      requestLog += '\n--- CORS Note ---\nBrowser may send OPTIONS preflight before actual ' + method + '.\nCheck DevTools (F12 > Network) to see both requests.\n';
    }

    requestDisplay.textContent = requestLog;
    if (requestDetails) requestDetails.open = true;

    let respData = { requestLog };

    loadCookieStore();
    const cookiesBefore = document.cookie;

    const fetchOptions = { method, headers: effectiveHeaders, credentials };
    if (!['GET', 'HEAD'].includes(method) && body) fetchOptions.body = body;

    try {
      const startTime = performance.now();
      const response = await fetch(url, fetchOptions);
      const duration = performance.now() - startTime;

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

      const bodySizeBytes = (typeof responseBodyText === 'string')
        ? new Blob([responseBodyText]).size
        : null;

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

      headersDisplay.textContent = headersText;
      cookiesDisplay.innerHTML = cookiesHtml;
      cookieInfo.innerHTML = cookieInfoHtml;
      bodyDisplay.textContent = formattedBody;
      switchRespTab('body');

      respData.statusCode = responseStatus;
      respData.headersText = headersText;
      respData.cookiesHtml = cookiesHtml;
      respData.cookieInfoHtml = cookieInfoHtml;
      respData.bodyText = formattedBody;
      respData.error = null;

      setResponseMeta(responseStatus, responseStatusText, duration, bodySizeBytes);

      markCookiesEditorClean();
      updateCookiesEditor();
    } catch (err) {
      const errMsg = err?.message || String(err);
      const isCorsError = errMsg.toLowerCase().includes('failed to fetch') && crossOrigin;

      if (isCorsError) {
        const targetOrigin = (() => { try { return new URL(url).origin; } catch { return url; } })();
        const corsHelp = [
          'CORS Error: The server did not allow this cross-origin request.',
          '',
          'The server at ' + targetOrigin + ' must respond with:',
          '  Access-Control-Allow-Origin: ' + location.origin,
          '',
          'Options to work around this:',
          '• Use a CORS proxy: https://corsproxy.io/?' + encodeURIComponent(url),
          '• Install a browser extension that disables CORS (for dev only)',
          '• Run the server with CORS headers enabled'
        ].join('\n');

        bodyDisplay.textContent = corsHelp;
        headersDisplay.textContent = '(blocked by CORS policy)';
        cookiesDisplay.innerHTML = renderCookieStore();
        cookieInfo.innerHTML = 'Request blocked by CORS policy. See Response Body for details.';
      } else {
        headersDisplay.textContent = '(no headers)';
        cookiesDisplay.innerHTML = renderCookieStore();
        cookieInfo.innerHTML = 'Error: <span class="error-text">' + escapeHtml(errMsg) + '</span>';
        bodyDisplay.textContent = 'Error: ' + errMsg;
      }

      markCookiesEditorClean();
      updateCookiesEditor();

      setResponseMeta(isCorsError ? 0 : 0, isCorsError ? 'CORS blocked' : 'Error', null, null);

      respData.error = errMsg;
    } finally {
      const tab = getCurrentTab();
      if (tab) {
        tab.response = respData;
        tab.responseMeta = lastResponseMeta;
        saveToStorage();
      }
      sendBtn.disabled = false;
      loadingSpinner.classList.remove('active');
    }
  }

  sendBtn.addEventListener('click', doSend);

  // ---- Keyboard shortcuts ----
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      doSend();
    }
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doSend();
    }
  });

  // Response tab keyboard navigation (ArrowLeft / ArrowRight)
  document.querySelector('.resp-tabs')?.addEventListener('keydown', e => {
    const tabs = Array.from(document.querySelectorAll('.resp-tab[role="tab"]'));
    const currentIdx = tabs.findIndex(t => t.classList.contains('active'));
    if (currentIdx === -1) return;

    let newIdx = currentIdx;
    if (e.key === 'ArrowRight') newIdx = (currentIdx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') newIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    else return;

    e.preventDefault();
    switchRespTab(tabs[newIdx].getAttribute('data-tab'));
  });

  // Response tab click/keydown
  document.querySelectorAll('.resp-tab[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => switchRespTab(tab.getAttribute('data-tab')));
    tab.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchRespTab(tab.getAttribute('data-tab'));
      }
    });
  });

  // ---- Save Cookies ----
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
      markCookiesEditorClean();
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
    markCookiesEditorClean();
  });

  // ---- Add Header btn ----
  addHeaderBtn.addEventListener('click', () => addHeader());

  // ---- Auto-save on form changes ----
  [urlInput, methodSelect, credentialsSelect, bodyTextarea].filter(Boolean).forEach(el => {
    el.addEventListener('input', autoSave);
    el.addEventListener('change', autoSave);
  });
  headersList.addEventListener('input', autoSave);

  methodSelect.addEventListener('change', syncBodyState);

  urlInput.addEventListener('input', clearUrlError);

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
        console.warn('Could not restore previous session — starting fresh.');
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
    if (tab) { applyFormData(tab); showResponse(tab.response, tab.responseMeta); }

    syncBodyState();
  });

  window.addEventListener('beforeunload', () => {
    saveCurrentTab();
    clearTimeout(saveTimer);
    saveToStorage();
  });

  // Legacy exports for external access
  window.addHeader = addHeader;
  window.switchRespTab = switchRespTab;
})();
