# План патча: улучшение безопасности и качества кода

**Дата:** 2026-07-06
**Проект:** API Tester (`C:\Repos\api-test-html`)

---

## Контекст

Проект — Postman-подобный инструмент для тестирования API из браузера (vanilla JS).
Аудит выявил 2 критических XSS, несколько функциональных багов (в т.ч. полностью
неработающую систему кук), проблемы с Fetch API и качеством кода.

Ниже — план исправлений в порядке приоритета.

---

## Статус выполнения (после применения патча)

- [x] **P0.1** XSS через `response.statusText` — выполнено
- [x] **P0.2** XSS через имена кук — выполнено
- [x] **P0.3** IIFE / сокращение глобальной области — выполнено
- [x] **P1.4** Credentials mode selector + сохранение в табе — выполнено
- [x] **P1.5** Не добавлять `Content-Type` для `GET/HEAD` по умолчанию — выполнено
- [x] **P1.6** Нормализация/проверка заголовков без учёта регистра — выполнено
- [x] **P1.7** Честная логика Cookie Store, удаление мёртвого кода — выполнено
- [x] **P1.8** Предупреждение о forbidden headers в Request log — выполнено
- [x] **P1.9** Disable `Body` для `GET/HEAD` — выполнено
- [x] **P2.10** `beforeunload` flush для автосохранения — выполнено
- [x] **P2.11** Разблокировка UI в `finally` — выполнено
- [x] **P2.12** Убрана хрупкая схема `innerHTML + setTimeout` для подсказки — выполнено (реализовано через стабильный обработчик событий)
- [x] **P2.13** Warning при `http://` — выполнено
- [x] **P2.14** Пустой `catch` устранён — выполнено
- [x] **P3.15** Переименование табов (double-click) — выполнено
- [x] **P3.16** Убран хардкод `max-height: calc(100vh - 460px)` — выполнено

---

## P0 — Безопасность (критично)

### 1. XSS через `response.statusText`

**Файл:** `main.js`, строка 424

**Проблема:** `responseStatusText` (приходит с сервера) интерполируется в HTML-строку
без `escapeHtml()` и записывается в `innerHTML`. Злонамеренный сервер может вернуть
`200 <img src=x onerror=alert(1)>` → выполнение JS в контексте приложения.

**Исправление:** Заменить строку 424:
```js
// Было:
const statusHtml = '<span class="status-badge ' + getStatusClass(responseStatus) + '">'
  + responseStatus + ' ' + responseStatusText + '</span>';
// Стало:
const statusHtml = '<span class="status-badge ' + getStatusClass(responseStatus) + '">'
  + responseStatus + ' ' + escapeHtml(responseStatusText) + '</span>';
```

**Статус-проверка:** убедиться, что `escapeHtml()` применяется и при повторном показе
сохранённого ответа (`showResponse`, строка 307) — там уже `resp.statusHtml`, который
содержит отформатированный HTML. Исправление выше защищает оба пути.

---

### 2. XSS через имена кук из Set-Cookie

**Файл:** `main.js`, строки 431–438

**Проблема:** Имена кук из заголовка `Set-Cookie` (в т.ч. от злонамеренного сервера)
конкатенируются в `cookieInfoHtml` без экранирования и пишутся в `innerHTML` (строка 456).

**Исправление:** Применить `escapeHtml()` к каждому `r.name`:

```js
// Строки 431–438 заменить на:
if (added.length > 0) {
  cookieInfoHtml = 'Received <span>' + added.length + '</span> cookie(s) from this response (';
  cookieInfoHtml += added.map(r => escapeHtml(r.name)).join(', ') + ')';
}
if (deleted.length > 0) {
  if (cookieInfoHtml) cookieInfoHtml += '. ';
  cookieInfoHtml += 'Deleted <span>' + deleted.length + '</span> cookie(s) ('
    + deleted.map(r => escapeHtml(r.name)).join(', ') + ')';
}
```

---

### 3. IIFE / module scope для функций

