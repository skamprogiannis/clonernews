const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(value) {
    const classes = new Set(this.element.className.split(' ').filter(Boolean));
    classes.add(value);
    this.element.className = [...classes].join(' ');
  }

  remove(value) {
    const classes = this.element.className
      .split(' ')
      .filter((className) => className && className !== value);
    this.element.className = classes.join(' ');
  }

  contains(value) {
    return this.element.className.split(' ').includes(value);
  }

  toggle(value, force) {
    const shouldAdd = force ?? !this.contains(value);
    this[shouldAdd ? 'add' : 'remove'](value);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.attributes = new Map();
    this.children = [];
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.hidden = false;
    this.id = '';
    this.listeners = new Map();
    this.parentElement = null;
    this.textContent = '';
    this.tagName = tagName.toUpperCase();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const matchesSelector = (element) => {
      if (selector.startsWith('.')) {
        return element.classList.contains(selector.slice(1));
      }

      if (selector.startsWith('#')) {
        return element.id === selector.slice(1);
      }

      return element.tagName === selector.toUpperCase();
    };

    const visit = (element) => {
      element.children.forEach((child) => {
        if (matchesSelector(child)) {
          matches.push(child);
        }
        visit(child);
      });
    };

    visit(this);
    return matches;
  }
}

function createFakeDocument() {
  const feedStatus = new FakeElement('p');
  feedStatus.id = 'feed-status';
  const postsContainer = new FakeElement('section');
  postsContainer.id = 'posts-container';

  return {
    addEventListener() {},
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => {
      if (id === postsContainer.id) {
        return postsContainer;
      }

      if (id === feedStatus.id) {
        return feedStatus;
      }

      return postsContainer.querySelector(`#${id}`);
    },
    feedStatus,
    postsContainer,
    querySelectorAll: () => [],
    readyState: 'loading',
  };
}

function loadScripts(fileNames, contextValues = {}) {
  const document = contextValues.document ?? createFakeDocument();
  const context = vm.createContext({
    console,
    document,
    fetchItemDetails: async () => null,
    loadedPosts: [],
    renderComments() {},
    ...contextValues,
  });

  fileNames.forEach((fileName) => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'js', fileName),
      'utf8',
    );

    vm.runInContext(source, context, { filename: `js/${fileName}` });
  });

  return { context, document };
}

function loadScript(fileName, contextValues = {}) {
  return loadScripts([fileName], contextValues);
}

function loadRenderingScripts(fileNames, contextValues = {}) {
  return loadScripts(['render-text.js', ...fileNames], contextValues);
}

test('renderPosts displays posts from newest to oldest', () => {
  const { context, document } = loadRenderingScripts(['Render.js']);

  context.renderPosts([
    { by: 'older', id: 1, time: 100, title: 'Older', type: 'story' },
    { by: 'newer', id: 2, time: 200, title: 'Newer', type: 'story' },
  ]);

  assert.deepEqual(
    document.postsContainer.children.map((post) => post.dataset.postId),
    ['2', '1'],
  );
});

test('renderPosts never assigns API markup directly to the rendered page', () => {
  const { context, document } = loadRenderingScripts(['Render.js']);

  context.renderPosts([
    {
      id: 1,
      text: '<img src=x onerror=alert(1)>Safe text',
      time: 100,
      title: 'Markup example',
      type: 'story',
    },
  ]);

  const body = document.postsContainer.querySelector('.post-text');
  assert.equal(body.textContent, '<img src=x onerror=alert(1)>Safe text');
});

test('renderComments shows newest direct comments under their parent post', () => {
  const document = createFakeDocument();
  const commentsSection = document.createElement('section');
  commentsSection.id = 'comments-42';
  document.postsContainer.append(commentsSection);
  const { context } = loadRenderingScripts(['RenderCom.js'], { document });

  context.renderComments(
    [
      { by: 'older', id: 1, parent: 42, text: 'Older', time: 100 },
      { by: 'other', id: 3, parent: 99, text: 'Wrong parent', time: 300 },
      { by: 'newer', id: 2, parent: 42, text: 'Newer', time: 200 },
    ],
    42,
  );

  assert.deepEqual(
    commentsSection.children.map((comment) => comment.dataset.commentId),
    ['2', '1'],
  );
});

