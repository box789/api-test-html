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
const bodyTextarea = document.getElementById('body');
const headersList = document.getElementById('headersList');
const cookiesEditor = document.getElementById('cookiesEditor');
const saveCookiesBtn = document.getElementById('saveCookiesBtn');


function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

let saveTimer;
const respTabs = document.querySelectorAll('.resp-tab');
const respPanes = document.querySelectorAll('.resp-pane');

let tabs = [];
let currentTabId = null;

// ---- Cookie Store (manual, per-domain, persists in localStorage) ----
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

function parseSetCookieHeaders(url, rawHeaders) {
  const domain = getUrlDomain(url);
  if (!domain) return [];
  const results = [];
  rawHeaders.forEach(raw => {
    try {
      const parts = raw.split(';').map(s => s.trim());
      const first = parts[0];
      const eqIdx = first.indexOf('=');
      if (eqIdx <= 0) return;
      const name = first.substring(0, eqIdx).trim();
      const value = first.substring(eqIdx + 1).trim();
      let maxAge = null, path = '/', cookieDomain = domain;
      let httpOnly = false, secure = false, sameSite = null;
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const eq = p.indexOf('=');
        let key, val;
        if (eq > 0) { key = p.substring(0, eq).trim().toLowerCase(); val = p.substring(eq + 1).trim(); }
        else { key = p.trim().toLowerCase(); val = ''; }
        if (key === 'max-age') maxAge = parseInt(val, 10);
        else if (key === 'path') path = val || '/';
        else if (key === 'domain') cookieDomain = val.replace(/^\./, '');
        else if (key === 'httponly') httpOnly = true;
        else if (key === 'secure') secure = true;
        else if (key === 'samesite') sameSite = val.toLowerCase();
      }
      const action = addCookieToStore(cookieDomain, name, value, { maxAge, path, domain: cookieDomain, httpOnly, secure, sameSite });
      results.push({ name, value, domain: cookieDomain, path, httpOnly, secure, sameSite, action });
    } catch (e) { console.warn('Set-Cookie parse error:', raw, e); }
  });
  return results;
}

