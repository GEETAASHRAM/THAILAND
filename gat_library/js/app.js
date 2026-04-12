// =========================================================
// GITA APP ENGINE
// - Main reading UI
// - Search
// - Chapter playback
// - Subscription modal
// - Karaoke / presentation mode
// - Share sheet with QR
// - PWA install prompt
// =========================================================

(function () {
  'use strict';

  const QR_LOGO_URL =
    'https://raw.githubusercontent.com/GEETAASHRAM/THAILAND/refs/heads/main/gat_library/images/favicon_swamiharihar_ji_maharaj.ico';

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
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
  let currentSharePayload = null;

  const kState = {
    playlist: [],
    listIndex: 0,
    mode: 'chapter',
    animId: null,
    audio: new Audio()
  };

  // -------------------------------------------------------
  // Utility helpers
  // -------------------------------------------------------
  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(str = '') {
    return escapeHtml(str).replace(/\n/g, '<br>');
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

    const cleanup = () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    };

    toast.querySelector('.app-toast__close')?.addEventListener('click', cleanup);
    root.appendChild(toast);
    window.setTimeout(cleanup, timeout);
  }

  function stopInlineMonitor() {
    if (chunkMonitorId) {
      cancelAnimationFrame(chunkMonitorId);
      chunkMonitorId = null;
    }
  }

  function safeAudioErrorToast(src = '') {
    const shortUrl = src
      ? `<div style="font-size:12px;opacity:.85;margin-top:4px;word-break:break-all;">${escapeHtml(src)}</div>`
      : '';
    showToast(
      `Audio could not be loaded. Please check your connection and try again.${shortUrl}`,
      'error',
      6000
    );
  }

  function fitKaraokeTextToViewport(contentEl, lyricsEl, englishEl) {
    if (!contentEl || !lyricsEl || !englishEl) return;

    lyricsEl.style.fontSize = '';
    englishEl.style.fontSize = '';
    lyricsEl.style.lineHeight = '';
    englishEl.style.lineHeight = '';

    const contentMax = Math.max(220, window.innerHeight - 240);

    let lyricsSize = parseFloat(getComputedStyle(lyricsEl).fontSize) || 44;
    let englishSize = parseFloat(getComputedStyle(englishEl).fontSize) || 24;

    const minLyrics = 22;
    const minEnglish = 15;

    let guard = 0;
    while (contentEl.scrollHeight > contentMax && guard < 18) {
      if (lyricsSize > minLyrics) {
        lyricsSize -= 2;
        lyricsEl.style.fontSize = `${lyricsSize}px`;
        lyricsEl.style.lineHeight = '1.35';
      }

      if (contentEl.scrollHeight <= contentMax) break;

      if (englishSize > minEnglish) {
        englishSize -= 1;
        englishEl.style.fontSize = `${englishSize}px`;
        englishEl.style.lineHeight = '1.55';
      }

      guard++;
    }

    if (contentEl.scrollHeight > contentMax) {
      contentEl.style.overflowY = 'auto';
    } else {
      contentEl.style.overflowY = 'hidden';
    }
  }

  window.addEventListener('resize', () => {
    const content = document.getElementById('kContent') || document.getElementById('karaokeContent');
    const lyrics = document.getElementById('kLyrics');
    const english = document.getElementById('kEnglish');
    if (content && lyrics && english) {
      fitKaraokeTextToViewport(content, lyrics, english);
    }
  });

  // -------------------------------------------------------
  // Boot
  // -------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      initPWAInstallPrompt();
      injectShareSheet();
      injectSubscriptionModal();
      injectKaraokeModal();
      injectWelcomeScreen();
      bindStaticEvents();

      const response = await fetch('data/geeta_complete.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to load geeta_complete.json (${response.status})`);

      globalGeetaData = await response.json();

      populateChapterDropdown();
      precomputeSubscriptionOptions();

      const routed = handleSubscriptionRouting();
      if (!routed) {
        loadChapter();
      }
    } catch (error) {
      console.error('Initialization Error:', error);
      showToast('Failed to load Gita data. Please check your connection.', 'error', 6000);
    }
  });

  // -------------------------------------------------------
  // Static bindings
  // -------------------------------------------------------
  function bindStaticEvents() {
    document.getElementById('searchButton')?.addEventListener('click', searchWord);

    searchInput?.addEventListener('keyup', e => {
      if (e.key === 'Enter') searchWord();
    });

    document.getElementById('clearButton')?.addEventListener('click', clearResults);

    globalPresentationBtn?.addEventListener('click', () => {
      const mode = searchResults.innerHTML.trim() ? 'search' : 'chapter';
      openKaraoke(currentPlaylist, 0, mode);
    });

    document.addEventListener('click', e => {
      const speaker = e.target.closest('.speaker-btn');
      if (speaker) {
        const absoluteIndex = Number(speaker.getAttribute('data-index'));
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

  // -------------------------------------------------------
  // PWA install
  // -------------------------------------------------------
  function initPWAInstallPrompt() {
    setTimeout(() => {
      if (!deferredPwaPrompt && !localStorage.getItem('pwa_help_shown')) {
        showToast(
          'For faster access, install this app from your browser menu or Add to Home Screen.',
          'info',
          6000
        );
        localStorage.setItem('pwa_help_shown', 'true');
      }
    }, 3500);

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

      try {
        deferredPwaPrompt.prompt();
        const choice = await deferredPwaPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          document.getElementById('pwaInstallToast').style.display = 'none';
        }
      } catch (error) {
        console.error('Install prompt error:', error);
      } finally {
        deferredPwaPrompt = null;
      }
    });

    document.getElementById('btnClosePwaToast')?.addEventListener('click', () => {
      document.getElementById('pwaInstallToast').style.display = 'none';
      localStorage.setItem('pwa_toast_dismissed', 'true');
    });
  }

  // -------------------------------------------------------
  // Data precompute
  // -------------------------------------------------------
  function populateChapterDropdown() {
    const chapters = Array.from(new Set(globalGeetaData.map(item => Number(item.Chapter)))).sort((a, b) => a - b);
    chapterSelect.innerHTML = '';

    chapters.forEach(chapter => {
      const option = document.createElement('option');
      option.value = String(chapter);
      option.textContent = `Chapter ${chapter}`;
      chapterSelect.appendChild(option);
    });

    chapterSelect.addEventListener('change', loadChapter);
  }

  function precomputeSubscriptionOptions() {
    try {
      const seenChapters = new Set();
      precomputedSubOptions.chapter = [];
      precomputedSubOptions.verse = [];

      globalGeetaData.forEach((v, idx) => {
        if (!seenChapters.has(String(v.Chapter))) {
          seenChapters.add(String(v.Chapter));
          precomputedSubOptions.chapter.push({
            val: String(v.Chapter),
            text: `Chapter ${v.Chapter}: ${v.Topic || 'Bhagavad Gita'}`
          });
        }

        precomputedSubOptions.verse.push({
          val: String(idx),
          text: `Ch ${v.Chapter}, Verse ${v.VerseNum}: ${v.Topic || ''}`
        });
      });
    } catch (error) {
      console.error('Precompute subscription options error:', error);
    }
  }

  // -------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------
  function buildVerseCard(item, absoluteIndex, highlightTerm = '') {
    const hasAudio = item.AudioStart !== undefined && Number(item.AudioEnd) > Number(item.AudioStart);

    const highlight = text => {
      const safe = nl2br(text || '');
      if (!highlightTerm) return safe;

      try {
        const escaped = highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`(${escaped})`, 'gi');
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
              ? `<button class="speaker-btn" data-index="${absoluteIndex}" title="Play Verse Audio" aria-label="Play Verse Audio">🔊</button>`
              : ''
          }
        </div>
        <div class="sanskrit-lines mb-2">${highlight(item.OriginalText)}</div>
        <div class="english-lines mb-3">${highlight(item.EnglishText)}</div>
        <hr />
        <div class="hindi-description mb-2">${highlight(item.OriginalMeaning || '')}</div>
        <div class="english-description">${highlight(item.EnglishMeaning || '')}</div>
      </div>
    `;
  }

  // -------------------------------------------------------
  // Chapter load
  // -------------------------------------------------------
  function clearResults() {
    container.innerHTML = '';
    searchResults.innerHTML = '';
    currentPlaylist = [];
    globalPresentationBtn.style.display = 'none';

    if (currentChapterAudio) currentChapterAudio.pause();
    stopInlineMonitor();
  }

  function loadChapter() {
    try {
      const selectedChapter = chapterSelect.value;

      container.innerHTML = '';
      searchResults.innerHTML = '';
      searchInput.value = '';
      currentPlaylist = [];

      const chapterData = globalGeetaData.filter((item, absoluteIndex) => {
        if (String(item.Chapter) === String(selectedChapter)) {
          currentPlaylist.push(absoluteIndex);
          return true;
        }
        return false;
      });

      globalPresentationBtn.style.display = currentPlaylist.length ? 'inline-block' : 'none';

      if (chapterData.length > 0 && chapterData[0].AudioFileURL) {
        const audioWrap = document.createElement('div');
        audioWrap.className = 'card mb-3';

        const audioLabel = document.createElement('h5');
        audioLabel.className = 'mb-2';
        audioLabel.textContent = `🔊 Play Chapter ${selectedChapter} Audio`;

        currentChapterAudio = new Audio();
        currentChapterAudio.controls = true;
        currentChapterAudio.preload = 'metadata';
        currentChapterAudio.src = chapterData[0].AudioFileURL;
        currentChapterAudio.addEventListener('error', () => safeAudioErrorToast(currentChapterAudio.src));

        audioWrap.appendChild(audioLabel);
        audioWrap.appendChild(currentChapterAudio);
        container.appendChild(audioWrap);
      }

      const fragment = document.createDocumentFragment();

      chapterData.forEach((verse, i) => {
        const absoluteIndex = currentPlaylist[i];
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildVerseCard(verse, absoluteIndex);
        fragment.appendChild(wrapper.firstElementChild);
      });

      container.appendChild(fragment);
    } catch (error) {
      console.error('Load chapter error:', error);
      showToast('Unable to render chapter.', 'error');
    }
  }

  // -------------------------------------------------------
  // Search
  // -------------------------------------------------------
  function searchWord() {
    try {
      const term = searchInput.value.toLowerCase().trim();
      if (!term) return;

      searchResults.innerHTML = '';
      container.innerHTML = '';
      currentPlaylist = [];

      if (currentChapterAudio) currentChapterAudio.pause();
      stopInlineMonitor();

      let totalMatches = 0;
      const fragment = document.createDocumentFragment();

      globalGeetaData.forEach((item, absoluteIndex) => {
        let matched = false;

        for (const key in item) {
          if (typeof item[key] === 'string' && item[key].toLowerCase().includes(term)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          totalMatches++;
          currentPlaylist.push(absoluteIndex);

          const wrapper = document.createElement('div');
          wrapper.innerHTML = buildVerseCard(item, absoluteIndex, term);
          fragment.appendChild(wrapper.firstElementChild);
        }
      });

      if (totalMatches > 0) {
        const totals = document.createElement('div');
        totals.className = 'alert alert-info';
        totals.innerHTML = `<strong>Total matches found:</strong> ${totalMatches} verses`;

        searchResults.appendChild(totals);
        searchResults.appendChild(fragment);
        globalPresentationBtn.style.display = 'inline-block';
      } else {
        searchResults.innerHTML = `<p class="text-center text-danger mt-3">No results found.</p>`;
        globalPresentationBtn.style.display = 'none';
      }
    } catch (error) {
      console.error('Search error:', error);
      showToast('Search failed.', 'error');
    }
  }

  // -------------------------------------------------------
  // Inline verse playback
  // -------------------------------------------------------
  function playVerseInline(absoluteIndex) {
    try {
      const verse = globalGeetaData[absoluteIndex];
      if (!verse || !verse.AudioFileURL || verse.AudioStart === undefined) return;

      if (!currentChapterAudio) {
        currentChapterAudio = new Audio();
        currentChapterAudio.preload = 'metadata';
        currentChapterAudio.addEventListener('error', () => safeAudioErrorToast(currentChapterAudio.src));
      }

      if (!currentChapterAudio.src || currentChapterAudio.src.indexOf(verse.AudioFileURL) === -1) {
        currentChapterAudio.src = verse.AudioFileURL;
      }

      currentChapterAudio.pause();
      stopInlineMonitor();

      currentChapterAudio.currentTime = Number(verse.AudioStart) || 0;
      currentChapterAudio.play().catch(error => {
        console.warn('Autoplay blocked:', error);
        showToast('Tap again if your browser blocked audio autoplay.', 'warning');
      });

      const endTime = Number(verse.AudioEnd) || 0;

      const monitor = () => {
        if (!currentChapterAudio) return;
        if (currentChapterAudio.currentTime >= endTime) {
          currentChapterAudio.pause();
          currentChapterAudio.currentTime = Number(verse.AudioStart) || 0;
        } else if (!currentChapterAudio.paused) {
          chunkMonitorId = requestAnimationFrame(monitor);
        }
      };

      chunkMonitorId = requestAnimationFrame(monitor);
    } catch (error) {
      console.error('Inline play error:', error);
      showToast('Unable to play verse audio.', 'error');
    }
  }

  // -------------------------------------------------------
  // Subscription modal
  // -------------------------------------------------------
  function injectSubscriptionModal() {
    const html = `
      <div id="subscriptionModal" class="app-modal-overlay">
        <div class="app-modal-card">
          <button id="btnCloseSubModalX" class="app-modal-close" aria-label="Close">×</button>

          <div class="app-modal-title">📅 Daily Gita Subscription</div>
          <div class="app-modal-subtitle">
            Create a reminder link and add it to your calendar. When the reminder opens the app,
            the correct reading will appear automatically.
          </div>

          <div class="form-group">
            <label class="field-label" for="subType">What would you like to receive daily?</label>
            <span class="field-help">Choose between one full chapter or one verse at a time.</span>
            <select id="subType" class="form-control">
              <option value="chapter">One Chapter at a time</option>
              <option value="verse">One Verse at a time</option>
            </select>
          </div>

          <div class="form-group">
            <label class="field-label" for="subStart">Starting Point</label>
            <input type="text" id="subFilter" class="form-control mb-2" placeholder="🔍 Search chapter or verse..." />
            <div id="subFilterFeedback" class="small text-muted mb-1"></div>
            <div id="subLoading" class="loading-inline hidden">⏳ Processing options...</div>
            <select id="subStart" class="form-control" size="5" style="overflow-y:auto;"></select>
          </div>

          <div class="row">
            <div class="col-sm-6 form-group">
              <label class="field-label" for="subDate">Start Date</label>
              <input type="date" id="subDate" class="form-control" />
            </div>
            <div class="col-sm-6 form-group">
              <label class="field-label" for="subTime">Notification Time</label>
              <input type="time" id="subTime" class="form-control" />
            </div>
          </div>

          <div class="form-group">
            <label class="field-label" for="subFreq">Frequency</label>
            <select id="subFreq" class="form-control">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div class="modal-actions-stack mt-3">
            <button id="btnGoogleCal" class="btn btn-primary">➕ Add to Google Calendar</button>
            <button id="btnAppleCal" class="btn btn-dark">🍎 Add to Apple / Outlook (.ics)</button>
            <button id="btnCopySubLink" class="btn btn-info">🔗 Share / Copy Subscription Link</button>
            <button id="btnCloseSubModal" class="btn btn-outline-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById('subscriptionModal');
    const subType = document.getElementById('subType');
    const subStart = document.getElementById('subStart');
    const subFilter = document.getElementById('subFilter');
    const subFeedback = document.getElementById('subFilterFeedback');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('subDate').value = tomorrow.toISOString().split('T')[0];

    document.getElementById('btnOpenSubModal')?.addEventListener('click', () => {
      openSubscriptionModalPreFilled('chapter', '1', 'daily');
    });

    document.getElementById('btnCloseSubModal')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btnCloseSubModalX')?.addEventListener('click', () => modal.classList.remove('active'));

    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('active');
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

      const fragment = document.createDocumentFragment();
      source.forEach(opt => {
        if (!term || opt.text.toLowerCase().includes(term)) {
          const option = document.createElement('option');
          option.value = opt.val;
          option.textContent = opt.text;
          fragment.appendChild(option);
          count++;
        }
      });

      subStart.appendChild(fragment);
      subFeedback.textContent = term ? `Showing ${count} matching options` : '';
    });

    document.getElementById('btnCopySubLink')?.addEventListener('click', () => {
      try {
        if (!subStart.value) {
          showToast('Please select a starting point.', 'warning');
          return;
        }

        const appUrl = buildSubscriptionUrl();
        const message =
          `📖 My Bhagavad Gita reading link\n\n` +
          `Open today’s reading here:\n${appUrl}\n\n` +
          `Shared from Geeta App`;

        openShareSheet({
          title: 'Bhagavad Gita Subscription',
          text: message,
          url: appUrl
        });
      } catch (error) {
        console.error('Copy sub link error:', error);
        showToast('Failed to prepare subscription link.', 'error');
      }
    });

    document.getElementById('btnGoogleCal')?.addEventListener('click', () => {
      try {
        if (!subStart.value) {
          showToast('Please select a starting point.', 'warning');
          return;
        }

        const appUrl = buildSubscriptionUrl();
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
        modal.classList.remove('active');
      } catch (error) {
        console.error('Google calendar error:', error);
        showToast('Failed to open Google Calendar link.', 'error');
      }
    });

    document.getElementById('btnAppleCal')?.addEventListener('click', () => {
      try {
        if (!subStart.value) {
          showToast('Please select a starting point.', 'warning');
          return;
        }

        const type = document.getElementById('subType').value;
        const appUrl = buildSubscriptionUrl();
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
          `DESCRIPTION:Tap to open today\\'s reading:\\n${appUrl}`,
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

        modal.classList.remove('active');
        showToast('Calendar file downloaded.', 'success');
      } catch (error) {
        console.error('ICS generation error:', error);
        showToast('Failed to create calendar file.', 'error');
      }
    });

    function buildSubscriptionUrl() {
      const type = document.getElementById('subType').value;
      const startVal = document.getElementById('subStart').value;
      const freq = document.getElementById('subFreq').value;
      const startDate = document.getElementById('subDate').value;
      const subId = `sub_${Date.now()}`;

      return `${window.location.origin}${window.location.pathname}?subId=${encodeURIComponent(subId)}&type=${encodeURIComponent(type)}&start=${encodeURIComponent(startVal)}&freq=${encodeURIComponent(freq)}&date=${encodeURIComponent(startDate)}`;
    }

    function getUTCStartAndEnd() {
      const dateVal = document.getElementById('subDate').value;
      const timeVal = document.getElementById('subTime').value || '21:15';
      const localDate = new Date(`${dateVal}T${timeVal}:00`);

      const formatUTC = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const dtStart = formatUTC(localDate);
      const dtEnd = formatUTC(new Date(localDate.getTime() + 15 * 60000));

      return { dtStart, dtEnd };
    }
  }

  function openSubscriptionModalPreFilled(type, startValue, freq) {
    const modal = document.getElementById('subscriptionModal');
    const subType = document.getElementById('subType');
    const subStart = document.getElementById('subStart');
    const subLoading = document.getElementById('subLoading');

    subType.value = type;
    subLoading.classList.remove('hidden');
    subStart.style.display = 'none';

    setTimeout(() => {
      try {
        const list = type === 'chapter' ? precomputedSubOptions.chapter : precomputedSubOptions.verse;
        subStart.innerHTML = '';

        const fragment = document.createDocumentFragment();

        list.forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.val;
          option.textContent = opt.text;
          fragment.appendChild(option);
        });

        subStart.appendChild(fragment);

        if (startValue !== undefined && startValue !== null && startValue !== '') {
          subStart.value = String(startValue);
        }

        subLoading.classList.add('hidden');
        subStart.style.display = 'block';
      } catch (error) {
        console.error('Open sub modal error:', error);
        subLoading.classList.add('hidden');
        subStart.style.display = 'block';
      }
    }, 0);

    document.getElementById('subFreq').value = freq;

    const targetUTC = new Date();
    targetUTC.setUTCHours(14, 15, 0, 0);
    const localH = String(targetUTC.getHours()).padStart(2, '0');
    const localM = String(targetUTC.getMinutes()).padStart(2, '0');
    document.getElementById('subTime').value = `${localH}:${localM}`;

    modal.classList.add('active');
  }

  // -------------------------------------------------------
  // Welcome splash
  // -------------------------------------------------------
  function injectWelcomeScreen() {
    const html = `
      <div id="welcomeSplash" class="welcome-splash" style="display:none;">
        <div class="welcome-card">
          <div id="streakBadge" class="streak-badge" style="display:none;">🔥 1 Day Streak</div>
          <h2>Welcome Back!</h2>
          <p class="text-light mt-2 mb-4">Your daily Srimad Bhagavad Gita reading is ready.</p>
          <button id="btnBeginReading" class="btn-begin">▶️ Begin Reading</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
  }

  // -------------------------------------------------------
  // Subscription routing
  // -------------------------------------------------------
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
      if (badge && streak > 1) {
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

      let routePlaylist = [];

      if (type === 'verse') {
        const targetIndex = initialStart + progressionSteps;

        if (targetIndex >= globalGeetaData.length) {
          showToast('You have completed all verses in this subscription.', 'success', 5000);
          return true;
        }

        routePlaylist = [targetIndex];
      } else if (type === 'chapter') {
        const chapters = Array.from(new Set(globalGeetaData.map(i => Number(i.Chapter))));
        const startChapIndex = chapters.indexOf(initialStart);
        const targetChapIndex = startChapIndex + progressionSteps;

        if (targetChapIndex >= chapters.length) {
          showToast('You have completed all chapters in this subscription.', 'success', 5000);
          return true;
        }

        const targetChapter = chapters[targetChapIndex];
        globalGeetaData.forEach((v, i) => {
          if (Number(v.Chapter) === targetChapter) routePlaylist.push(i);
        });
      }

      const splash = document.getElementById('welcomeSplash');
      if (!splash) return false;

      splash.style.display = 'flex';

      const btnBegin = document.getElementById('btnBeginReading');
      btnBegin.onclick = () => {
        splash.classList.add('fade-out');
        setTimeout(() => {
          splash.style.display = 'none';
        }, 400);

        openKaraoke(routePlaylist, 0, type);
      };

      return true;
    } catch (error) {
      console.error('Subscription routing error:', error);
      showToast('Failed to open subscription reading.', 'error');
      return false;
    }
  }

  // -------------------------------------------------------
  // Share sheet with QR
  // -------------------------------------------------------
  function injectShareSheet() {
    const html = `
      <div id="shareSheet" class="share-sheet">
        <div class="share-sheet__panel">
          <div class="share-sheet__title">Share</div>

          <div class="share-sheet__layout">
            <div id="sharePreview" class="share-sheet__preview"></div>

            <div class="share-qr-card">
              <div class="share-qr-title">Scan QR to open</div>
              <div class="share-qr-wrap">
                <canvas id="shareQrCanvas" width="180" height="180"></canvas>
                <img id="shareQrLogo" class="share-qr-logo" alt="QR Logo" />
              </div>
              <div id="shareQrUrl" class="share-qr-url"></div>
            </div>
          </div>

          <div class="share-grid">
            <button id="shareNativeBtn">📲 Share</button>
            <button id="shareCopyBtn">📋 Copy Message</button>
            <button id="shareWhatsappBtn">🟢 WhatsApp</button>
            <button id="shareTelegramBtn">🔵 Telegram</button>
            <button id="shareEmailBtn">✉️ Email</button>
            <button id="shareCopyLinkBtn">🔗 Copy Link Only</button>
            <button id="shareQrImageBtn">📷 Share QR Image</button>
            <button id="copyQrImageBtn">🖼️ Copy QR Image</button>
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

  function getShareQrElements() {
    return {
      wrap: document.querySelector('.share-qr-wrap'),
      canvas: document.getElementById('shareQrCanvas'),
      logo: document.getElementById('shareQrLogo'),
      urlText: document.getElementById('shareQrUrl')
    };
  }

  function resetShareQrSurface() {
    const { wrap, canvas } = getShareQrElements();
    if (!wrap || !canvas) return;

    const legacy = document.getElementById('shareQrLegacy');
    if (legacy) legacy.remove();

    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function renderShareQr(url) {
    const { wrap, canvas, logo, urlText } = getShareQrElements();
    if (!wrap || !canvas || !url) return;

    resetShareQrSurface();

    try {
      if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        await window.QRCode.toCanvas(canvas, url, {
          width: 180,
          margin: 1,
          errorCorrectionLevel: 'H',
          color: {
            dark: '#111827',
            light: '#ffffff'
          }
        });
      } else if (typeof window.QRCode === 'function') {
        canvas.style.display = 'none';

        const legacy = document.createElement('div');
        legacy.id = 'shareQrLegacy';
        wrap.insertBefore(legacy, logo || null);

        new window.QRCode(legacy, {
          text: url,
          width: 160,
          height: 160,
          colorDark: '#111827',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.H : undefined
        });
      } else {
        throw new Error('No compatible QR library detected on the page.');
      }

      if (logo) {
        logo.src = QR_LOGO_URL;
        logo.style.display = 'block';
      }

      if (urlText) {
        urlText.textContent = url;
      }
    } catch (error) {
      console.error('QR render error:', error);

      if (urlText) {
        urlText.textContent = url;
      }

      showToast('QR could not be generated. Link is still available to copy.', 'warning', 4500);
    }
  }
  async function loadImageForCanvas(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('No image source provided.'));
      return;
    }

    const img = new Image();

    // Important for cross-origin image use inside canvas
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

