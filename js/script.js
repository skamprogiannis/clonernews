const BASE_URL = 'https://hacker-news.firebaseio.com/v0';

var loadedPosts = [];
const itemCache = new Map();

const POST_ENDPOINTS = {
  ask: 'askstories',
  story: 'newstories',
  show: 'showstories',
  job: 'jobstories',
};

const POLL_TARGET_COUNT = 30;
const POLL_SEARCH_URL =
  `https://hn.algolia.com/api/v1/search_by_date?tags=poll&hitsPerPage=${POLL_TARGET_COUNT}`;

async function fetchPostIds(type) {
  // Fetches IDs for recent posts of the specified type
  if (type === 'poll') {
    // If the type is 'poll', fetch the most recent poll IDs
    return fetchRecentPollIds();
  }

  // For other types, fetch the list of IDs from the API
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

/**
 * Fetches a Hacker News item, using the item cache unless a refresh is forced.
 *
 * @param {number} id - Hacker News item ID.
 * @param {{ forceRefresh?: boolean }} [options={}] - Fetch options.
 * @returns {Promise<object|null>} The item returned by the Hacker News API.
 * @throws {Error} When the ID is missing or the request fails.
 */
async function fetchItemDetails(id, { forceRefresh = false } = {}) {
  if (!id && id !== 0) {
    throw new Error('fetchItemDetails requires an item ID');
  }

  if (!forceRefresh && itemCache.has(id)) {
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
  // Throttles the execution of a function to ensure it doesn't exceed the specified limit
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
  const response = await fetch(POLL_SEARCH_URL);

  if (!response.ok) {
    throw new Error(`Unable to fetch poll IDs: ${response.status}`);
  }

  const data = await response.json();

  return Array.isArray(data.hits)
    ? data.hits
        .map((hit) => Number(hit.objectID))
        .filter((id) => Number.isInteger(id) && id > 0)
    : [];
}
