# Clownernews

Clownernews is a browser-based Hacker News client built with HTML, CSS, and
vanilla JavaScript. It displays stories, jobs, polls, Ask HN, and Show HN posts
in newest-first order.

The interface includes lazy-loaded feeds, comments and nested replies, poll
choices, and notifications when Hacker News data changes. Post data comes from
the Hacker News API, with Algolia Hacker News Search used to find recent polls.

## Poll discovery

The official Hacker News API represents polls and poll options as items, but it
does not provide an endpoint that lists recent polls. Discovering them only
through the official API would require walking backward from `maxitem` and
potentially making hundreds or thousands of item requests.

To avoid unnecessary load, Clownernews makes one
[Algolia Hacker News Search](https://hn.algolia.com/api) request to discover
recent poll IDs. It then fetches and validates every displayed poll, poll
option, and comment through the
[official Hacker News API](https://github.com/HackerNews/API). Algolia is used
only for discovery; the displayed item data still comes from Hacker News.

## Run locally

The project has no build step or package dependencies. From the project
directory, start a local web server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. An
internet connection is required to load Hacker News data.

## Run the tests

The tests require Node.js:

```bash
node tests/feed.test.js
node tests/live-data.test.js
```
