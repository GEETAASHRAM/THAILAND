document.addEventListener('DOMContentLoaded', () => {

    
    // JavaScript for the searchable select field
    const searchSelect = document.getElementById('searchSelect');
    // Store the original placeholder text
    var originalPlaceholder = searchSelect.getAttribute('placeholder');
    const optionsContainer = document.getElementById('optionsContainer');
    const options = optionsContainer.getElementsByTagName('div');
    const fileUrlInput = document.getElementById('fileUrlInput');

    searchSelect.addEventListener('input', function() {
        const filter = searchSelect.value.toLowerCase();
        let hasVisibleOptions = false;

        for (let i = 0; i < options.length; i++) {
            const text = options[i].textContent || options[i].innerText;
            if (text.toLowerCase().indexOf(filter) > -1) {
                options[i].style.display = "";
                hasVisibleOptions = true;
            } else {
                options[i].style.display = "none";
            }
        }

        if (hasVisibleOptions) {
            optionsContainer.classList.remove('hidden');
        } else {
            optionsContainer.classList.add('hidden');
        }
    });

    // Event listener to select the option and fill the input field
    optionsContainer.addEventListener('click', function(event) {
        const value = event.target.getAttribute('data-value');
        searchSelect.value = event.target.textContent.trim();
        if (value) {
            fileUrlInput.value = value;
            optionsContainer.classList.add('hidden');
        }
    });

    // Function to clear the input field
    function clearInput() {
        originalPlaceholder = searchSelect.value;
        searchSelect.value = '';
    }

    // Function to restore the original value
    function restoreOriginalValue() {
        if (searchSelect.value === '') {
            searchSelect.value = originalPlaceholder;
        }
    }

    // Event listener for input focus
    searchSelect.addEventListener('focus', clearInput);

    // Event listener for input blur (focus lost)
    searchSelect.addEventListener('blur', restoreOriginalValue);

    // Hide options when clicking outside
    document.addEventListener('click', function(event) {
        if (!event.target.closest('.select-container')) {
            optionsContainer.classList.add('hidden');
        }
    });

    const audioPlayer = document.getElementById('audioPlayer');
    const markButton = document.getElementById('markButton');
    const deleteButton = document.getElementById('deleteButton');
    const timestampsTable = document.getElementById('timestampsTable');
    const loadButton = document.getElementById('loadButton');
    const fileInput = document.getElementById('fileInput');
    const prefixInput = document.getElementById('prefixInput');
    const suffixInput = document.getElementById('suffixInput');
    const controlRow = document.querySelector('.control-row');
    const controlRowOffsetTop = controlRow.offsetTop;

    let startTime = null;
    let verseNumber = 1;
    
    window.addEventListener('scroll', () => {
        // console.log(`Y Scrll: ${window.scrollY}, Div Offset:${controlRowOffsetTop}`);
        if (window.scrollY > controlRowOffsetTop) {
            markButton.classList.add('floating');
            markButton.textContent = ''; // Clear text content when floating
            deleteButton.classList.add('floating');
            deleteButton.textContent = ''; // Clear text content when floating
        } else {
            markButton.classList.remove('floating');
            markButton.textContent = 'Mark Verse (Spacebar)'; // Restore button text when not floating
            deleteButton.classList.remove('floating');
            deleteButton.textContent = 'Delete Verse'; // Restore button text when not floating
        }
    });

    fileUrlInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            loadAudio();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            event.preventDefault();
            markTimestamp();
        }
    });

    markButton.addEventListener('click', () => {
        markTimestamp();
    });

    window.loadAudio = function() {
        const fileUrl = fileUrlInput.value;
        if (fileUrl) {
            audioPlayer.src = fileUrl;
        } else if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = function(e) {
                audioPlayer.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
        audioPlayer.load();
        loadButton.disabled = true;
        loadButton.textContent = 'Loading...';
        audioPlayer.addEventListener('loadeddata', () => {
            loadButton.disabled = false;
            loadButton.textContent = 'Load Audio';
        });
    };

    deleteButton.addEventListener('click', function() {

        const timestampsTable = document.getElementById('timestampsTable');
        const tbody = timestampsTable.querySelector('tbody');
        if (tbody.rows.length > 0) {
            // Remove the last row
            const lastRow = tbody.rows[tbody.rows.length - 1];
            tbody.removeChild(lastRow);

            // Reset startTime, endTime, and update verse number
            if (tbody.rows.length > 0) {
                const previousRow = tbody.rows[tbody.rows.length - 1];
                startTime = parseFloat(previousRow.cells[1].textContent); // Reset to the last row's end time
                verseNumber--;
                audioPlayer.currentTime = startTime;
            } else {
                startTime = null;
                verseNumber = 1;
                audioPlayer.currentTime = 0;
            }

            // Update JSON data
            prepareJson();
        } else {
            alert("No previous verse to delete!");
        }
    });

    const tableBody = document.querySelector('#timestampsTable tbody');
    
    // Track changes to the textarea's content
    tableBody.addEventListener('input', function(event) {
        if (event.target && event.target.classList.contains('lyricsInput')) {
            event.target.dataset.changed = true; // Mark as changed when user types
        }
    });
    // Attach the blur event to all textareas in the table
    tableBody.addEventListener('blur', function(event) {
        if (event.target && event.target.classList.contains('lyricsInput')) {
            // Call prepareJSON only if the text is changed or has content
            if (event.target.dataset.changed || event.target.value.length > 0) {
                console.log(event.target.value);
                prepareJson();
                delete event.target.dataset.changed; // Reset the changed status after saving
            }
        }
    }, true);  // Use the third argument `true` to capture the event during the capturing phase



    function markTimestamp() {
        if (startTime === null) {
            startTime = 0;//audioPlayer.currentTime;
        }
        const endTime = audioPlayer.currentTime;
        const duration = endTime - startTime; // Calculate duration in seconds
        const prefix = prefixInput.value;
        const suffix = suffixInput.value;
        const chunkName = `${prefix}${verseNumber}${suffix}`;
        const newRow = document.createElement('tr');
        newRow.innerHTML = `
            <td>${verseNumber}</td>
            <td>${startTime.toFixed(2)}</td>
            <td>${endTime.toFixed(2)}</td>
            <td>${duration.toFixed(2)}</td>
            <td>${chunkName}</td>
            <td><textarea class="lyricsInput" placeholder="Enter lyrics here"></textarea></td>
            <td>
                <audio controls ontimeupdate="checkTime(this, ${startTime.toFixed(2)}, ${endTime.toFixed(2)})">
                    <source src="${audioPlayer.src}#t=${startTime.toFixed(2)},${endTime.toFixed(2)}" type="audio/mpeg">
                    Your browser does not support the audio element.
                </audio>
            </td>
        `;
        timestampsTable.appendChild(newRow);
        startTime = endTime;
        verseNumber++;
        prepareJson();
    }

    window.prepareJson = function(){
        const data = {
            audioUrl: audioPlayer.src,
            prefix: prefixInput.value,
            suffix: suffixInput.value,
            timestamps: []
        };

        timestampsTable.querySelectorAll('tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 6) {
                const textarea = cells[5].querySelector('textarea');
                const chunkLyrics = textarea ? textarea.value : '';
                data.timestamps.push({
                    sequence: parseInt(cells[0].textContent),
                    startTime: parseFloat(cells[1].textContent),
                    endTime: parseFloat(cells[2].textContent),
                    duration: parseFloat(cells[3].textContent),
                    chunkName: cells[4].textContent,
                    chunkLyrics: chunkLyrics,
                    audioUrl: cells[6].querySelector('audio source').src
                });
            }
        });
        document.getElementById('jsonDataInput').value = JSON.stringify(data, null, 2);
        return data;
    }

    window.saveData = function() {
        const data = prepareJson();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    window.loadJsonFile = function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const data = JSON.parse(e.target.result);
                loadJsonData(data);
            };
            reader.readAsText(file);
        }
    };

    window.loadJsonData = function(data) {
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        fileUrlInput.value = data.audioUrl;
        fileInput.value = '';
        prefixInput.value = data.prefix;
        suffixInput.value = data.suffix;
        audioPlayer.src = data.audioUrl;
        audioPlayer.load();

        // Clear existing rows in the table body (tbody)
        const tbody = timestampsTable.querySelector('tbody');
        tbody.innerHTML = '';

        data.timestamps.forEach((timestamp, index) => {
            const newRow = document.createElement('tr');
            newRow.innerHTML = `
                <td>${timestamp.sequence}</td>
                <td>${timestamp.startTime.toFixed(2)}</td>
                <td>${timestamp.endTime.toFixed(2)}</td>
                <td>${timestamp.duration.toFixed(2)}</td>
                <td>${timestamp.chunkName}</td>
                <td><textarea class="lyricsInput" placeholder="Enter lyrics here">${timestamp.chunkLyrics}</textarea></td>
                <td>
                    <audio controls ontimeupdate="checkTime(this, ${timestamp.startTime.toFixed(2)}, ${timestamp.endTime.toFixed(2)})">
                        <source src="${audioPlayer.src}#t=${timestamp.startTime.toFixed(2)},${timestamp.endTime.toFixed(2)}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                </td>
            `;
            tbody.appendChild(newRow); // Append the new row to the tbody
            // timestampsTable.appendChild(newRow);
        });

        verseNumber = data.timestamps.length + 1;
        startTime = data.timestamps.length > 0 ? data.timestamps[data.timestamps.length - 1].endTime : null;
        audioPlayer.currentTime = startTime == null ? 0 : startTime;

        new DataTable('#timestampsTable'
                ,{
                    responsive: true,
                    buttons: ['copy', 'csv',  'excel', 'print'],
                    layout: {
                        top2Start: 'buttons'
                    },
                    fixedColumns: true,
                    "searching": true,
                    "ordering": true,
                    "info": true,
                    "lengthChange": true,
                    "lengthMenu": [[25, 50, 75, -1], [25, 50, 75, "All"]],
                    "striped": true,
                    "hover": true
                }
        );
    };

    document.getElementById('jsonDataInput').addEventListener('input', function() {
        const data = this.value;
        if (data.trim()) {
            loadJsonData(data);
        }
    });
});

window.copyJsonData = function() {
    const jsonDataInput = document.getElementById('jsonDataInput');
    jsonDataInput.select();
    document.execCommand('copy');
    alert('JSON data copied to clipboard!');
};

function checkTime(audio, startTime, endTime) {
    // console.log(audio, startTime, endTime);
    if (audio.currentTime > endTime) {
        audio.pause();
        audio.currentTime = startTime;
    }
}
