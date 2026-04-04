document.addEventListener('DOMContentLoaded', () => {

    console.log("🚀 App Initialized");

    try {

        // =========================
        // GLOBAL STATE
        // =========================
        let startTime = null;
        let verseNumber = 1;
        let isGeetaMode = false;

        let historyStack = [];
        let redoStack = [];

        window.currentGeetaData = null;

        // =========================
        // ELEMENT REFERENCES
        // =========================
        const audioPlayer = document.getElementById('audioPlayer');
        const tableBody = document.querySelector('#timestampsTable tbody');
        const jsonInput = document.getElementById('jsonDataInput');

        const markButton = document.getElementById('markButton');
        const deleteButton = document.getElementById('deleteButton');
        const undoButton = document.getElementById('undoButton');
        const redoButton = document.getElementById('redoButton');

        const fileUrlInput = document.getElementById('fileUrlInput');
        const fileInput = document.getElementById('fileInput');

        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');

        // =========================
        // 💾 AUTO SAVE
        // =========================
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
                    console.log("📂 Loaded auto-save");
                    loadJsonData(saved);
                }
            } catch (e) {
                console.warn("Load auto-save failed:", e);
            }
        }

        setInterval(autoSave, 5000);

        // =========================
        // 🔁 UNDO / REDO
        // =========================
        function saveHistory() {
            historyStack.push(jsonInput.value);
            if (historyStack.length > 50) historyStack.shift();
            redoStack = [];
        }

        function undo() {
            if (historyStack.length === 0) return;
            redoStack.push(jsonInput.value);
            jsonInput.value = historyStack.pop();
            loadJsonData(jsonInput.value);
            console.log("↩ Undo");
        }

        function redo() {
            if (redoStack.length === 0) return;
            historyStack.push(jsonInput.value);
            jsonInput.value = redoStack.pop();
            loadJsonData(jsonInput.value);
            console.log("↪ Redo");
        }

        undoButton.addEventListener('click', undo);
        redoButton.addEventListener('click', redo);

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') undo();
            if (e.ctrlKey && e.key === 'y') redo();
        });

        // =========================
        // 🎧 LOAD AUDIO
        // =========================
        window.loadAudio = function () {
            try {
                if (fileUrlInput.value) {
                    audioPlayer.src = fileUrlInput.value;
                } else if (fileInput.files.length > 0) {
                    const reader = new FileReader();
                    reader.onload = e => audioPlayer.src = e.target.result;
                    reader.readAsDataURL(fileInput.files[0]);
                } else {
                    alert("Provide audio source");
                    return;
                }
                audioPlayer.load();
                console.log("🎧 Audio loaded");
            } catch (err) {
                console.error("Audio load error:", err);
            }
        };

        // =========================
        // 🔥 AUTO HIGHLIGHT + SCROLL
        // =========================
        audioPlayer.addEventListener('timeupdate', () => {

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
        });

        // =========================
        // 📊 PROGRESS
        // =========================
        function updateProgress() {
            if (!isGeetaMode || !window.currentGeetaData) return;

            let total = window.currentGeetaData.length;
            let completed = window.currentGeetaData.filter(v => v.AudioEnd > 0).length;
            let percent = Math.round((completed / total) * 100);

            progressBar.style.width = percent + "%";
            progressText.innerText = `Progress: ${completed}/${total} (${percent}%)`;
        }

        // =========================
        // 🧠 MARK TIMESTAMP
        // =========================
        function markTimestamp() {

            const currentTime = audioPlayer.currentTime;

            if (isGeetaMode) {
                const row = tableBody.querySelectorAll('tr')[verseNumber - 1];
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
                <td>${verseNumber}</td>
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
        }

        markButton.addEventListener('click', markTimestamp);

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                markTimestamp();
            }
        });

        // =========================
        // 🗑 DELETE
        // =========================
        deleteButton.addEventListener('click', () => {

            const rows = tableBody.rows;

            if (rows.length === 0) {
                alert("No rows to delete");
                return;
            }

            tableBody.removeChild(rows[rows.length - 1]);

            verseNumber--;
            startTime = rows.length > 1
                ? parseFloat(rows[rows.length - 2].cells[2].textContent)
                : null;

            prepareJson();
            saveHistory();
        });

        // =========================
        // ✏ EDIT TIMES
        // =========================
        tableBody.addEventListener('blur', (event) => {

            const cell = event.target;

            if (cell.classList.contains('startTime') || cell.classList.contains('endTime')) {

                const row = cell.closest('tr');

                const start = parseFloat(row.children[1].textContent);
                const end = parseFloat(row.children[2].textContent);

                if (end < start) {
                    alert("Invalid time");
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

        }, true);

        // =========================
        // 📥 LOAD JSON
        // =========================
        window.loadJsonData = function (data) {

            if (typeof data === 'string') data = JSON.parse(data);

            if (Array.isArray(data) && data[0]?.Chapter) {
                loadGeetaJson(data);
                return;
            }

            isGeetaMode = false;
            tableBody.innerHTML = '';

            data.timestamps.forEach((t, i) => {

                const row = document.createElement('tr');

                row.innerHTML = `
                    <td>${i + 1}</td>
                    <td contenteditable="true" class="startTime">${t.start || t.startTime}</td>
                    <td contenteditable="true" class="endTime">${t.end || t.endTime}</td>
                    <td>${((t.end||t.endTime)-(t.start||t.startTime)).toFixed(2)}</td>
                    <td>${i + 1}</td>
                    <td><textarea>${t.chunkLyrics || ""}</textarea></td>
                    <td><audio controls><source src="${t.audioUrl || ''}"></audio></td>
                `;

                tableBody.appendChild(row);
            });

            verseNumber = data.timestamps.length + 1;
        };

        // =========================
        // 📖 LOAD GEETA JSON
        // =========================
        window.loadGeetaJson = function (data) {

            isGeetaMode = true;
            tableBody.innerHTML = '';

            let chapter = null;

            data.forEach(v => {

                if (chapter !== v.Chapter) {
                    chapter = v.Chapter;
                    tableBody.innerHTML += `<tr><td colspan="7"><b>Chapter ${chapter}</b></td></tr>`;
                }

                tableBody.innerHTML += `
                    <tr>
                        <td>${v.VerseNum}</td>
                        <td contenteditable="true" class="startTime">${v.AudioStart || 0}</td>
                        <td contenteditable="true" class="endTime">${v.AudioEnd || 0}</td>
                        <td>0</td>
                        <td>${v.VerseNum}</td>
                        <td>${v.OriginalText}</td>
                        <td><audio controls><source src="${v.AudioFileURL}"></audio></td>
                    </tr>
                `;
            });

            window.currentGeetaData = data;
            audioPlayer.src = data[0].AudioFileURL;

            updateProgress();
        };

        // =========================
        // 📤 JSON BUILD
        // =========================
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

        // =========================
        // 📂 INIT
        // =========================
        loadAutoSave();

    } catch (err) {
        console.error("🔥 Fatal Error:", err);
    }
});