**Файл:** `main.js`

**Проблема:** Все функции — в глобальной области. После XSS атакующий получает
прямой доступ к `switchRespTab`, `saveToStorage`, `cookieStore` и т.д.

**Исправление:** Оборачиваем весь `main.js` (кроме инлайн-onclick в HTML) в IIFE
и явно экспортируем только те функции, что вызываются из HTML-атрибутов:

```js
(function() {
  // ... весь текущий код ...
  window.addHeader = addHeader;
  window.switchRespTab = switchRespTab;
})();
```

**Затрагивает:** HTML-инлайн `onclick="addHeader()"` и `onclick="switchRespTab(...)"`.

---

## P1 — Функциональные баги

### 4. Credentials mode — добавить переключатель

**Файл:** `index.html` (добавить UI) + `main.js` (использовать)

**Проблема:** Жёстко зашито `credentials: 'same-origin'`. Cross-origin куки не
отправляются никогда.

**Исправление:**

**index.html** — добавить после method-select:
```html
<select id="credentials" class="method-select" style="width:auto;">
  <option value="same-origin">same-origin</option>
  <option value="include">include</option>
  <option value="omit">omit</option>
</select>
```

**main.js** — в строке 383 заменить:
```js
// Было:
const fetchOptions = { method, headers, credentials: 'same-origin' };
// Стало:
const credentials = document.getElementById('credentials').value;
const fetchOptions = { method, headers, credentials };
```

Добавить в `collectFormData` и `applyFormData` поле `credentials` для сохранения
в табах.

---

### 5. Content-Type не добавлять для GET/HEAD

**Файл:** `main.js`, строка 134

**Проблема:** В `createTabData()` по умолчанию создаются заголовки `Content-Type:
application/json` и `Accept: */*`. Для GET/HEAD отправка `Content-Type` — лишняя
и вызывает unnecessary CORS preflight.

**Исправление:** В `createTabData` не добавлять `Content-Type` по умолчанию, либо
добавлять динамически в момент отправки. Проще: убрать из дефолтных заголовков и
добавлять только если метод не GET/HEAD:

```js
// В createTabData (строка 128–140):
function createTabData(name) {
  return {
    id: generateId(),
    name: name || 'New Request',
    url: '',
    method: 'GET',
    headers: [
      { k: 'Accept', v: '*/*' }
    ],
    body: '',
    response: null
  };
}
```

А в send handler (перед fetch) добавлять `Content-Type: application/json`, если
метод не GET/HEAD и пользователь не указал свой Content-Type.

---

### 6. Нормализация ключей заголовков

**Файл:** `main.js`, строка 352–361

**Проблема:** `headers['Content-Type']` чувствителен к регистру. Пользователь
может ввести `content-type`, и preflight-detection не сработает.

**Исправление:** Нормализовать ключи в canonical form (Title-Case для FETCH API
это не требуется, но для консистентности):

```js
// После строки 352:
const headers = {};
headersArr.forEach(h => {
  const key = h.k.trim();
  if (key) headers[key] = h.v;
});

// Нормализованная проверка Content-Type:
function getHeader(headersObj, name) {
  const lower = name.toLowerCase();
  const found = Object.keys(headersObj).find(k => k.toLowerCase() === lower);
  return found ? headersObj[found] : undefined;
}

// Заменить строку 359:
const contentType = getHeader(headers, 'Content-Type');
const isNonSimpleContentType = contentType && !['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'].includes(contentType);
```

---

### 7. Честный Cookie Store + очистка мёртвого кода

**Файл:** `main.js`

**Проблемы:**
- `buildCookieHeader()` (строка 95–101) — никогда не вызывается
- `Set-Cookie` через `Headers.forEach()` нечитаем (forbidden response-header name)
- UI выглядит как работающий, но куки никуда не отправляются

**Исправления:**

a) Удалить `buildCookieHeader()` (строки 95–101) — мёртвый код.

