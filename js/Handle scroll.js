const FEED_BATCH_SIZE = 10;

let activePostIds = [];
let activePostType = 'story';
let nextPostIndex = 0;
let feedLoadInProgress = false;
let feedRequestId = 0;

function setFeedStatus(message, state = '') {
  const status = document.getElementById('feed-status');

  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.state = state;
}

async function loadMorePosts(requestId = feedRequestId) {
  if (
    requestId !== feedRequestId ||
    feedLoadInProgress ||
    nextPostIndex >= activePostIds.length
  ) {
    return;
  }

  feedLoadInProgress = true;
  const batchIds = activePostIds.slice(
    nextPostIndex,
    nextPostIndex + FEED_BATCH_SIZE,
  );

  try {
    const posts = (await Promise.all(batchIds.map(fetchItemDetails))).filter(
      Boolean,
    );

    if (requestId !== feedRequestId) {
      return;
    }

    nextPostIndex += batchIds.length;
    loadedPosts.push(...posts);
    renderPosts(posts);
    setFeedStatus(
      nextPostIndex >= activePostIds.length
        ? `All ${loadedPosts.length} ${activePostType} posts loaded.`
        : `${loadedPosts.length} ${activePostType} posts loaded. Scroll for more.`,
      'success',
    );
  } catch (error) {
    if (requestId !== feedRequestId) {
      return;
    }

    setFeedStatus(
      'Could not load more posts. Scroll again to retry.',
      'error',
    );
    console.error(`Unable to load more ${activePostType} posts.`, error);
  } finally {
    if (requestId === feedRequestId) {
      feedLoadInProgress = false;
    }
  }
}

async function loadFeed(type) {
  const postsContainer = document.getElementById('posts-container');
  const requestId = feedRequestId + 1;

  feedRequestId = requestId;
  activePostType = type;
  setFeedStatus(`Loading ${type} posts…`, 'loading');

  try {
    const postIds = await fetchPostIds(type);

    if (requestId !== feedRequestId) {
      return;
    }

    activePostIds = postIds;
    nextPostIndex = 0;
    feedLoadInProgress = false;
    loadedPosts.length = 0;
    postsContainer?.replaceChildren();

    if (activePostIds.length === 0) {
      setFeedStatus(`No ${type} posts are available right now.`, 'empty');
      return;
    }

    await loadMorePosts(requestId);
  } catch (error) {
    if (requestId !== feedRequestId) {
      return;
    }

    setFeedStatus(
      'Could not load posts. Try another filter or retry in a moment.',
      'error',
    );
    console.error(`Unable to load the ${type} feed.`, error);
  }
}

function handleScrollEvent() {
  const scrollPosition = window.innerHeight + window.scrollY;
  const totalHeight = document.documentElement.scrollHeight;

  if (scrollPosition >= totalHeight - 100) {
    void loadMorePosts();
  }
}

async function selectPostType(selectedButton, filterButtons) {
  filterButtons.forEach((button) => {
    button.classList.toggle('active', button === selectedButton);
  });

  await loadFeed(selectedButton.dataset.type);
}

async function initializeFeed() {
  const filterButtons = [...document.querySelectorAll('.filter-btn')];
  const initialButton =
    filterButtons.find((button) => button.classList.contains('active')) ||
    filterButtons[0];

  filterButtons.forEach((button) => {
    button.addEventListener('click', () =>
      selectPostType(button, filterButtons),
    );
  });
  window.addEventListener('scroll', throttle(handleScrollEvent, 200), {
    passive: true,
  });

  if (initialButton) {
    await selectPostType(initialButton, filterButtons);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeFeed, {
    once: true,
  });
} else {
  void initializeFeed();
}
