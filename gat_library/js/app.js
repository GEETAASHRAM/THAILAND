// =========================================================
// GITA APP ENGINE (MOBILE-OPTIMIZED + SUBSCRIPTIONS + KARAOKE + SHARE + TOAST)
// =========================================================

const container = document.getElementById('container');
const searchResults = document.getElementById('searchResults');
const chapterSelect = document.getElementById('chapterSelect');
const searchInput = document.getElementById('searchInput');
const globalPresentationBtn = document.getElementById('globalPresentationBtn');

let globalGeetaData = [];
let currentChapterAudio = null;
let chunkMonitorId = null;
let currentPlaylist = [];
let precomputedSubOptions = { chapter: [], verse: [] };
let deferredPwaPrompt = null;

const kState = {
  playlist: [],
  listIndex: 0,
  mode: 'chapter',
  animId: null,
  audio: new Audio()
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    initToast();
    initPWAInstallPrompt();
    injectShareSheet();
    injectSubscriptionModal();
    injectKaraokeModal();
    injectWelcomeScreen();

    bindStaticEvents();

    const response = await fetch('data/geeta_complete.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

    globalGeetaData = await response.json();

    populateChapterDropdown();
    precomputeSubscriptionOptions();

    const routed = handleSubscriptionRouting();
    if (!routed) loadChapter();
  } catch (error) {
    console.error('Initialization Error:', error);
    showToast('Failed to load Gita data. Please check your internet connection.', 'error', 5000);
  }
});

// ---------------------------------------------------------
// Toast
// ---------------------------------------------------------
function initToast() {
  if (!document.getElementById('toastRoot')) {
    const root = document.createElement('div');
    root.id = 'toastRoot';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }
}

function showToast(message, type = 'info', timeout = 3500) {
  const root = document.getElementById('toastRoot');
  if (!root) return;

  const toast = document.createElement('div');
  toast.className = `app-toast app-toast--${type}`;
  toast.innerHTML = `
    <div class="app-toast__body">${message}</div>
    <button class="app-toast__close" aria-label="Close">×</button>
  `;
  root.appendChild(toast);

  const cleanup = () => {
    toast.remove();
  };

  toast.querySelector('.app-toast__close')?.addEventListener('click', cleanup);
  setTimeout(cleanup, timeout);
}

// ---------------------------------------------------------
// PWA install
// ---------------------------------------------------------
function initPWAInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const toast = document.getElementById('pwaInstallToast');
    if (toast && !localStorage.getItem('pwa_toast_dismissed')) {
      toast.style.display = 'flex';
    }
  });

  document.getElementById('btnInstallPwa')?.addEventListener('click', async () => {
    if (!deferredPwaPrompt) return;
    deferredPwaPrompt.prompt();
    const choice = await deferredPwaPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      document.getElementById('pwaInstallToast').style.display = 'none';
    }
    deferredPwaPrompt = null;
  });

  document.getElementById('btnClosePwaToast')?.addEventListener('click', () => {
    document.getElementById('pwaInstallToast').style.display = 'none';
    localStorage.setItem('pwa_toast_dismissed', 'true');
  });
}

// ---------------------------------------------------------
// Static bindings
// ---------------------------------------------------------
function bindStaticEvents() {
  document.getElementById('searchButton')?.addEventListener('click', searchWord);
  searchInput?.addEventListener('keyup', e => {
    if (e.key === 'Enter') searchWord();
  });

  document.getElementById('clearButton')?.addEventListener('click', clearResults);

  chapterSelect?.addEventListener('change', loadChapter);

  globalPresentationBtn?.addEventListener('click', () => {
    const mode = searchResults.innerHTML.trim() ? 'search' : 'chapter';
    openKaraoke(currentPlaylist, 0, mode);
  });

  document.addEventListener('click', e => {
    const inline = e.target.closest('.inline-play-btn');
    if (inline) {
      const absoluteIndex = Number(inline.dataset.index);
      playVerseInline(absoluteIndex);
    }
  });

  document.getElementById('quickSubscribeAd')?.addEventListener('click', () => {
    openSubscriptionModalPreFilled('chapter', '12', 'daily');
  });

  document.getElementById('quickSubscribeAd')?.addEventListener('keypress', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openSubscriptionModalPreFilled('chapter', '12', 'daily');
    }
  });
}

