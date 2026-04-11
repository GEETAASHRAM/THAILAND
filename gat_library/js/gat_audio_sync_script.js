// =========================================================
// 🚀 FINAL AUDIO SYNC SCRIPT (BULLETPROOF + KARAOKE MODAL)
// =========================================================

// Global function to enforce strict start/stop bounds on chunk audio players
window.enforceChunkBounds = function(audioElem, start, end) {
    if (end > 0 && audioElem.currentTime >= end) {
        audioElem.pause();
        audioElem.currentTime = start;
    }
};

document.addEventListener('DOMContentLoaded', () => {

    console.log("🚀 App Initialized - High Performance Engine + Presentation Mode");

    // =========================
    // 🧠 GLOBAL STATE
    // =========================
    let startTime = null;
    let activeVerseIndex = 0; 
    let isGeetaMode = false;
    let historyStack = [];
    let redoStack = [];
    window.currentGeetaData = null;
    let activeRowElem = null; 

    // =========================
    // 📌 ELEMENTS (With Null Safety)
    // =========================
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

    // =========================
    // 🎤 PRESENTATION (KARAOKE) MODAL UI INJECTION
    // =========================
    const modalHtml = `
        <div id="karaokeModal" class="karaoke-modal">
            <div class="k-close-hint">Click anywhere outside text to close</div>
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
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const karaokeModal = document.getElementById('karaokeModal');
    const karaokeContent = document.getElementById('karaokeContent');
    const kTitle = document.getElementById('kTitle');
    const kLyrics = document.getElementById('kLyrics');
    const kEnglish = document.getElementById('kEnglish');
    let presentationIndex = 0;
    let presentationInterval = null;

    function openPresentation(startIndex) {
        if (!window.currentGeetaData || window.currentGeetaData.length === 0) return;
        presentationIndex = startIndex;
        karaokeModal.classList.add('active');
        playPresentationVerse();
    }

    function closePresentation() {
        karaokeModal.classList.remove('active');
        if (audioPlayer) audioPlayer.pause();
        clearInterval(presentationInterval);
    }

    // Close if clicked outside content
    karaokeModal.addEventListener('click', (e) => {
        if (e.target === karaokeModal) closePresentation();
    });

    document.getElementById('kPrevBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (presentationIndex > 0) {
            presentationIndex--;
            playPresentationVerse();
        }
    });

    document.getElementById('kNextBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (presentationIndex < window.currentGeetaData.length - 1) {
            presentationIndex++;
            playPresentationVerse();
        }
    });

    function playPresentationVerse() {
        if (!window.currentGeetaData) return;
        const v = window.currentGeetaData[presentationIndex];
        
        // Fade Out Old Content
        karaokeContent.classList.add('fade-out');
        clearInterval(presentationInterval);

        setTimeout(() => {
            // Update Content
            kTitle.textContent = `${v.Topic || 'Geeta'} - Chapter ${v.Chapter}, Verse ${v.VerseNum}`;
            kLyrics.innerHTML = v.OriginalText ? v.OriginalText.replace(/\n/g, '<br>') : 'No Text Available';
            kEnglish.innerHTML = v.EnglishText ? v.EnglishText.replace(/\n/g, '<br>') : '';
            
            // Fade In New Content
            karaokeContent.classList.remove('fade-out');

            // Handle Audio Playback
            if (audioPlayer && v.AudioStart !== undefined && v.AudioEnd > v.AudioStart) {
                
                // Switch audio source if chapter changed
                if (v.AudioFileURL && (!audioPlayer.src || audioPlayer.src.indexOf(v.AudioFileURL) === -1)) {
                    audioPlayer.src = v.AudioFileURL;
                }

                audioPlayer.currentTime = v.AudioStart;
                audioPlayer.play().catch(err => console.warn("Autoplay blocked in presentation mode."));

                // Monitor time to auto-advance
                presentationInterval = setInterval(() => {
                    if (audioPlayer.currentTime >= v.AudioEnd) {
                        clearInterval(presentationInterval);
                        if (presentationIndex < window.currentGeetaData.length - 1) {
                            presentationIndex++;
                            playPresentationVerse(); // Auto trigger next verse
                        } else {
                            audioPlayer.pause(); 
                        }
                    }
                }, 100);
            }
        }, 400); // Wait for CSS fade out
    }


    // =========================
    // 🌐 LOAD SYSTEM PRE-DEFINED JSON
    // =========================
    window.currentSystemFile = null;

    window.loadSystemJson = async function(filePath) {
        if (!filePath) return;
        try {
            const loadingInd = document.getElementById('loadingIndicator');
            if (loadingInd) loadingInd.classList.remove('hidden');
            
            console.log(`Fetching ${filePath}...`);
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            
            const data = await response.json();
            window.currentSystemFile = filePath; 
            window.loadJsonData(data);

        } catch (err) {
            console.error(`Failed to load ${filePath}:`, err);
            alert(`⚠️ Failed to load ${filePath}.\n\nPlease ensure the file exists and your network is active.`);
            const loadingInd = document.getElementById('loadingIndicator');
            if (loadingInd) loadingInd.classList.add('hidden');
            const sysSelect = document.getElementById('systemJsonSelect');
            if(sysSelect) sysSelect.selectedIndex = 0;
        }
    };

    // =========================
    // 🔗 GENERATE SHARE URL
    // =========================
    window.copyShareLink = function() {
        if (!window.currentSystemFile) {
            alert("⚠️ Please load a System JSON from the dropdown first before generating a share link.");
            return;
        }
        const baseUrl = window.location.origin + window.location.pathname;
        const shareUrl = `${baseUrl}?file=${encodeURIComponent(window.currentSystemFile)}`;

        navigator.clipboard.writeText(shareUrl)
            .then(() => alert(`✅ Share Link Copied to Clipboard!\n\n${shareUrl}`))
            .catch(e => {
                console.error("Clipboard copy failed:", e);
                alert("Failed to copy. Here is your link:\n\n" + shareUrl);
            });
    };
    
    // =========================
    // 🚨 AUDIO ERROR HANDLING
    // =========================
    if (audioPlayer) {
        audioPlayer.addEventListener('error', (e) => {
            const err = audioPlayer.error;
            let msg = "Unknown error occurred while loading audio.";
            if (err) {
                switch (err.code) {
                    case 1: msg = "Playback aborted by user."; break;
                    case 2: msg = "Network issue. Please check your connection."; break;
                    case 3: msg = "Audio decoding failed. File might be corrupted."; break;
                    case 4: msg = "Audio file not found or not reachable."; break;
                }
            }
            if (audioPlayer.src && audioPlayer.src !== window.location.href) {
                alert(`⚠️ Audio Error: ${msg}\n\nFailed URL: ${audioPlayer.src}`);
            }
        });
    }

    // =========================
    // 🧩 UTIL & HIGHLIGHTING
    // =========================
    function safeNum(v) { return isNaN(parseFloat(v)) ? 0 : parseFloat(v); }

    function generateName(i, v = null) {
        if (v) return `${v.Topic || "Topic"}_C${v.Chapter}_V${v.VerseNum}`;
        return `${prefixInput?.value || ""}${i}${suffixInput?.value || ""}`;
    }

    function highlightHTML(element, term) {
        try {
            const text = element.textContent;
            if (!term) { element.innerHTML = text; return; }
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedTerm})`, 'gi');
            element.innerHTML = text.replace(regex, `<mark style="background-color: yellow; color: black; border-radius: 2px;">$1</mark>`);
        } catch (e) {}
    }

    function flashRow(row) {
        const originalBg = row.style.background;
        row.style.background = "#d4edda"; 
        setTimeout(() => row.style.background = originalBg, 400);
    }

    function fireConfetti() {
        try {
            const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
            for (let i = 0; i < 100; i++) {
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

                const duration = Math.random() * 2 + 1;
                conf.animate([
                    { transform: `translate3d(0,0,0) rotate(0deg)`, opacity: 1 },
                    { transform: `translate3d(${Math.random()*300 - 150}px, 100vh, 0) rotate(${Math.random()*720}deg)`, opacity: 0 }
                ], { duration: duration * 1000, easing: 'cubic-bezier(.37,0,.63,1)' });
                setTimeout(() => conf.remove(), duration * 1000);
            }
        } catch (e) {}
    }

    // =========================
    // 🎯 FAST SMART FOCUS
    // =========================
    function setFocusRow(index) {
        try {
            if (!tableBody || index < 0 || index >= tableBody.rows.length) return;
            activeVerseIndex = index;
            
            const previousFocused = tableBody.querySelector('.focused-verse');
            if (previousFocused) previousFocused.classList.remove('focused-verse');

            const newFocus = tableBody.rows[index];
            if (newFocus) {
                newFocus.classList.add('focused-verse');
                newFocus.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        } catch (e) {}
    }

    // Listen for Karaoke Play clicks OR row focusing
    tableBody?.addEventListener('click', (e) => {
        const presBtn = e.target.closest('.pres-play-btn');
        if (presBtn) {
            const index = parseInt(presBtn.getAttribute('data-index'));
            openPresentation(index);
            return;
        }

        const row = e.target.closest('tr');
        if (row && !e.target.classList.contains('chunk-player')) {
            setFocusRow(row.rowIndex - 1); 
        }
    });

    // =========================
    // ⚡ MARKING ENGINE (GEETA MODE)
    // =========================
    function markGeetaEnd() {
        if (!isGeetaMode || !currentGeetaData || !audioPlayer) return;
        try {
            const row = tableBody.rows[activeVerseIndex];
            if (!row) return;

            const t = parseFloat(audioPlayer.currentTime.toFixed(2));
            if (t === 0 && audioPlayer.paused) {
                alert("⚠️ Please play the Main Audio Player at the top first!"); 
                return;
            }

            const sCell = row.querySelector('.startTime');
            const eCell = row.querySelector('.endTime');
            const durCell = row.cells[3];

            let s = safeNum(sCell.textContent);
            let en = t;
            
            if (en <= s) { 
                alert(`⚠️ End time (${en}s) must be greater than Start time (${s}s). Wait for the verse to finish or manually edit the Start time.`); 
                return; 
            }

            let dur = parseFloat((en - s).toFixed(2));
            
            sCell.textContent = s.toFixed(2);
            eCell.textContent = en.toFixed(2);
            durCell.textContent = dur.toFixed(2);
            row.dataset.start = s;
            row.dataset.end = en;

            currentGeetaData[activeVerseIndex].AudioStart = s;
            currentGeetaData[activeVerseIndex].AudioEnd = en;
            currentGeetaData[activeVerseIndex].ReadTimeInSeconds = dur;

            const audioRowPlayer = row.querySelector('.chunk-player');
            if (audioRowPlayer) {
                const audioRowSource = audioRowPlayer.querySelector('source');
                let baseUrl = currentGeetaData[activeVerseIndex].AudioFileURL || audioPlayer.src;
                baseUrl = baseUrl.split('#')[0]; 
                audioRowSource.src = `${baseUrl}#t=${s},${en}`;
                audioRowPlayer.setAttribute('ontimeupdate', `enforceChunkBounds(this, ${s}, ${en})`);
                audioRowPlayer.style.display = 'block'; 
                audioRowPlayer.load();

                // Reveal presentation button now that timing is set
                const presBtn = row.querySelector('.pres-play-btn');
                if (presBtn) presBtn.style.display = 'block';
            }

            flashRow(row);
            prepareGeetaJson();
            updateProgress();
            saveHistory();
            advanceToNextGeetaVerse(en);
            
        } catch (err) {
            console.error("Error marking Geeta End:", err);
            alert("An error occurred while finalizing the verse.");
        }
    }

    function advanceToNextGeetaVerse(previousEndTime) {
        try {
            const nextIndex = activeVerseIndex + 1;
            if (nextIndex >= currentGeetaData.length) { 
                console.log("🏆 Entire sequence completed!");
                fireConfetti(); 
                return; 
            }

            const currentChapter = currentGeetaData[activeVerseIndex].Chapter;
            const nextChapter = currentGeetaData[nextIndex].Chapter;
            const nextAudioUrl = currentGeetaData[nextIndex].AudioFileURL;

            setFocusRow(nextIndex);
            const nextRow = tableBody.rows[nextIndex];

            if (currentChapter === nextChapter) {
                currentGeetaData[nextIndex].AudioStart = previousEndTime;
                if (nextRow) {
                    nextRow.querySelector('.startTime').textContent = previousEndTime.toFixed(2);
                    nextRow.dataset.start = previousEndTime;
                }
                prepareGeetaJson();
            } else {
                console.log(`🔄 Chapter complete! Switching to ${nextChapter}...`);
                fireConfetti();
                
                currentGeetaData[nextIndex].AudioStart = 0;
                if (nextRow) {
                    nextRow.querySelector('.startTime').textContent = "0.00";
                    nextRow.dataset.start = 0;
                }
                prepareGeetaJson();

                if (nextAudioUrl && currentGeetaData[activeVerseIndex].AudioFileURL !== nextAudioUrl) {
                    if (fileUrlInput) fileUrlInput.value = nextAudioUrl;
                    audioPlayer.src = nextAudioUrl;
                    audioPlayer.load();
                    audioPlayer.play().catch(e => {}); 
                }
            }
        } catch (err) {}
    }

    // =========================
    // ⚡ MARKING ENGINE (NORMAL MODE)
    // =========================
    function markNormalMode() {
        if(!audioPlayer) return;
        try {
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
                <td class="name-cell">${generateName(activeVerseIndex + 1)}</td>
                <td><textarea class="lyricsInput"></textarea></td>
                <td><audio controls class="chunk-player" style="height:35px; width:100%; display:block;" ontimeupdate="enforceChunkBounds(this, ${startTime}, ${end})"><source src="${audioPlayer.src}#t=${startTime},${end}"></audio></td>
            `;
            tableBody?.appendChild(row);
            
            startTime = end;
            activeVerseIndex++;
            
            prepareJson();
            updateProgress();
            saveHistory();
        } catch (err) {}
    }

    function togglePlayPause() {
        if (!audioPlayer) return;
        if (audioPlayer.paused) audioPlayer.play();
        else audioPlayer.pause();
    }

    // =========================
    // 🧠 KEYBOARD & BUTTON MAPS
    // =========================
    document.addEventListener('keydown', e => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
        if (e.key === ']' || e.key === '}') { e.preventDefault(); isGeetaMode ? markGeetaEnd() : markNormalMode(); }
        if (e.ctrlKey && e.key === 'z') undo();
        if (e.ctrlKey && e.key === 'y') redo();
    });

    floatPlayBtn?.addEventListener('click', togglePlayPause);
    floatMarkBtn?.addEventListener('click', () => isGeetaMode ? markGeetaEnd() : markNormalMode());
    floatUndoBtn?.addEventListener('click', undo);
    floatRedoBtn?.addEventListener('click', redo);
    floatDeleteBtn?.addEventListener('click', deleteLastRow);

    // =========================
    // 🏎️ CHAPTER-AWARE SCROLL & TIMER ENGINE
    // =========================
    audioPlayer?.addEventListener('timeupdate', () => {
        try {
            const t = audioPlayer.currentTime;
            
            const floatTimer = document.getElementById('floatTimer');
            if (floatTimer) {
                const dur = audioPlayer.duration || 0;
                const format = (s) => isNaN(s) ? "00:00" : `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
                floatTimer.textContent = `${format(t)} / ${format(dur)}`;
            }

            let foundIndex = -1;

            if (isGeetaMode && currentGeetaData) {
                const cur = currentGeetaData[activeVerseIndex];
                const activeChapter = cur ? cur.Chapter : currentGeetaData[0].Chapter;

                if (cur && cur.AudioEnd > 0 && t >= cur.AudioStart && t <= cur.AudioEnd) {
                    foundIndex = activeVerseIndex;
                } else {
                    for (let i = 0; i < currentGeetaData.length; i++) {
                        const v = currentGeetaData[i];
                        if (v.Chapter === activeChapter && v.AudioEnd > v.AudioStart && t >= v.AudioStart && t <= v.AudioEnd) { 
                            foundIndex = i; 
                            break; 
                        }
                    }
                }
            } else if (tableBody) {
                const rows = tableBody.rows;
                for (let i = 0; i < rows.length; i++) {
                    const s = parseFloat(rows[i].dataset.start);
                    const e = parseFloat(rows[i].dataset.end);
                    if (!isNaN(s) && !isNaN(e) && t >= s && t <= e) { 
                        foundIndex = i; 
                        break; 
                    }
                }
            }

            if (foundIndex !== -1 && tableBody) {
                const targetRow = tableBody.rows[foundIndex];
                if (activeRowElem !== targetRow) {
                    if (activeRowElem) activeRowElem.classList.remove('active-row');
                    targetRow.classList.add('active-row');
                    targetRow.scrollIntoView({ block: "center", behavior: "smooth" });
                    activeRowElem = targetRow;
                }
            } else if (activeRowElem) {
                activeRowElem.classList.remove('active-row');
                activeRowElem = null;
            }
        } catch (e) {}
    });

    // =========================
    // 🔍 ASYNC TABLE SEARCH
    // =========================
    let searchDebounce;
    tableSearch?.addEventListener('input', function () {
        clearTimeout(searchDebounce);
        const term = this.value.toLowerCase().trim();
        if (searchCountDisplay) searchCountDisplay.innerText = "Searching...";

        searchDebounce = setTimeout(() => {
            if (!tableBody) return;
            const rows = Array.from(tableBody.rows);
            let matchCount = 0;
            let index = 0;

            function processSearchBatch() {
                try {
                    const limit = Math.min(index + 50, rows.length);
                    for (; index < limit; index++) {
                        const row = rows[index];
                        const searchStr = row.dataset.searchStr;

                        if (!term) {
                            if (row.style.display !== "") row.style.display = "";
                            if (row.dataset.highlighted === "true") {
                                const lEl = row.querySelector('.lyrics-text') || row.querySelector('textarea');
                                if (lEl && lEl.tagName === 'DIV') highlightHTML(lEl, "");
                                const nCell = row.querySelector('.name-cell');
                                if (nCell) highlightHTML(nCell, "");
                                row.dataset.highlighted = "false";
                            }
                            continue;
                        }

                        if (searchStr && searchStr.includes(term)) {
                            row.style.display = "";
                            matchCount++;
                            const lEl = row.querySelector('.lyrics-text') || row.querySelector('textarea');
                            if (lEl && lEl.tagName === 'DIV') highlightHTML(lEl, term);
                            const nCell = row.querySelector('.name-cell');
                            if (nCell) highlightHTML(nCell, term);
                            row.dataset.highlighted = "true";
                        } else {
                            row.style.display = "none";
                        }
                    }
                    if (index < rows.length) requestAnimationFrame(processSearchBatch); 
                    else if (searchCountDisplay) searchCountDisplay.innerText = term ? `Found ${matchCount} results for "${term}"` : "";
                } catch (e) {}
            }
            processSearchBatch();
        }, 300); 
    });

    // =========================
    // 🔍 DROPDOWN SEARCH
    // =========================
    const searchSelectObj = document.getElementById('searchSelect');
    const optionsContainer = document.getElementById('optionsContainer');
    if (searchSelectObj && optionsContainer) {
        const options = optionsContainer.getElementsByTagName('div');
        
        searchSelectObj.addEventListener('focus', () => { 
            optionsContainer.classList.remove('hidden'); 
            [...options].forEach(o => o.style.display = ""); 
        });
        
        searchSelectObj.addEventListener('input', () => {
            const filter = searchSelectObj.value.toLowerCase();
            let visible = false;
            [...options].forEach(o => { 
                if (o.textContent.toLowerCase().includes(filter)) { o.style.display = ""; visible = true; } 
                else o.style.display = "none"; 
            });
            optionsContainer.classList.toggle('hidden', !visible);
        });
        
        optionsContainer.onclick = (e) => {
            const val = e.target.getAttribute('data-value');
            if (val) {
                if (fileUrlInput) fileUrlInput.value = val; 
                searchSelectObj.value = e.target.textContent; 
                optionsContainer.classList.add('hidden'); 
                window.loadAudio();
            }
        };
        
        document.addEventListener('click', e => { 
            if (!e.target.closest('.select-container')) optionsContainer.classList.add('hidden'); 
        });
    }

    // =========================
    // 🎧 LOAD AUDIO (MANUAL)
    // =========================
    window.loadAudio = function () {
        try {
            if ((!fileUrlInput || !fileUrlInput.value) && (!fileInput || !fileInput.files.length)) { 
                alert("Please provide an audio source first."); 
                return; 
            }
            
            console.log("🎵 Loading new audio source...");
            if (tableBody) tableBody.innerHTML = ''; 
            activeVerseIndex = 0; startTime = null; isGeetaMode = false; window.currentGeetaData = null;
            if (jsonInput) jsonInput.value = '';
            
            if(progressBar) progressBar.style.width = "0%";
            if(progressText) progressText.innerText = `Progress: 0/0 (0%)`;
            if (searchCountDisplay) searchCountDisplay.innerText = "";

            if(audioPlayer) {
                audioPlayer.onloadedmetadata = () => { updateProgress(); };

                if (fileUrlInput && fileUrlInput.value) {
                    audioPlayer.src = fileUrlInput.value;
                } else if (fileInput && fileInput.files.length) {
                    const reader = new FileReader();
                    reader.onload = e => { audioPlayer.src = e.target.result; audioPlayer.load(); };
                    reader.readAsDataURL(fileInput.files[0]);
                    return;
                }
                audioPlayer.load();
            }
        } catch (e) { 
            alert("Failed to load audio source.");
        }
    };

    // =========================
    // 💾 AUTO SAVE & HISTORY
    // =========================
    function autoSave() { 
        if (jsonInput && jsonInput.value) {
            localStorage.setItem("geeta_progress", jsonInput.value); 
        }
    }
    setInterval(autoSave, 5000);

    function loadAutoSave() {
        const saved = localStorage.getItem("geeta_progress");
        if (saved) {
            window.loadJsonData(saved);
        }
    }

    function saveHistory() {
        if (!jsonInput) return;
        historyStack.push(jsonInput.value);
        if (historyStack.length > 100) historyStack.shift(); 
        redoStack = [];
    }

    function undo() {
        if (!historyStack.length || !jsonInput) return;
        redoStack.push(jsonInput.value);
        jsonInput.value = historyStack.pop();
        window.loadJsonData(jsonInput.value);
    }

    function redo() {
        if (!redoStack.length || !jsonInput) return;
        historyStack.push(jsonInput.value);
        jsonInput.value = redoStack.pop();
        window.loadJsonData(jsonInput.value);
    }

    // =========================
    // 📊 PROGRESS TRACKER
    // =========================
    function updateProgress() {
        try {
            if (isGeetaMode && window.currentGeetaData) {
                const total = window.currentGeetaData.length;
                const done = window.currentGeetaData.filter(v => v.AudioEnd > 0).length;
                const p = Math.round((done / total) * 100) || 0;
                if(progressBar) progressBar.style.width = p + "%";
                if(progressText) progressText.innerText = `Progress: ${done}/${total} Verses (${p}%)`;
            } else {
                if (!audioPlayer || isNaN(audioPlayer.duration) || audioPlayer.duration === 0 || !tableBody) return;
                let tm = 0; [...tableBody.rows].forEach(row => { tm += safeNum(row.cells[3].textContent); });
                const p = Math.round((tm / audioPlayer.duration) * 100) || 0;
                const ft = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
                if(progressBar) progressBar.style.width = Math.min(p, 100) + "%";
                if(progressText) progressText.innerText = `Progress: ${ft(tm)} / ${ft(audioPlayer.duration)} (${p}%)`;
            }
        } catch (e) {}
    }

    // =========================
    // 📥 ASYNC JSON LOAD
    // =========================
    window.loadJsonData = function (data) {
        try {
            console.log("📥 Parsing incoming JSON Data...");
            if (typeof data === 'string') data = JSON.parse(data);
            
            if(tableBody) tableBody.innerHTML = ''; 
            activeVerseIndex = 0; 
            startTime = null;

            if (Array.isArray(data)) {
                // GEETA JSON LOAD
                isGeetaMode = true; currentGeetaData = data;
                let idx = 0;
                const loadingInd = document.getElementById('loadingIndicator');
                if (loadingInd) loadingInd.classList.remove('hidden');

                function renderBatch() {
                    if (!tableBody) return;
                    const frag = document.createDocumentFragment();
                    for (let i = 0; i < 50 && idx < data.length; i++, idx++) {
                        const v = data[idx];
                        const lTxt = v.EnglishText ? `${v.OriginalText || ""}<br><br>${v.EnglishText}` : (v.OriginalText || "");
                        const isDone = (v.AudioEnd > 0 && v.AudioEnd > v.AudioStart);
                        let bUrl = v.AudioFileURL || ""; bUrl = bUrl.split('#')[0]; 
                        const chunkSrc = isDone ? `${bUrl}#t=${v.AudioStart},${v.AudioEnd}` : bUrl;
                        
                        const row = document.createElement('tr');
                        row.dataset.searchStr = `${v.VerseNum} ${v.Topic}_C${v.Chapter}_V${v.VerseNum} ${v.OriginalText} ${v.EnglishText}`.toLowerCase();
                        row.dataset.start = v.AudioStart || 0;
                        row.dataset.end = v.AudioEnd || 0;

                        // INJECTED PRESENTATION BUTTON
                        row.innerHTML = `
                            <td>${v.VerseNum}</td>
                            <td contenteditable class="startTime">${v.AudioStart || 0}</td>
                            <td contenteditable class="endTime">${v.AudioEnd || 0}</td>
                            <td>${v.ReadTimeInSeconds || 0}</td>
                            <td class="name-cell">${generateName(v.VerseNum, v)}</td>
                            <td><div class="lyrics-text" style="max-height: 100px; overflow-y: auto; background: #f9f9f9; padding: 10px; border: 1px solid #ccc; border-radius: 8px;">${lTxt}</div></td>
                            <td>
                                <button class="pres-play-btn" data-index="${idx}" style="display:${isDone ? 'block' : 'none'}; width:100%; margin-bottom:5px; background:#17a2b8; color:white; border:none; border-radius:4px; padding:6px; cursor:pointer; font-weight:bold;">🎤 Play Presentation</button>
                                <audio class="chunk-player" controls style="height:35px; width:100%; display:${isDone ? 'block' : 'none'};" ontimeupdate="enforceChunkBounds(this, ${v.AudioStart || 0}, ${v.AudioEnd || 0})"><source src="${chunkSrc}"></audio>
                            </td>
                        `;
                        frag.appendChild(row);
                    }
                    tableBody.appendChild(frag);
                    
                    if (idx < data.length) {
                        requestAnimationFrame(renderBatch);
                    } else {
                        updateProgress(); 
                        if (loadingInd) loadingInd.classList.add('hidden');
                        
                        const firstUnf = data.findIndex(v => !v.AudioEnd || v.AudioEnd === 0);
                        if (firstUnf !== -1) {
                            setFocusRow(firstUnf);
                            const tUrl = data[firstUnf].AudioFileURL;
                            
                            if (tUrl && audioPlayer) {
                                if (fileUrlInput) fileUrlInput.value = tUrl;
                                audioPlayer.src = tUrl;
                                audioPlayer.addEventListener('loadedmetadata', function seekOnce() {
                                    audioPlayer.currentTime = data[firstUnf].AudioStart || 0;
                                    audioPlayer.removeEventListener('loadedmetadata', seekOnce);
                                });
                                audioPlayer.load();
                            }

                            if (firstUnf > 0 && data[firstUnf].Chapter === data[firstUnf - 1].Chapter) {
                                const prevE = data[firstUnf - 1].AudioEnd;
                                data[firstUnf].AudioStart = prevE;
                                tableBody.rows[firstUnf].querySelector('.startTime').textContent = prevE.toFixed(2);
                                tableBody.rows[firstUnf].dataset.start = prevE;
                            } else {
                                data[firstUnf].AudioStart = 0;
                                tableBody.rows[firstUnf].querySelector('.startTime').textContent = "0.00";
                                tableBody.rows[firstUnf].dataset.start = 0;
                            }
                        } else {
                            setFocusRow(0); 
                        }
                    }
                }
                renderBatch();
                prepareGeetaJson();

            } else {
                // NORMAL JSON LOAD
                isGeetaMode = false;
                let maxEndSaved = 0; 

                if(data.audioUrl && audioPlayer) { 
                    audioPlayer.src = data.audioUrl; 
                    audioPlayer.load(); 
                }
                
                data.timestamps?.forEach((t, i) => {
                    maxEndSaved = Math.max(maxEndSaved, safeNum(t.end));
                    const row = document.createElement('tr');
                    row.dataset.searchStr = `${t.name || generateName(i + 1)} ${t.lyrics || ""}`.toLowerCase();
                    row.dataset.start = t.start || 0;
                    row.dataset.end = t.end || 0;

                    row.innerHTML = `
                        <td>${i + 1}</td>
                        <td contenteditable class="startTime">${t.start}</td>
                        <td contenteditable class="endTime">${t.end}</td>
                        <td>${(t.end - t.start).toFixed(2)}</td>
                        <td class="name-cell">${t.name || generateName(i + 1)}</td>
                        <td><textarea class="lyricsInput">${t.lyrics || ""}</textarea></td>
                        <td><audio controls class="chunk-player" style="height:35px; width:100%; display:block;" ontimeupdate="enforceChunkBounds(this, ${t.start}, ${t.end})"><source src="${data.audioUrl}#t=${t.start},${t.end}"></audio></td>
                    `;
                    tableBody?.appendChild(row);
                });

                startTime = maxEndSaved; 
                activeVerseIndex = data.timestamps?.length || 0;
                prepareJson();
                
                function performSeek() { 
                    if(audioPlayer) audioPlayer.currentTime = maxEndSaved; 
                    updateProgress(); 
                }
                
                if (audioPlayer && audioPlayer.readyState >= 1) performSeek();
                else if (audioPlayer) audioPlayer.addEventListener('loadedmetadata', function seek() { 
                    performSeek(); 
                    audioPlayer.removeEventListener('loadedmetadata', seek); 
                });
            }
        } catch (err) { 
            console.error("Load JSON Error.", err); 
            alert("Failed to load JSON data.");
        }
    };

    window.loadJsonFile = function(e) { 
        const f = e.target.files[0]; 
        if(!f) return; 
        const r = new FileReader(); 
        r.onload = (ev) => { 
            if(jsonInput) jsonInput.value = ev.target.result; 
            window.loadJsonData(ev.target.result); 
        }; 
        r.readAsText(f); 
    };
    
    jsonInput?.addEventListener('blur', () => { 
        if(jsonInput.value.trim()) window.loadJsonData(jsonInput.value); 
    });

    // =========================
    // 📤 BUILD & EXPORT
    // =========================
    window.prepareJson = function () {
        try {
            if(!jsonInput) return;
            const data = { audioUrl: audioPlayer ? audioPlayer.src : '', timestamps: [] };
            if (tableBody) {
                [...tableBody.rows].forEach((r, i) => {
                    const s = safeNum(r.cells[1].textContent);
                    const e = safeNum(r.cells[2].textContent);
                    r.dataset.start = s; 
                    r.dataset.end = e; // Sync cache
                    
                    data.timestamps.push({
                        verse: i + 1, 
                        name: r.cells[4].textContent, 
                        start: s, 
                        end: e,
                        duration: parseFloat((e - s).toFixed(2)),
                        lyrics: r.cells[5].querySelector('textarea')?.value || ""
                    });
                });
            }
            jsonInput.value = JSON.stringify(data, null, 2);
        } catch(e) {}
    };

    function prepareGeetaJson() { 
        if (currentGeetaData && jsonInput) jsonInput.value = JSON.stringify(currentGeetaData, null, 2); 
    }

    window.saveData = function () {
        try {
            if (!jsonInput || !jsonInput.value) { alert("No data to save."); return; }
            const blob = new Blob([jsonInput.value], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = isGeetaMode ? 'geeta_sync.json' : 'audio_sync.json';
            a.click();
        } catch (e) {}
    };

    window.copyJsonData = function () { 
        if (!jsonInput || !jsonInput.value) { alert("No data to copy."); return; }
        navigator.clipboard.writeText(jsonInput.value)
            .then(() => alert("JSON copied to clipboard!"))
            .catch(e => alert("Clipboard copy failed."));
    };

    // =========================
    // 🗑 DELETE & MANUAL EDIT
    // =========================
    function deleteLastRow() {
        try {
            if (!tableBody || !tableBody.rows.length) return;
            tableBody.deleteRow(-1);
            activeVerseIndex--;
            startTime = tableBody.rows.length ? safeNum(tableBody.rows[tableBody.rows.length - 1].cells[2].textContent) : null;

            if (isGeetaMode) {
                currentGeetaData[activeVerseIndex].AudioStart = 0;
                currentGeetaData[activeVerseIndex].AudioEnd = 0;
                currentGeetaData[activeVerseIndex].ReadTimeInSeconds = 0;
                prepareGeetaJson(); 
            } else prepareJson();
            
            updateProgress(); saveHistory();
        } catch(e) {}
    }

    tableBody?.addEventListener('blur', e => {
        const cell = e.target;
        if (cell.classList.contains('startTime') || cell.classList.contains('endTime')) {
            try {
                const row = cell.closest('tr');
                const s = safeNum(row.cells[1].textContent);
                const en = safeNum(row.cells[2].textContent);

                if (en < s && en !== 0) { 
                    alert("Invalid time configuration. End time must be greater than Start time."); 
                    row.cells[2].textContent = row.dataset.end || "0.00";
                    return; 
                }

                const dur = parseFloat((en - s).toFixed(2));
                if (en > 0) row.cells[3].textContent = dur;
                
                row.dataset.start = s; 
                row.dataset.end = en; 

                const audioEl = row.querySelector('.chunk-player');
                const sourceEl = row.querySelector('source');
                if(audioEl && sourceEl && en > 0) {
                    let baseUrl = isGeetaMode ? (currentGeetaData[row.rowIndex - 1].AudioFileURL || audioPlayer.src) : audioPlayer.src;
                    baseUrl = baseUrl.split('#')[0];
                    sourceEl.src = `${baseUrl}#t=${s},${en}`;
                    audioEl.setAttribute('ontimeupdate', `enforceChunkBounds(this, ${s}, ${en})`);
                    audioEl.style.display = 'block';
                    
                    const presBtn = row.querySelector('.pres-play-btn');
                    if (presBtn) presBtn.style.display = 'block';
                    
                    audioEl.load();
                }

                if (isGeetaMode) {
                    const idx = row.rowIndex - 1; 
                    if(currentGeetaData[idx]) {
                        currentGeetaData[idx].AudioStart = s;
                        currentGeetaData[idx].AudioEnd = en;
                        currentGeetaData[idx].ReadTimeInSeconds = dur > 0 ? dur : 0;
                    }
                    prepareGeetaJson(); 
                } else prepareJson();
                
                updateProgress(); saveHistory();
            } catch (err) {}
        }
    }, true);

    // =========================
    // 🏁 SYSTEM STARTUP & URL ROUTING
    // =========================
    const urlParams = new URLSearchParams(window.location.search);
    const sharedFile = urlParams.get('file');

    if (sharedFile) {
        console.log("🔗 Shared URL detected. Auto-loading system file:", sharedFile);
        const selectObj = document.getElementById('systemJsonSelect');
        if (selectObj) {
            for (let i = 0; i < selectObj.options.length; i++) {
                if (selectObj.options[i].value === sharedFile) {
                    selectObj.selectedIndex = i;
                    break;
                }
            }
        }
        window.loadSystemJson(sharedFile);
    } else {
        loadAutoSave();
    }
});
