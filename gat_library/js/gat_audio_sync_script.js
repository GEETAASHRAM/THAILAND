// =========================================================
// GEETA AUDIO SYNC TOOL (WORKER-OPTIMIZED + TOAST + CLEAN PRESENTATION)
// =========================================================

window.enforceChunkBounds = function(audioElem, start, end) {
  if (end > 0 && audioElem.currentTime >= end) {
    audioElem.pause();
    audioElem.currentTime = start;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // -------------------------
  // Worker
  // -------------------------
  const jsonWorker = createJsonWorker();

  // -------------------------
  // Global state
  // -------------------------
  let startTime = null;
  let activeVerseIndex = 0;
  let isGeetaMode = false;
  let historyStack = [];
  let redoStack = [];
  let activeRowElem = null;
  let presentationIndex = 0;
  let presentationMonitor = null;
  let stringifyTimer = null;

  window.currentGeetaData = null;
  window.currentSystemFile = null;

  // -------------------------
  // Elements
  // -------------------------
  const audioPlayer = document.getElementById('audioPlayer');
  const tableBody = document.querySelector('#timestampsTable tbody');
  const jsonInput = document.getElementById('jsonDataInput');

  const prefixInput = document.getElementById('prefixInput');
  const suffixInput = document.getElementById('suffixInput');
  const fileUrlInput = document.getElementById('fileUrlInput');
  const fileInput = document.getElementById('fileInput');

  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const tableSearch = document.getElementById('tableSearch');

  const floatPlayBtn = document.getElementById('floatPlayBtn');
  const floatMarkBtn = document.getElementById('floatMarkBtn');
  const floatUndoBtn = document.getElementById('floatUndoBtn');
  const floatRedoBtn = document.getElementById('floatRedoBtn');
  const floatDeleteBtn = document.getElementById('floatDeleteBtn');

  let searchCountDisplay = null;
  if (tableSearch) {
    searchCountDisplay = document.createElement('div');
    searchCountDisplay.style.fontWeight = 'bold';
    searchCountDisplay.style.color = '#007BFF';
    searchCountDisplay.style.marginBottom = '10px';
    tableSearch.parentNode.insertBefore(searchCountDisplay, tableSearch.nextSibling);
  }

  initToast();
  injectPresentationModal();
  injectShareSheet();
  bindDropdownSearch();
  bindControls();
  bindAudioEvents();

  const sharedFile = new URLSearchParams(window.location.search).get('file');
  if (sharedFile) {
    const selectObj = document.getElementById('systemJsonSelect');
    if (selectObj) {
      [...selectObj.options].forEach((o, i) => {
        if (o.value === sharedFile) selectObj.selectedIndex = i;
      });
    }
    loadSystemJson(sharedFile);
  } else {
    loadAutoSave();
  }

  // -------------------------
  // Toast
  // -------------------------
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

    const cleanup = () => toast.remove();
    toast.querySelector('.app-toast__close')?.addEventListener('click', cleanup);
    setTimeout(cleanup, timeout);
  }

  // -------------------------
  // Worker helpers
  // -------------------------
  function createJsonWorker() {
    const workerCode = `
      self.onmessage = function(e) {
        const { id, type, payload } = e.data;
        try {
          if (type === 'parse') {
            const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
            self.postMessage({ id, ok: true, data: parsed });
          } else if (type === 'stringify') {
            const text = JSON.stringify(payload, null, 2);
            self.postMessage({ id, ok: true, data: text });
          }
        } catch (err) {
          self.postMessage({ id, ok: false, error: err.message || 'Worker error' });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  function workerRequest(type, payload) {
    return new Promise((resolve, reject) => {
      const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const listener = e => {
        if (e.data.id !== id) return;
        jsonWorker.removeEventListener('message', listener);
        if (e.data.ok) resolve(e.data.data);
        else reject(new Error(e.data.error || 'Worker failed'));
      };

      jsonWorker.addEventListener('message', listener);
      jsonWorker.postMessage({ id, type, payload });
    });
  }

  // -------------------------
  // Utilities
  // -------------------------
  function safeNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function nl2br(str = '') {
    return escapeHtml(str).replace(/\n/g, '<br>');
  }

  function generateName(i, v = null) {
    if (v) return `${v.Topic || 'Topic'}_C${v.Chapter}_V${v.VerseNum}`;
    return `${prefixInput?.value || ''}${i}${suffixInput?.value || ''}`;
  }

  function formatTime(s) {
    if (!Number.isFinite(s)) return '00:00';
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  function setLoading(flag, text = 'Loading large JSON... Please wait.') {
    const loadingInd = document.getElementById('loadingIndicator');
    if (!loadingInd) return;
    loadingInd.textContent = text;
    loadingInd.classList.toggle('hidden', !flag);
  }

  function clearToolState() {
    if (tableBody) tableBody.innerHTML = '';
    activeVerseIndex = 0;
    startTime = null;
    activeRowElem = null;
    window.currentGeetaData = null;
    isGeetaMode = false;
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.innerText = 'Progress: 0/0 (0%)';
  }

  // -------------------------
  // Presentation modal
  // -------------------------
  function injectPresentationModal() {
    const html = `
      <div id="karaokeModal" class="karaoke-modal">
        <button id="kCloseBtn" class="k-close-btn" aria-label="Close">×</button>
        <button id="kShareBtn" class="k-share-btn">🔗 Share</button>
        <div class="k-close-hint">Tap outside the text area to close</div>

        <div id="karaokeContent" class="karaoke-content">
          <div id="kTitle" class="karaoke-title">Chapter 1, Verse 1</div>
          <div id="kLyrics" class="karaoke-lyrics">Sanskrit Text</div>
          <div id="kEnglish" class="karaoke-english">English Translation</div>
        </div>

        <div class="karaoke-controls" id="kControls">
          <button id="kPrevBtn" class="k-btn">⏮️ Prev</button>
          <button id="kNextBtn" class="k-btn">Next ⏭️</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    const karaokeModal = document.getElementById('karaokeModal');

    document.getElementById('kCloseBtn')?.addEventListener('click', closePresentation);
    karaokeModal?.addEventListener('click', e => {
      if (e.target === karaokeModal) closePresentation();
    });

    document.getElementById('kPrevBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!window.currentGeetaData || presentationIndex <= 0) return;
      presentationIndex--;
      playPresentationVerse();
    });

    document.getElementById('kNextBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!window.currentGeetaData || presentationIndex >= window.currentGeetaData.length - 1) return;
      presentationIndex++;
      playPresentationVerse();
    });

    document.getElementById('kShareBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      const v = window.currentGeetaData?.[presentationIndex];
      if (!v) return;

      const shareUrl = `${window.location.origin}${window.location.pathname}${window.currentSystemFile ? `?file=${encodeURIComponent(window.currentSystemFile)}` : ''}`;
      const message =
        `🎧 Bhagavad Gita Sync Presentation\n\n` +
        `Chapter ${v.Chapter}, Verse ${v.VerseNum}\n\n` +
        `${v.OriginalText || ''}\n\n` +
        `${v.EnglishText || ''}\n\n` +
        `Open here:\n${shareUrl}`;

      openShareSheet({
        title: `Bhagavad Gita - Chapter ${v.Chapter}, Verse ${v.VerseNum}`,
        text: message,
        url: shareUrl
      });
    });
  }

  function openPresentation(startIndex) {
    if (!window.currentGeetaData || !window.currentGeetaData.length) return;
    presentationIndex = startIndex;
    document.getElementById('karaokeModal')?.classList.add('active');
    playPresentationVerse();
  }

  function closePresentation() {
    document.getElementById('karaokeModal')?.classList.remove('active');
    if (audioPlayer) audioPlayer.pause();
    cancelAnimationFrame(presentationMonitor);
  }

  function playPresentationVerse() {
    if (!window.currentGeetaData || !audioPlayer) return;
    const v = window.currentGeetaData[presentationIndex];
    if (!v) return;

    const karaokeContent = document.getElementById('karaokeContent');
    const kTitle = document.getElementById('kTitle');
    const kLyrics = document.getElementById('kLyrics');
    const kEnglish = document.getElementById('kEnglish');

    karaokeContent.classList.add('fade-out');
    cancelAnimationFrame(presentationMonitor);

    setTimeout(() => {
      kTitle.textContent = `${v.Topic || 'Geeta'} - Chapter ${v.Chapter}, Verse ${v.VerseNum}`;
      kLyrics.innerHTML = nl2br(v.OriginalText || 'No Text Available');
      kEnglish.innerHTML = nl2br(v.EnglishText || '');

      karaokeContent.classList.remove('fade-out');

      if (v.AudioStart !== undefined && Number(v.AudioEnd) > Number(v.AudioStart)) {
        if (v.AudioFileURL && (!audioPlayer.src || !audioPlayer.src.includes(v.AudioFileURL))) {
          audioPlayer.src = v.AudioFileURL;
        }

        audioPlayer.currentTime = Number(v.AudioStart) || 0;
        audioPlayer.play().catch(() => {
          showToast('Tap play if autoplay is blocked by your browser.', 'warning');
        });

        const end = Number(v.AudioEnd) || 0;

        const monitor = () => {
          if (audioPlayer.currentTime >= end) {
            if (presentationIndex < window.currentGeetaData.length - 1) {
              presentationIndex++;
              playPresentationVerse();
            } else {
              audioPlayer.pause();
            }
          } else if (!audioPlayer.paused) {
            presentationMonitor = requestAnimationFrame(monitor);
          }
        };

        presentationMonitor = requestAnimationFrame(monitor);
      }
    }, 180);
  }

  // -------------------------
  // Share sheet
  // -------------------------
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
        showToast('Native sharing is not available on this device.', 'warning');
      }
    };

    document.getElementById('shareCopyBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Message copied.', 'success');
        closeShareSheet();
      } catch {
        showToast('Copy failed.', 'error');
      }
    };

    document.getElementById('shareCopyLinkBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied.', 'success');
        closeShareSheet();
      } catch {
        showToast('Copy failed.', 'error');
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

  // -------------------------
  // Audio events
  // -------------------------
  function bindAudioEvents() {
    audioPlayer?.addEventListener('error', () => {
      const err = audioPlayer.error;
      let msg = 'Unknown audio error.';
      if (err) {
        switch (err.code) {
          case 1: msg = 'Playback aborted.'; break;
          case 2: msg = 'Network issue while loading audio.'; break;
          case 3: msg = 'Audio decoding failed.'; break;
          case 4: msg = 'Audio file not found or unreachable.'; break;
        }
      }
      showToast(`${msg}<div style="font-size:12px;opacity:.85;margin-top:4px;word-break:break-all;">${audioPlayer.src || ''}</div>`, 'error', 6000);
    });

    audioPlayer?.addEventListener('timeupdate', () => {
      const timer = document.getElementById('floatTimer');
      if (timer) timer.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration || 0)}`;
      syncActiveRowToAudio();
    });
  }

  function syncActiveRowToAudio() {
    try {
      const t = audioPlayer.currentTime;
      let foundIndex = -1;

      if (isGeetaMode && window.currentGeetaData) {
        const current = window.currentGeetaData[activeVerseIndex];
        const activeChapter = current ? current.Chapter : window.currentGeetaData[0]?.Chapter;

        if (current && Number(current.AudioEnd) > 0 && t >= Number(current.AudioStart) && t <= Number(current.AudioEnd)) {
          foundIndex = activeVerseIndex;
        } else {
          for (let i = 0; i < window.currentGeetaData.length; i++) {
            const v = window.currentGeetaData[i];
            if (
              v.Chapter === activeChapter &&
              Number(v.AudioEnd) > Number(v.AudioStart) &&
              t >= Number(v.AudioStart) &&
              t <= Number(v.AudioEnd)
            ) {
              foundIndex = i;
              break;
            }
          }
        }
      } else if (tableBody) {
        const rows = tableBody.rows;
        for (let i = 0; i < rows.length; i++) {
          const s = safeNum(rows[i].dataset.start);
          const e = safeNum(rows[i].dataset.end);
          if (t >= s && t <= e) {
            foundIndex = i;
            break;
          }
        }
      }

      if (foundIndex !== -1 && tableBody) {
        const row = tableBody.rows[foundIndex];
        if (activeRowElem !== row) {
          if (activeRowElem) activeRowElem.classList.remove('active-row');
          row.classList.add('active-row');
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          activeRowElem = row;
        }
      } else if (activeRowElem) {
        activeRowElem.classList.remove('active-row');
        activeRowElem = null;
      }
    } catch {}
  }

  // -------------------------
  // Controls
  // -------------------------
  function bindControls() {
    document.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }
      if (e.key === ']' || e.key === '}') {
        e.preventDefault();
        isGeetaMode ? markGeetaEnd() : markNormalMode();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    });

    floatPlayBtn?.addEventListener('click', togglePlayPause);
    floatMarkBtn?.addEventListener('click', () => isGeetaMode ? markGeetaEnd() : markNormalMode());
    floatUndoBtn?.addEventListener('click', undo);
    floatRedoBtn?.addEventListener('click', redo);
    floatDeleteBtn?.addEventListener('click', deleteLastRow);

    tableBody?.addEventListener('click', e => {
      const presBtn = e.target.closest('.pres-play-btn');
      if (presBtn) {
        const index = Number(presBtn.dataset.index);
        openPresentation(index);
        return;
      }

      const row = e.target.closest('tr');
      if (row && !e.target.classList.contains('chunk-player')) {
        setFocusRow(row.rowIndex - 1);
      }
    });

    tableBody?.addEventListener('blur', handleManualCellEdit, true);

    let searchDebounce;
    tableSearch?.addEventListener('input', function() {
      clearTimeout(searchDebounce);
      const term = this.value.toLowerCase().trim();
      if (searchCountDisplay) searchCountDisplay.innerText = 'Searching...';

      searchDebounce = setTimeout(() => {
        const rows = Array.from(tableBody?.rows || []);
        let idx = 0;
        let count = 0;

        const batch = () => {
          const limit = Math.min(idx + 80, rows.length);
          for (; idx < limit; idx++) {
            const row = rows[idx];
            const searchStr = row.dataset.searchStr || '';

            if (!term || searchStr.includes(term)) {
              row.style.display = '';
              count++;
            } else {
              row.style.display = 'none';
            }
          }

          if (idx < rows.length) requestAnimationFrame(batch);
          else if (searchCountDisplay) searchCountDisplay.innerText = term ? `Found ${count} results for "${term}"` : '';
        };

        batch();
      }, 180);
    });
  }

  function bindDropdownSearch() {
    const searchSelectObj = document.getElementById('searchSelect');
    const optionsContainer = document.getElementById('optionsContainer');
    if (!searchSelectObj || !optionsContainer) return;

    const options = optionsContainer.getElementsByTagName('div');

    searchSelectObj.addEventListener('focus', () => {
      optionsContainer.classList.remove('hidden');
      [...options].forEach(o => (o.style.display = ''));
    });

    searchSelectObj.addEventListener('input', () => {
      const filter = searchSelectObj.value.toLowerCase();
      let visible = false;
      [...options].forEach(o => {
        if (o.textContent.toLowerCase().includes(filter)) {
          o.style.display = '';
          visible = true;
        } else {
          o.style.display = 'none';
        }
      });
      optionsContainer.classList.toggle('hidden', !visible);
    });

    optionsContainer.addEventListener('click', e => {
      const value = e.target.getAttribute('data-value');
      if (!value) return;
      fileUrlInput.value = value;
      searchSelectObj.value = e.target.textContent;
      optionsContainer.classList.add('hidden');
      window.loadAudio();
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.select-container')) optionsContainer.classList.add('hidden');
    });
  }

  function togglePlayPause() {
    if (!audioPlayer) return;
    if (audioPlayer.paused) audioPlayer.play().catch(() => showToast('Tap again if playback is blocked.', 'warning'));
    else audioPlayer.pause();
  }

  function setFocusRow(index) {
    if (!tableBody || index < 0 || index >= tableBody.rows.length) return;
    activeVerseIndex = index;

    const old = tableBody.querySelector('.focused-verse');
    if (old) old.classList.remove('focused-verse');

    const row = tableBody.rows[index];
    row.classList.add('focused-verse');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // -------------------------
  // JSON load
  // -------------------------
  window.loadSystemJson = async function(filePath) {
    if (!filePath) return;
    try {
      setLoading(true, 'Loading system JSON...');
      const response = await fetch(filePath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      window.currentSystemFile = filePath;
      if (jsonInput) jsonInput.value = text;

      const parsed = await workerRequest('parse', text);
      await loadJsonData(parsed);
      showToast('System JSON loaded.', 'success');
    } catch (err) {
      console.error(err);
      showToast(`Failed to load ${filePath}.`, 'error', 5000);
      const sysSelect = document.getElementById('systemJsonSelect');
      if (sysSelect) sysSelect.selectedIndex = 0;
    } finally {
      setLoading(false);
    }
  };

  window.loadJsonFile = function(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        setLoading(true, 'Parsing local JSON...');
        const text = ev.target.result;
        if (jsonInput) jsonInput.value = text;
        const parsed = await workerRequest('parse', text);
        await loadJsonData(parsed);
        showToast('Local JSON loaded.', 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to parse local JSON.', 'error');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  window.loadJsonData = async function(data) {
    try {
      setLoading(true, 'Rendering JSON...');
      clearToolState();

      if (typeof data === 'string') {
        data = await workerRequest('parse', data);
      }

      if (Array.isArray(data)) {
        isGeetaMode = true;
        window.currentGeetaData = data;
        await renderGeetaRowsBatched(data);
        scheduleJsonSync();
        focusFirstIncompleteVerse(data);
      } else {
        isGeetaMode = false;
        renderNormalJson(data);
        scheduleJsonSync();
      }

      updateProgress();
    } catch (err) {
      console.error('Load JSON Error', err);
      showToast('Failed to load JSON data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  async function renderGeetaRowsBatched(data) {
    let idx = 0;

    return new Promise(resolve => {
      const batch = () => {
        const frag = document.createDocumentFragment();

        for (let i = 0; i < 120 && idx < data.length; i++, idx++) {
          const v = data[idx];
          const lTxt = `${nl2br(v.OriginalText || '')}${v.EnglishText ? '<br><br>' + nl2br(v.EnglishText) : ''}`;
          const isDone = Number(v.AudioEnd) > Number(v.AudioStart);
          let baseUrl = (v.AudioFileURL || '').split('#')[0];
          const chunkSrc = isDone ? `${baseUrl}#t=${Number(v.AudioStart) || 0},${Number(v.AudioEnd) || 0}` : baseUrl;

          const row = document.createElement('tr');
          row.dataset.searchStr = `${v.VerseNum} ${v.Topic || ''} C${v.Chapter} V${v.VerseNum} ${v.OriginalText || ''} ${v.EnglishText || ''}`.toLowerCase();
          row.dataset.start = Number(v.AudioStart) || 0;
          row.dataset.end = Number(v.AudioEnd) || 0;

          row.innerHTML = `
            <td>${v.VerseNum}</td>
            <td contenteditable class="startTime">${Number(v.AudioStart) || 0}</td>
            <td contenteditable class="endTime">${Number(v.AudioEnd) || 0}</td>
            <td>${Number(v.ReadTimeInSeconds) || 0}</td>
            <td class="name-cell">${escapeHtml(generateName(v.VerseNum, v))}</td>
            <td>
              <div class="lyrics-text" style="max-height:100px; overflow-y:auto; background:#f9f9f9; padding:10px; border:1px solid #ccc; border-radius:8px;">
                ${lTxt}
              </div>
            </td>
            <td>
              <button class="pres-play-btn" data-index="${idx}" style="display:${isDone ? 'inline-flex' : 'none'};">🎤 Play Presentation</button>
              <audio class="chunk-player" controls style="height:35px; width:100%; display:${isDone ? 'block' : 'none'};" ontimeupdate="enforceChunkBounds(this, ${Number(v.AudioStart) || 0}, ${Number(v.AudioEnd) || 0})">
                <source src="${chunkSrc}">
              </audio>
            </td>
          `;
          frag.appendChild(row);
        }

        tableBody.appendChild(frag);

        if (idx < data.length) {
          requestAnimationFrame(batch);
        } else {
          resolve();
        }
      };

      batch();
    });
  }

  function renderNormalJson(data) {
    let maxEndSaved = 0;
    if (data.audioUrl && audioPlayer) {
      audioPlayer.src = data.audioUrl;
      audioPlayer.load();
    }

    const frag = document.createDocumentFragment();

    (data.timestamps || []).forEach((t, i) => {
      maxEndSaved = Math.max(maxEndSaved, safeNum(t.end));

      const row = document.createElement('tr');
      row.dataset.searchStr = `${t.name || generateName(i + 1)} ${t.lyrics || ''}`.toLowerCase();
      row.dataset.start = safeNum(t.start);
      row.dataset.end = safeNum(t.end);

      row.innerHTML = `
        <td>${i + 1}</td>
        <td contenteditable class="startTime">${safeNum(t.start)}</td>
        <td contenteditable class="endTime">${safeNum(t.end)}</td>
        <td>${(safeNum(t.end) - safeNum(t.start)).toFixed(2)}</td>
        <td class="name-cell">${escapeHtml(t.name || generateName(i + 1))}</td>
        <td><textarea class="lyricsInput">${t.lyrics || ''}</textarea></td>
        <td>
          <audio controls class="chunk-player" style="height:35px; width:100%; display:block;" ontimeupdate="enforceChunkBounds(this, ${safeNum(t.start)}, ${safeNum(t.end)})">
            <source src="${data.audioUrl}#t=${safeNum(t.start)},${safeNum(t.end)}">
          </audio>
        </td>
      `;
      frag.appendChild(row);
    });

    tableBody.appendChild(frag);
    startTime = maxEndSaved;
    activeVerseIndex = (data.timestamps || []).length;

    const performSeek = () => {
      if (audioPlayer) audioPlayer.currentTime = maxEndSaved;
      updateProgress();
    };

    if (audioPlayer && audioPlayer.readyState >= 1) performSeek();
    else audioPlayer?.addEventListener('loadedmetadata', function seek() {
      performSeek();
      audioPlayer.removeEventListener('loadedmetadata', seek);
    });
  }

  function focusFirstIncompleteVerse(data) {
    const firstUnfinished = data.findIndex(v => !v.AudioEnd || Number(v.AudioEnd) === 0);
    if (firstUnfinished !== -1) {
      setFocusRow(firstUnfinished);
      const current = data[firstUnfinished];

      if (current.AudioFileURL && audioPlayer) {
        fileUrlInput.value = current.AudioFileURL;
        audioPlayer.src = current.AudioFileURL;
        audioPlayer.addEventListener('loadedmetadata', function seekOnce() {
          audioPlayer.currentTime = Number(current.AudioStart) || 0;
          audioPlayer.removeEventListener('loadedmetadata', seekOnce);
        });
        audioPlayer.load();
      }

      if (firstUnfinished > 0 && data[firstUnfinished].Chapter === data[firstUnfinished - 1].Chapter) {
        const prevEnd = Number(data[firstUnfinished - 1].AudioEnd) || 0;
        data[firstUnfinished].AudioStart = prevEnd;
        const row = tableBody.rows[firstUnfinished];
        row.querySelector('.startTime').textContent = prevEnd.toFixed(2);
        row.dataset.start = prevEnd;
      } else {
        data[firstUnfinished].AudioStart = 0;
        const row = tableBody.rows[firstUnfinished];
        row.querySelector('.startTime').textContent = '0.00';
        row.dataset.start = 0;
      }
    } else {
      setFocusRow(0);
    }
  }

  // -------------------------
  // Audio loading
  // -------------------------
  window.loadAudio = function() {
    try {
      if (!fileUrlInput.value && !fileInput.files.length) {
        showToast('Please provide an audio source first.', 'warning');
        return;
      }

      clearToolState();
      historyStack = [];
      redoStack = [];

      if (jsonInput) jsonInput.value = '';
      if (searchCountDisplay) searchCountDisplay.innerText = '';

      audioPlayer.onloadedmetadata = () => updateProgress();

      if (fileUrlInput.value) {
        audioPlayer.src = fileUrlInput.value;
        audioPlayer.load();
      } else if (fileInput.files.length) {
        const reader = new FileReader();
        reader.onload = e => {
          audioPlayer.src = e.target.result;
          audioPlayer.load();
        };
        reader.readAsDataURL(fileInput.files[0]);
      }

      showToast('Audio source loaded.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to load audio source.', 'error');
    }
  };

  // -------------------------
  // Marking engine
  // -------------------------
  function markGeetaEnd() {
    if (!isGeetaMode || !window.currentGeetaData || !audioPlayer) return;

    const row = tableBody.rows[activeVerseIndex];
    if (!row) return;

    const currentTime = Number(audioPlayer.currentTime.toFixed(2));
    if (currentTime === 0 && audioPlayer.paused) {
      showToast('Please play the main audio first.', 'warning');
      return;
    }

    const startCell = row.querySelector('.startTime');
    const endCell = row.querySelector('.endTime');
    const durationCell = row.cells[3];

    const start = safeNum(startCell.textContent);
    const end = currentTime;

    if (end <= start) {
      showToast(`End time (${end}s) must be greater than start time (${start}s).`, 'warning');
      return;
    }

    const duration = Number((end - start).toFixed(2));

    startCell.textContent = start.toFixed(2);
    endCell.textContent = end.toFixed(2);
    durationCell.textContent = duration.toFixed(2);

    row.dataset.start = start;
    row.dataset.end = end;

    const v = window.currentGeetaData[activeVerseIndex];
    v.AudioStart = start;
    v.AudioEnd = end;
    v.ReadTimeInSeconds = duration;

    const audioRowPlayer = row.querySelector('.chunk-player');
    const source = row.querySelector('source');
    const baseUrl = (v.AudioFileURL || audioPlayer.src).split('#')[0];

    if (source) source.src = `${baseUrl}#t=${start},${end}`;
    if (audioRowPlayer) {
      audioRowPlayer.setAttribute('ontimeupdate', `enforceChunkBounds(this, ${start}, ${end})`);
      audioRowPlayer.style.display = 'block';
      audioRowPlayer.load();
    }

    const presBtn = row.querySelector('.pres-play-btn');
    if (presBtn) presBtn.style.display = 'inline-flex';

    flashRow(row);
    updateProgress();
    saveHistory();
    scheduleJsonSync();
    advanceToNextGeetaVerse(end);
  }

  function advanceToNextGeetaVerse(previousEndTime) {
    const nextIndex = activeVerseIndex + 1;
    if (nextIndex >= window.currentGeetaData.length) {
      fireConfetti();
      return;
    }

    const current = window.currentGeetaData[activeVerseIndex];
    const next = window.currentGeetaData[nextIndex];
    const nextRow = tableBody.rows[nextIndex];

    setFocusRow(nextIndex);

    if (current.Chapter === next.Chapter) {
      next.AudioStart = previousEndTime;
      if (nextRow) {
        nextRow.querySelector('.startTime').textContent = previousEndTime.toFixed(2);
        nextRow.dataset.start = previousEndTime;
      }
    } else {
      fireConfetti();
      next.AudioStart = 0;
      if (nextRow) {
        nextRow.querySelector('.startTime').textContent = '0.00';
        nextRow.dataset.start = 0;
      }

      if (next.AudioFileURL && current.AudioFileURL !== next.AudioFileURL) {
        fileUrlInput.value = next.AudioFileURL;
        audioPlayer.src = next.AudioFileURL;
        audioPlayer.load();
      }
    }

    scheduleJsonSync();
  }

  function markNormalMode() {
    if (!audioPlayer) return;

    const t = audioPlayer.currentTime;
    if (startTime === null) startTime = 0;
    const end = t;

    const row = document.createElement('tr');
    row.dataset.start = startTime;
    row.dataset.end = end;
    row.dataset.searchStr = generateName(activeVerseIndex + 1).toLowerCase();

    row.innerHTML = `
      <td>${activeVerseIndex + 1}</td>
      <td contenteditable class="startTime">${startTime.toFixed(2)}</td>
      <td contenteditable class="endTime">${end.toFixed(2)}</td>
      <td>${(end - startTime).toFixed(2)}</td>
      <td class="name-cell">${escapeHtml(generateName(activeVerseIndex + 1))}</td>
      <td><textarea class="lyricsInput"></textarea></td>
      <td>
        <audio controls class="chunk-player" style="height:35px; width:100%; display:block;" ontimeupdate="enforceChunkBounds(this, ${startTime}, ${end})">
          <source src="${audioPlayer.src}#t=${startTime},${end}">
        </audio>
      </td>
    `;

    tableBody.appendChild(row);

    startTime = end;
    activeVerseIndex++;

    updateProgress();
    saveHistory();
    scheduleJsonSync();
  }

  function handleManualCellEdit(e) {
    const cell = e.target;
    if (!cell.classList.contains('startTime') && !cell.classList.contains('endTime')) return;

    try {
      const row = cell.closest('tr');
      const start = safeNum(row.cells[1].textContent);
      const end = safeNum(row.cells[2].textContent);

      if (end < start && end !== 0) {
        showToast('Invalid time configuration. End must be greater than start.', 'warning');
        row.cells[2].textContent = row.dataset.end || '0.00';
        return;
      }

      const duration = Number((end - start).toFixed(2));
      if (end > 0) row.cells[3].textContent = duration;

      row.dataset.start = start;
      row.dataset.end = end;

      const audioEl = row.querySelector('.chunk-player');
      const sourceEl = row.querySelector('source');

      if (audioEl && sourceEl && end > 0) {
        const baseUrl = isGeetaMode
          ? (window.currentGeetaData[row.rowIndex - 1]?.AudioFileURL || audioPlayer.src).split('#')[0]
          : audioPlayer.src.split('#')[0];

        sourceEl.src = `${baseUrl}#t=${start},${end}`;
        audioEl.setAttribute('ontimeupdate', `enforceChunkBounds(this, ${start}, ${end})`);
        audioEl.style.display = 'block';
        audioEl.load();

        const presBtn = row.querySelector('.pres-play-btn');
        if (presBtn) presBtn.style.display = 'inline-flex';
      }

      if (isGeetaMode) {
        const idx = row.rowIndex - 1;
        const v = window.currentGeetaData[idx];
        if (v) {
          v.AudioStart = start;
          v.AudioEnd = end;
          v.ReadTimeInSeconds = duration > 0 ? duration : 0;
        }
      }

      updateProgress();
      saveHistory();
      scheduleJsonSync();
    } catch {}
  }

  // -------------------------
  // Save / copy / share
  // -------------------------
  function scheduleJsonSync() {
    clearTimeout(stringifyTimer);
    stringifyTimer = setTimeout(async () => {
      try {
        const payload = isGeetaMode ? window.currentGeetaData : buildNormalJsonObject();
        const text = await workerRequest('stringify', payload);
        if (jsonInput) jsonInput.value = text;
      } catch (err) {
        console.error(err);
      }
    }, 250);
  }

  function buildNormalJsonObject() {
    const data = {
      audioUrl: audioPlayer ? audioPlayer.src : '',
      timestamps: []
    };

    [...(tableBody?.rows || [])].forEach((r, i) => {
      const s = safeNum(r.cells[1].textContent);
      const e = safeNum(r.cells[2].textContent);

      data.timestamps.push({
        verse: i + 1,
        name: r.cells[4].textContent,
        start: s,
        end: e,
        duration: Number((e - s).toFixed(2)),
        lyrics: r.cells[5].querySelector('textarea')?.value || ''
      });
    });

    return data;
  }

  window.saveData = async function() {
    try {
      const payload = isGeetaMode ? window.currentGeetaData : buildNormalJsonObject();
      const text = await workerRequest('stringify', payload);

      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = isGeetaMode ? 'geeta_sync.json' : 'audio_sync.json';
      a.click();

      showToast('JSON saved.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to save JSON.', 'error');
    }
  };

  window.copyJsonData = async function() {
    try {
      const payload = isGeetaMode ? window.currentGeetaData : buildNormalJsonObject();
      const text = await workerRequest('stringify', payload);
      await navigator.clipboard.writeText(text);
      showToast('JSON copied to clipboard.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Clipboard copy failed.', 'error');
    }
  };

  window.copyShareLink = async function() {
    if (!window.currentSystemFile) {
      showToast('Please load a system JSON first.', 'warning');
      return;
    }

    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${baseUrl}?file=${encodeURIComponent(window.currentSystemFile)}`;
    const message =
      `🎧 Bhagavad Gita Audio Sync Tool\n\nOpen this JSON directly here:\n${shareUrl}\n\nShared from Geeta App`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Bhagavad Gita Audio Sync Tool',
          text: message,
          url: shareUrl
        });
      } else {
        await navigator.clipboard.writeText(message);
        showToast('Share message copied.', 'success');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(message);
        showToast('Share message copied.', 'success');
      } catch {
        showToast('Failed to create share message.', 'error');
      }
    }
  };

  // -------------------------
  // Delete / history / autosave
  // -------------------------
  function saveHistory() {
    const current = jsonInput?.value || '';
    historyStack.push(current);
    if (historyStack.length > 100) historyStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!historyStack.length || !jsonInput) return;
    redoStack.push(jsonInput.value);
    const snapshot = historyStack.pop();
    jsonInput.value = snapshot;
    window.loadJsonData(snapshot);
  }

  function redo() {
    if (!redoStack.length || !jsonInput) return;
    historyStack.push(jsonInput.value);
    const snapshot = redoStack.pop();
    jsonInput.value = snapshot;
    window.loadJsonData(snapshot);
  }

  function deleteLastRow() {
    try {
      if (!tableBody || !tableBody.rows.length) return;

      tableBody.deleteRow(-1);
      activeVerseIndex = Math.max(0, activeVerseIndex - 1);
      startTime = tableBody.rows.length
        ? safeNum(tableBody.rows[tableBody.rows.length - 1].cells[2].textContent)
        : null;

      if (isGeetaMode && window.currentGeetaData[activeVerseIndex]) {
        window.currentGeetaData[activeVerseIndex].AudioStart = 0;
        window.currentGeetaData[activeVerseIndex].AudioEnd = 0;
        window.currentGeetaData[activeVerseIndex].ReadTimeInSeconds = 0;
      }

      updateProgress();
      saveHistory();
      scheduleJsonSync();
    } catch {}
  }

  function autoSave() {
    if (jsonInput?.value) localStorage.setItem('geeta_progress', jsonInput.value);
  }

  function loadAutoSave() {
    const saved = localStorage.getItem('geeta_progress');
    if (saved) {
      window.loadJsonData(saved);
    }
  }

  setInterval(autoSave, 5000);

  // -------------------------
  // Progress
  // -------------------------
  function updateProgress() {
    try {
      if (isGeetaMode && window.currentGeetaData) {
        const total = window.currentGeetaData.length;
        const done = window.currentGeetaData.filter(v => Number(v.AudioEnd) > Number(v.AudioStart)).length;
        const p = Math.round((done / total) * 100) || 0;
        progressBar.style.width = `${p}%`;
        progressText.innerText = `Progress: ${done}/${total} Verses (${p}%)`;
      } else {
        if (!audioPlayer || !audioPlayer.duration || !tableBody) return;
        let tm = 0;
        [...tableBody.rows].forEach(row => {
          tm += safeNum(row.cells[3].textContent);
        });

        const p = Math.min(100, Math.round((tm / audioPlayer.duration) * 100) || 0);
        progressBar.style.width = `${p}%`;
        progressText.innerText = `Progress: ${formatTime(tm)} / ${formatTime(audioPlayer.duration)} (${p}%)`;
      }
    } catch {}
  }

  // -------------------------
  // UX helpers
  // -------------------------
  function flashRow(row) {
    const original = row.style.background;
    row.style.background = '#d4edda';
    setTimeout(() => {
      row.style.background = original;
    }, 350);
  }

  function fireConfetti() {
    try {
      const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
      for (let i = 0; i < 50; i++) {
        const conf = document.createElement('div');
        conf.style.position = 'fixed';
        conf.style.width = '10px';
        conf.style.height = '10px';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        conf.style.left = Math.random() * 100 + 'vw';
        conf.style.top = '-10px';
        conf.style.zIndex = '9999';
        conf.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        document.body.appendChild(conf);

        const duration = Math.random() * 1.4 + 0.8;
        conf.animate(
          [
            { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
            { transform: `translate3d(${Math.random() * 220 - 110}px, 100vh, 0) rotate(${Math.random() * 540}deg)`, opacity: 0 }
          ],
          { duration: duration * 1000, easing: 'cubic-bezier(.37,0,.63,1)' }
        );

        setTimeout(() => conf.remove(), duration * 1000);
      }
    } catch {}
  }

  // -------------------------
  // Optional textarea blur parse
  // -------------------------
  jsonInput?.addEventListener('blur', async () => {
    if (!jsonInput.value.trim()) return;
    try {
      setLoading(true, 'Parsing JSON from editor...');
      const parsed = await workerRequest('parse', jsonInput.value);
      await window.loadJsonData(parsed);
    } catch (err) {
      console.error(err);
      showToast('Invalid JSON in editor.', 'error');
    } finally {
      setLoading(false);
    }
  });
});