// ---------------------------------------------------------
// Data helpers
// ---------------------------------------------------------
function populateChapterDropdown() {
  const chapters = Array.from(new Set(globalGeetaData.map(item => item.Chapter)));
  chapters.sort((a, b) => parseInt(a) - parseInt(b));

  chapterSelect.innerHTML = '';
  chapters.forEach(chapter => {
    const option = document.createElement('option');
    option.value = chapter;
    option.textContent = `Chapter ${chapter}`;
    chapterSelect.appendChild(option);
  });
}

function precomputeSubscriptionOptions() {
  setTimeout(() => {
    try {
      const seen = new Set();
      const chapters = [];

      globalGeetaData.forEach((v, idx) => {
        if (!seen.has(v.Chapter)) {
          seen.add(v.Chapter);
          chapters.push({
            val: String(v.Chapter),
            text: `Chapter ${v.Chapter}: ${v.Topic || 'Bhagavad Gita'}`
          });
        }

        precomputedSubOptions.verse.push({
          val: String(idx),
          text: `Ch ${v.Chapter}, Verse ${v.VerseNum}: ${v.Topic || ''}`
        });
      });

      precomputedSubOptions.chapter = chapters;
    } catch (err) {
      console.error('Precompute error:', err);
    }
  }, 0);
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function nl2br(str = '') {
  return escapeHtml(str).replace(/\n/g, '<br>');
}

function buildVerseCard(item, absoluteIndex, highlightTerm = '') {
  const hasAudio = item.AudioStart !== undefined && Number(item.AudioEnd) > Number(item.AudioStart);
  const highlightMatch = text => {
    const safe = nl2br(text || '');
    if (!highlightTerm) return safe;
    try {
      const rx = new RegExp(`(${highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return safe.replace(rx, '<span class="highlight">$1</span>');
    } catch {
      return safe;
    }
  };

  return `
    <div class="verse">
      <div class="verse-header">
        <div class="verse-meta">Chapter ${item.Chapter}, Verse ${item.VerseNum}</div>
        ${
          hasAudio
            ? `<button class="speaker-btn inline-play-btn" data-index="${absoluteIndex}" title="Play Verse Audio" aria-label="Play Verse Audio">🔊</button>`
            : ''
        }
      </div>
      <div class="sanskrit-lines mb-2">${highlightMatch(item.OriginalText)}</div>
      <div class="english-lines mb-3">${highlightMatch(item.EnglishText)}</div>
      <hr />
      <div class="hindi-description mb-2">${highlightMatch(item.OriginalMeaning)}</div>
      <div class="english-description">${highlightMatch(item.EnglishMeaning)}</div>
    </div>
  `;
}

// ---------------------------------------------------------
// Clear + chapter load + search
// ---------------------------------------------------------
function clearResults() {
  container.innerHTML = '';
  searchResults.innerHTML = '';
  globalPresentationBtn.style.display = 'none';
  currentPlaylist = [];
  stopAllAudio();
}

function stopAllAudio() {
  if (currentChapterAudio) currentChapterAudio.pause();
  cancelAnimationFrame(chunkMonitorId);
}

function loadChapter() {
  try {
    const selectedChapter = chapterSelect.value;
    searchResults.innerHTML = '';
    container.innerHTML = '';
    searchInput.value = '';

    currentPlaylist = [];

    const chapterData = globalGeetaData.filter((item, index) => {
      if (String(item.Chapter) === String(selectedChapter)) {
        currentPlaylist.push(index);
        return true;
      }
      return false;
    });

    if (currentPlaylist.length > 0) {
      globalPresentationBtn.style.display = 'inline-block';
    } else {
      globalPresentationBtn.style.display = 'none';
    }

    if (chapterData.length > 0 && chapterData[0].AudioFileURL) {
      const audioWrap = document.createElement('div');
      audioWrap.className = 'card mb-3';

      const label = document.createElement('h5');
      label.className = 'mb-2';
      label.textContent = `🔊 Play Chapter ${selectedChapter} Audio`;

      currentChapterAudio = new Audio();
      currentChapterAudio.id = 'mainChapterAudio';
      currentChapterAudio.controls = true;
      currentChapterAudio.preload = 'metadata';
      currentChapterAudio.src = chapterData[0].AudioFileURL;

      currentChapterAudio.addEventListener('error', () => {
        showAudioErrorToast(currentChapterAudio.src);
      });

      audioWrap.appendChild(label);
      audioWrap.appendChild(currentChapterAudio);
      container.appendChild(audioWrap);
    }

    const frag = document.createDocumentFragment();
    chapterData.forEach(verse => {
      const absoluteIndex = globalGeetaData.findIndex(v => v.Chapter === verse.Chapter && v.VerseNum === verse.VerseNum);
      const div = document.createElement('div');
      div.innerHTML = buildVerseCard(verse, absoluteIndex);
      frag.appendChild(div.firstElementChild);
    });

    container.appendChild(frag);
  } catch (error) {
    console.error('Error rendering chapter:', error);
    showToast('Unable to render chapter.', 'error');
  }
}

function searchWord() {
  try {
    const term = searchInput.value.toLowerCase().trim();
    if (!term) return;

    searchResults.innerHTML = '';
    container.innerHTML = '';
    stopAllAudio();
    currentPlaylist = [];

    let totalMatches = 0;
    const frag = document.createDocumentFragment();

    globalGeetaData.forEach((item, absoluteIndex) => {
      let verseHasMatch = false;

      for (const key in item) {
        if (typeof item[key] === 'string' && item[key].toLowerCase().includes(term)) {
          verseHasMatch = true;
          break;
        }
      }

      if (verseHasMatch) {
        totalMatches++;
        currentPlaylist.push(absoluteIndex);

        const div = document.createElement('div');
        div.innerHTML = buildVerseCard(item, absoluteIndex, term);
        frag.appendChild(div.firstElementChild);
      }
    });

    if (totalMatches > 0) {
      const totalsElement = document.createElement('div');
      totalsElement.className = 'alert alert-info';
      totalsElement.innerHTML = `<strong>Total matches found:</strong> ${totalMatches} verses`;
      searchResults.appendChild(totalsElement);
      searchResults.appendChild(frag);
      globalPresentationBtn.style.display = 'inline-block';
    } else {
      searchResults.innerHTML = `<p class="text-center text-danger mt-3">No results found.</p>`;
      globalPresentationBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('Error during search:', error);
    showToast('Search failed.', 'error');
  }
}

// ---------------------------------------------------------
// Inline verse player
// ---------------------------------------------------------
function playVerseInline(absoluteIndex) {
  try {
    const verse = globalGeetaData[absoluteIndex];
    if (!verse || !verse.AudioFileURL || verse.AudioStart === undefined) return;

    if (!currentChapterAudio) {
      currentChapterAudio = new Audio();
      currentChapterAudio.preload = 'metadata';
      currentChapterAudio.addEventListener('error', () => showAudioErrorToast(currentChapterAudio.src));
    }

    if (!currentChapterAudio.src || currentChapterAudio.src.indexOf(verse.AudioFileURL) === -1) {
      currentChapterAudio.src = verse.AudioFileURL;
    }

    cancelAnimationFrame(chunkMonitorId);
    currentChapterAudio.pause();
    currentChapterAudio.currentTime = Number(verse.AudioStart) || 0;

    currentChapterAudio.play().catch(err => {
      console.warn('Playback blocked', err);
      showToast('Tap again if your browser blocked audio autoplay.', 'warning');
    });

    const end = Number(verse.AudioEnd) || 0;

    const monitor = () => {
      if (!currentChapterAudio) return;
      if (currentChapterAudio.currentTime >= end) {
        currentChapterAudio.pause();
        currentChapterAudio.currentTime = Number(verse.AudioStart) || 0;
      } else if (!currentChapterAudio.paused) {
        chunkMonitorId = requestAnimationFrame(monitor);
      }
    };

    chunkMonitorId = requestAnimationFrame(monitor);
  } catch (err) {
    console.error('Inline play error:', err);
    showToast('Unable to play verse audio.', 'error');
  }
}

// ---------------------------------------------------------
// Subscription modal
// ---------------------------------------------------------
function injectSubscriptionModal() {
  const modalHTML = `
    <div id="subModal" class="karaoke-modal" style="z-index:105000;">
      <div class="karaoke-content bg-light text-dark p-4 rounded text-left" style="max-width:560px; width:95%; border-radius:18px;">
        <h3 class="text-primary mb-3">📅 Setup Daily Reading</h3>

        <div class="form-group">
          <label class="font-weight-bold">Subscribe to:</label>
          <select id="subType" class="form-control border-primary">
            <option value="chapter">One Chapter at a time</option>
            <option value="verse">One Verse at a time</option>
          </select>
        </div>

        <div class="form-group">
          <label class="font-weight-bold mb-1">Starting Point:</label>
          <input type="text" id="subFilter" class="form-control mb-2" placeholder="🔍 Search chapter or verse..." />
          <div id="subFilterFeedback" class="small text-muted mb-1"></div>
          <div id="subLoading" class="loading-inline hidden">⏳ Processing options...</div>
          <select id="subStart" class="form-control" size="5" style="overflow-y:auto;"></select>
        </div>

        <div class="row">
          <div class="col-sm-6 form-group">
            <label class="font-weight-bold">Start Date:</label>
            <input type="date" id="subDate" class="form-control" />
          </div>
          <div class="col-sm-6 form-group">
            <label class="font-weight-bold">Notification Time:</label>
            <input type="time" id="subTime" class="form-control" />
          </div>
        </div>

        <div class="form-group">
          <label class="font-weight-bold">Frequency:</label>
          <select id="subFreq" class="form-control">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <div class="d-flex flex-column mt-3" style="gap:10px;">
          <button id="btnGoogleCal" class="btn btn-primary">➕ Add to Google Calendar</button>
          <button id="btnAppleCal" class="btn btn-dark">🍎 Add to Apple / Outlook (.ics)</button>
          <button id="btnCopySubLink" class="btn btn-info">🔗 Copy Subscription Link</button>
          <button id="btnCloseSub" class="btn btn-outline-secondary">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const subModal = document.getElementById('subModal');
  const subType = document.getElementById('subType');
  const subStart = document.getElementById('subStart');
  const subFilter = document.getElementById('subFilter');
  const subFilterFeedback = document.getElementById('subFilterFeedback');
  const subLoading = document.getElementById('subLoading');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('subDate').value = tomorrow.toISOString().split('T')[0];

  document.getElementById('btnOpenSubModal')?.addEventListener('click', () => {
    openSubscriptionModalPreFilled('chapter', '1', 'daily');
  });

  document.getElementById('btnCloseSub')?.addEventListener('click', () => {
    subModal.classList.remove('active');
  });

  subModal.addEventListener('click', e => {
    if (e.target === subModal) subModal.classList.remove('active');
  });

  subType.addEventListener('change', () => {
    subFilter.value = '';
    openSubscriptionModalPreFilled(subType.value, '', document.getElementById('subFreq').value);
  });

  subFilter.addEventListener('input', e => {
    const term = e.target.value.toLowerCase().trim();
    const source = subType.value === 'chapter' ? precomputedSubOptions.chapter : precomputedSubOptions.verse;

    subStart.innerHTML = '';
    let count = 0;

    const frag = document.createDocumentFragment();
    source.forEach(opt => {
      if (!term || opt.text.toLowerCase().includes(term)) {
        const option = document.createElement('option');
        option.value = opt.val;
        option.textContent = opt.text;
        frag.appendChild(option);
        count++;
      }
    });

    subStart.appendChild(frag);
    subFilterFeedback.textContent = term ? `Showing ${count} matching options` : '';
  });

  document.getElementById('btnCopySubLink')?.addEventListener('click', async () => {
    if (!subStart.value) {
      showToast('Please select a starting point.', 'warning');
      return;
    }

    const appUrl = generateAppUrl();
    const message = `📖 My Bhagavad Gita reading link\n\nOpen today’s reading here:\n${appUrl}\n\nShared from Geeta App`;

    try {
      await navigator.clipboard.writeText(message);
      showToast('Subscription link copied with message.', 'success');
    } catch {
      showToast('Failed to copy subscription link.', 'error');
    }
  });

  document.getElementById('btnGoogleCal')?.addEventListener('click', () => {
    if (!subStart.value) {
      showToast('Please select a starting point.', 'warning');
      return;
    }

    const appUrl = generateAppUrl();
    const freq = document.getElementById('subFreq').value.toUpperCase();
    const { dtStart, dtEnd } = getUTCStartAndEnd();

    const details = `Tap the link to open today's reading:\n${appUrl}`;
    const gCalUrl =
      `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent('📖 Gita Reading')}` +
      `&dates=${dtStart}/${dtEnd}` +
      `&details=${encodeURIComponent(details)}` +
      `&recur=${encodeURIComponent(`RRULE:FREQ=${freq}`)}`;

    window.open(gCalUrl, '_blank');
    subModal.classList.remove('active');
  });

  document.getElementById('btnAppleCal')?.addEventListener('click', () => {
    if (!subStart.value) {
      showToast('Please select a starting point.', 'warning');
      return;
    }

    const type = subType.value;
    const appUrl = generateAppUrl();
    const freq = document.getElementById('subFreq').value.toUpperCase();
    const { dtStart } = getUTCStartAndEnd();

    const icsData = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//GitaApp//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'SUMMARY:📖 Gita Reading',
      `DTSTART:${dtStart}`,
      `RRULE:FREQ=${freq}`,
      `DESCRIPTION:Tap to open today's reading:\\n${appUrl}`,
      `URL:${appUrl}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT0M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n');

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Gita_Reminder_${type}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    subModal.classList.remove('active');
    showToast('Calendar file downloaded.', 'success');
  });

  function generateAppUrl() {
    const type = subType.value;
    const startVal = subStart.value;
    const freq = document.getElementById('subFreq').value;
    const startDate = document.getElementById('subDate').value;
    const subId = `sub_${Date.now()}`;

    return `${window.location.origin}${window.location.pathname}?subId=${subId}&type=${encodeURIComponent(type)}&start=${encodeURIComponent(startVal)}&freq=${encodeURIComponent(freq)}&date=${encodeURIComponent(startDate)}`;
  }

  function getUTCStartAndEnd() {
    const dateVal = document.getElementById('subDate').value;
    const timeVal = document.getElementById('subTime').value;
    const localDate = new Date(`${dateVal}T${timeVal}:00`);

    const formatUTC = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const dtStart = formatUTC(localDate);
    const dtEnd = formatUTC(new Date(localDate.getTime() + 15 * 60000));

    return { dtStart, dtEnd };
  }
}

function openSubscriptionModalPreFilled(type, startValue, freq) {
  const subModal = document.getElementById('subModal');
  const subType = document.getElementById('subType');
  const subStart = document.getElementById('subStart');
  const subLoading = document.getElementById('subLoading');

  subType.value = type;
  subLoading.classList.remove('hidden');
  subStart.style.display = 'none';

  setTimeout(() => {
    const list = type === 'chapter' ? precomputedSubOptions.chapter : precomputedSubOptions.verse;
    subStart.innerHTML = '';

    const frag = document.createDocumentFragment();
    list.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.val;
      option.textContent = opt.text;
      frag.appendChild(option);
    });

    subStart.appendChild(frag);
    if (startValue !== undefined && startValue !== null && startValue !== '') {
      subStart.value = String(startValue);
    }

    subLoading.classList.add('hidden');
    subStart.style.display = 'block';
  }, 0);

  document.getElementById('subFreq').value = freq;

  const targetUTC = new Date();
  targetUTC.setUTCHours(14, 15, 0, 0); // 21:15 Bangkok = 14:15 UTC
  const localH = String(targetUTC.getHours()).padStart(2, '0');
  const localM = String(targetUTC.getMinutes()).padStart(2, '0');
  document.getElementById('subTime').value = `${localH}:${localM}`;

  subModal.classList.add('active');
}

// ---------------------------------------------------------
// Welcome + routing
// ---------------------------------------------------------
function injectWelcomeScreen() {
  const splashHTML = `
    <div id="welcomeSplash" class="welcome-splash" style="display:none;">
      <div class="welcome-card">
        <div id="streakBadge" class="streak-badge" style="display:none;">🔥 1 Day Streak</div>
        <h2>Welcome Back!</h2>
        <p class="text-light mt-2 mb-4">Your daily Srimad Bhagavad Gita reading is ready.</p>
        <button id="btnBeginReading" class="btn-begin">▶️ Begin Reading</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', splashHTML);
}

function handleSubscriptionRouting() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const subId = urlParams.get('subId');
    if (!subId) return false;

    let streak = parseInt(localStorage.getItem('gita_streak') || '0', 10);
    const lastRead = localStorage.getItem('gita_last_read');
    const todayStr = new Date().toISOString().split('T')[0];

    if (lastRead !== todayStr) {
      streak++;
      localStorage.setItem('gita_streak', String(streak));
      localStorage.setItem('gita_last_read', todayStr);
    }

    const badge = document.getElementById('streakBadge');
    if (streak > 1 && badge) {
      badge.textContent = `🔥 ${streak} Day Streak`;
      badge.style.display = 'inline-block';
    }

    const type = urlParams.get('type');
    const initialStart = parseInt(urlParams.get('start') || '0', 10);
    const startDateStr = urlParams.get('date');
    const freq = urlParams.get('freq');

    if (!type || !startDateStr || Number.isNaN(initialStart)) return false;

    const startDate = new Date(startDateStr);
    const today = new Date();
    const diffTime = Math.max(0, today - startDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let progressionSteps = 0;
    if (freq === 'daily') progressionSteps = diffDays;
    else if (freq === 'weekly') progressionSteps = Math.floor(diffDays / 7);
    else if (freq === 'monthly') {
      progressionSteps =
        (today.getFullYear() - startDate.getFullYear()) * 12 +
        (today.getMonth() - startDate.getMonth());
      if (progressionSteps < 0) progressionSteps = 0;
    }

    let pList = [];

    if (type === 'verse') {
      const targetIndex = initialStart + progressionSteps;
      if (targetIndex >= globalGeetaData.length) {
        showToast('You have completed all verses in this subscription.', 'success', 5000);
        return true;
      }
      pList = [targetIndex];
    } else if (type === 'chapter') {
      const chapters = Array.from(new Set(globalGeetaData.map(i => parseInt(i.Chapter, 10))));
      const startChapIndex = chapters.indexOf(initialStart);
      const targetChapIndex = startChapIndex + progressionSteps;

      if (targetChapIndex >= chapters.length) {
        showToast('You have completed all chapters in this subscription.', 'success', 5000);
        return true;
      }

      const targetChapter = chapters[targetChapIndex];
      globalGeetaData.forEach((v, i) => {
        if (parseInt(v.Chapter, 10) === targetChapter) pList.push(i);
      });
    }

    const splash = document.getElementById('welcomeSplash');
    splash.style.display = 'flex';

    const beginBtn = document.getElementById('btnBeginReading');
    beginBtn.onclick = () => {
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.style.display = 'none';
      }, 400);

      openKaraoke(pList, 0, type);
    };

    return true;
  } catch (err) {
    console.error('Routing error:', err);
    showToast('Failed to open subscription reading.', 'error');
    return false;
  }
}

// ---------------------------------------------------------
// Karaoke modal + share
// ---------------------------------------------------------
function injectKaraokeModal() {
  const modalHTML = `
    <div id="karaokeModal" class="karaoke-modal">
      <button id="kCloseBtn" class="k-close-btn" aria-label="Close">×</button>
      <button id="kShareBtn" class="k-share-btn">🔗 Share</button>

      <div id="kContent" class="karaoke-content">
        <div id="kTitle" class="karaoke-title"></div>
        <div id="kLyrics" class="karaoke-lyrics"></div>
        <div id="kEnglish" class="karaoke-english"></div>

        <div id="kManualControls" class="k-manual-container" style="display:none;">
          <button id="kRewind" class="k-icon-btn" title="Rewind 5s">⏪</button>
          <button id="kPlayPause" class="k-icon-btn" title="Play/Pause">⏯️</button>
          <button id="kForward" class="k-icon-btn" title="Forward 5s">⏩</button>
        </div>
      </div>

      <div class="karaoke-controls" id="kControls">
        <button id="kPrevBtn" class="k-btn">⏮️ Prev Verse</button>
        <button id="kNextBtn" class="k-btn">Next Verse ⏭️</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('kCloseBtn')?.addEventListener('click', closeKaraoke);
  document.getElementById('karaokeModal')?.addEventListener('click', e => {
    if (e.target.id === 'karaokeModal') closeKaraoke();
  });
  document.getElementById('kPrevBtn')?.addEventListener('click', () => traverseKaraoke(-1));
  document.getElementById('kNextBtn')?.addEventListener('click', () => traverseKaraoke(1));
  document.getElementById('kRewind')?.addEventListener('click', () => {
    kState.audio.currentTime = Math.max(0, kState.audio.currentTime - 5);
  });
  document.getElementById('kForward')?.addEventListener('click', () => {
    kState.audio.currentTime += 5;
  });
  document.getElementById('kPlayPause')?.addEventListener('click', () => {
    if (kState.audio.paused) {
      kState.audio.play().catch(() => showToast('Playback blocked. Tap again.', 'warning'));
    } else {
      kState.audio.pause();
    }
  });

  kState.audio.preload = 'metadata';
  kState.audio.addEventListener('error', () => showAudioErrorToast(kState.audio.src));

  document.getElementById('kShareBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    const verse = globalGeetaData[kState.playlist[kState.listIndex]];
    if (!verse) return;

    const shareUrl = `${window.location.origin}${window.location.pathname}`;
    const message =
      `📖 Bhagavad Gita — Chapter ${verse.Chapter}, Verse ${verse.VerseNum}\n\n` +
      `${verse.OriginalText || ''}\n\n` +
      `${verse.EnglishText || ''}\n\n` +
      `Read and listen on Geeta App:\n${shareUrl}`;

    openShareSheet({
      title: `Bhagavad Gita - Chapter ${verse.Chapter}, Verse ${verse.VerseNum}`,
      text: message,
      url: shareUrl
    });
  });
}

function openKaraoke(playlistArr, startListIndex = 0, mode = 'chapter') {
  if (!playlistArr || playlistArr.length === 0) {
    showToast('No verses available for presentation.', 'warning');
    return;
  }

  stopAllAudio();

  kState.playlist = playlistArr;
  kState.listIndex = startListIndex;
  kState.mode = mode;

  const modal = document.getElementById('karaokeModal');
  modal.classList.add('active');

  document.getElementById('kControls').style.display = mode === 'verse' ? 'none' : 'flex';
  playCurrentKaraoke();
}

function closeKaraoke() {
  document.getElementById('karaokeModal')?.classList.remove('active');
  kState.audio.pause();
  cancelAnimationFrame(kState.animId);
}

function traverseKaraoke(direction) {
  const nextIndex = kState.listIndex + direction;
  if (nextIndex >= 0 && nextIndex < kState.playlist.length) {
    kState.listIndex = nextIndex;
    playCurrentKaraoke();
  }
}

function playCurrentKaraoke() {
  try {
    const absoluteIndex = kState.playlist[kState.listIndex];
    const verse = globalGeetaData[absoluteIndex];
    if (!verse) return;

    const content = document.getElementById('kContent');
    const manualControls = document.getElementById('kManualControls');

    cancelAnimationFrame(kState.animId);
    content.classList.add('fade-out');

    setTimeout(() => {
      document.getElementById('kTitle').textContent =
        `Chapter ${verse.Chapter}, Verse ${verse.VerseNum}${verse.Topic ? ' — ' + verse.Topic : ''}`;
      document.getElementById('kLyrics').innerHTML = nl2br(verse.OriginalText || 'Text Unavailable');
      document.getElementById('kEnglish').innerHTML = nl2br(verse.EnglishText || '');
      content.classList.remove('fade-out');

      const hasTimestamps = verse.AudioStart !== undefined && Number(verse.AudioEnd) > Number(verse.AudioStart);
      manualControls.style.display = hasTimestamps ? 'none' : 'flex';

      if (!verse.AudioFileURL) return;

      let fileChanged = false;
      if (!kState.audio.src || kState.audio.src.indexOf(verse.AudioFileURL) === -1) {
        kState.audio.src = verse.AudioFileURL;
        fileChanged = true;
      }

      if (hasTimestamps) {
        const start = Number(verse.AudioStart) || 0;
        const end = Number(verse.AudioEnd) || 0;

        const timeDiff = Math.abs((kState.audio.currentTime || 0) - start);
        const isContiguous = !fileChanged && !kState.audio.paused && timeDiff < 0.35;

        if (!isContiguous) {
          kState.audio.currentTime = start;
          kState.audio.play().catch(() => showToast('Tap play if autoplay is blocked.', 'warning'));
        }

        const monitor = () => {
          if (kState.audio.currentTime >= end) {
            if (kState.mode === 'verse') {
              kState.audio.currentTime = start;
              kState.animId = requestAnimationFrame(monitor);
            } else if (kState.listIndex < kState.playlist.length - 1) {
              kState.listIndex++;
              playCurrentKaraoke();
            } else {
              kState.audio.pause();
            }
          } else if (!kState.audio.paused) {
            kState.animId = requestAnimationFrame(monitor);
          }
        };

        kState.animId = requestAnimationFrame(monitor);
      } else {
        if (kState.mode !== 'search') {
          kState.audio.play().catch(() => showToast('Tap play if autoplay is blocked.', 'warning'));
        } else {
          kState.audio.pause();
        }
      }
    }, 180);
  } catch (err) {
    console.error('Error playing karaoke:', err);
    showToast('Unable to open presentation.', 'error');
  }
}

// ---------------------------------------------------------
// Share sheet
// ---------------------------------------------------------
function injectShareSheet() {
  const html = `
    <div id="shareSheet" class="share-sheet">
      <div class="share-sheet__panel">
        <div class="share-sheet__title">Share</div>
        <div id="sharePreview" class="share-sheet__preview"></div>

        <div class="share-grid">
          <button id="shareNativeBtn">📲 Share</button>
          <button id="shareCopyBtn">📋 Copy Message</button>
          <button id="shareWhatsappBtn">🟢 WhatsApp</button>
          <button id="shareTelegramBtn">🔵 Telegram</button>
          <button id="shareEmailBtn">✉️ Email</button>
          <button id="shareCopyLinkBtn">🔗 Copy Link Only</button>
        </div>

        <button id="shareSheetClose" class="share-sheet__close">Close</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const sheet = document.getElementById('shareSheet');
  sheet.addEventListener('click', e => {
    if (e.target === sheet) closeShareSheet();
  });

  document.getElementById('shareSheetClose')?.addEventListener('click', closeShareSheet);
}

let currentSharePayload = null;

function openShareSheet({ title, text, url }) {
  currentSharePayload = { title, text, url };
  document.getElementById('sharePreview').textContent = text;
  document.getElementById('shareSheet').classList.add('active');

  document.getElementById('shareNativeBtn').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        closeShareSheet();
      } catch {}
    } else {
      showToast('Native share is not available on this device.', 'warning');
    }
  };

  document.getElementById('shareCopyBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Message copied.', 'success');
      closeShareSheet();
    } catch {
      showToast('Failed to copy message.', 'error');
    }
  };

  document.getElementById('shareCopyLinkBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied.', 'success');
      closeShareSheet();
    } catch {
      showToast('Failed to copy link.', 'error');
    }
  };

  document.getElementById('shareWhatsappBtn').onclick = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  document.getElementById('shareTelegramBtn').onclick = () => {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
  };

  document.getElementById('shareEmailBtn').onclick = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
  };
}

function closeShareSheet() {
  document.getElementById('shareSheet')?.classList.remove('active');
}

// ---------------------------------------------------------
// Audio error handling
// ---------------------------------------------------------
function showAudioErrorToast(src = '') {
  const shortUrl = src ? `<div style="font-size:12px;opacity:.85;margin-top:4px;word-break:break-all;">${src}</div>` : '';
  showToast(`Audio could not be loaded. Please check your connection or try again.${shortUrl}`, 'error', 6000);
}