async function buildShareQrPngBlob() {
  const canvas = document.getElementById('shareQrCanvas');
  const logo = document.getElementById('shareQrLogo');

  if (!canvas) {
    throw new Error('QR canvas not found.');
  }

  // Ensure QR has been rendered first
  const srcCanvas = canvas;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = srcCanvas.width || 180;
  exportCanvas.height = srcCanvas.height || 180;

  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available.');
  }

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // Draw main QR canvas
  ctx.drawImage(srcCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

  // Draw centered logo if available and visible
  if (logo && logo.src && logo.style.display !== 'none') {
    try {
      const logoImg = await loadImageForCanvas(logo.src);

      const logoSize = Math.round(exportCanvas.width * 0.22);
      const x = Math.round((exportCanvas.width - logoSize) / 2);
      const y = Math.round((exportCanvas.height - logoSize) / 2);
      const radius = 12;

      // White rounded background behind logo
      ctx.save();
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x - 4, y - 4, logoSize + 8, logoSize + 8, radius);
      ctx.fill();
      ctx.restore();

      ctx.drawImage(logoImg, x, y, logoSize, logoSize);
    } catch (logoError) {
      console.warn('Logo could not be embedded in exported QR image:', logoError);
      // QR still shares fine even without logo
    }
  }

  const blob = await new Promise((resolve, reject) => {
    exportCanvas.toBlob(blobResult => {
      if (blobResult) resolve(blobResult);
      else reject(new Error('Failed to convert QR canvas to PNG blob.'));
    }, 'image/png');
  });

  return blob;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function shareQrImageFile({ title, text, url }) {
  try {
    const blob = await buildShareQrPngBlob();
    const file = new File([blob], 'gita-qr.png', { type: 'image/png' });

    const shareData = {
      title: title || 'Share QR',
      text: text || '',
      files: [file]
    };

    // Some browsers support files + text, some are stricter, so validate first
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share(shareData);
      showToast('QR image shared.', 'success');
      return true;
    }

    // Fallback: download the PNG if file sharing is unavailable
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gita-qr.png';
    document.body.appendChild(a);
    a.click();
    a.remove();

    showToast('QR image downloaded (file share not supported on this browser).', 'info', 5000);
    return false;
  } catch (error) {
    console.error('shareQrImageFile error:', error);
    showToast('Unable to share QR image.', 'error');
    return false;
  }
}

