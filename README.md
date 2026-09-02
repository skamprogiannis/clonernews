# Cloner News

A dependency-free Hacker News client built with HTML, CSS, and vanilla
JavaScript. It combines lazily loaded feeds, expandable discussions, polls,
and meaningful live-update notifications in one responsive interface.

## Highlights

- Browses new stories, jobs, polls, Ask HN, and Show HN posts.
- Loads feed pages on demand without fetching the same item twice.
- Displays nested comment threads and poll results in place.
- Refreshes loaded items every five seconds and reports only meaningful
  changes.
- Exposes clear loading, empty, offline, and retry states.
- Renders the limited Hacker News markup allowlist without copying unsafe
  elements or attributes into the page.

## Architecture

The browser talks directly to the public data services; there is no build step
or application server.

```text
Hacker News API --------> feed and item cache -----> renderers
        |                         |                       |
        |                         +----> live diff -------+
        |
Algolia poll search ---> recent poll ID discovery
```

- `js/script.js` owns API access, caching, and throttling.
- `js/Handle scroll.js` coordinates feed selection and incremental loading.
- `js/Render.js` and `js/RenderCom.js` build posts and comment trees.
- `js/live-updates.js` compares fresh item snapshots with the loaded state.
- `js/render-text.js` recreates only a small safe subset of API markup.

## Poll discovery

The official Hacker News API represents polls and poll options as items, but it
does not provide an endpoint that lists recent polls. Discovering them only
through the official API would require walking backward from `maxitem` and
potentially making hundreds or thousands of item requests.

To avoid unnecessary load, Cloner News makes one
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

The tests use Node.js 18 or newer and its built-in test runner:

```bash
npm test
```

They cover feed ordering and pagination, request caching, overlapping loads,
poll discovery, nested replies, and live-update comparisons.

## Team and contributions

- `atassos` established the visual design, page structure, and early feed
  rendering.
- `edamaski` implemented the initial Hacker News API and comment helpers.
- `skamprogiannis` integrated feed interactions and nested content, developed
  the live-update system, expanded automated tests, and documented the final
  architecture.

The repository keeps the original commit history for all three contributors.

## Status and limitations

This Zone01 Athens project is feature-complete for its current assignment.
Because it uses public browser APIs, an internet connection is required and
temporary upstream failures can delay or prevent loading. Poll IDs come from
Algolia because the official Hacker News API does not expose a recent-polls
listing endpoint.
