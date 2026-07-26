const LIVE_UPDATE_INTERVAL_MS = 5000;
const MAX_LIVE_NOTIFICATIONS = 5;

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

async function refreshChangedLoadedPosts(changedIds) {
  const loadedPostsById = new Map(
    loadedPosts
      .filter((post) => post && Number.isInteger(post.id))
      .map((post) => [post.id, post]),
  );
  const loadedChangedIds = changedIds.filter((id) =>
    loadedPostsById.has(id),
  );
  const refreshResults = await Promise.allSettled(
    loadedChangedIds.map(async (id) => {
      const freshPost = await fetchItemDetails(id, {
        forceRefresh: true,
      });
      const loadedPost = loadedPostsById.get(id);

      if (freshPost && loadedPost) {
        Object.assign(loadedPost, freshPost);
      }

      return freshPost;
    }),
  );

  return refreshResults
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
}

function createLiveUpdateMessage(changedIds, refreshedPosts) {
  const itemLabel = changedIds.length === 1 ? 'item' : 'items';
  const titles = refreshedPosts
    .map((post) => post.title)
    .filter((title) => typeof title === 'string' && title.trim())
    .slice(0, 3);
  let message =
    `Hacker News updated: ${changedIds.length} ${itemLabel} changed.`;

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

    liveUpdateErrorReported = false;

    const currentUpdateIds = new Set(
      updates.items.filter(Number.isInteger),
    );

    setLiveIndicator(true);

    if (previousLiveUpdateIds === null) {
      previousLiveUpdateIds = currentUpdateIds;
      return;
    }

    const changedIds = [...currentUpdateIds].filter(
      (id) => !previousLiveUpdateIds.has(id),
    );
    previousLiveUpdateIds = currentUpdateIds;

    if (changedIds.length === 0) {
      return;
    }

    const refreshedPosts = await refreshChangedLoadedPosts(changedIds);
    showNotification(createLiveUpdateMessage(changedIds, refreshedPosts));
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