b) Заменить комментарий в send-обработчике (строки 379–381) на более честный:
```js
// Примечание: Set-Cookie из fetch недоступен JS (forbidden response-header name).
// Куки детектятся через document.cookie diff — работает только для same-origin,
// не-HttpOnly кук. Для кросс-доменных запросов используйте DevTools (F12 > Network).
```

c) Очистить мёртвую попытку чтения Set-Cookie из заголовков:
```js
// Строки 400–421 заменить на:
let cookieResults = [];
const cookiesAfter = document.cookie;
if (cookiesAfter !== cookiesBefore && domain) {
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
```

d) Заменить UI-текст с "Received X cookie(s)" на более честный с учётом same-origin
ограничения.

---

### 8. Предупреждение о forbidden headers

**Файл:** `main.js`, после строки 363

**Проблема:** Пользователь видит в Request log заголовки, которые fetch молча
отбрасывает (Cookie, User-Agent, Host, Referer и др.).

**Исправление:** Добавить проверку и предупреждение:

```js
const FORBIDDEN_HEADERS = [
  'cookie', 'set-cookie', 'user-agent', 'host', 'referer',
  'referrer', 'accept-encoding', 'accept-charset', 'connection',
  'origin', 'access-control-request-headers',
  'access-control-request-method', 'content-length', 'date', 'dnt',
  'expect', 'from', 'keep-alive', 'proxy-', 'sec-', 'upgrade', 'via',
  'warning', 'www-authenticate'
];

function isForbiddenHeader(name) {
  const lower = name.toLowerCase();
  return FORBIDDEN_HEADERS.some(f =>
    f.endsWith('-') ? lower.startsWith(f) : lower === f
  );
}
```

В send handler, после построения requestLog, добавить:
```js
const forbiddenWarnings = Object.keys(headers)
  .filter(k => isForbiddenHeader(k));
if (forbiddenWarnings.length > 0) {
  requestLog += '\n--- ⚠ Warning ---\n'
    + 'These headers are forbidden by the Fetch API and will be STRIPPED:\n  '
    + forbiddenWarnings.join(', ');
}
```

---

### 9. Disable body textarea для GET/HEAD

**Файл:** `main.js`

**Проблема:** Body textarea активен для GET/HEAD, но fetch и request-log игнорируют
body для этих методов.

**Исправление:** Добавить обработчик на изменение method:
```js
document.getElementById('method').addEventListener('change', () => {
  const method = document.getElementById('method').value;
  bodyTextarea.disabled = ['GET', 'HEAD'].includes(method);
  if (bodyTextarea.disabled) {
    bodyTextarea.placeholder = '(body not applicable for ' + method + ')';
  } else {
    bodyTextarea.placeholder = '{"key": "value"}';
  }
});
// Вызвать при инициализации
```

---

## P2 — Качество и надёжность

### 10. beforeunload handler

**Файл:** `main.js`

**Проблема:** 300ms debounce + нет beforeunload → потеря данных при быстром
закрытии страницы.

**Исправление:** Добавить в init:
```js
window.addEventListener('beforeunload', () => {
  saveCurrentTab();
  clearTimeout(saveTimer);
  saveToStorage();
});
```

---

### 11. Кнопка не блокируется навсегда при ошибке в catch

**Файл:** `main.js`, строки 469–486

**Проблема:** Если catch сам выбросит исключение, sendBtn останется disabled.

**Исправление:** Использовать `try/catch/finally` или обернуть catch-block:

```js
// Заменить строки 386–487:
const fetchOptions = { method, headers, credentials };
if (!['GET', 'HEAD'].includes(method) && body) fetchOptions.body = body;

try {
  // ... fetch и обработка ...
} catch (err) {
  // ... обработка ошибки ...
} finally {
  sendBtn.disabled = false;
  loading.classList.remove('active');
}
```

---

### 12. HttpOnly help link — надёжный обработчик

**Файл:** `main.js`, строки 442–451

**Проблема:** Ссылка вставляется через innerHTML, а обработчик клика — через
setTimeout(0). Может не сработать.

