// =========================================================
// 🚀 AUDIO SYNC SCRIPT (SMART PROGRESS CALCULATION)
// =========================================================

document.addEventListener('DOMContentLoaded', () => {

    console.log("🚀 App Initialized");

    // =========================
    // 🧠 GLOBAL STATE
    // =========================
    let startTime = null;
    let verseNumber = 1;
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
    function safeNum(v) {
        return isNaN(parseFloat(v)) ? 0 : parseFloat(v);
    }

    function generateName(i, v = null) {
        if (v) return `${v.Topic || "Topic"}_C${v.Chapter}_V${v.VerseNum}`;
        return `${prefixInput?.value || ""}${i}${suffixInput?.value || ""}`;
    }

    function highlightHTML(element, term) {
        const text = element.textContent;
        if (!term) {
            element.innerHTML = text; 
            return;
        }
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedTerm})`, 'gi');
        element.innerHTML = text.replace(regex, `<mark style="background-color: yellow; color: black; border-radius: 2px;">$1</mark>`);
    }

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

        searchSelect.addEventListener('focus', () => {
            optionsContainer.classList.remove('hidden');
            [...options].forEach(o => o.style.display = "");
        });

        searchSelect.addEventListener('input', () => {
            const filter = searchSelect.value.toLowerCase();
            let visible = false;
            [...options].forEach(o => {
                if (o.textContent.toLowerCase().includes(filter)) {
                    o.style.display = ""; visible = true;
                } else o.style.display = "none";
            });
            optionsContainer.classList.toggle('hidden', !visible);
        });

        optionsContainer.onclick = (e) => {
            const val = e.target.getAttribute('data-value');
            if (val) {
                fileUrlInput.value = val;
                searchSelect.value = e.target.textContent;
                optionsContainer.classList.add('hidden');
                window.loadAudio();
            }
        };

        document.addEventListener('click', e => {
            if (!e.target.closest('.select-container')) optionsContainer.classList.add('hidden');
        });
    }

    // =========================
    // 🎧 LOAD AUDIO
    // =========================
    window.loadAudio = function () {
        try {
            if (!fileUrlInput.value && !fileInput?.files.length) {
                alert("Provide audio source"); return;
            }

            tableBody.innerHTML = '';
            verseNumber = 1; startTime = null; isGeetaMode = false; window.currentGeetaData = null;
            jsonInput.value = '';
            if(progressBar) progressBar.style.width = "0%";
            if(progressText) progressText.innerText = `Progress: 0/0 (0%)`;
            if (searchCountDisplay) searchCountDisplay.innerText = "";

            // Listen for audio metadata to update progress instantly when duration is known
            audioPlayer.onloadedmetadata = () => { updateProgress(); };

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
    function autoSave() {
        if (jsonInput.value) localStorage.setItem("geeta_progress", jsonInput.value);
    }
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
    // 🔥 HIGHLIGHT + SCROLL
    // =========================
    audioPlayer.addEventListener('timeupdate', () => {
        [...tableBody.rows].forEach(row => {
            const start = safeNum(row.cells[1]?.textContent);
            const end = safeNum(row.cells[2]?.textContent);
            if (!isNaN(start) && !isNaN(end) && audioPlayer.currentTime >= start && audioPlayer.currentTime <= end) {
                row.classList.add('active-row');
                row.scrollIntoView({ block: "center" }); 
            } else {
                row.classList.remove('active-row');
            }
        });
    });

    // =========================
    // 📊 SMART PROGRESS TRACKER
    // =========================
    function updateProgress() {
        if (isGeetaMode && window.currentGeetaData) {
            // MODE 1: Geeta Mode (Count by verses completed)
            const total = window.currentGeetaData.length;
            const done = window.currentGeetaData.filter(v => v.AudioEnd > 0).length;
            const p = Math.round((done / total) * 100) || 0;
            if(progressBar) progressBar.style.width = p + "%";
            if(progressText) progressText.innerText = `Progress: ${done}/${total} Verses (${p}%)`;
        
        } else {
            // MODE 2: Normal Chunk Mode (Calculate marked duration vs total audio duration)
            if (!audioPlayer || isNaN(audioPlayer.duration) || audioPlayer.duration === 0) return;

            let totalMarkedSeconds = 0;
            [...tableBody.rows].forEach(row => {
                totalMarkedSeconds += safeNum(row.cells[3].textContent);
            });

            const totalAudioSeconds = audioPlayer.duration;
            const p = Math.round((totalMarkedSeconds / totalAudioSeconds) * 100) || 0;

            const formatTime = (secs) => {
                const m = Math.floor(secs / 60).toString().padStart(2, '0');
                const s = Math.floor(secs % 60).toString().padStart(2, '0');
                return `${m}:${s}`;
            };

            if(progressBar) progressBar.style.width = Math.min(p, 100) + "%";
            if(progressText) progressText.innerText = `Progress: ${formatTime(totalMarkedSeconds)} / ${formatTime(totalAudioSeconds)} (${p}%)`;
        }
    }

    // =========================
    // 🧠 ROW MARKING LOGIC (GEETA BUTTONS)
    // =========================
    tableBody.addEventListener('click', e => {
        if (!isGeetaMode) return;

        const target = e.target;
        if (target.classList.contains('row-mark-start') || target.classList.contains('row-mark-end')) {
            const row = target.closest('tr');
            const idx = parseInt(target.getAttribute('data-index'));
            const t = audioPlayer.currentTime;

            if (target.classList.contains('row-mark-start')) {
                row.querySelector('.startTime').textContent = t.toFixed(2);
            } else {
                row.querySelector('.endTime').textContent = t.toFixed(2);
            }

            const s = safeNum(row.querySelector('.startTime').textContent);
            const en = safeNum(row.querySelector('.endTime').textContent);
            const dur = parseFloat((en - s).toFixed(2));
            
            if (en > 0 && en >= s) row.cells[3].textContent = dur;

            if (currentGeetaData[idx]) {
                currentGeetaData[idx].AudioStart = s;
                currentGeetaData[idx].AudioEnd = en;
                currentGeetaData[idx].ReadTimeInSeconds = dur > 0 ? dur : 0;
            }

            prepareGeetaJson();
            updateProgress();
            saveHistory();
            
            const originalBg = row.style.background;
            row.style.background = "#d4edda"; 
            setTimeout(() => row.style.background = originalBg, 400);
        }
    });

    // =========================
    // 🧠 SPACEBAR MARKING (NORMAL SEQUENTIAL)
    // =========================
    function mark() {
        const t = audioPlayer.currentTime;
        if (isGeetaMode) {
            const row = tableBody.rows[verseNumber - 1];
            if (!row) return;
            const s = row.querySelector('.startTime');
            const e = row.querySelector('.endTime');
            const durCell = row.cells[3]; 

            if (!s.textContent || s.textContent === "0" || s.textContent === "0.00") {
                s.textContent = t.toFixed(2);
            } else {
                e.textContent = t.toFixed(2);
                const startVal = safeNum(s.textContent);
                const duration = parseFloat((t - startVal).toFixed(2));
                durCell.textContent = duration;

                const v = currentGeetaData[verseNumber - 1];
                v.AudioStart = startVal;
                v.AudioEnd = parseFloat(t.toFixed(2));
                v.ReadTimeInSeconds = duration;
                verseNumber++;
            }
            prepareGeetaJson();
        } else {
            if (startTime === null) startTime = 0;
            const end = t;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${verseNumber}</td>
                <td contenteditable class="startTime">${startTime.toFixed(2)}</td>
                <td contenteditable class="endTime">${end.toFixed(2)}</td>
                <td>${(end - startTime).toFixed(2)}</td>
                <td class="name-cell">${generateName(verseNumber)}</td>
                <td><textarea class="lyricsInput"></textarea></td>
                <td><audio controls><source src="${audioPlayer.src}#t=${startTime},${end}"></audio></td>
            `;
            tableBody.appendChild(row);
            startTime = end;
            verseNumber++;
            prepareJson();
        }
        updateProgress(); // Triggers for both modes
        saveHistory();
    }

    document.getElementById('markButton')?.addEventListener('click', mark);
    document.addEventListener('keydown', e => {
        if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            e.preventDefault(); mark();
        }
        if (e.ctrlKey && e.key === 'z') undo();
        if (e.ctrlKey && e.key === 'y') redo();
    });

    // =========================
    // 🗑 DELETE
    // =========================
    deleteButton?.addEventListener('click', () => {
        if (!tableBody.rows.length) return;
        tableBody.deleteRow(-1);
        verseNumber--;
        startTime = tableBody.rows.length ? safeNum(tableBody.rows[tableBody.rows.length - 1].cells[2].textContent) : null;

        if (isGeetaMode) {
            currentGeetaData[verseNumber - 1].AudioStart = 0;
            currentGeetaData[verseNumber - 1].AudioEnd = 0;
            currentGeetaData[verseNumber - 1].ReadTimeInSeconds = 0;
            prepareGeetaJson(); 
        } else {
            prepareJson();
        }
        updateProgress(); // Triggers for both modes
        saveHistory();
    });

    // =========================
    // ✏ MANUAL EDIT HANDLER 
    // =========================
    tableBody.addEventListener('blur', e => {
        const cell = e.target;
        if (cell.classList.contains('startTime') || cell.classList.contains('endTime')) {
            const row = cell.closest('tr');
            const s = safeNum(row.cells[1].textContent);
            const en = safeNum(row.cells[2].textContent);

            if (en < s) { alert("Invalid time"); return; }
            const duration = parseFloat((en - s).toFixed(2));
            row.cells[3].textContent = duration;
            
            const audioEl = row.querySelector('audio');
            if(audioEl) {
                row.querySelector('source').src = `${audioPlayer.src}#t=${s},${en}`;
                audioEl.load();
            }

            if (isGeetaMode) {
                const idx = row.rowIndex - 1; 
                if(currentGeetaData[idx]) {
                    currentGeetaData[idx].AudioStart = s;
                    currentGeetaData[idx].AudioEnd = en;
                    currentGeetaData[idx].ReadTimeInSeconds = duration;
                }
                prepareGeetaJson(); 
            } else {
                prepareJson();
            }
            updateProgress(); // Triggers for both modes
            saveHistory();
        }
    }, true);

    // =========================
    // 📥 JSON LOAD 
    // =========================
    window.loadJsonData = function (data) {
        try {
            if (typeof data === 'string') data = JSON.parse(data);
            tableBody.innerHTML = '';
            verseNumber = 1; startTime = null;

            if (Array.isArray(data)) {
                isGeetaMode = true; currentGeetaData = data;
                let idx = 0;
                document.getElementById('loadingIndicator')?.classList.remove('hidden');

                function renderBatch() {
                    const frag = document.createDocumentFragment();
                    for (let i = 0; i < 50 && idx < data.length; i++, idx++) {
                        const v = data[idx];
                        const lyricsText = v.EnglishText ? `${v.OriginalText || ""}<br><br>${v.EnglishText}` : (v.OriginalText || "");

                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${v.VerseNum}</td>
                            <td contenteditable class="startTime">${v.AudioStart || 0}</td>
                            <td contenteditable class="endTime">${v.AudioEnd || 0}</td>
                            <td>${v.ReadTimeInSeconds || 0}</td>
                            <td class="name-cell">${generateName(v.VerseNum, v)}</td>
                            <td>
                                <div class="lyrics-text" style="max-height: 100px; overflow-y: auto; background: #f9f9f9; padding: 10px; border: 1px solid #ccc; border-radius: 8px;">
                                    ${lyricsText}
                                </div>
                            </td>
                            <td>
                                <div style="display:flex; gap:5px; margin-bottom:5px;">
                                    <button class="row-mark-start" data-index="${idx}" style="flex:1; background:#28a745; color:white; border:none; border-radius:4px; padding:6px; cursor:pointer; font-size:12px;">Start</button>
                                    <button class="row-mark-end" data-index="${idx}" style="flex:1; background:#dc3545; color:white; border:none; border-radius:4px; padding:6px; cursor:pointer; font-size:12px;">End</button>
                                </div>
                                <audio controls style="height:35px; width:100%;"><source src="${v.AudioFileURL || ""}"></audio>
                            </td>
                        `;
                        frag.appendChild(row);
                    }
                    tableBody.appendChild(frag);
                    if (idx < data.length) requestAnimationFrame(renderBatch);
                    else {
                        updateProgress();
                        document.getElementById('loadingIndicator')?.classList.add('hidden');
                    }
                }
                renderBatch();
                
                if (data[0]?.AudioFileURL) { audioPlayer.src = data[0].AudioFileURL; audioPlayer.load(); }
                prepareGeetaJson();

            } else {
                isGeetaMode = false;
                if(data.audioUrl) { audioPlayer.src = data.audioUrl; audioPlayer.load(); }
                
                data.timestamps?.forEach((t, i) => {
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
                verseNumber = (data.timestamps?.length || 0) + 1;
                prepareJson();
                updateProgress(); // Update for normal JSON load
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
    // 📤 JSON BUILD & EXPORT
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
    // 🚀 INIT
    // =========================
    loadAutoSave();
});
