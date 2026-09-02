function renderComments(comments, parentId) {
  const container = document.getElementById(`comments-${parentId}`);

  if (!container) {
    return;
  }

  const newestFirst = comments
    .filter(
      (comment) =>
        comment &&
        comment.parent === parentId &&
        !comment.dead &&
        !comment.deleted,
    )
    .sort((first, second) => second.time - first.time);

  container.replaceChildren();

  newestFirst.forEach((comment) => {
    const commentBox = document.createElement('article');
    const author = document.createElement('div');
    const text = document.createElement('div');

    commentBox.className = 'comment-box';
    commentBox.dataset.commentId = String(comment.id);
    author.className = 'comment-author';
    author.textContent = comment.by || 'Anonymous';
    text.className = 'comment-text';
    appendSafeHackerNewsMarkup(text, comment.text || '');

    commentBox.append(author, text);

    if (Array.isArray(comment.kids) && comment.kids.length > 0) {
      const replyButton = document.createElement('button');
      const repliesContainer = document.createElement('section');
      const replyLabel = comment.kids.length === 1 ? 'reply' : 'replies';

      replyButton.className = 'comment-toggle';
      replyButton.type = 'button';
      replyButton.textContent = `Show ${comment.kids.length} ${replyLabel}`;
      replyButton.setAttribute('aria-expanded', 'false');
      replyButton.setAttribute('aria-controls', `comments-${comment.id}`);

      repliesContainer.className = 'nested-comments';
      repliesContainer.id = `comments-${comment.id}`;
      repliesContainer.hidden = true;

      replyButton.addEventListener('click', async () => {
        const willOpen = repliesContainer.hidden;

        repliesContainer.hidden = !willOpen;
        replyButton.setAttribute('aria-expanded', String(willOpen));
        replyButton.textContent = willOpen
          ? 'Hide replies'
          : `Show ${comment.kids.length} ${replyLabel}`;

        if (!willOpen || repliesContainer.dataset.loaded === 'true') {
          return;
        }

        replyButton.disabled = true;
        replyButton.textContent = 'Loading replies…';

        try {
          const replies = (
            await Promise.all(
              comment.kids.map((id) => fetchItemDetails(id)),
            )
          ).filter(Boolean);

          renderComments(replies, comment.id);
          if (repliesContainer.children.length === 0) {
            repliesContainer.textContent = 'No replies available.';
          }
          repliesContainer.dataset.loaded = 'true';
          replyButton.textContent = 'Hide replies';
        } catch (error) {
          repliesContainer.textContent =
            'Replies could not be loaded. Try again.';
          repliesContainer.hidden = true;
          replyButton.setAttribute('aria-expanded', 'false');
          replyButton.textContent = 'Retry replies';
          console.error(
            `Unable to load replies for comment ${comment.id}.`,
            error,
          );
        } finally {
          replyButton.disabled = false;
        }
      });

      commentBox.append(replyButton, repliesContainer);
    }

    container.append(commentBox);
  });
}
