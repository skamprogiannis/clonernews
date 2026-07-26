const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'script.js'),
  'utf8',
);

function successfulJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.classList = new FakeClassList();
    this.className = '';
    this.dateTime = '';
    this.parentElement = null;
    this.textContent = '';
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  prepend(child) {
    child.parentElement = this;
    this.children.unshift(child);
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    const index = this.parentElement.children.indexOf(this);
    this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  querySelector(selector) {
    if (selector !== '.live-text') {
      return null;
    }

    return this.children.find((child) => child.className === 'live-text') ?? null;
  }

  get childElementCount() {
    return this.children.length;
  }

  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }
}

function createFakeDocument() {
  const notificationArea = new FakeElement('section');
  const liveIndicator = new FakeElement();
  const liveText = new FakeElement('span');
  liveText.className = 'live-text';
  liveIndicator.append(liveText);

  const elements = new Map([
    ['live-indicator', liveIndicator],
    ['live-notification-area', notificationArea],
  ]);

  return {
    addEventListener() {},
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => elements.get(id) ?? null,
    liveIndicator,
    notificationArea,
    readyState: 'loading',
  };
}

function loadApiHelpers(fetchImplementation) {
  const context = vm.createContext({
    clearTimeout,
    console,
    Date,
    fetch: fetchImplementation,
    Map,
    setTimeout,
  });

  vm.runInContext(scriptSource, context, { filename: 'js/script.js' });

  return context;
}

function loadLiveData(
  fetchImplementation,
  {
    consoleImplementation = console,
    setIntervalImplementation = setInterval,
  } = {},
) {
  const document = createFakeDocument();
  const context = vm.createContext({
    clearInterval,
    clearTimeout,
    console: consoleImplementation,
    Date,
    document,
    fetch: fetchImplementation,
    Map,
    setInterval: setIntervalImplementation,
    setTimeout,
    Set,
  });

  vm.runInContext(scriptSource, context, { filename: 'js/script.js' });

  const liveDataSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'live-updates.js'),
    'utf8',
  );
  vm.runInContext(liveDataSource, context, {
    filename: 'js/live-updates.js',
  });

  return { context, document };
}

test('force refresh bypasses and replaces the cached item', async () => {
  const responses = [
    { id: 123, score: 10, title: 'Cached title' },
    { id: 123, score: 15, title: 'Fresh title' },
  ];
  let requestCount = 0;

  const context = loadApiHelpers(async () => {
    const item = responses[requestCount];
    requestCount += 1;

    return successfulJsonResponse({ ...item });
  });

  const original = await context.fetchItemDetails(123);
  const cached = await context.fetchItemDetails(123);
  const refreshed = await context.fetchItemDetails(123, {
    forceRefresh: true,
  });
  const refreshedCache = await context.fetchItemDetails(123);

  assert.equal(original.score, 10);
  assert.equal(cached.score, 10);
  assert.equal(refreshed.score, 15);
  assert.equal(refreshedCache.score, 15);
  assert.equal(requestCount, 2);
});

test('the initial live check is silent and a later change is announced once', async () => {
  const updateResponses = [
    { items: [100], profiles: [] },
    { items: [101, 100], profiles: [] },
    { items: [101, 100], profiles: [] },
  ];
  let responseIndex = 0;

  const { context, document } = loadLiveData(async (url) => {
    assert.match(url, /\/updates\.json$/);
    const response = updateResponses[responseIndex];
    responseIndex += 1;

    return successfulJsonResponse(response);
  });

  await context.checkForNewData();
  assert.equal(document.notificationArea.childElementCount, 0);

  await context.checkForNewData();
  assert.equal(document.notificationArea.childElementCount, 1);
  assert.match(
    document.notificationArea.children[0].children[1].textContent,
    /1 item changed/,
  );

  await context.checkForNewData();
  assert.equal(document.notificationArea.childElementCount, 1);
});

