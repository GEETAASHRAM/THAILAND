// =========================================================
// 🚀 AUDIO SYNC SCRIPT (SEAMLESS FLOW & CONFETTI)
// =========================================================

document.addEventListener('DOMContentLoaded', () => {

    console.log("🚀 App Initialized");

    // =========================
    // 🧠 GLOBAL STATE
    // =========================
    let startTime = null;
    let activeVerseIndex = 0; 
    let isGeetaMode = false;

    let historyStack = [];
    let redoStack = [];

    window.currentGeetaData = null;

    // =========================
    // 📌 ELEMENTS
    // =========================
    const audioPlayer = document.getElementById('audioPlayer');
    const tableBody = document.querySelector('#timestampsTable tbody');
    const jsonInput = document.getElementById('jsonDataInput');

    const prefixInput = document.getElementById('prefixInput');
    const suffixInput = document.getElementById('suffixInput');

    const fileUrlInput = document.getElementById('fileUrlInput');
    const fileInput = document.getElementById('fileInput');

    const undoButton = document.getElementById('undoButton');
    const redoButton = document.getElementById('redoButton');
    const deleteButton = document.getElementById('deleteButton');

    const searchSelect = document.getElementById('searchSelect');
    const optionsContainer = document.getElementById('optionsContainer');

    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    const tableSearch = document.getElementById('tableSearch'); 

    let searchCountDisplay = null;
    if (tableSearch) {
        searchCountDisplay = document.createElement('div');
        searchCountDisplay.style.fontWeight = 'bold';
        searchCountDisplay.style.color = '#007BFF';
        searchCountDisplay.style.marginBottom = '10px';
        tableSearch.parentNode.insertBefore(searchCountDisplay, tableSearch.nextSibling);
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
        const text = element.textContent;
        if (!term) { element.innerHTML = text; return; }
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedTerm})`, 'gi');
        element.innerHTML = text.replace(regex, `<mark style="background-color: yellow; color: black; border-radius: 2px;">$1</mark>`);
    }

    // 🎉 CONFETTI CELEBRATION
    function fireConfetti() {
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        for (let i = 0; i < 150; i++) {
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

            const duration = Math.random() * 2 + 1.5;
            conf.animate([
                { transform: `translate3d(0,0,0) rotate(0deg)`, opacity: 1 },
                { transform: `translate3d(${Math.random()*300 - 150}px, 100vh, 0) rotate(${Math.random()*720}deg)`, opacity: 0 }
            ], { duration: duration * 1000, easing: 'cubic-bezier(.37,0,.63,1)' });

            setTimeout(() => conf.remove(), duration * 1000);
        }
    }

    // =========================
    // 🎯 SMART FOCUS TRACKER
    // =========================
    function setFocusRow(index) {
        if (index < 0 || index >= tableBody.rows.length) return;
        activeVerseIndex = index;

        [...tableBody.rows].forEach((row, i) => {
            if (i === activeVerseIndex) {
                row.classList.add('focused-verse');
                row.scrollIntoView({ block: "center", behavior: "smooth" });
            } else {
                row.classList.remove('focused-verse');
            }
        });
    }

    tableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (row && !e.target.classList.contains('row-mark-start') && !e.target.classList.contains('row-mark-end')) {
            setFocusRow(row.rowIndex - 1); 
        }
    });

    function advanceAndCheckChapter(currentEndTime) {
        if (!isGeetaMode || !currentGeetaData) return;
        
        const currentIndex = activeVerseIndex;
        const nextIndex = activeVerseIndex + 1;

        if (nextIndex < currentGeetaData.length) {
            const currentChapter = currentGeetaData[currentIndex].Chapter;
            const nextChapter = currentGeetaData[nextIndex].Chapter;
            
            const nextAudioUrl = currentGeetaData[nextIndex].AudioFileURL;

            setFocusRow(nextIndex);

            if (currentChapter === nextChapter) {
                // SAME CHAPTER: Auto-set the start time of the next verse to the end time of the previous verse
                currentGeetaData[nextIndex].AudioStart = currentEndTime;
                const nextRow = tableBody.rows[nextIndex];
                if (nextRow) {
                    nextRow.querySelector('.startTime').textContent = currentEndTime;
                }
            } else {
                // DIFFERENT CHAPTER: Celebrate and swap audio!
                console.log("🔄 Chapter complete! Loading new audio...");
                fireConfetti();
                
                if (nextAudioUrl && currentGeetaData[currentIndex].AudioFileURL !== nextAudioUrl) {
                    fileUrlInput.value = nextAudioUrl;
                    audioPlayer.src = nextAudioUrl;
                    audioPlayer.load();
                }
            }
        } else {
            // END OF ENTIRE BOOK
            fireConfetti();
        }
    }

    // =========================
    // ⚡ MARKING LOGIC (GEETA MODE)
    // =========================
    function flashRow(row) {
        const originalBg = row.style.background;
        row.style.background = "#d4edda"; 
        setTimeout(() => row.style.background = originalBg, 400);
    }

    function markTargetedVerse(action) {
        if (!isGeetaMode) return;
        const row = tableBody.rows[activeVerseIndex];
        if (!row) return;

        const t = audioPlayer.currentTime;
        const sCell = row.querySelector('.startTime');
        const eCell = row.querySelector('.endTime');
        const durCell = row.cells[3];
        const audioRowPlayer = row.querySelector('audio');
        const audioRowSource = row.querySelector('source');

        try {
            if (action === 'start') {
                sCell.textContent = t.toFixed(2);
                if (currentGeetaData[activeVerseIndex]) {
                    currentGeetaData[activeVerseIndex].AudioStart = parseFloat(t.toFixed(2));
                }
                flashRow(row);
                prepareGeetaJson();
            } 
            else if (action === 'end') {
                eCell.textContent = t.toFixed(2);
                
                const s = safeNum(sCell.textContent);
                const en = safeNum(eCell.textContent);
                const dur = parseFloat((en - s).toFixed(2));
                
                if (en > 0 && en >= s) durCell.textContent = dur;

                if (currentGeetaData[activeVerseIndex]) {
                    currentGeetaData[activeVerseIndex].AudioEnd = en;
                    currentGeetaData[activeVerseIndex].ReadTimeInSeconds = dur > 0 ? dur : 0;
                    
                    // UPDATE CHUNK AUDIO SOURCE
                    if (audioRowPlayer && audioRowSource) {
                        const baseUrl = currentGeetaData[activeVerseIndex].AudioFileURL || audioPlayer.src;
                        audioRowSource.src = `${baseUrl}#t=${s},${en}`;
                        audioRowPlayer.load();
                    }
                }

                flashRow(row);
                prepareGeetaJson();
                updateProgress();
                saveHistory();

                // Auto move to next verse
                advanceAndCheckChapter(en);
            }
        } catch (err) {
            console.error("Marking failed:", err);
            alert("Error marking verse. Please check inputs.");
        }
    }

    // =========================
    // 🧠 KEYBOARD SHORTCUTS
    // =========================
    document.addEventListener('keydown', e => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        if (e.key === '[' || e.key === '{') { e.preventDefault(); markTargetedVerse('start'); }
        if (e.key === ']' || e.key === '}') { e.preventDefault(); markTargetedVerse('end'); }

        if (e.code === 'Space' && !isGeetaMode) {
            e.preventDefault();
            markNormalMode();
        }

        if (e.ctrlKey && e.key === 'z') undo();
        if (e.ctrlKey && e.key === 'y') redo();
    });

    // Delegated button clicks for Start/End inside Geeta Mode
    tableBody.addEventListener('click', e => {
        if (!isGeetaMode) return;
        const target = e.target;
        if (target.classList.contains('row-mark-start')) {
            setFocusRow(parseInt(target.getAttribute('data-index')));
            markTargetedVerse('start');
        }
        if (target.classList.contains('row-mark-end')) {
            setFocusRow(parseInt(target.getAttribute('data-index')));
            markTargetedVerse('end');
        }
    });

    // =========================
    // ⚡ MARKING LOGIC (NORMAL MODE)
    // =========================
    function markNormalMode() {
        const t = audioPlayer.currentTime;
        if (startTime === null) startTime = 0;
        const end = t;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${activeVerseIndex + 1}</td>
            <td contenteditable class="startTime">${startTime.toFixed(2)}</td>
            <td contenteditable class="endTime">${end.toFixed(2)}</td>
            <td>${(end - startTime).toFixed(2)}</td>
            <td class="name-cell">${generateName(activeVerseIndex + 1)}</td>
            <td><textarea class="lyricsInput"></textarea></td>
            <td><audio controls><source src="${audioPlayer.src}#t=${startTime},${end}"></audio></td>
        `;
        tableBody.appendChild(row);
        startTime = end;
        activeVerseIndex++;
        prepareJson();
        updateProgress();
        saveHistory();
    }

    document.getElementById('markButton')?.addEventListener('click', () => {
        isGeetaMode ? markTargetedVerse('start') : markNormalMode();
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
            const rows = Array.from(tableBody.rows);
            let matchCount = 0;
            let index = 0;
            const batchSize = 50; 

            function processSearchBatch() {
                const limit = Math.min(index + batchSize, rows.length);
                for (; index < limit; index++) {
                    const row = rows[index];
                    const lyricsEl = row.querySelector('.lyrics-text') || row.querySelector('textarea');
                    const nameCell = row.querySelector('.name-cell') || row.cells[4];
                    const lyricsText = lyricsEl.tagName === 'DIV' ? lyricsEl.textContent : lyricsEl.value;
                    const textToSearch = (nameCell.textContent + " " + lyricsText).toLowerCase();

                    if (!term) {
                        row.style.display = "";
                        if (lyricsEl.tagName === 'DIV') highlightHTML(lyricsEl, "");
                        highlightHTML(nameCell, "");
                        continue;
                    }

                    if (textToSearch.includes(term)) {
                        row.style.display = "";
                        matchCount++;
                        if (lyricsEl.tagName === 'DIV') highlightHTML(lyricsEl, term);
                        highlightHTML(nameCell, term);
                    } else {
                        row.style.display = "none";
                    }
                }

                if (index < rows.length) {
                    requestAnimationFrame(processSearchBatch); 
                } else {
                    if (searchCountDisplay) {
                        searchCountDisplay.innerText = term ? `Found ${matchCount} results for "${term}"` : "";
                    }
                }
            }
            processSearchBatch();
        }, 300); 
    });

    // =========================
    // 🔍 DROPDOWN SEARCH
    // =========================
    if (searchSelect && optionsContainer) {
        const options = optionsContainer.getElementsByTagName('div');
        searchSelect.addEventListener('focus', () => { optionsContainer.classList.remove('hidden'); [...options].forEach(o => o.style.display = ""); });
        searchSelect.addEventListener('input', () => {
            const filter = searchSelect.value.toLowerCase();
            let visible = false;
            [...options].forEach(o => { if (o.textContent.toLowerCase().includes(filter)) { o.style.display = ""; visible = true; } else o.style.display = "none"; });
            optionsContainer.classList.toggle('hidden', !visible);
        });
        optionsContainer.onclick = (e) => {
            const val = e.target.getAttribute('data-value');
            if (val) {
                fileUrlInput.value = val; searchSelect.value = e.target.textContent; optionsContainer.classList.add('hidden'); window.loadAudio();
            }
        };
        document.addEventListener('click', e => { if (!e.target.closest('.select-container')) optionsContainer.classList.add('hidden'); });
    }

    // =========================
    // 🎧 LOAD AUDIO
    // =========================
    window.loadAudio = function () {
        try {
            if (!fileUrlInput.value && !fileInput?.files.length) { alert("Provide audio source"); return; }
            tableBody.innerHTML = ''; activeVerseIndex = 0; startTime = null; isGeetaMode = false; window.currentGeetaData = null;
            jsonInput.value = '';
            if(progressBar) progressBar.style.width = "0%";
            if(progressText) progressText.innerText = `Progress: 0/0 (0%)`;
            if (searchCountDisplay) searchCountDisplay.innerText = "";

            if (fileUrlInput.value) {
                audioPlayer.src = fileUrlInput.value;
            } else if (fileInput?.files.length) {
                const reader = new FileReader();
                reader.onload = e => { audioPlayer.src = e.target.result; audioPlayer.load(); };
                reader.readAsDataURL(fileInput.files[0]);
                return;
            }
            audioPlayer.load();
        } catch (e) { console.error(e); }
    };

    // =========================
    // 💾 AUTO SAVE & HISTORY
    // =========================
    function autoSave() { if (jsonInput.value) localStorage.setItem("geeta_progress", jsonInput.value); }
    setInterval(autoSave, 5000);

    function loadAutoSave() {
        const saved = localStorage.getItem("geeta_progress");
        if (saved) window.loadJsonData(saved);
    }

    function saveHistory() {
        historyStack.push(jsonInput.value);
        if (historyStack.length > 100) historyStack.shift(); 
        redoStack = [];
    }

    function undo() {
        if (!historyStack.length) return;
        redoStack.push(jsonInput.value);
        jsonInput.value = historyStack.pop();
        window.loadJsonData(jsonInput.value);
    }

    function redo() {
        if (!redoStack.length) return;
        historyStack.push(jsonInput.value);
        jsonInput.value = redoStack.pop();
        window.loadJsonData(jsonInput.value);
    }

    undoButton?.addEventListener('click', undo);
    redoButton?.addEventListener('click', redo);

    // =========================
    // 📊 SMART PROGRESS TRACKER
    // =========================
    function updateProgress() {
        if (isGeetaMode && window.currentGeetaData) {
            const total = window.currentGeetaData.length;
            const done = window.currentGeetaData.filter(v => v.AudioEnd > 0).length;
            const p = Math.round((done / total) * 100) || 0;
            if(progressBar) progressBar.style.width = p + "%";
            if(progressText) progressText.innerText = `Progress: ${done}/${total} Verses (${p}%)`;
        } else {
            if (!audioPlayer || isNaN(audioPlayer.duration) || audioPlayer.duration === 0) return;
            let totalMarkedSeconds = 0;
            [...tableBody.rows].forEach(row => { totalMarkedSeconds += safeNum(row.cells[3].textContent); });
            const totalAudioSeconds = audioPlayer.duration;
            const p = Math.round((totalMarkedSeconds / totalAudioSeconds) * 100) || 0;
            const formatTime = (secs) => `${Math.floor(secs / 60).toString().padStart(2, '0')}:${Math.floor(secs % 60).toString().padStart(2, '0')}`;
            if(progressBar) progressBar.style.width = Math.min(p, 100) + "%";
            if(progressText) progressText.innerText = `Progress: ${formatTime(totalMarkedSeconds)} / ${formatTime(totalAudioSeconds)} (${p}%)`;
        }
    }

    // =========================
    // 📥 ASYNC JSON LOAD 
    // =========================
    window.loadJsonData = function (data) {
        try {
            if (typeof data === 'string') data = JSON.parse(data);
            tableBody.innerHTML = '';
            activeVerseIndex = 0; startTime = null;

            if (Array.isArray(data)) {
                isGeetaMode = true; currentGeetaData = data;
                let idx = 0;
                document.getElementById('loadingIndicator')?.classList.remove('hidden');

                function renderBatch() {
                    const frag = document.createDocumentFragment();
                    for (let i = 0; i < 50 && idx < data.length; i++, idx++) {
                        const v = data[idx];
                        const lyricsText = v.EnglishText ? `${v.OriginalText || ""}<br><br>${v.EnglishText}` : (v.OriginalText || "");
                        const chunkSrc = (v.AudioFileURL && v.AudioEnd > 0) ? `${v.AudioFileURL}#t=${v.AudioStart},${v.AudioEnd}` : (v.AudioFileURL || "");

                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${v.VerseNum}</td>
                            <td contenteditable class="startTime">${v.AudioStart || 0}</td>
                            <td contenteditable class="endTime">${v.AudioEnd || 0}</td>
                            <td>${v.ReadTimeInSeconds || 0}</td>
                            <td class="name-cell">${generateName(v.VerseNum, v)}</td>
                            <td><div class="lyrics-text" style="max-height: 100px; overflow-y: auto; background: #f9f9f9; padding: 10px; border: 1px solid #ccc; border-radius: 8px;">${lyricsText}</div></td>
                            <td>
                                <div style="display:flex; gap:5px; margin-bottom:5px;">
                                    <button class="row-mark-start" data-index="${idx}" title="Hotkey: [" style="flex:1; background:#28a745; color:white; border:none; border-radius:4px; padding:6px; cursor:pointer; font-size:12px;">Start [</button>
                                    <button class="row-mark-end" data-index="${idx}" title="Hotkey: ]" style="flex:1; background:#dc3545; color:white; border:none; border-radius:4px; padding:6px; cursor:pointer; font-size:12px;">End ]</button>
                                </div>
                                <audio controls style="height:35px; width:100%;"><source src="${chunkSrc}"></audio>
                            </td>
                        `;
                        frag.appendChild(row);
                    }
                    tableBody.appendChild(frag);
                    if (idx < data.length) {
                        requestAnimationFrame(renderBatch);
                    } else {
                        updateProgress();
                        document.getElementById('loadingIndicator')?.classList.add('hidden');
                        
                        // Set focus to the first uncompleted verse
                        const firstUnfinished = data.findIndex(v => !v.AudioEnd || v.AudioEnd === 0);
                        setFocusRow(firstUnfinished !== -1 ? firstUnfinished : 0);
                    }
                }
                renderBatch();
                
                if (data[0]?.AudioFileURL) { audioPlayer.src = data[0].AudioFileURL; audioPlayer.load(); }
                prepareGeetaJson();

            } else {
                // NORMAL JSON LOAD
                isGeetaMode = false;
                let maxEndSaved = 0;

                if(data.audioUrl) { audioPlayer.src = data.audioUrl; audioPlayer.load(); }
                
                data.timestamps?.forEach((t, i) => {
                    maxEndSaved = Math.max(maxEndSaved, safeNum(t.end));
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${i + 1}</td>
                        <td contenteditable class="startTime">${t.start}</td>
                        <td contenteditable class="endTime">${t.end}</td>
                        <td>${(t.end - t.start).toFixed(2)}</td>
                        <td class="name-cell">${t.name || generateName(i + 1)}</td>
                        <td><textarea class="lyricsInput">${t.lyrics || ""}</textarea></td>
                        <td><audio controls><source src="${data.audioUrl}#t=${t.start},${t.end}"></audio></td>
                    `;
                    tableBody.appendChild(row);
                });

                activeVerseIndex = data.timestamps?.length || 0;
                prepareJson();
                
                // AUTO SEEK TO LAST SAVED POSITION FOR NORMAL JSON
                audioPlayer.addEventListener('loadedmetadata', function seekOnce() {
                    audioPlayer.currentTime = maxEndSaved;
                    updateProgress();
                    audioPlayer.removeEventListener('loadedmetadata', seekOnce);
                });
            }
        } catch (err) { console.error("Load JSON Error:", err); }
    };

    window.loadJsonFile = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => { jsonInput.value = e.target.result; window.loadJsonData(e.target.result); };
        reader.readAsText(file);
    };

    jsonInput.addEventListener('blur', () => { if(jsonInput.value.trim()) window.loadJsonData(jsonInput.value); });

    // =========================
    // 📤 BUILD & EXPORT
    // =========================
    window.prepareJson = function () {
        const data = { audioUrl: audioPlayer.src, timestamps: [] };
        [...tableBody.rows].forEach((r, i) => {
            const s = safeNum(r.cells[1].textContent);
            const e = safeNum(r.cells[2].textContent);
            data.timestamps.push({
                verse: i + 1, name: r.cells[4].textContent, start: s, end: e,
                duration: parseFloat((e - s).toFixed(2)),
                lyrics: r.cells[5].querySelector('textarea')?.value || ""
            });
        });
        jsonInput.value = JSON.stringify(data, null, 2);
    };

    function prepareGeetaJson() { jsonInput.value = JSON.stringify(currentGeetaData, null, 2); }

    window.saveData = function () {
        const blob = new Blob([jsonInput.value], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = isGeetaMode ? 'geeta_sync.json' : 'audio_sync.json';
        a.click();
    };

    window.copyJsonData = function () { navigator.clipboard.writeText(jsonInput.value); alert("Copied to clipboard!"); };

    // =========================
    // 🗑 DELETE & EDIT
    // =========================
    deleteButton?.addEventListener('click', () => {
        if (!tableBody.rows.length) return;
        tableBody.deleteRow(-1);
        activeVerseIndex--;
        startTime = tableBody.rows.length ? safeNum(tableBody.rows[tableBody.rows.length - 1].cells[2].textContent) : null;

        if (isGeetaMode) {
            currentGeetaData[activeVerseIndex].AudioStart = 0;
            currentGeetaData[activeVerseIndex].AudioEnd = 0;
            currentGeetaData[activeVerseIndex].ReadTimeInSeconds = 0;
            prepareGeetaJson(); 
        } else { prepareJson(); }
        updateProgress();
        saveHistory();
    });

    tableBody.addEventListener('blur', e => {
        const cell = e.target;
        if (cell.classList.contains('startTime') || cell.classList.contains('endTime')) {
            const row = cell.closest('tr');
            const s = safeNum(row.cells[1].textContent);
            const en = safeNum(row.cells[2].textContent);

            if (en < s) { alert("Invalid time"); return; }
            const dur = parseFloat((en - s).toFixed(2));
            row.cells[3].textContent = dur;
            
            const audioEl = row.querySelector('audio');
            const sourceEl = row.querySelector('source');
            if(audioEl && sourceEl) {
                const baseUrl = isGeetaMode ? (currentGeetaData[row.rowIndex - 1].AudioFileURL || audioPlayer.src) : audioPlayer.src;
                sourceEl.src = `${baseUrl}#t=${s},${en}`;
                audioEl.load();
            }

            if (isGeetaMode) {
                const idx = row.rowIndex - 1; 
                if(currentGeetaData[idx]) {
                    currentGeetaData[idx].AudioStart = s;
                    currentGeetaData[idx].AudioEnd = en;
                    currentGeetaData[idx].ReadTimeInSeconds = dur;
                }
                prepareGeetaJson(); 
            } else { prepareJson(); }
            updateProgress(); 
            saveHistory();
        }
    }, true);

    // =========================
    // INIT
    // =========================
    loadAutoSave();
});