**Исправление:** Использовать делегирование события:
```js
// Вместо setTimeout:
if (!hasCookies) {
  cookieInfoHtml += ' &#x24d8; HttpOnly cookies... <a href="#" class="http-only-help" style="color:#cba6f7;">How to view?</a>';
  // Добавить один статический обработчик через делегирование
}
```

```js
// В init или один раз:
document.addEventListener('click', e => {
  if (e.target.classList.contains('http-only-help')) {
    e.preventDefault();
    alert('Open DevTools (F12) > Application > Cookies and select the domain.');
  }
});
```

---

### 13. Предупреждение об HTTP

**Файл:** `main.js`, send handler

**Проблема:** Нет предупреждения при отправке на `http://`.

**Исправление:**
```js
if (url.startsWith('http://')) {
  requestLog += '\n--- ⚠ Security Warning ---\n'
    + 'Request is sent over plain HTTP! Data (including headers, body, tokens) is transmitted in cleartext.\n';
}
```

---

### 14. Непустой catch

**Файл:** `main.js`, строка 408

**Проблема:** Пустой `catch (e) {}`.

**Исправление:**
```js
} catch (e) {
  console.warn('Header iteration failed:', e);
}
```

---

## P3 — UX и косметика

### 15. Редактирование имён табов

**Файл:** `main.js`

Добавить double-click на имя таба для редактирования:
```js
nameSpan.addEventListener('dblclick', () => {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = t.name;
  input.style.cssText = 'background:#1e1e2e;border:1px solid #cba6f7;color:#cdd6f4;padding:2px 6px;border-radius:4px;font-size:13px;width:100px;';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener('blur', () => {
    t.name = input.value.trim() || t.name;
    renderTabs();
    saveToStorage();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { renderTabs(); }
  });
});
```

### 16. CSS — динамическая высота контента

**Файл:** `main.css`, строка 46

**Проблема:** `max-height: calc(100vh - 460px)` — хардкод.

**Исправление:** Использовать flex-grow на контейнере вместо хардкода:
```css
.resp-pane pre {
  max-height: none; /* или убрать свойство */
}
```
Либо добавить в JS вычисление динамической высоты при resize.

---

## Порядок выполнения

1. **P0** (1–3): XSS-фиксы — самый приоритет. Меняют только `main.js`.
2. **P1** (4): Credentials selector — меняет `index.html` + `main.js`.
3. **P1** (5): Content-Type для GET/HEAD — меняет `main.js`.
4. **P1** (6): Нормализация заголовков — меняет `main.js`.
5. **P1** (7): Cookie store — меняет `main.js`.
6. **P1** (8): Forbidden headers warning — меняет `main.js`.
7. **P1** (9): Disable body для GET/HEAD — меняет `main.js`.
8. **P2** (10–14): Качество — меняет `main.js`.
9. **P3** (15–16): UX — меняет `main.js` + `main.css`.

---

## Верификация

После каждого изменения:
1. Открыть `index.html` в браузере.
2. Отправить тестовый запрос на `https://httpbin.org/anything`.
3. Проверить, что:
   - Статус-бейдж отображается корректно.
   - Вкладка Cookies показывает честное сообщение.
   - Request log показывает правильные заголовки с предупреждениями.
   - Credentials selector меняет поведение fetch.
   - Body textarea дисаблится для GET/HEAD.
4. Проверить XSS: открыть DevTools и убедиться, что statusText с HTML-тегами
   не выполняется (показан как текст).
5. Закрыть/обновить страницу — данные не теряются.

---

## Риски

- **IIFE (п.3)** может сломать инлайн `onclick="switchRespTab(...)"` в index.html.
  Нужно проверить и либо перевести onclick на addEventListener, либо явно
  экспортировать функции в window.
- **Cookie refactor (п.7)** — изменение логики обнаружения кук. Если пользователи
  полагались на отображение кук (даже неработающее), они увидят меньше информации.