test('a changed loaded post is force-refreshed and named in the notification', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
  const itemResponses = [
    { id: 201, score: 10, title: 'Cached title' },
    { id: 201, score: 15, title: 'Fresh title' },
  ];
  let updateResponseIndex = 0;
  let itemResponseIndex = 0;

  const { context, document } = loadLiveData(async (url) => {
    if (url.endsWith('/updates.json')) {
      const response = updateResponses[updateResponseIndex];
      updateResponseIndex += 1;

      return successfulJsonResponse(response);
    }

    assert.match(url, /\/item\/201\.json$/);
    const response = itemResponses[itemResponseIndex];
    itemResponseIndex += 1;

    return successfulJsonResponse({ ...response });
  });

  const loadedPost = { id: 201, score: 10, title: 'Cached title' };
  context.loadedPosts.push(loadedPost);
  await context.fetchItemDetails(201);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemResponseIndex, 2);
  assert.equal(loadedPost.score, 15);
  assert.equal(loadedPost.title, 'Fresh title');
  assert.match(
    document.notificationArea.children[0].children[1].textContent,
    /Fresh title/,
  );
});

test('the live timer starts once and does not overlap an active check', async () => {
  let fetchCount = 0;
  let intervalCount = 0;
  let intervalDelay = null;

  const { context } = loadLiveData(
    async () => {
      fetchCount += 1;
      return new Promise(() => {});
    },
    {
      setIntervalImplementation: (_callback, delay) => {
        intervalCount += 1;
        intervalDelay = delay;
        return 42;
      },
    },
  );

  assert.equal(context.startLiveUpdateTimer(), 42);
  assert.equal(context.startLiveUpdateTimer(), 42);

  await context.checkForNewData();

  assert.equal(fetchCount, 1);
  assert.equal(intervalCount, 1);
  assert.equal(intervalDelay, 5000);
});

test('the page exposes the live region and loads scripts in dependency order', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8',
  );
  const apiScriptIndex = html.indexOf('src="js/script.js"');
  const liveScriptIndex = html.indexOf('src="js/live-updates.js"');

  assert.match(html, /id="live-notification-area"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Live Hacker News updates"/);
  assert.notEqual(apiScriptIndex, -1);
  assert.ok(liveScriptIndex > apiScriptIndex);
});

test('live notifications include offline and reduced-motion styles', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'css', 'style.css'),
    'utf8',
  );

  assert.match(css, /#live-notification-area/);
  assert.match(css, /\.live-notification\s*\{/);
  assert.match(css, /#live-indicator\.is-offline/);
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*\.live-notification[\s\S]*flex-direction: column/,
  );
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('repeated live failures report once until a successful recovery', async () => {
  const responses = [
    { ok: false, status: 503 },
    { ok: false, status: 503 },
    successfulJsonResponse({ items: [100], profiles: [] }),
    { ok: false, status: 503 },
  ];
  const errors = [];
  let responseIndex = 0;

  const { context, document } = loadLiveData(
    async () => {
      const response = responses[responseIndex];
      responseIndex += 1;
      return response;
    },
    {
      consoleImplementation: {
        error: (...args) => errors.push(args),
      },
    },
  );

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(errors.length, 1);
  assert.ok(document.liveIndicator.classList.contains('is-offline'));

  await context.checkForNewData();
  assert.ok(!document.liveIndicator.classList.contains('is-offline'));

  await context.checkForNewData();
  assert.equal(errors.length, 2);
});

test('a loaded post changing when update IDs reorder is announced', async () => {
  const updateResponses = [
    { items: [200, 201], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
  const itemResponses = [
    { id: 201, score: 10, title: 'Before repeat update' },
    { id: 201, score: 11, title: 'After repeat update' },
  ];
  let itemResponseIndex = 0;
  let updateResponseIndex = 0;

  const { context, document } = loadLiveData(async (url) => {
    if (url.endsWith('/updates.json')) {
      const response = updateResponses[updateResponseIndex];
      updateResponseIndex += 1;
      return successfulJsonResponse(response);
    }

    const response = itemResponses[itemResponseIndex];
    itemResponseIndex += 1;
    return successfulJsonResponse({ ...response });
  });

  const loadedPost = {
    id: 201,
    score: 10,
    title: 'Before repeat update',
  };
  context.loadedPosts.push(loadedPost);
  await context.fetchItemDetails(201);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemResponseIndex, 2);
  assert.equal(loadedPost.score, 11);
  assert.equal(document.notificationArea.childElementCount, 1);
  assert.match(
    document.notificationArea.children[0].children[1].textContent,
    /After repeat update/,
  );
});

test('an unchanged update snapshot does not refetch loaded posts', async () => {
  let itemRequestCount = 0;

  const { context, document } = loadLiveData(async (url) => {
    if (url.endsWith('/updates.json')) {
      return successfulJsonResponse({
        items: [201, 200],
        profiles: [],
      });
    }

    itemRequestCount += 1;
    return successfulJsonResponse({
      id: 201,
      score: 10,
      title: 'Unchanged post',
    });
  });

  context.loadedPosts.push({
    id: 201,
    score: 10,
    title: 'Unchanged post',
  });
  await context.fetchItemDetails(201);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemRequestCount, 1);
  assert.equal(document.notificationArea.childElementCount, 0);
});

test('a failed loaded-post refresh preserves state and retries', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 200], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
  const errors = [];
  let itemRequestCount = 0;
  let updateResponseIndex = 0;

  const { context, document } = loadLiveData(
    async (url) => {
      if (url.endsWith('/updates.json')) {
        const response = updateResponses[updateResponseIndex];
        updateResponseIndex += 1;
        return successfulJsonResponse(response);
      }

      itemRequestCount += 1;

      if (itemRequestCount === 1) {
        throw new Error('Temporary item failure');
      }

      return successfulJsonResponse({
        id: 201,
        score: 15,
        title: 'Recovered post',
      });
    },
    {
      consoleImplementation: {
        error: (...args) => errors.push(args),
      },
    },
  );

  const loadedPost = { id: 201, score: 10, title: 'Stale post' };
  context.loadedPosts.push(loadedPost);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(document.notificationArea.childElementCount, 0);
  assert.ok(document.liveIndicator.classList.contains('is-offline'));

  await context.checkForNewData();

  assert.equal(itemRequestCount, 2);
  assert.equal(errors.length, 1);
  assert.equal(loadedPost.title, 'Recovered post');
  assert.equal(document.notificationArea.childElementCount, 1);
  assert.ok(!document.liveIndicator.classList.contains('is-offline'));
});

