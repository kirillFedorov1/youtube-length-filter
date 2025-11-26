// Default minimal duration (minutes) for Home / Subscriptions
const DEFAULT_MIN_MINUTES = 10;

// Video cards in different feeds
const VIDEO_CARD_SELECTORS = [
  'ytd-rich-item-renderer',
  'ytd-grid-video-renderer',
  'ytd-video-renderer'
];

let minDurationSeconds = DEFAULT_MIN_MINUTES * 60;
let hideShorts = true;
let autoTheater = false;
let observerStarted = false;
let lastTheaterVideoId = null;
let theaterRetryTimer = null;

console.log('[yt-length-filter] content script loaded, path =', location.pathname);

// ----- Page helpers -----
function isHomePage() {
  return location.pathname === '/';
}

function isSubscriptionsPage() {
  return location.pathname.startsWith('/feed/subscriptions');
}

function isFilterPage() {
  return isHomePage() || isSubscriptionsPage();
}

function isWatchPage() {
  return location.pathname === '/watch';
}

// ----- Duration parsing -----
function parseDurationToSeconds(text) {
  if (!text) return null;

  const cleaned = text.replace(/[^\d:]/g, '').trim();
  if (!cleaned.includes(':')) return null;

  const parts = cleaned.split(':').filter(Boolean);
  if (!parts.length || !parts.every(p => /^\d+$/.test(p))) return null;

  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + parseInt(part, 10);
  }
  return seconds;
}

// Find pure timecode element in card
function findDurationElementInCard(card) {
  const candidates = card.querySelectorAll('*');

  for (const el of candidates) {
    const text = (el.textContent || '').trim();
    // Strict "mm:ss" or "hh:mm:ss" without extra text
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
      return el;
    }
  }

  return null;
}

// Handle single video card (only on filter pages)
function handleCard(card) {
  if (!(card instanceof HTMLElement)) return;
  if (!isFilterPage()) return;

  if (card.dataset.ytLengthFilterChecked === '1') return;

  const durEl = findDurationElementInCard(card);
  if (!durEl) return;

  const rawText = durEl.textContent || '';
  const seconds = parseDurationToSeconds(rawText);
  if (seconds == null) return;

  card.dataset.ytLengthFilterChecked = '1';

  if (seconds < minDurationSeconds) {
    card.style.display = 'none';
    card.dataset.ytLengthFilterHidden = '1';
    console.log('[yt-length-filter] hide card, duration =', seconds, 'sec, text =', rawText.trim());
  } else {
    console.log('[yt-length-filter] keep card, duration =', seconds, 'sec, text =', rawText.trim());
  }
}

// Filter already rendered cards
function filterAllVideos(root = document) {
  if (!isFilterPage()) {
    console.log('[yt-length-filter] filterAllVideos: not a filter page, path =', location.pathname);
    return;
  }

  const selector = VIDEO_CARD_SELECTORS.join(',');
  const cards = root.querySelectorAll(selector);

  console.log('[yt-length-filter] filterAllVideos, cards found =', cards.length);
  cards.forEach(handleCard);
}

// ----- Shorts hiding -----
function hideShortsInNode(root) {
  if (!hideShorts || !(root instanceof HTMLElement)) return;

  // Horizontal Shorts shelves
  const shelves = root.matches('ytd-reel-shelf-renderer')
    ? [root]
    : root.querySelectorAll('ytd-reel-shelf-renderer');

  shelves.forEach(el => {
    if (el.dataset.ytLengthFilterShortsHidden === '1') return;
    el.style.display = 'none';
    el.dataset.ytLengthFilterShortsHidden = '1';
    console.log('[yt-length-filter] hide Shorts shelf');
  });

  // Any cards that link to /shorts/
  const shortsLinks = root.querySelectorAll('a[href*="/shorts/"]');
  shortsLinks.forEach(link => {
    const card = link.closest(
      'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-reel-item-renderer'
    );
    if (!card || card.dataset.ytLengthFilterShortsHidden === '1') return;

    card.style.display = 'none';
    card.dataset.ytLengthFilterShortsHidden = '1';
    console.log('[yt-length-filter] hide Shorts card with link', link.href);
  });
}