async function copyQrImageToClipboard() {
  try {
    const blob = await buildShareQrPngBlob();

    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      throw new Error('Clipboard image writing is not supported in this browser.');
    }

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob
      })
    ]);

    showToast('QR image copied to clipboard.', 'success');
  } catch (error) {
    console.error('copyQrImageToClipboard error:', error);
    showToast('Unable to copy QR image.', 'warning', 4500);
  }
}
  
  function openShareSheet({ title, text, url }) {
    currentSharePayload = { title, text, url };

    const preview = document.getElementById('sharePreview');
    const sheet = document.getElementById('shareSheet');
    if (!preview || !sheet) return;

    preview.textContent = text;
    sheet.classList.add('active');
    renderShareQr(url);

    document.getElementById('shareNativeBtn').onclick = async () => {
      if (!navigator.share) {
        showToast('Native share is not available on this device.', 'warning');
        return;
      }

      try {
        await navigator.share({ title, text, url });
        closeShareSheet();
      } catch (error) {
        console.warn('Native share canceled or failed:', error);
      }
    };

    document.getElementById('shareCopyBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Message copied.', 'success');
      } catch (error) {
        console.error('Copy message error:', error);
        showToast('Failed to copy message.', 'error');
      }
    };

    document.getElementById('shareCopyLinkBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied.', 'success');
      } catch (error) {
        console.error('Copy link error:', error);
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

    document.getElementById('shareQrImageBtn').onclick = async () => {
      await shareQrImageFile({ title, text, url });
    };
    
    document.getElementById('copyQrImageBtn').onclick = async () => {
      await copyQrImageToClipboard();
    };

  }

  function closeShareSheet() {
    document.getElementById('shareSheet')?.classList.remove('active');
    currentSharePayload = null;
  }

  // -------------------------------------------------------
  // Karaoke modal
  // -------------------------------------------------------
  function injectKaraokeModal() {
    const html = `
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

    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('kCloseBtn')?.addEventListener('click', closeKaraoke);

    document.getElementById('karaokeModal')?.addEventListener('click', e => {
      if (e.target.id === 'karaokeModal') closeKaraoke();
    });

    document.getElementById('kPrevBtn')?.addEventListener('click', () => traverseKaraoke(-1));
    document.getElementById('kNextBtn')?.addEventListener('click', () => traverseKaraoke(1));

    document.getElementById('kRewind')?.addEventListener('click', e => {
      const btn = e.currentTarget;
      btn.classList.add('clicked');
      setTimeout(() => btn.classList.remove('clicked'), 180);
      kState.audio.currentTime = Math.max(0, kState.audio.currentTime - 5);
      btn.blur();
    });

    document.getElementById('kForward')?.addEventListener('click', e => {
      const btn = e.currentTarget;
      btn.classList.add('clicked');
      setTimeout(() => btn.classList.remove('clicked'), 180);
      kState.audio.currentTime += 5;
      btn.blur();
    });

    document.getElementById('kPlayPause')?.addEventListener('click', () => {
      if (kState.audio.paused) {
        kState.audio.play().catch(error => {
          console.warn('Karaoke play blocked:', error);
          showToast('Tap play again if autoplay is blocked.', 'warning');
        });
      } else {
        kState.audio.pause();
      }
    });

    kState.audio.preload = 'metadata';
    kState.audio.addEventListener('error', () => safeAudioErrorToast(kState.audio.src));

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
    if (!playlistArr || !playlistArr.length) {
      showToast('No verses available for presentation.', 'warning');
      return;
    }

    if (currentChapterAudio) currentChapterAudio.pause();
    stopInlineMonitor();

    kState.playlist = playlistArr;
    kState.listIndex = startListIndex;
    kState.mode = mode;

    const modal = document.getElementById('karaokeModal');
    if (!modal) return;

    modal.classList.add('active');
    document.getElementById('kControls').style.display = mode === 'verse' ? 'none' : 'flex';

    playCurrentKaraoke();
  }

  function closeKaraoke() {
    document.getElementById('karaokeModal')?.classList.remove('active');
    kState.audio.pause();

    if (kState.animId) {
      cancelAnimationFrame(kState.animId);
      kState.animId = null;
    }
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
      const kTitle = document.getElementById('kTitle');
      const kLyrics = document.getElementById('kLyrics');
      const kEnglish = document.getElementById('kEnglish');

      if (!content || !manualControls || !kTitle || !kLyrics || !kEnglish) return;

      if (kState.animId) {
        cancelAnimationFrame(kState.animId);
        kState.animId = null;
      }

      content.classList.add('fade-out');

      setTimeout(() => {
        kTitle.textContent =
          `Chapter ${verse.Chapter}, Verse ${verse.VerseNum}${verse.Topic ? ' — ' + verse.Topic : ''}`;
        kLyrics.innerHTML = nl2br(verse.OriginalText || 'Text Unavailable');
        kEnglish.innerHTML = nl2br(verse.EnglishText || '');
        content.classList.remove('fade-out');

        requestAnimationFrame(() => {
          fitKaraokeTextToViewport(content, kLyrics, kEnglish);
        });

        const hasTimestamps =
          verse.AudioStart !== undefined && Number(verse.AudioEnd) > Number(verse.AudioStart);

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
            kState.audio.play().catch(error => {
              console.warn('Karaoke autoplay blocked:', error);
              showToast('Tap play if autoplay is blocked.', 'warning');
            });
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
            kState.audio.play().catch(error => {
              console.warn('Manual play blocked:', error);
            });
          } else {
            kState.audio.pause();
          }
        }
      }, 180);
    } catch (error) {
      console.error('Play current karaoke error:', error);
      showToast('Unable to open presentation mode.', 'error');
    }
  }
})();
