document.addEventListener('DOMContentLoaded', () => {

    console.log("🚀 Geeta Audio Sync App Initialized");

    // =========================================================
    // 🧠 GLOBAL STATE
    // =========================================================
    let startTime = null;
    let verseNumber = 1;
    let isGeetaMode = false;

    let historyStack = [];
    let redoStack = [];

    window.currentGeetaData = null;

    // =========================================================
    // 📌 ELEMENT REFERENCES
    // =========================================================
    const audioPlayer = document.getElementById('audioPlayer');
    const tableBody = document.querySelector('#timestampsTable tbody');
    const jsonInput = document.getElementById('jsonDataInput');

    const markButton = document.getElementById('markButton');
    const deleteButton = document.getElementById('deleteButton');
    const undoButton = document.getElementById('undoButton');
    const redoButton = document.getElementById('redoButton');

    const fileUrlInput = document.getElementById('fileUrlInput');
    const fileInput = document.getElementById('fileInput');

    const searchSelect = document.getElementById('searchSelect');
    const optionsContainer = document.getElementById('optionsContainer');

    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    const prefixInput = document.getElementById('prefixInput');
    const suffixInput = document.getElementById('suffixInput');

    // =========================================================
    // 🔍 SEARCH DROPDOWN LOGIC
    // =========================================================
    try {

        const options = optionsContainer.getElementsByTagName('div');

        searchSelect.addEventListener('focus', () => {
            console.log("🔍 Search focus");
            optionsContainer.classList.remove('hidden');

            for (let i = 0; i < options.length; i++) {
                options[i].style.display = "";
            }
        });

        searchSelect.addEventListener('input', () => {

            const filter = searchSelect.value.toLowerCase();
            let visible = false;

            for (let i = 0; i < options.length; i++) {
                const text = options[i].textContent.toLowerCase();

                if (text.includes(filter)) {
                    options[i].style.display = "";
                    visible = true;
                } else {
                    options[i].style.display = "none";
                }
            }

            optionsContainer.classList.toggle('hidden', !visible);
        });

        optionsContainer.addEventListener('click', (event) => {

            const value = event.target.getAttribute('data-value');

            if (value) {
                searchSelect.value = event.target.textContent.trim();
                fileUrlInput.value = value;
                optionsContainer.classList.add('hidden');

                console.log("🎧 Selected audio:", value);
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.select-container')) {
                optionsContainer.classList.add('hidden');
            }
        });

    } catch (err) {
        console.error("Dropdown error:", err);
    }

    // =========================================================
    // 🎧 LOAD AUDIO
    // =========================================================
    window.loadAudio = function () {

        try {

            if (fileUrlInput.value) {
                audioPlayer.src = fileUrlInput.value;
            } else if (fileInput.files.length > 0) {

                const reader = new FileReader();

                reader.onload = (e) => {
                    audioPlayer.src = e.target.result;
                };

                reader.readAsDataURL(fileInput.files[0]);
            } else {
                alert("Please provide audio source");
                return;
            }

            audioPlayer.load();
            console.log("🎧 Audio Loaded:", audioPlayer.src);

        } catch (err) {
            console.error("Audio load error:", err);
        }
    };

    
    // =========================================================
    // 💾 SAVE DATA 
    // =========================================================
    window.saveData = function () {
    
        try {
    
            const blob = new Blob([jsonInput.value], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
    
            const a = document.createElement('a');
            a.href = url;
            a.download = 'geeta_audio_sync.json';
            a.click();
    
            URL.revokeObjectURL(url);
    
            console.log("💾 JSON downloaded");
    
        } catch (err) {
            console.error("Save error:", err);
        }
    };
    
    // =========================================================
    // 💾 AUTO SAVE (LOCAL STORAGE)
    // =========================================================
    function autoSave() {
        try {
            localStorage.setItem("geeta_progress", jsonInput.value);
            console.log("💾 Auto-saved");
        } catch (e) {
            console.warn("Auto-save failed:", e);
        }
    }

    function loadAutoSave() {
        try {
            const saved = localStorage.getItem("geeta_progress");
            if (saved) {
                console.log("📂 Restoring auto-save");
                loadJsonData(saved);
            }
        } catch (e) {
            console.warn("Load auto-save failed:", e);
        }
    }

    setInterval(autoSave, 5000);
    
    // =========================================================
    // 📋COPY
    // =========================================================
    window.copyJsonData = function () {
        try {
            navigator.clipboard.writeText(jsonInput.value);
            console.log("📋 JSON copied");
            alert("Copied to clipboard!");
        } catch (err) {
            console.error("Copy failed:", err);
        }
    };
    
    // =========================================================
    // 🔁 UNDO / REDO SYSTEM
    // =========================================================
    function saveHistory() {
        historyStack.push(jsonInput.value);

        if (historyStack.length > 100) {
            historyStack.shift();
        }

        redoStack = [];
    }

    function undo() {
        try {
            if (!historyStack.length) return;

            redoStack.push(jsonInput.value);
            jsonInput.value = historyStack.pop();

            loadJsonData(jsonInput.value);

            console.log("↩ Undo");
        } catch (err) {
            console.error("Undo error:", err);
        }
    }

    function redo() {
        try {
            if (!redoStack.length) return;

            historyStack.push(jsonInput.value);
            jsonInput.value = redoStack.pop();

            loadJsonData(jsonInput.value);

            console.log("↪ Redo");
        } catch (err) {
            console.error("Redo error:", err);
        }
    }

    undoButton?.addEventListener('click', undo);
    redoButton?.addEventListener('click', redo);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'z') undo();
        if (e.ctrlKey && e.key === 'y') redo();
    });

    // =========================================================
    // 🔥 AUTO HIGHLIGHT + SCROLL
    // =========================================================
    audioPlayer.addEventListener('timeupdate', () => {

        try {

            const rows = tableBody.querySelectorAll('tr');

            rows.forEach(row => {

                const cells = row.querySelectorAll('td');
                if (cells.length < 3) return;

                const start = parseFloat(cells[1]?.textContent);
                const end = parseFloat(cells[2]?.textContent);

                if (!isNaN(start) && !isNaN(end)) {

                    if (audioPlayer.currentTime >= start && audioPlayer.currentTime <= end) {
                        row.style.background = "#ffeaa7";
                        row.scrollIntoView({ behavior: "smooth", block: "center" });
                    } else {
                        row.style.background = "";
                    }
                }
            });

        } catch (err) {
            console.error("Highlight error:", err);
        }
    });

    // =========================================================
    // 📊 PROGRESS TRACKING
    // =========================================================
    function updateProgress() {

        if (!isGeetaMode || !window.currentGeetaData) return;

        try {

            const total = window.currentGeetaData.length;
            const completed = window.currentGeetaData.filter(v => v.AudioEnd > 0).length;

            const percent = Math.round((completed / total) * 100);

            progressBar.style.width = percent + "%";
            progressText.innerText = `Progress: ${completed}/${total} (${percent}%)`;

        } catch (err) {
            console.error("Progress error:", err);
        }
    }

    // =========================================================
    // 🧠 MARK TIMESTAMP
    // =========================================================
    function markTimestamp() {

        try {

            const currentTime = audioPlayer.currentTime;

            if (isGeetaMode) {

                const rows = tableBody.querySelectorAll('tr');
                const row = rows[verseNumber - 1];

                if (!row) return;

                const startCell = row.querySelector('.startTime');
                const endCell = row.querySelector('.endTime');

                if (!startCell.textContent || startCell.textContent === "0") {
                    startCell.textContent = currentTime.toFixed(2);
                } else {
                    endCell.textContent = currentTime.toFixed(2);
                    verseNumber++;
                }

                prepareGeetaJson();
                updateProgress();
                saveHistory();

                return;
            }

            if (startTime === null) startTime = 0;

            const endTime = currentTime;
            const duration = endTime - startTime;

            const row = document.createElement('tr');

            row.innerHTML = `
                <td>${prefixInput.value || ""}${verseNumber}${suffixInput.value || ""}</td>
                <td contenteditable="true" class="startTime">${startTime.toFixed(2)}</td>
                <td contenteditable="true" class="endTime">${endTime.toFixed(2)}</td>
                <td>${duration.toFixed(2)}</td>
                <td>${verseNumber}</td>
                <td><textarea></textarea></td>
                <td><audio controls><source src="${audioPlayer.src}#t=${startTime},${endTime}"></audio></td>
            `;

            tableBody.appendChild(row);

            startTime = endTime;
            verseNumber++;

            prepareJson();
            saveHistory();

        } catch (err) {
            console.error("Mark error:", err);
        }
    }

    markButton.addEventListener('click', markTimestamp);
    
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            e.preventDefault();
            markTimestamp();
        }
    });

    // =========================================================
    // 🗑 DELETE LAST ROW
    // =========================================================
    deleteButton.addEventListener('click', () => {

        try {

            const rows = tableBody.rows;

            if (!rows.length) {
                alert("No rows to delete");
                return;
            }

            tableBody.removeChild(rows[rows.length - 1]);

            verseNumber--;

            if (rows.length > 1) {
                startTime = parseFloat(rows[rows.length - 2].cells[2].textContent);
            } else {
                startTime = null;
            }

            if (isGeetaMode) {
                prepareGeetaJson();
                updateProgress();
            } else {
                prepareJson();
            }

            saveHistory();

        } catch (err) {
            console.error("Delete error:", err);
        }
    });

    // =========================================================
    // ✏ EDIT TIMESTAMP CELLS
    // =========================================================
    tableBody.addEventListener('blur', (event) => {

        try {

            const cell = event.target;

            if (cell.classList.contains('startTime') || cell.classList.contains('endTime')) {

                const row = cell.closest('tr');

                const start = parseFloat(row.children[1].textContent);
                const end = parseFloat(row.children[2].textContent);

                if (end < start) {
                    alert("Invalid time range");
                    return;
                }

                row.children[3].textContent = (end - start).toFixed(2);

                const source = row.querySelector('source');
                source.src = `${audioPlayer.src}#t=${start},${end}`;

                row.querySelector('audio').load();

                if (isGeetaMode) {
                    prepareGeetaJson();
                    updateProgress();
                } else {
                    prepareJson();
                }

                saveHistory();
            }

        } catch (err) {
            console.error("Edit error:", err);
        }

    }, true);

    // =====================================
    // 📥 AUTO LOAD ON PASTE + BLUR/ENTER
    // =====================================
    jsonInput.addEventListener('blur', () => {
    
        try {
    
            const value = jsonInput.value.trim();
    
            if (!value) return;
    
            console.log("📥 Attempting to load pasted JSON");
    
            loadJsonData(value);
    
        } catch (err) {
            console.warn("Invalid pasted JSON");
        }
    });
    jsonInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' || (e.ctrlKey && e.key === 'Enter')) {
            loadJsonData(jsonInput.value);
        }
    });
    
    // =========================================================
    // 📥 LOAD JSON DATA (DUAL FORMAT)
    // =========================================================
           
    window.loadJsonData = function (data) {

        try {

            if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            if (Array.isArray(data) && data[0]?.Chapter !== undefined) {
                loadGeetaJson(data);
                return;
            }

            if (!data.timestamps) throw new Error("Invalid JSON");

            isGeetaMode = false;
            tableBody.innerHTML = '';

            data.timestamps.forEach((t, i) => {

                const start = t.start ?? t.startTime ?? 0;
                const end = t.end ?? t.endTime ?? 0;

                const row = document.createElement('tr');

                row.innerHTML = `
                    <td>${i + 1}</td>
                    <td contenteditable="true" class="startTime">${start}</td>
                    <td contenteditable="true" class="endTime">${end}</td>
                    <td>${(end - start).toFixed(2)}</td>
                    <td>${prefixInput.value || ""}${i + 1}${suffixInput.value || ""}</td>
                    <td><textarea>${t.chunkLyrics || ""}</textarea></td>
                    <td><audio controls><source src="${audioPlayer.src}#t=${start},${end}"></audio></td>
                `;

                tableBody.appendChild(row);
            });

            verseNumber = data.timestamps.length + 1;

        } catch (err) {
            console.error("JSON load error:", err);
            alert("Invalid JSON format");
        }
    };

    //from file
    window.loadJsonFile = function (event) {
        try {
            const file = event.target.files[0];
            if (!file) return;
    
            const reader = new FileReader();
    
            reader.onload = (e) => {
                const content = e.target.result;
                jsonInput.value = content;
                loadJsonData(content);
            };
    
            reader.readAsText(file);
    
            console.log("📂 JSON file loaded");
    
        } catch (err) {
            console.error("File load error:", err);
        }
    };
            
    // =========================================================
    // 📖 LOAD GEETA JSON
    // =========================================================
    function loadGeetaJson(data) {
    
        isGeetaMode = true;
        tableBody.innerHTML = '';
        window.currentGeetaData = data;
    
        let index = 0;
        const batchSize = 50;
    
        function renderBatch() {
    
            const fragment = document.createDocumentFragment();
    
            for (let i = 0; i < batchSize && index < data.length; i++, index++) {
    
                const v = data[index];
    
                const row = document.createElement('tr');
    
                const audioUrl = v.AudioFileURL || audioPlayer.src || "";
    
                row.innerHTML = `
                    <td>${v.VerseNum}</td>
                    <td contenteditable class="startTime">${v.AudioStart || 0}</td>
                    <td contenteditable class="endTime">${v.AudioEnd || 0}</td>
                    <td>0</td>
                    <td>${prefixInput.value || ""}${v.VerseNum}${suffixInput.value || ""}</td>
                    <td>${v.OriginalText}</td>
                    <td><audio controls><source src="${audioUrl}"></audio></td>
                `;
    
                fragment.appendChild(row);
            }
    
            tableBody.appendChild(fragment);
    
            if (index < data.length) {
                requestAnimationFrame(renderBatch);
            } else {
                console.log("✅ Large JSON rendered safely");
                updateProgress(); 
            }
        }
    
        renderBatch();
    
        audioPlayer.src = data[0]?.AudioFileURL || "";
    }

    // =========================================================
    // 📤 BUILD JSON
    // =========================================================
    window.prepareJson = function () {

        const rows = tableBody.querySelectorAll('tr');
        const data = { timestamps: [] };

        rows.forEach(row => {

            const cells = row.querySelectorAll('td');
            if (cells.length < 3) return;

            data.timestamps.push({
                start: parseFloat(cells[1].textContent),
                end: parseFloat(cells[2].textContent)
            });
        });

        jsonInput.value = JSON.stringify(data, null, 2);
    };

    function prepareGeetaJson() {

        let index = 0;

        tableBody.querySelectorAll('tr').forEach(row => {

            const cells = row.querySelectorAll('td');
            if (cells.length < 3) return;

            window.currentGeetaData[index].AudioStart = parseFloat(cells[1].textContent) || 0;
            window.currentGeetaData[index].AudioEnd = parseFloat(cells[2].textContent) || 0;

            index++;
        });

        jsonInput.value = JSON.stringify(window.currentGeetaData, null, 2);
    }

    // =========================================================
    // 🚀 INIT
    // =========================================================
    loadAutoSave();

});
