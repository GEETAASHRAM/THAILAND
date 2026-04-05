// =========================================================
// 🚀 AUDIO SYNC SCRIPT 
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

    // =========================
    // 🧩 UTIL
    // =========================
    function safeNum(v) {
        return isNaN(parseFloat(v)) ? 0 : parseFloat(v);
    }

    function generateName(i, v = null) {
        if (v) return `${v.Topic || "BG"}_C${v.Chapter}_V${v.VerseNum}`;
        return `${prefixInput?.value || ""}${i}${suffixInput?.value || ""}`;
    }

    // =========================
    // 🔍 TABLE SEARCH (NEW)
    // =========================
    tableSearch?.addEventListener('input', function () {
        const f = this.value.toLowerCase();
        [...tableBody.rows].forEach(r => {
            r.style.display = r.innerText.toLowerCase().includes(f) ? "" : "none";
        });
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
                    o.style.display = "";
                    visible = true;
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
            if (!e.target.closest('.select-container')) {
                optionsContainer.classList.add('hidden');
            }
        });
    }

    // =========================
    // 🎧 LOAD AUDIO
    // =========================
    window.loadAudio = function () {
        try {
            if (fileUrlInput.value) {
                audioPlayer.src = fileUrlInput.value;
            } else if (fileInput?.files.length) {
                const reader = new FileReader();
                reader.onload = e => { audioPlayer.src = e.target.result; audioPlayer.load(); };
                reader.readAsDataURL(fileInput.files[0]);
                return;
            } else {
                alert("Provide audio source");
                return;
            }
            audioPlayer.load();
        } catch (e) {
            console.error(e);
        }
    };

    // =========================
    // 💾 AUTO SAVE
    // =========================
    function autoSave() {
        if (jsonInput.value) localStorage.setItem("geeta_progress", jsonInput.value);
    }

    function loadAutoSave() {
        const saved = localStorage.getItem("geeta_progress");
        if (saved) window.loadJsonData(saved);
    }

    setInterval(autoSave, 5000);

    // =========================
    // 🔁 UNDO / REDO
    // =========================
    function saveHistory() {
        historyStack.push(jsonInput.value);
        if (historyStack.length > 100) historyStack.shift(); // Prevent memory growth
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

            // Fixed edge case where start = 0
            if (!isNaN(start) && !isNaN(end) && audioPlayer.currentTime >= start && audioPlayer.currentTime <= end) {
                row.classList.add('active-row'); 
                row.scrollIntoView({ block: "center" });
            } else {
                row.classList.remove('active-row');
            }
        });
    });

    // =========================
    // 📊 PROGRESS
    // =========================
    function updateProgress() {
        if (!isGeetaMode || !window.currentGeetaData) return;

        const total = window.currentGeetaData.length;
        const done = window.currentGeetaData.filter(v => v.AudioEnd > 0).length;
        const p = Math.round((done / total) * 100) || 0;

        if(progressBar) progressBar.style.width = p + "%";
        if(progressText) progressText.innerText = `Progress: ${done}/${total} (${p}%)`;
    }

    // =========================
    // 🧠 MARK TIMESTAMP
    // =========================
    function mark() {
        const t = audioPlayer.currentTime;

        if (isGeetaMode) {
            const row = tableBody.rows[verseNumber - 1];
            if (!row) return;

            const s = row.querySelector('.startTime');
            const e = row.querySelector('.endTime');

            if (!s.textContent || s.textContent === "0" || s.textContent === "0.00") {
                s.textContent = t.toFixed(2);
            } else {
                e.textContent = t.toFixed(2);

                const v = currentGeetaData[verseNumber - 1];
                v.AudioStart = safeNum(s.textContent);
                v.AudioEnd = t;
                v.ReadTimeInSeconds = t - v.AudioStart;

                verseNumber++;
            }
            updateProgress();
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
                <td>${generateName(verseNumber)}</td>
                <td><textarea class="lyricsInput"></textarea></td>
                <td><audio controls><source src="${audioPlayer.src}#t=${startTime},${end}"></audio></td>
            `;

            tableBody.appendChild(row);
            startTime = end;
            verseNumber++;
            prepareJson();
        }
        saveHistory();
    }

    document.getElementById('markButton')?.addEventListener('click', mark);

    document.addEventListener('keydown', e => {
        // Prevent spacebar from firing if user is typing in a text field
        if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            e.preventDefault();
            mark();
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

        startTime = tableBody.rows.length
            ? safeNum(tableBody.rows[tableBody.rows.length - 1].cells[2].textContent)
            : null;

        if (isGeetaMode) {
            currentGeetaData[verseNumber - 1].AudioStart = 0;
            currentGeetaData[verseNumber - 1].AudioEnd = 0;
            prepareGeetaJson();
            updateProgress();
        } else {
            prepareJson();
        }
        saveHistory();
    });

    // =========================
    // ✏ EDIT HANDLER
    // =========================
    tableBody.addEventListener('blur', e => {
        const cell = e.target;

        if (cell.classList.contains('startTime') || cell.classList.contains('endTime')) {
            const row = cell.closest('tr');
            const s = safeNum(row.cells[1].textContent);
            const en = safeNum(row.cells[2].textContent);

            if (en < s) {
                alert("Invalid time");
                return;
            }

            row.cells[3].textContent = (en - s).toFixed(2);
            
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
                    currentGeetaData[idx].ReadTimeInSeconds = en - s;
                }
                prepareGeetaJson();
                updateProgress();
            } else {
                prepareJson();
            }
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
            verseNumber = 1;
            startTime = null;

            if (Array.isArray(data)) {
                isGeetaMode = true;
                currentGeetaData = data;
                
                let idx = 0;
                document.getElementById('loadingIndicator')?.classList.remove('hidden');

                // Render in batches to prevent UI freezing with large Geeta files
                function renderBatch() {
                    const frag = document.createDocumentFragment();
                    for (let i = 0; i < 50 && idx < data.length; i++, idx++) {
                        const v = data[idx];
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${v.VerseNum}</td>
                            <td contenteditable class="startTime">${v.AudioStart || 0}</td>
                            <td contenteditable class="endTime">${v.AudioEnd || 0}</td>
                            <td>${v.ReadTimeInSeconds || 0}</td>
                            <td>${generateName(v.VerseNum, v)}</td>
                            <td>${v.OriginalText || ""}</td>
                            <td><audio controls><source src="${v.AudioFileURL || ""}"></audio></td>
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
                if(data.audioUrl) {
                    audioPlayer.src = data.audioUrl;
                    audioPlayer.load();
                }
                
                data.timestamps?.forEach((t, i) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${i + 1}</td>
                        <td contenteditable class="startTime">${t.start}</td>
                        <td contenteditable class="endTime">${t.end}</td>
                        <td>${(t.end - t.start).toFixed(2)}</td>
                        <td>${t.name || generateName(i + 1)}</td>
                        <td><textarea class="lyricsInput">${t.lyrics || ""}</textarea></td>
                        <td><audio controls><source src="${data.audioUrl}#t=${t.start},${t.end}"></audio></td>
                    `;
                    tableBody.appendChild(row);
                });
                verseNumber = (data.timestamps?.length || 0) + 1;
                prepareJson();
            }
        } catch (err) {
            console.error("Load JSON Error:", err);
        }
    };

    // Load from local file input
    window.loadJsonFile = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            jsonInput.value = e.target.result;
            window.loadJsonData(e.target.result);
        };
        reader.readAsText(file);
    };

    // Paste handler
    jsonInput.addEventListener('blur', () => {
        if(jsonInput.value.trim()) window.loadJsonData(jsonInput.value);
    });

    // =========================
    // 📤 JSON BUILD
    // =========================
    window.prepareJson = function () {
        const data = {
            audioUrl: audioPlayer.src,
            timestamps: []
        };

        [...tableBody.rows].forEach((r, i) => {
            const s = safeNum(r.cells[1].textContent);
            const e = safeNum(r.cells[2].textContent);

            data.timestamps.push({
                verse: i + 1,
                name: r.cells[4].textContent,
                start: s,
                end: e,
                duration: e - s,
                lyrics: r.cells[5].querySelector('textarea')?.value || ""
            });
        });

        jsonInput.value = JSON.stringify(data, null, 2);
    };

    function prepareGeetaJson() {
        jsonInput.value = JSON.stringify(currentGeetaData, null, 2);
    }

    // =========================
    // 💾 EXPORT GLOBALS
    // =========================
    window.saveData = function () {
        const blob = new Blob([jsonInput.value], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = isGeetaMode ? 'geeta_sync.json' : 'audio_sync.json';
        a.click();
    };

    window.copyJsonData = function () {
        navigator.clipboard.writeText(jsonInput.value);
        alert("Copied to clipboard!");
    };

    // =========================
    // 🚀 INIT
    // =========================
    loadAutoSave();

});
