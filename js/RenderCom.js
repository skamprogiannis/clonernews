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
    text.innerHTML = comment.text || '';

    commentBox.append(author, text);
    container.append(commentBox);
  });
}