test('refreshing a loaded post removes API fields absent from fresh data', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
  let updateResponseIndex = 0;

  const { context } = loadLiveData(async (url) => {
    if (url.endsWith('/updates.json')) {
      const response = updateResponses[updateResponseIndex];
      updateResponseIndex += 1;
      return successfulJsonResponse(response);
    }

    return successfulJsonResponse({
      deleted: true,
      id: 201,
      type: 'story',
    });
  });

  const loadedPost = {
    id: 201,
    kids: [301],
    score: 10,
    title: 'Stale deleted title',
    type: 'story',
  };
  context.loadedPosts.push(loadedPost);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(loadedPost.deleted, true);
  assert.ok(!Object.hasOwn(loadedPost, 'kids'));
  assert.ok(!Object.hasOwn(loadedPost, 'score'));
  assert.ok(!Object.hasOwn(loadedPost, 'title'));
});

test('a malformed update response does not replace the last valid snapshot', async () => {
  const responses = [
    { items: [100], profiles: [] },
    { items: ['invalid'], profiles: [] },
    { items: [100], profiles: [] },
  ];
  const errors = [];
  let responseIndex = 0;

  const { context, document } = loadLiveData(
    async () => {
      const response = responses[responseIndex];
      responseIndex += 1;
      return successfulJsonResponse(response);
    },
    {
      consoleImplementation: {
        error: (...args) => errors.push(args),
      },
    },
  );

  await context.checkForNewData();
  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(errors.length, 1);
  assert.equal(document.notificationArea.childElementCount, 0);
});

test('only the five newest live notifications remain visible', () => {
  const { context, document } = loadLiveData(async () =>
    successfulJsonResponse({ items: [], profiles: [] }),
  );

  for (let index = 1; index <= 6; index += 1) {
    context.showNotification(`Update ${index}`);
  }

  assert.equal(document.notificationArea.childElementCount, 5);
  assert.equal(
    document.notificationArea.children[0].children[1].textContent,
    'Update 6',
  );
  assert.equal(
    document.notificationArea.children[4].children[1].textContent,
    'Update 2',
  );
});
