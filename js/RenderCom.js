function renderComments(comments, parentId) {

    let com = document.getElementById(`comments-${parentId}`);

    comments.forEach(comment => {

        const commentBox = document.createElement('div');
        commentBox.className = 'comment-box';


        commentBox.innerHTML = `
            <div class="comment-author">${comment.by || 'Anonymous'}</div>
            <div class="comment-text">${comment.text}</div>
        `;


        com.appendChild(commentBox);
    });
}
