# clonernews

.
##  Agreed Naming Conventions 

Everyone must use these identical names within their code modules:
- `BASE_URL = ''` (Official API endpoint)
- `loadedPosts` (Global JS array tracking posts currently rendered on screen)
- Post types (Strings): `'story'`, `'job'`, `'poll'`
- DOM Element IDs:
  - `#live-notification-area` (The container for the 5-second live updates)
  - `#posts-container` (The main feed container where post cards are appended)
  - `#filter-buttons` (The UI filtering controls)

---------------------------------------------------------------------------------

##  Roles & Function Allocation

###  Member 1: Integrator & Live Data
**Responsibilities:** Project coordination, final code integration, and the Live Updates mechanism.
**Functions to implement (JavaScript):**
1. `function startLiveUpdateTimer()`
   - **What it does:** Starts a tracker using `setInterval` that executes strictly every 5000ms (5 seconds).
2. `async function checkForNewData()`
   - **What it does:** Triggered by the timer, fetches the latest top ID from the API, compares it to our displayed state, and detects updates.
3. `function showNotification(message)`
   - **What it does:** Renders a visual alert banner inside `#live-notification-area` to notify the user of new content.

----------------------------------------------------------------------------------
###  Member 2: Frontend Developer (UI/UX & Events)
**Responsibilities:** Page layout design, data rendering, and scroll event management (Lazy Loading).
**Files to implement:** `index.html`, `style.css`
**Functions to implement (JavaScript):**
1. `function renderPosts(posts)`
   - **What it does:** Receives an array of post objects, builds HTML card structures with appropriate CSS badges based on type, and appends them sorted (newest to oldest) into `#posts-container`.
2. `function handleScrollEvent()`
   - **What it does:** Monitors window scrolling; when the user nears the bottom, it triggers the loading of the next batch of 10 posts (Infinite Scroll).
3. `function renderComments(comments, parentId)`
   - **What it does:** Correctly structures and injects comment threads beneath the post matching the specified `parentId`.
-------------------------------------------------------------------------------

### Member 3: Backend Developer (API Integration & Optimization)
**Responsibilities:** Interfacing with the HackerNews API, data formatting, and protecting against Rate Limiting.
**Functions to implement (JavaScript):**
1. `async function fetchPostIds(type)`
   - **What it does:** Accepts a category string (`'story'`, `'job'`, `'poll'`), calls the respective API endpoint, and returns an array of item IDs.
2. `async function fetchItemDetails(id)`
   - **What it does:** Takes a single ID and returns an object containing the comprehensive details of that post or comment.
3. `function throttle(func, limit)` or `debounce(func, delay)`
   - **What it does:** A utility function that prevents API overload by capping execution frequency, specifically during rapid scrolling.

-----------------------------------------------------------------------------

# HackerNews UI - JavaScript Function Skeletons

```javascript
async function fetchPostIds(type) {

}

async function fetchItemDetails(id) {

}

function throttle(func, limit) {

}

function renderPosts(posts) {

}

function handleScrollEvent() {

}

function renderComments(comments, parentId) {

}

function startLiveUpdateTimer() {

}

async function checkForNewData() {

}
```
---------------------------------------------------------------------


##  Execution Milestones
1. **Milestone 1:** Member 3 develops core fetch routines & Member 2 designs the static HTML/CSS layout.
2. **Milestone 2:** Binding live API data to the UI, completing `renderPosts` and implementing Infinite Scroll (`handleScrollEvent`).
3. **Milestone 3:** Integration of the 5-second Live Timer by Member 1, followed by comprehensive testing.