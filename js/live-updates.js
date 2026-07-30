const LIVE_UPDATE_INTERVAL_MS = 5000;
const MAX_LIVE_NOTIFICATIONS = 5;
const LIVE_ITEM_FIELDS = [
  'by',
  'dead',
  'deleted',
  'descendants',
  'id',
  'kids',
  'parent',
  'parts',
  'poll',
  'score',
  'text',
  'time',
  'title',
  'type',
  'url',
];

let previousLiveUpdateIds = null;
let liveUpdateCheckInProgress = false;
let liveUpdateErrorReported = false;
let liveUpdateTimerId = null;

function setLiveIndicator(isAvailable) {
  const indicator = document.getElementById('live-indicator');
  const label = indicator?.querySelector('.live-text');

  if (!indicator || !label) {
    return;
  }

  indicator.classList[isAvailable ? 'remove' : 'add']('is-offline');
  label.textContent = isAvailable
    ? 'Live: Updates every 5s'
      : 'Live updates unavailable';
}

function markLiveUpdatesAvailable() {
  liveUpdateErrorReported = false;
  setLiveIndicator(true);
}

function showNotification(message) {
  const notificationArea = document.getElementById(
    'live-notification-area',
  );

  if (!notificationArea) {
    return;
  }

  document.getElementById('live-empty-state')?.remove();

  const notification = document.createElement('article');
  const timestamp = document.createElement('time');
  const text = document.createElement('p');
  const now = new Date();

  notification.className = 'live-notification';
  timestamp.className = 'live-notification__time';
  timestamp.dateTime = now.toISOString();
  timestamp.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  text.className = 'live-notification__message';
  text.textContent = message;

  notification.append(timestamp, text);
  notificationArea.prepend(notification);

  while (notificationArea.childElementCount > MAX_LIVE_NOTIFICATIONS) {
    notificationArea.lastElementChild.remove();
  }
}

/**
 * Refreshes changed items already held in loadedPosts.
 *
 * Refreshes bypass itemCache. The loaded objects are mutated in place only
 * after every refresh succeeds.
 *
 * @param {number[]} changedIds - IDs that may have changed.
 * @returns {Promise<Array<{
 *   changedFields: string[],
 *   freshPost: object,
 *   loadedPost: object,
 *   title: string
 * }>>} Descriptions of posts that actually changed.
 * @throws {Error} When any changed loaded item cannot be refreshed.
 */
async function refreshChangedLoadedPosts(changedIds) {
  const loadedPostsById = new Map(
    loadedPosts
      .filter((post) => post && Number.isInteger(post.id))
      .map((post) => [post.id, post]),
  );
  const loadedChangedIds = changedIds.filter((id) =>
    loadedPostsById.has(id),
  );
  const refreshResults = await Promise.all(
    loadedChangedIds.map(async (id) => {
      const freshPost = await fetchItemDetails(id, {
        forceRefresh: true,
      });
      const loadedPost = loadedPostsById.get(id);

      if (!freshPost || !loadedPost) {
        throw new Error(`Unable to refresh changed item ${id}`);
      }

      const changedFields = LIVE_ITEM_FIELDS.filter((field) => {
        const loadedValue = loadedPost[field];
        const freshValue = freshPost[field];

        if (Array.isArray(loadedValue) || Array.isArray(freshValue)) {
          return (
            !Array.isArray(loadedValue) ||
            !Array.isArray(freshValue) ||
            loadedValue.length !== freshValue.length ||
            loadedValue.some((value, index) => value !== freshValue[index])
          );
        }

        return loadedValue !== freshValue;
      });

      return {
        changedFields,
        freshPost,
        loadedPost,
        title:
          freshPost.title ||
          loadedPost.title ||
          `Hacker News post ${freshPost.id}`,
      };
    }),
  );

  refreshResults.forEach(({ freshPost, loadedPost }) => {
    LIVE_ITEM_FIELDS.forEach((field) => {
      if (!Object.hasOwn(freshPost, field)) {
        delete loadedPost[field];
      }
    });
    Object.assign(loadedPost, freshPost);
  });

  return refreshResults.filter(
    ({ changedFields }) => changedFields.length > 0,
  );
}

