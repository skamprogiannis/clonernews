function renderPosts(posts) {
    let container = document.getElementById('posts-container');

    posts.forEach(post => {
        const postCard = document.createElement('div');
        postCard.className = 'post-card'; 

       
        postCard.innerHTML = `
            <h2 class="post-title">${post.title}</h2>
            <div class="post-meta">
                Type: <strong>${post.type}</strong> | By: <strong>${post.by || 'unknown'}</strong>
            </div>
          
            <div class="comments-section" id="comments-${post.id}"></div>
        `;

        container.appendChild(postCard);
    });
}
