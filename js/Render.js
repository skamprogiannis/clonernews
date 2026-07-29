async function togglePost(
  post,
  details,
  commentsContainer,
  pollOptionsContainer,
  toggleButton,
) {
  const willOpen = details.hidden;

  details.hidden = !willOpen;
  toggleButton.setAttribute('aria-expanded', String(willOpen));
  toggleButton.textContent = willOpen ? 'Close post' : 'Open post';

  if (!willOpen || details.dataset.loaded === 'true') {
    return;
  }

  const commentIds = Array.isArray(post.kids) ? post.kids : [];
  const pollOptionIds = Array.isArray(post.parts) ? post.parts : [];

  commentsContainer.textContent =
    commentIds.length > 0 ? 'Loading comments…' : 'No comments available.';
  if (pollOptionsContainer) {
    pollOptionsContainer.textContent = 'Loading poll choices…';
  }
  toggleButton.disabled = true;

  try {
    const [comments, pollOptions] = await Promise.all([
      Promise.all(commentIds.map((id) => fetchItemDetails(id))),
      Promise.all(pollOptionIds.map((id) => fetchItemDetails(id))),
    ]);

    if (pollOptionsContainer) {
      const validOptions = pollOptions.filter(
        (option) =>
          option &&
          option.type === 'pollopt' &&
          option.poll === post.id &&
          Number.isInteger(option.id),
      );

      pollOptionsContainer.replaceChildren();
      validOptions.forEach((option) => {
        const listItem = document.createElement('li');
        const score = document.createElement('span');

        listItem.className = 'poll-option';
        listItem.dataset.pollOptionId = String(option.id);
        listItem.innerHTML = option.text || `Poll choice ${option.id}`;
        score.textContent = ` — ${option.score ?? 0} votes`;
        listItem.append(score);
        pollOptionsContainer.append(listItem);
      });

      if (validOptions.length === 0) {
        pollOptionsContainer.textContent = 'No poll choices available.';
      }
    }

    if (comments.length > 0) {
      renderComments(comments.filter(Boolean), post.id);
    }

    if (comments.length === 0 || commentsContainer.children.length === 0) {
      commentsContainer.textContent = 'No comments available.';
    }

    details.dataset.loaded = 'true';
  } catch (error) {
    commentsContainer.textContent =
      'Post details could not be loaded. Close and reopen the post to retry.';
    if (pollOptionsContainer) {
      pollOptionsContainer.textContent = '';
    }
    console.error(`Unable to load details for item ${post.id}.`, error);
  } finally {
    toggleButton.disabled = false;
  }
}

function renderPosts(posts) {
  const container = document.getElementById('posts-container');
  const newestFirst = [...posts]
    .filter((post) => post && Number.isInteger(post.id))
    .sort((first, second) => second.time - first.time);

  newestFirst.forEach((post) => {
    const postCard = document.createElement('article');
    const title = document.createElement('h2');
    const metadata = document.createElement('p');
    const toggleButton = document.createElement('button');
    const details = document.createElement('div');
    const commentsContainer = document.createElement('section');
    let pollOptionsContainer = null;

    postCard.className = 'post-card';
    postCard.dataset.postId = String(post.id);
    title.className = 'post-title';
    title.textContent = post.title || `Hacker News item ${post.id}`;
    metadata.className = 'post-meta';
    metadata.textContent =
      `${post.type || 'item'} · by ${post.by || 'unknown'} · ` +
      new Date(post.time * 1000).toLocaleString();

    toggleButton.className = 'post-toggle';
    toggleButton.type = 'button';
    toggleButton.textContent = 'Open post';
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.setAttribute('aria-controls', `post-details-${post.id}`);

    details.className = 'post-details';
    details.hidden = true;
    details.id = `post-details-${post.id}`;

    if (post.url) {
      const sourceLink = document.createElement('a');

      sourceLink.className = 'post-source';
      sourceLink.href = post.url;
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.target = '_blank';
      sourceLink.textContent = 'Read original source';
      details.append(sourceLink);
    }

    if (post.text) {
      const body = document.createElement('div');

      body.className = 'post-text';
      body.innerHTML = post.text;
      details.append(body);
    }

    if (Array.isArray(post.parts) && post.parts.length > 0) {
      const pollOptionsTitle = document.createElement('h3');

      pollOptionsTitle.textContent = 'Poll choices';
      pollOptionsContainer = document.createElement('ol');
      pollOptionsContainer.className = 'poll-options';
      details.append(pollOptionsTitle, pollOptionsContainer);
    }

    commentsContainer.className = 'comments-section';
    commentsContainer.id = `comments-${post.id}`;
    details.append(commentsContainer);

    toggleButton.addEventListener('click', () =>
      togglePost(
        post,
        details,
        commentsContainer,
        pollOptionsContainer,
        toggleButton,
      ),
    );

    postCard.append(title, metadata, toggleButton, details);
    container.append(postCard);
  });
}