test('loadFeed renders only the first ten posts for the selected type', async () => {
  const renderedBatches = [];
  const requestedItems = [];
  const loadedPosts = [];
  const postIds = Array.from({ length: 12 }, (_, index) => index + 1);
  const { context } = loadScript('Handle scroll.js', {
    fetchItemDetails: async (id) => {
      requestedItems.push(id);
      return { id, time: id, title: `Post ${id}`, type: 'story' };
    },
    fetchPostIds: async (type) => {
      assert.equal(type, 'story');
      return postIds;
    },
    loadedPosts,
    renderPosts: (posts) => renderedBatches.push([...posts]),
    throttle: (callback) => callback,
    window: {
      addEventListener() {},
      innerHeight: 800,
      scrollY: 0,
    },
  });

  await context.loadFeed('story');

  assert.deepEqual(requestedItems, postIds.slice(0, 10));
  assert.equal(renderedBatches.length, 1);
  assert.equal(renderedBatches[0].length, 10);
  assert.equal(loadedPosts.length, 10);
});

test('loadMorePosts keeps all loaded posts ordered without refetching', async () => {
  const renderedBatches = [];
  const requestedItems = [];
  const postIds = Array.from({ length: 25 }, (_, index) => index + 1);
  const { context } = loadScript('Handle scroll.js', {
    fetchItemDetails: async (id) => {
      requestedItems.push(id);
      return {
        id,
        time: id === 11 ? 100 : id,
        title: `Post ${id}`,
        type: 'story',
      };
    },
    fetchPostIds: async () => postIds,
    renderPosts: (posts) => renderedBatches.push([...posts]),
    throttle: (callback) => callback,
    window: {
      addEventListener() {},
      innerHeight: 800,
      scrollY: 0,
    },
  });

  await context.loadFeed('story');
  await context.loadMorePosts();

  assert.deepEqual(requestedItems, postIds.slice(0, 20));
  assert.deepEqual(
    renderedBatches.map((batch) => batch.length),
    [10, 20],
  );
  assert.equal(renderedBatches[1][0].id, 11);
});

test('initializeFeed loads Stories and connects each filter button', async () => {
  const document = createFakeDocument();
  const storyButton = document.createElement('button');
  const jobButton = document.createElement('button');
  const pollButton = document.createElement('button');
  const requestedTypes = [];

  storyButton.className = 'filter-btn active';
  storyButton.dataset.type = 'story';
  jobButton.className = 'filter-btn';
  jobButton.dataset.type = 'job';
  pollButton.className = 'filter-btn';
  pollButton.dataset.type = 'poll';
  document.querySelectorAll = () => [storyButton, jobButton, pollButton];

  const { context } = loadScript('Handle scroll.js', {
    document,
    fetchPostIds: async (type) => {
      requestedTypes.push(type);
      return [];
    },
    throttle: (callback) => callback,
    window: {
      addEventListener() {},
      innerHeight: 800,
      scrollY: 0,
    },
  });

  await context.initializeFeed();
  await jobButton.listeners.get('click')();

  assert.deepEqual(requestedTypes, ['story', 'job']);
  assert.equal(storyButton.classList.contains('active'), false);
  assert.equal(jobButton.classList.contains('active'), true);
});

test('loadFeed reports an API failure without leaving an unhandled rejection', async () => {
  const document = createFakeDocument();
  const errors = [];
  const { context } = loadScript('Handle scroll.js', {
    console: {
      error: (...args) => errors.push(args),
    },
    document,
    fetchPostIds: async () => {
      throw new Error('Network unavailable');
    },
    throttle: (callback) => callback,
    window: {
      addEventListener() {},
      innerHeight: 800,
      scrollY: 0,
    },
  });

  await context.loadFeed('story');

  assert.match(document.feedStatus.textContent, /could not load/i);
  assert.equal(document.feedStatus.dataset.state, 'error');
  assert.equal(errors.length, 1);
});

