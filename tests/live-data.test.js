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
  const liveBoard = new FakeElement('aside');
  const emptyState = new FakeElement('p');
  const liveIndicator = new FakeElement();
  const liveText = new FakeElement('span');
  liveText.className = 'live-text';
  liveIndicator.append(liveText);
  liveBoard.append(emptyState);

  const elements = new Map([
    ['live-empty-state', emptyState],
    ['live-indicator', liveIndicator],
    ['live-notification-area', notificationArea],
  ]);

  return {
    addEventListener() {},
    createElement: (tagName) => new FakeElement(tagName),
    emptyState,
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

test('poll IDs come from one targeted search request', async () => {
  const requestedUrls = [];
  const context = loadApiHelpers(async (url) => {
    requestedUrls.push(url);

    return successfulJsonResponse({
      hits: [
        { objectID: '300' },
        { objectID: '200' },
        { objectID: 'not-an-id' },
      ],
    });
  });

  const pollIds = await context.fetchPostIds('poll');

  assert.deepEqual(Array.from(pollIds), [300, 200]);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /search_by_date\?tags=poll/);
});

test('Ask and Show feeds use their Hacker News endpoints', async () => {
  const requestedUrls = [];
  const context = loadApiHelpers(async (url) => {
    requestedUrls.push(url);
    return successfulJsonResponse([3, 2, 1]);
  });

  const askIds = await context.fetchPostIds('ask');
  const showIds = await context.fetchPostIds('show');

  assert.deepEqual(Array.from(askIds), [3, 2, 1]);
  assert.deepEqual(Array.from(showIds), [3, 2, 1]);
  assert.match(requestedUrls[0], /\/askstories\.json$/);
  assert.match(requestedUrls[1], /\/showstories\.json$/);
});

test('unrelated live item changes do not create noisy notifications', async () => {
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
  assert.equal(document.notificationArea.childElementCount, 0);

  await context.checkForNewData();
  assert.equal(document.notificationArea.childElementCount, 0);
});

test('a changed loaded post is force-refreshed and described by name', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
  const itemResponses = [
    { id: 201, score: 10, title: 'Fresh title' },
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

  const loadedPost = { id: 201, score: 10, title: 'Fresh title' };
  context.loadedPosts.push(loadedPost);
  await context.fetchItemDetails(201);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemResponseIndex, 2);
  assert.equal(loadedPost.score, 15);
  assert.equal(loadedPost.title, 'Fresh title');
  assert.match(
    document.notificationArea.children[0].children[1].textContent,
    /^Score updated on “Fresh title”\.$/,
  );
});