function buildCookieHeader(domain) {
  loadCookieStore();
  if (!cookieStore[domain]) return '';
  return Object.entries(cookieStore[domain])
    .map(([name, data]) => name + '=' + data.value)
    .join('; ');
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

// ---- Tab management ----
function generateId() { return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

function createTabData(name) {
  return {
    id: generateId(),
    name: name || 'New Request',
    url: '',
    method: 'GET',
    headers: [
      { k: 'Content-Type', v: 'application/json' },
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
  return { url: urlInput.value, method: methodSelect.value, headers: getHeaders(), body: bodyTextarea.value };
}

function applyFormData(data) {
  urlInput.value = data.url || '';
  methodSelect.value = data.method || 'GET';
  renderHeaders(data.headers);
  bodyTextarea.value = data.body || '';
}

function getCurrentTab() { return tabs.find(t => t.id === currentTabId); }

function saveCurrentTab() {
  const tab = getCurrentTab();
  if (!tab) return;
  const fd = collectFormData();
  tab.url = fd.url; tab.method = fd.method; tab.headers = fd.headers; tab.body = fd.body;
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

function renderTabs() {
  const bar = document.getElementById('tabBar');
  bar.innerHTML = '';
  tabs.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (t.id === currentTabId ? ' active' : '');
    el.setAttribute('data-id', t.id);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = t.name;
    el.appendChild(nameSpan);
    const close = document.createElement('button');
    close.className = 'close-btn';
    close.textContent = '\u00d7';
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
  statusDisplay.innerHTML = resp.statusHtml || '<span style="color:#6c7086;">No status</span>';
  headersDisplay.textContent = resp.headersText || '(no headers)';
  cookiesDisplay.innerHTML = resp.cookiesHtml || '<span style="color:#6c7086;">(no cookies stored)</span>';
  cookieInfo.innerHTML = escapeHtml(resp.cookieInfo || '');
  bodyDisplay.textContent = resp.bodyText || '';
  requestDisplay.textContent = resp.requestLog || '';
}

function switchRespTab(name) {
  respTabs.forEach(t => t.classList.remove('active'));
  respPanes.forEach(p => p.classList.remove('active'));
  document.querySelector('.resp-tab[data-tab="' + name + '"]').classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

function getStatusClass(status) {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  if (status >= 500) return 'status-5xx';
  return '';
}

function tryFormatJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function formatResponseHeaders(response) {
  const parts = [];
  response.headers.forEach((val, key) => { parts.push(key + ': ' + val); });
  return parts.join('\n') + '\n';
}

// ---- Send handler ----
sendBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { alert('Please enter a URL'); return; }

  saveCurrentTab();

  const method = methodSelect.value;
  const headersArr = getHeaders();
  const body = bodyTextarea.value;

  const domain = getUrlDomain(url);
  const headers = {};
  headersArr.forEach(h => { headers[h.k] = h.v; });

  sendBtn.disabled = true;
  loading.classList.add('active');

  const crossOrigin = (() => { try { return new URL(url).origin !== location.origin; } catch { return false; } })();
  const isNonSimpleContentType = headers['Content-Type'] && !['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'].includes(headers['Content-Type']);
  const hasCustomHeaders = Object.keys(headers).some(k => !['cookie', 'content-type', 'accept', 'accept-language', 'content-language'].includes(k.toLowerCase()));
  const mayPreflight = !['GET', 'HEAD', 'POST'].includes(method) || isNonSimpleContentType || hasCustomHeaders;

  let requestLog = method + ' ' + url + '\n\n--- Request Headers ---\n';
  Object.entries(headers).forEach(([k, v]) => { requestLog += k + ': ' + v + '\n'; });
  if (body && !['GET', 'HEAD'].includes(method)) {
    requestLog += '\n--- Request Body ---\n' + body + '\n';
  }
  if (crossOrigin && mayPreflight) {
    requestLog += '\n--- CORS Note ---\nBrowser may send OPTIONS preflight before actual ' + method + '.\nCheck DevTools (F12 > Network) to see both requests.\n';
  }
  requestDisplay.textContent = requestLog;
  switchRespTab('request');

  let respData = { requestLog };

  loadCookieStore();
  const cookiesBefore = document.cookie;

  // For same-origin requests the browser automatically attaches cookies
  // (default fetch credentials: 'same-origin'). Manual Cookie header is a
  // forbidden header name in the Fetch spec and would be stripped anyway.

  const fetchOptions = { method, headers, credentials: 'same-origin' };
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

    // Detect cookies: try response headers (works with --disable-web-security), then fallback to document.cookie diff
    let cookieResults = [];
    try {
      response.headers.forEach((val, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          cookieResults = cookieResults.concat(parseSetCookieHeaders(url, [val]));
        }
      });
    } catch (e) {}
    if (cookieResults.length === 0 && domain) {
      const cookiesAfter = document.cookie;
      if (cookiesAfter !== cookiesBefore) {
        const before = {}; cookiesBefore.split(';').map(s => s.trim()).filter(Boolean).forEach(c => { const e = c.indexOf('='); if (e > 0) before[c.slice(0, e).trim()] = c.slice(e + 1).trim(); });
        const after = {}; cookiesAfter.split(';').map(s => s.trim()).filter(Boolean).forEach(c => { const e = c.indexOf('='); if (e > 0) after[c.slice(0, e).trim()] = c.slice(e + 1).trim(); });
        const newOrChanged = [];
        for (const [n, v] of Object.entries(after)) {
          if (before[n] === undefined || before[n] !== v) newOrChanged.push({ name: n, value: v });
        }
        newOrChanged.forEach(c => addCookieToStore(domain, c.name, c.value, {}));
        cookieResults = newOrChanged.map(c => ({ name: c.name, action: 'saved' }));
      }
    }

    const formattedBody = tryFormatJson(responseBodyText);
    const statusHtml = '<span class="status-badge ' + getStatusClass(responseStatus) + '">' + responseStatus + ' ' + responseStatusText + '</span>';
    const headersText = formatResponseHeaders(response) || '(no headers)';
    const cookiesHtml = renderCookieStore();

    const added = cookieResults.filter(r => r.action === 'saved');
    const deleted = cookieResults.filter(r => r.action === 'deleted');
    let cookieInfoHtml = '';
    if (added.length > 0) {
      cookieInfoHtml = 'Received <span>' + added.length + '</span> cookie(s) from this response (';
      cookieInfoHtml += added.map(r => r.name).join(', ') + ')';
    }
    if (deleted.length > 0) {
      if (cookieInfoHtml) cookieInfoHtml += '. ';
      cookieInfoHtml += 'Deleted <span>' + deleted.length + '</span> cookie(s) (' + deleted.map(r => r.name).join(', ') + ')';
    }
    if (!cookieInfoHtml) {
      cookieInfoHtml = 'No cookies in this response. Stored cookies preserved.';
    }
    if (added.length === 0 && cookieResults.length === 0) {
      loadCookieStore();
      const hasCookies = Object.keys(cookieStore).length > 0;
      if (!hasCookies) {
        cookieInfoHtml += ' &#x24d8; HttpOnly cookies (like .AspNet.ApplicationCookie) cannot be read via JavaScript but are stored by browser. <a href="#" id="httpOnlyHelpLink" style="color:#cba6f7;">How to view?</a>';
        setTimeout(() => {
          document.getElementById('httpOnlyHelpLink')?.addEventListener('click', e => { e.preventDefault(); alert('Open DevTools (F12) > Application > Cookies and select the domain to view all cookies including HttpOnly.'); });
        }, 0);
      }
    }

    statusDisplay.innerHTML = statusHtml;
    headersDisplay.textContent = headersText;
    cookiesDisplay.innerHTML = cookiesHtml;
    cookieInfo.innerHTML = cookieInfoHtml;
    bodyDisplay.textContent = formattedBody;
    switchRespTab('status');

    respData.statusHtml = statusHtml;
    respData.headersText = headersText;
    respData.cookiesHtml = cookiesHtml;
    respData.cookieInfo = cookieInfoHtml;
    respData.bodyText = formattedBody;
    respData.error = null;

    updateCookiesEditor();

  } catch (err) {
    const errMsg = err.message;
    statusDisplay.innerHTML = '<span class="status-badge" style="background:#f38ba8;color:#1e1e2e;">Error</span>';
    headersDisplay.textContent = '(no headers)';
    cookiesDisplay.innerHTML = renderCookieStore();
    cookieInfo.innerHTML = 'Error: <span class="error-text">' + escapeHtml(errMsg) + '</span>';
    updateCookiesEditor();
    bodyDisplay.textContent = 'Error: ' + errMsg;
    switchRespTab('status');

    respData.error = errMsg;
  }

  const tab = getCurrentTab();
  if (tab) { tab.response = respData; saveToStorage(); }

  sendBtn.disabled = false;
  loading.classList.remove('active');
});

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

saveCookiesBtn.addEventListener('click', () => {
  const raw = cookiesEditor.value.trim();
  const domain = getUrlDomain(urlInput.value);
  if (!domain) { alert('Enter a URL first to associate cookies with the domain.'); return; }

  loadCookieStore();
  if (!raw) {
    delete cookieStore[domain];
    saveCookieStore();
    cookiesDisplay.innerHTML = renderCookieStore();
    cookieInfo.innerHTML = 'Cookies cleared for <span>' + escapeHtml(domain) + '</span>';
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
  cookieInfo.innerHTML = 'Saved <span>' + Object.keys(newCookies).length + '</span> cookie(s) for <span>' + escapeHtml(domain) + '</span>';
});

// Auto-save on form changes
[urlInput, methodSelect, bodyTextarea].forEach(el => {
  el.addEventListener('input', autoSave);
  el.addEventListener('change', autoSave);
});
headersList.addEventListener('input', autoSave);

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadCookieStore();
  const stored = localStorage.getItem('apiTester_tabs');
  if (stored) {
    try {
      tabs = JSON.parse(stored);
      currentTabId = localStorage.getItem('apiTester_activeTab');
      if (!tabs.find(t => t.id === currentTabId)) currentTabId = tabs[0]?.id;
    } catch { tabs = []; }
  }
  if (!tabs.length) {
    const tab = createTabData('Request 1');
    tabs.push(tab);
    currentTabId = tab.id;
  }
  renderTabs();
  const tab = getCurrentTab();
  if (tab) { applyFormData(tab); showResponse(tab.response); }
});