test('a slower previous filter request cannot replace the selected feed', async () => {
  const loadedPosts = [];
  const renderedPostIds = [];
  let resolveJobs;
  let resolveStories;
  const storyIds = new Promise((resolve) => {
    resolveStories = resolve;
  });
  const jobIds = new Promise((resolve) => {
    resolveJobs = resolve;
  });
  const { context } = loadScript('Handle scroll.js', {
    fetchItemDetails: async (id) => ({
      id,
      time: id,
      title: `Post ${id}`,
      type: id === 2 ? 'job' : 'story',
    }),
    fetchPostIds: (type) => (type === 'story' ? storyIds : jobIds),
    loadedPosts,
    renderPosts: (posts) => {
      renderedPostIds.push(...posts.map((post) => post.id));
    },
    throttle: (callback) => callback,
    window: {
      addEventListener() {},
      innerHeight: 800,
      scrollY: 0,
    },
  });

  const storyRequest = context.loadFeed('story');
  const jobRequest = context.loadFeed('job');

  resolveJobs([2]);
  await jobRequest;
  resolveStories([1]);
  await storyRequest;

  assert.deepEqual(
    loadedPosts.map((post) => post.id),
    [2],
  );
  assert.deepEqual(renderedPostIds, [2]);
});

test('opening a post loads its direct comments once and renders them below it', async () => {
  const requestedItems = [];
  const document = createFakeDocument();
  const { context } = loadRenderingScripts(['RenderCom.js', 'Render.js'], {
    document,
    fetchItemDetails: async (id) => {
      requestedItems.push(id);
      return {
        by: `user-${id}`,
        id,
        parent: 42,
        text: `Comment ${id}`,
        time: id,
      };
    },
  });

  context.renderPosts([
    {
      by: 'author',
      id: 42,
      kids: [10, 11],
      time: 100,
      title: 'Post with comments',
      type: 'story',
    },
  ]);

  const postCard = document.postsContainer.children[0];
  const openButton = postCard.querySelector('.post-toggle');

  await openButton.listeners.get('click')();
  await openButton.listeners.get('click')();
  await openButton.listeners.get('click')();

  assert.deepEqual(requestedItems, [10, 11]);
  assert.deepEqual(
    postCard
      .querySelector('.comments-section')
      .children.map((comment) => comment.dataset.commentId),
    ['11', '10'],
  );
});

test('opening a poll loads and displays its choices', async () => {
  const requestedItems = [];
  const document = createFakeDocument();
  const { context } = loadRenderingScripts(['RenderCom.js', 'Render.js'], {
    document,
    fetchItemDetails: async (id) => {
      requestedItems.push(id);
      return {
        id,
        poll: 42,
        score: id === 10 ? 7 : 3,
        text: `Choice ${id}`,
        type: 'pollopt',
      };
    },
  });

  context.renderPosts([
    {
      by: 'author',
      id: 42,
      parts: [10, 11],
      time: 100,
      title: 'A poll',
      type: 'poll',
    },
  ]);

  const postCard = document.postsContainer.children[0];
  await postCard.querySelector('.post-toggle').listeners.get('click')();

  assert.deepEqual(requestedItems, [10, 11]);
  assert.deepEqual(
    postCard
      .querySelector('.poll-options')
      .children.map((option) => option.dataset.pollOptionId),
    ['10', '11'],
  );
});

test('a comment loads nested replies below the correct parent only once', async () => {
  const requestedItems = [];
  const document = createFakeDocument();
  const commentsSection = document.createElement('section');

  commentsSection.id = 'comments-42';
  document.postsContainer.append(commentsSection);

  const { context } = loadRenderingScripts(['RenderCom.js'], {
    document,
    fetchItemDetails: async (id) => {
      requestedItems.push(id);
      return {
        by: 'reply-author',
        id,
        parent: 1,
        text: 'Nested reply',
        time: 200,
        type: 'comment',
      };
    },
  });

  context.renderComments(
    [
      {
        by: 'parent-author',
        id: 1,
        kids: [2],
        parent: 42,
        text: 'Parent comment',
        time: 100,
        type: 'comment',
      },
    ],
    42,
  );

  const parentComment = commentsSection.children[0];
  const replyButton = parentComment.querySelector('.comment-toggle');

  await replyButton.listeners.get('click')();
  await replyButton.listeners.get('click')();
  await replyButton.listeners.get('click')();

  assert.deepEqual(requestedItems, [2]);
  assert.deepEqual(
    parentComment
      .querySelector('.nested-comments')
      .children.map((comment) => comment.dataset.commentId),
    ['2'],
  );
});