test('a reported loaded post stays silent when its data is unchanged', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
  let updateResponseIndex = 0;
  let itemRequestCount = 0;

  const { context, document } = loadLiveData(async (url) => {
    if (url.endsWith('/updates.json')) {
      const response = updateResponses[updateResponseIndex];
      updateResponseIndex += 1;
      return successfulJsonResponse(response);
    }

    itemRequestCount += 1;
    return successfulJsonResponse({
      id: 201,
      score: 10,
      title: 'Still the same',
      type: 'story',
    });
  });

  context.loadedPosts.push({
    id: 201,
    score: 10,
    title: 'Still the same',
    type: 'story',
  });

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemRequestCount, 1);
  assert.equal(document.notificationArea.childElementCount, 0);
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
  assert.match(html, /id="live-empty-state"/);
  assert.match(html, /Watching loaded posts for Hacker News changes/);
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
  assert.match(
    css,
    /@media screen and \(max-width: 1024px\)[\s\S]*\.live-board\s*\{[\s\S]*order: -1/,
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

test('reordering update IDs alone does not refresh or notify', async () => {
  const updateResponses = [
    { items: [200, 201], profiles: [] },
    { items: [201, 200], profiles: [] },
  ];
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
      return successfulJsonResponse({
        id: 201,
        score: 11,
        title: 'Should not be requested',
      });
    },
    {
      consoleImplementation: {
        error() {},
      },
    },
  );

  const loadedPost = {
    id: 201,
    score: 10,
    title: 'Unchanged post',
  };
  context.loadedPosts.push(loadedPost);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemRequestCount, 0);
  assert.equal(loadedPost.score, 10);
  assert.equal(document.notificationArea.childElementCount, 0);
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

test('a multi-post refresh applies no partial state before retry succeeds', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 202, 200], profiles: [] },
    { items: [201, 202, 200], profiles: [] },
  ];
  const itemAttempts = new Map();
  let updateResponseIndex = 0;

  const { context, document } = loadLiveData(
    async (url) => {
      if (url.endsWith('/updates.json')) {
        const response = updateResponses[updateResponseIndex];
        updateResponseIndex += 1;
        return successfulJsonResponse(response);
      }

      const id = Number(url.match(/\/item\/(\d+)\.json$/)[1]);
      const attempt = (itemAttempts.get(id) ?? 0) + 1;
      itemAttempts.set(id, attempt);

      if (id === 202 && attempt === 1) {
        throw new Error('Second item failed');
      }

      return successfulJsonResponse({
        id,
        score: id === 201 ? 11 : 21,
        title: `Fresh ${id}`,
        type: 'story',
      });
    },
    {
      consoleImplementation: {
        error() {},
      },
    },
  );

  const firstPost = {
    id: 201,
    score: 10,
    title: 'Stale 201',
    type: 'story',
  };
  const secondPost = {
    id: 202,
    score: 20,
    title: 'Stale 202',
    type: 'story',
  };
  context.loadedPosts.push(firstPost, secondPost);

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(firstPost.title, 'Stale 201');
  assert.equal(secondPost.title, 'Stale 202');
  assert.equal(document.notificationArea.childElementCount, 0);

  await context.checkForNewData();

  assert.equal(firstPost.title, 'Fresh 201');
  assert.equal(secondPost.title, 'Fresh 202');
  assert.equal(document.notificationArea.childElementCount, 2);
});

test('inserting one update ID does not refetch unchanged loaded posts', async () => {
  const updateResponses = [
    { items: [200, 201, 202], profiles: [] },
    { items: [203, 200, 201, 202], profiles: [] },
  ];
  let itemRequestCount = 0;
  let updateResponseIndex = 0;

  const { context } = loadLiveData(
    async (url) => {
      if (url.endsWith('/updates.json')) {
        const response = updateResponses[updateResponseIndex];
        updateResponseIndex += 1;
        return successfulJsonResponse(response);
      }

      itemRequestCount += 1;
      return successfulJsonResponse(null);
    },
    {
      consoleImplementation: {
        error() {},
      },
    },
  );

  context.loadedPosts.push(
    { id: 200, title: 'Post 200' },
    { id: 201, title: 'Post 201' },
    { id: 202, title: 'Post 202' },
  );

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(itemRequestCount, 0);
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

test('each changed loaded post gets a specific notification', async () => {
  const updateResponses = [
    { items: [200], profiles: [] },
    { items: [201, 202, 200], profiles: [] },
  ];
  let updateResponseIndex = 0;

  const { context, document } = loadLiveData(async (url) => {
    if (url.endsWith('/updates.json')) {
      const response = updateResponses[updateResponseIndex];
      updateResponseIndex += 1;
      return successfulJsonResponse(response);
    }

    const id = Number(url.match(/\/item\/(\d+)\.json$/)[1]);

    return successfulJsonResponse({
      id,
      kids: id === 201 ? [301, 302] : undefined,
      score: id === 201 ? 11 : 21,
      title: `Fresh ${id}`,
      type: 'story',
    });
  });

  context.loadedPosts.push(
    {
      id: 201,
      kids: [301],
      score: 10,
      title: 'Stale 201',
      type: 'story',
    },
    {
      id: 202,
      score: 20,
      title: 'Stale 202',
      type: 'story',
    },
  );

  await context.checkForNewData();
  await context.checkForNewData();

  assert.equal(document.notificationArea.childElementCount, 2);
  const messages = document.notificationArea.children.map(
    (notification) => notification.children[1].textContent,
  );
  assert.ok(
    messages.includes('Comments, score, and details updated on “Fresh 201”.'),
  );
  assert.ok(messages.includes('Score and details updated on “Fresh 202”.'));
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

  assert.equal(document.emptyState.parentElement, null);
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
