const BASE_URL = 'https://hacker-news.firebaseio.com/v0';

var loadedPosts = [];
const itemCache = new Map();

const POST_ENDPOINTS = {
  story: 'newstories',
  job: 'jobstories',
};

const POLL_SCAN_LIMIT = 500;
const POLL_TARGET_COUNT = 30;
const POLL_BATCH_SIZE = 25;

async function fetchPostIds(type) {
  if (type === 'poll') {
    return fetchRecentPollIds();
  }

  const endpoint = POST_ENDPOINTS[type];

  if (!endpoint) {
    throw new Error(`Unsupported post type: ${type}`);
  }

  const response = await fetch(`${BASE_URL}/${endpoint}.json`);

  if (!response.ok) {
    throw new Error(`Unable to fetch ${type} IDs: ${response.status}`);
  }

  return response.json();
}

async function fetchItemDetails(id) {
  if (!id && id !== 0) {
    throw new Error('fetchItemDetails requires an item ID');
  }

  if (itemCache.has(id)) {
    return itemCache.get(id);
  }

  const response = await fetch(`${BASE_URL}/item/${id}.json`);

  if (!response.ok) {
    throw new Error(`Unable to fetch item ${id}: ${response.status}`);
  }

  const item = await response.json();
  itemCache.set(id, item);

  return item;
}

function throttle(func, limit) {
  let lastRun = 0;
  let timeoutId = null;

  return function throttledFunction(...args) {
    const now = Date.now();
    const remaining = limit - (now - lastRun);
    const context = this;

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      lastRun = now;
      func.apply(context, args);
      return;
    }

    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastRun = Date.now();
        timeoutId = null;
        func.apply(context, args);
      }, remaining);
    }
  };
}

async function fetchRecentPollIds() {
  const response = await fetch(`${BASE_URL}/maxitem.json`);

  if (!response.ok) {
    throw new Error(`Unable to fetch latest item ID: ${response.status}`);
  }

  const maxItemId = await response.json();
  const pollIds = [];

  for (
    let firstId = maxItemId;
    firstId > maxItemId - POLL_SCAN_LIMIT && pollIds.length < POLL_TARGET_COUNT;
    firstId -= POLL_BATCH_SIZE
  ) {
    const ids = Array.from(
      { length: POLL_BATCH_SIZE },
      (_, index) => firstId - index,
    ).filter((id) => id > 0);

    const items = await Promise.all(ids.map((id) => fetchItemDetails(id)));

    items.forEach((item) => {
      if (item && item.type === 'poll') {
        pollIds.push(item.id);
      }
    });
  }

  return pollIds;
}
