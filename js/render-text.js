function appendSafeHackerNewsMarkup(target, markup) {
  if (typeof DOMParser === 'undefined') {
    target.textContent = String(markup ?? '');
    return;
  }

  const parsed = new DOMParser().parseFromString(String(markup ?? ''), 'text/html');
  const allowedTags = new Set([
    'A',
    'B',
    'BR',
    'CODE',
    'EM',
    'I',
    'P',
    'PRE',
    'STRONG',
  ]);

  function appendNode(source, destination) {
    if (source.nodeType === 3) {
      destination.append(document.createTextNode(source.textContent));
      return;
    }

    if (source.nodeType !== 1) {
      return;
    }

    if (!allowedTags.has(source.tagName)) {
      source.childNodes.forEach((child) => appendNode(child, destination));
      return;
    }

    const element = document.createElement(source.tagName.toLowerCase());
    if (source.tagName === 'A') {
      const href = source.getAttribute('href');

      if (href) {
        try {
          const url = new URL(href, 'https://news.ycombinator.com');
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            element.href = url.href;
            element.rel = 'noopener noreferrer';
            element.target = '_blank';
          }
        } catch {
          // Keep malformed links as text-only anchors.
        }
      }
    }

    source.childNodes.forEach((child) => appendNode(child, element));
    destination.append(element);
  }

  parsed.body.childNodes.forEach((node) => appendNode(node, target));
}