function hideShortsEverywhere() {
  if (!hideShorts) return;
  hideShortsInNode(document);
}

// ----- Auto theater mode -----
function getCurrentVideoId() {
  if (!isWatchPage()) return null;
  const params = new URLSearchParams(location.search || '');
  return params.get('v');
}

function ensureTheaterMode() {
  if (!autoTheater || !isWatchPage()) return;

  const videoId = getCurrentVideoId();
  if (!videoId) return;
  if (lastTheaterVideoId === videoId) return; // already processed

  const flexy = document.querySelector('ytd-watch-flexy');
  if (!flexy) {
    // Player not yet ready – retry once a bit later
    if (theaterRetryTimer) return;
    theaterRetryTimer = setTimeout(() => {
      theaterRetryTimer = null;
      ensureTheaterMode();
    }, 500);
    return;
  }

  lastTheaterVideoId = videoId;

  if (flexy.hasAttribute('theater')) {
    console.log('[yt-length-filter] theater already enabled for', videoId);
    return;
  }

  const sizeBtn =
    flexy.querySelector('.ytp-size-button') ||
    document.querySelector('.ytp-size-button');

  if (sizeBtn) {
    sizeBtn.click();
    console.log('[yt-length-filter] switched to theater mode via button for', videoId);
    return;
  }

  // Fallback: send keyboard shortcut "T"
  const ev = new KeyboardEvent('keydown', {
    key: 't',
    code: 'KeyT',
    keyCode: 84,
    which: 84,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(ev);
  console.log('[yt-length-filter] tried switching to theater mode via key event for', videoId);
}

// ----- MutationObserver -----
function setupObserver() {
  if (observerStarted) return;
  observerStarted = true;

  const target =
    document.querySelector('ytd-page-manager') ||
    document.querySelector('ytd-app') ||
    document.body;

  if (!target) {
    console.warn('[yt-length-filter] no target for MutationObserver');
    return;
  }

  const selector = VIDEO_CARD_SELECTORS.join(',');

  const observer = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // Filter cards on Home / Subscriptions
        if (node.matches && node.matches(selector)) {
          handleCard(node);
        } else if (node.querySelectorAll) {
          const innerCards = node.querySelectorAll(selector);
          innerCards.forEach(handleCard);
        }

        // Hide Shorts everywhere
        hideShortsInNode(node);
      }
    }
  });

  observer.observe(target, { childList: true, subtree: true });
  console.log('[yt-length-filter] MutationObserver started');
}

// ----- Settings + entry -----
function applySettingsAndRun() {
  chrome.storage?.sync.get(
    {
      minMinutes: DEFAULT_MIN_MINUTES,
      hideShorts: true,
      autoTheater: false
    },
    data => {
      const minutes =
        typeof data.minMinutes === 'number' && data.minMinutes >= 0
          ? data.minMinutes
          : DEFAULT_MIN_MINUTES;

      minDurationSeconds = minutes * 60;
      hideShorts = !!data.hideShorts;
      autoTheater = !!data.autoTheater;

      console.log(
        '[yt-length-filter] settings: minMinutes =',
        minutes,
        ', hideShorts =',
        hideShorts,
        ', autoTheater =',
        autoTheater,
        ', path =',
        location.pathname
      );

      filterAllVideos();
      hideShortsEverywhere();
      ensureTheaterMode();
      setupObserver();
    }
  );
}

function handleNavigation() {
  console.log('[yt-length-filter] navigation event, path =', location.pathname);

  lastTheaterVideoId = null;
  if (theaterRetryTimer) {
    clearTimeout(theaterRetryTimer);
    theaterRetryTimer = null;
  }

  applySettingsAndRun();
}

// First run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applySettingsAndRun);
} else {
  applySettingsAndRun();
}

// SPA navigation (YouTube)
window.addEventListener('yt-navigate-finish', handleNavigation);
window.addEventListener('popstate', handleNavigation);
