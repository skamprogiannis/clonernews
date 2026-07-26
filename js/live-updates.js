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

function findChangedUpdateIds(previousIds, currentIds) {
  const lengths = Array.from(
    { length: previousIds.length + 1 },
    () => Array(currentIds.length + 1).fill(0),
  );

  for (
    let previousIndex = 1;
    previousIndex <= previousIds.length;
    previousIndex += 1
  ) {
    for (
      let currentIndex = 1;
      currentIndex <= currentIds.length;
      currentIndex += 1
    ) {
      if (
        previousIds[previousIndex - 1] ===
        currentIds[currentIndex - 1]
      ) {
        lengths[previousIndex][currentIndex] =
          lengths[previousIndex - 1][currentIndex - 1] + 1;
      } else {
        lengths[previousIndex][currentIndex] = Math.max(
          lengths[previousIndex - 1][currentIndex],
          lengths[previousIndex][currentIndex - 1],
        );
      }
    }
  }

  const stableIds = new Set();
  let previousIndex = previousIds.length;
  let currentIndex = currentIds.length;

  while (previousIndex > 0 && currentIndex > 0) {
    if (
      previousIds[previousIndex - 1] ===
      currentIds[currentIndex - 1]
    ) {
      stableIds.add(previousIds[previousIndex - 1]);
      previousIndex -= 1;
      currentIndex -= 1;
    } else if (
      lengths[previousIndex - 1][currentIndex] >=
      lengths[previousIndex][currentIndex - 1]
    ) {
      previousIndex -= 1;
    } else {
      currentIndex -= 1;
    }
  }

  return currentIds.filter((id) => !stableIds.has(id));
}

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

      const didChange = LIVE_ITEM_FIELDS.some((field) => {
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

      return { didChange, freshPost, loadedPost };
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

  return {
    changedPosts: refreshResults
      .filter((result) => result.didChange)
      .map((result) => result.freshPost),
    refreshedPosts: refreshResults.map((result) => result.freshPost),
  };
}

function createLiveUpdateMessage(changedIds, refreshedPosts) {
  const titles = refreshedPosts
    .map((post) => post.title)
    .filter((title) => typeof title === 'string' && title.trim())
    .slice(0, 3);
  let message = 'Hacker News live data changed.';

  if (changedIds.length > 0) {
    const itemLabel = changedIds.length === 1 ? 'item' : 'items';
    message =
      `Hacker News updated: ${changedIds.length} ${itemLabel} changed.`;
  }

  if (titles.length > 0) {
    message += ` Updated on screen: ${titles.join(', ')}.`;
  }

  return message;
}

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

    const previousUpdateIdSet = new Set(previousLiveUpdateIds);
    const addedIds = currentUpdateIds.filter(
      (id) => !previousUpdateIdSet.has(id),
    );
    const didSnapshotChange =
      currentUpdateIds.length !== previousLiveUpdateIds.length ||
      currentUpdateIds.some(
        (id, index) => id !== previousLiveUpdateIds[index],
      );

    if (!didSnapshotChange) {
      markLiveUpdatesAvailable();
      return;
    }

    const changedUpdateIds = findChangedUpdateIds(
      previousLiveUpdateIds,
      currentUpdateIds,
    );
    const { changedPosts, refreshedPosts } =
      await refreshChangedLoadedPosts(changedUpdateIds);

    const postsToName =
      addedIds.length > 0
        ? refreshedPosts.filter(
            (post) =>
              addedIds.includes(post.id) ||
              changedPosts.some(
                (changedPost) => changedPost.id === post.id,
              ),
          )
        : changedPosts;
    const reportedChangeIds = [
      ...new Set([
        ...addedIds,
        ...changedPosts.map((post) => post.id),
      ]),
    ];

    showNotification(
      createLiveUpdateMessage(reportedChangeIds, postsToName),
    );
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