function createLiveUpdateMessage({
  changedFields,
  freshPost,
  title,
}) {
  if (freshPost.deleted) {
    return `“${title}” was deleted.`;
  }

  if (freshPost.dead) {
    return `“${title}” is no longer active.`;
  }

  const labels = [];
  const specificallyDescribedFields = new Set([
    'dead',
    'deleted',
    'descendants',
    'kids',
    'parts',
    'score',
  ]);

  if (
    changedFields.includes('kids') ||
    changedFields.includes('descendants')
  ) {
    labels.push('comments');
  }

  if (changedFields.includes('score')) {
    labels.push('score');
  }

  if (changedFields.includes('parts')) {
    labels.push('poll choices');
  }

  if (
    changedFields.some(
      (field) => !specificallyDescribedFields.has(field),
    )
  ) {
    labels.push('details');
  }

  if (labels.length === 0) {
    return `“${title}” was updated.`;
  }

  let changeSummary = labels[0];

  if (labels.length === 2) {
    changeSummary = `${labels[0]} and ${labels[1]}`;
  } else if (labels.length > 2) {
    changeSummary =
      `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
  }

  return (
    `${changeSummary[0].toUpperCase()}${changeSummary.slice(1)} ` +
    `updated on “${title}”.`
  );
}

/**
 * Checks Hacker News for live item changes and updates loaded post state.
 *
 * The first valid response becomes a silent baseline. Overlapping checks are
 * ignored, and failures preserve the previous baseline so the change can be
 * retried. Errors are handled internally by marking live updates unavailable
 * and logging once per outage.
 *
 * @returns {Promise<void>}
 */
async function checkForNewData() {
  if (liveUpdateCheckInProgress) {
    return;
  }

  liveUpdateCheckInProgress = true;

  try {
    const response = await fetch(`${BASE_URL}/updates.json`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch live updates: ${response.status}`);
    }

    const updates = await response.json();

    if (!updates || !Array.isArray(updates.items)) {
      throw new Error('Live updates response did not include an items array');
    }

    if (
      !updates.items.every(
        (id) => Number.isInteger(id) && id > 0,
      )
    ) {
      throw new Error('Live updates response included an invalid item ID');
    }

    const currentUpdateIds = [...updates.items];

    if (previousLiveUpdateIds === null) {
      previousLiveUpdateIds = currentUpdateIds;
      markLiveUpdatesAvailable();
      return;
    }

    // The API does not define an order for updates.items. Compare membership
    // so harmless reordering does not look like dozens of new changes.
    const previousUpdateIds = new Set(previousLiveUpdateIds);
    const newlyReportedIds = currentUpdateIds.filter(
      (id) => !previousUpdateIds.has(id),
    );
    const changedPosts =
      await refreshChangedLoadedPosts(newlyReportedIds);

    changedPosts.forEach((changedPost) => {
      showNotification(createLiveUpdateMessage(changedPost));
    });

    previousLiveUpdateIds = currentUpdateIds;
    markLiveUpdatesAvailable();
  } catch (error) {
    setLiveIndicator(false);

    if (!liveUpdateErrorReported) {
      console.error('Unable to check Hacker News live updates.', error);
      liveUpdateErrorReported = true;
    }
  } finally {
    liveUpdateCheckInProgress = false;
  }
}

function startLiveUpdateTimer() {
  if (liveUpdateTimerId !== null) {
    return liveUpdateTimerId;
  }

  void checkForNewData();
  liveUpdateTimerId = setInterval(() => {
    void checkForNewData();
  }, LIVE_UPDATE_INTERVAL_MS);

  return liveUpdateTimerId;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startLiveUpdateTimer, {
    once: true,
  });
} else {
  startLiveUpdateTimer();
}
