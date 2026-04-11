// =========================================================
// 🚀 GITA APP ENGINE (PWA + SUBSCRIPTIONS + KARAOKE)
// =========================================================

const container = document.getElementById('container');
let globalGeetaData = [];
let currentChapterAudio = null;

// ==========================================
// 1. SYSTEM INITIALIZATION & DATA LOADING
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("🚀 Initializing Main Gita Application...");
        
        // Fetch Master JSON
        const response = await fetch('data/geeta_complete.json');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        
        globalGeetaData = await response.json();
        
        // Populate Chapter Dropdown
        const chapters = Array.from(new Set(globalGeetaData.map(item => item.Chapter)));
        chapters.sort((a, b) => parseInt(a) - parseInt(b));

        const chapterSelect = document.getElementById('chapterSelect');
        if (chapterSelect) {
            chapters.forEach(chapter => {
                const option = document.createElement('option');
                option.value = chapter;
                option.textContent = `Chapter ${chapter}`;
                chapterSelect.appendChild(option);
            });
            chapterSelect.addEventListener('change', loadChapter);
        }

        // Inject UI Modals for advanced features
        injectSubscriptionModal();
        injectKaraokeModal();

        // 🧠 ROUTER: Check if user arrived via a Subscription Link
        const isSubscriptionLink = handleSubscriptionRouting();
        
        // Only load default chapter 1 if we didn't just route to a specific subscription verse
        if (!isSubscriptionLink) {
            loadChapter();
        }

    } catch (error) {
        console.error('Error during app initialization:', error);
        alert("Failed to load Gita data. Please check your internet connection.");
    }
});

// ==========================================
// 2. CORE READING UI (CHAPTERS & SEARCH)
// ==========================================

// Clear Results logic
document.getElementById('clearButton')?.addEventListener('click', () => {
    try {
        document.getElementById('container').innerHTML = '';
        document.getElementById('searchResults').innerHTML = '';
        if (currentChapterAudio) currentChapterAudio.pause();
    } catch (e) { console.error(e); }
});

function loadChapter() {
    try {
        const chapterSelect = document.getElementById('chapterSelect');
        if (!chapterSelect) return;
        const selectedChapter = chapterSelect.value;

        // Filter global data for this chapter
        const chapterData = globalGeetaData.filter(item => item.Chapter.toString() === selectedChapter.toString());

        const container = document.getElementById('container');
        container.style.display = 'block'; 
        document.getElementById('searchResults').innerHTML = ''; 
        container.innerHTML = ''; 
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        
        // --- CHAPTER AUDIO PLAYER ---
        if (chapterData.length > 0 && chapterData[0].AudioFileURL) {
            const audioContainer = document.createElement('div');
            audioContainer.className = 'text-center mb-4 p-3 bg-light rounded shadow-sm';
            
            const audioLabel = document.createElement('h5');
            audioLabel.textContent = `🔊 Play Chapter ${selectedChapter} Audio`;
            
            currentChapterAudio = document.createElement('audio');
            currentChapterAudio.id = 'mainChapterAudio';
            currentChapterAudio.controls = true;
            currentChapterAudio.src = chapterData[0].AudioFileURL;
            currentChapterAudio.style.width = '100%';
            
            audioContainer.appendChild(audioLabel);
            audioContainer.appendChild(currentChapterAudio);
            container.appendChild(audioContainer);
        }

        // --- VERSE RENDERING ---
        chapterData.forEach((verse) => {
            const verseElement = document.createElement('div');
            verseElement.classList.add('verse', 'position-relative'); 

            const hasAudio = verse.AudioStart && verse.AudioEnd && verse.AudioEnd > verse.AudioStart;

            // Verse Play Icon
            const playBtn = document.createElement('button');
            playBtn.innerHTML = hasAudio ? '🎤 Play Verse' : '▶️ Play Chapter Here';
            playBtn.classList.add('btn', 'btn-sm', hasAudio ? 'btn-success' : 'btn-secondary');
            playBtn.style.position = 'absolute';
            playBtn.style.top = '10px';
            playBtn.style.right = '10px';
            
            // Find absolute index for Karaoke
            const absoluteIndex = globalGeetaData.findIndex(v => v.Chapter === verse.Chapter && v.VerseNum === verse.VerseNum);
            playBtn.onclick = () => openKaraoke(absoluteIndex, 'chapter'); 
            
            verseElement.appendChild(playBtn);

            // Sanskrit Lines
            const sanskritLinesElement = document.createElement('div');
            sanskritLinesElement.classList.add('sanskrit-lines', 'font-weight-bold', 'text-danger');
            sanskritLinesElement.innerHTML = verse.OriginalText ? verse.OriginalText.replace(/\n/g, '<br>') : '';
            verseElement.appendChild(sanskritLinesElement);
            
            // English Lines
            const engLinesElement = document.createElement('div');
            engLinesElement.classList.add('english-lines', 'font-italic');
            engLinesElement.innerHTML = verse.EnglishText ? verse.EnglishText.replace(/\n/g, '<br>') : '';
            verseElement.appendChild(engLinesElement);
            
            verseElement.appendChild(document.createElement('hr'));
            
            // Hindi Description 
            const hindiDescriptionElement = document.createElement('div');
            hindiDescriptionElement.classList.add('hindi-description');
            hindiDescriptionElement.innerHTML = verse.OriginalMeaning ? verse.OriginalMeaning.replace(/\n/g, '<br>') : '';
            verseElement.appendChild(hindiDescriptionElement);
            
            // English Description 
            const engDescriptionElement = document.createElement('div');
            engDescriptionElement.classList.add('english-description', 'text-muted');
            engDescriptionElement.innerHTML = verse.EnglishMeaning ? verse.EnglishMeaning.replace(/\n/g, '<br>') : '';
            verseElement.appendChild(engDescriptionElement);

            container.appendChild(verseElement);
        });
    } catch (error) {
        console.error("Error rendering chapter:", error);
    }
}

// Search Logic
document.getElementById('searchButton')?.addEventListener('click', searchWord);
document.getElementById('searchInput')?.addEventListener('keyup', function (event) {
    if (event.key === 'Enter') searchWord();
});

async function searchWord() {
    try {
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput.value.toLowerCase();
        const searchResults = document.getElementById('searchResults');

        searchResults.innerHTML = '';
        document.getElementById('container').innerHTML = '';
        if (currentChapterAudio) currentChapterAudio.pause();

        let totalMatches = 0;
        let totalVerses = 0;

        globalGeetaData.forEach(item => {
            let verseHasMatch = false;
            for (const key in item) {
                if (item[key] && typeof item[key] === 'string') {
                    const value = item[key].toLowerCase();
                    if (value.includes(searchTerm)) {
                        totalMatches++;
                        verseHasMatch = true;
                    }
                }
            }

            if (verseHasMatch) {
                totalVerses++;
                const resultElement = document.createElement('div');
                resultElement.classList.add('verse');

                const highlightMatch = (text) => text ? text.replace(new RegExp(`(${searchTerm})`, 'gi'), '<span class="highlight">$1</span>').replace(/\n/g, '<br>') : '';

                const sanLines = document.createElement('p');
                sanLines.innerHTML = highlightMatch(item.OriginalText);
                resultElement.appendChild(sanLines);

                const engLines = document.createElement('p');
                engLines.innerHTML = highlightMatch(item.EnglishText);
                resultElement.appendChild(engLines);

                resultElement.appendChild(document.createElement('hr'));

                const hinDesc = document.createElement('p');
                hinDesc.innerHTML = highlightMatch(item.OriginalMeaning);
                resultElement.appendChild(hinDesc);

                const engDesc = document.createElement('p');
                engDesc.innerHTML = highlightMatch(item.EnglishMeaning);
                resultElement.appendChild(engDesc);

                searchResults.appendChild(resultElement);
            }
        });

        const totalsElement = document.createElement('div');
        totalsElement.classList.add('search-totals', 'alert', 'alert-info');
        totalsElement.innerHTML = `<strong>Total matches:</strong> ${totalMatches} <br> <strong>Total verses:</strong> ${totalVerses}`;
        searchResults.insertBefore(totalsElement, searchResults.firstChild);

        if (searchResults.innerHTML === '') {
            searchResults.innerHTML = '<p class="text-center text-danger">No results found.</p>';
        }
    } catch (error) {
        console.error('Error during search:', error);
    }
}

// ==========================================
// 3. SUBSCRIPTION MODAL & ROUTING LOGIC
// ==========================================
function injectSubscriptionModal() {
    try {
        const modalHTML = `
        <div id="subModal" class="karaoke-modal" style="z-index: 105000;">
            <div class="karaoke-content bg-light text-dark p-4 rounded text-left" style="max-width:500px;">
                <h3 class="text-primary mb-3">📅 Setup Daily Reading</h3>
                
                <div class="form-group">
                    <label>Subscribe to:</label>
                    <select id="subType" class="form-control">
                        <option value="chapter">One Chapter at a time</option>
                        <option value="verse">One Verse at a time</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Starting Point:</label>
                    <select id="subStart" class="form-control"></select>
                </div>

                <div class="form-group">
                    <label>Frequency:</label>
                    <select id="subFreq" class="form-control">
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Start Date:</label>
                    <input type="date" id="subDate" class="form-control">
                </div>

                <button id="btnGenerateSub" class="btn btn-success btn-block mt-4">Download Calendar Invite</button>
                <button id="btnCloseSub" class="btn btn-secondary btn-block mt-2">Cancel</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const subModal = document.getElementById('subModal');
        const subType = document.getElementById('subType');
        const subStart = document.getElementById('subStart');
        
        // Default date to tomorrow
        const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
        document.getElementById('subDate').value = tmrw.toISOString().split('T')[0];

        document.getElementById('btnOpenSubModal')?.addEventListener('click', () => {
            populateSubStartOptions('chapter');
            subModal.classList.add('active');
        });
        
        document.getElementById('btnCloseSub')?.addEventListener('click', () => subModal.classList.remove('active'));

        subType?.addEventListener('change', () => populateSubStartOptions(subType.value));

        function populateSubStartOptions(type) {
            subStart.innerHTML = '';
            if (type === 'chapter') {
                const chapters = Array.from(new Set(globalGeetaData.map(i => i.Chapter)));
                chapters.forEach(ch => subStart.innerHTML += `<option value="${ch}">Chapter ${ch}</option>`);
            } else {
                globalGeetaData.forEach((v, idx) => {
                    subStart.innerHTML += `<option value="${idx}">Ch ${v.Chapter}, Verse ${v.VerseNum}</option>`;
                });
            }
        }

        document.getElementById('btnGenerateSub')?.addEventListener('click', () => {
            const type = subType.value;
            const startVal = subStart.value;
            const freq = document.getElementById('subFreq').value;
            const startDate = document.getElementById('subDate').value;
            const subId = 'sub_' + Date.now();

            const appUrl = window.location.origin + window.location.pathname 
                + `?subId=${subId}&type=${type}&start=${startVal}&freq=${freq}&date=${startDate}`;

            const dParts = startDate.split('-');
            const icsDate = `${dParts[0]}${dParts[1]}${dParts[2]}T080000Z`;
            const rrule = freq === 'daily' ? 'DAILY' : 'WEEKLY';
            
            const icsData = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//GitaApp//EN\nCALSCALE:GREGORIAN\nBEGIN:VEVENT\nSUMMARY:📖 Gita Reading\nDTSTART:${icsDate}\nRRULE:FREQ=${rrule}\nDESCRIPTION:Tap to open today's reading:\\n${appUrl}\nURL:${appUrl}\nSTATUS:CONFIRMED\nBEGIN:VALARM\nTRIGGER:-PT0M\nACTION:DISPLAY\nDESCRIPTION:Reminder\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR`;

            const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
            const link = document.createElement('a');
            link.href = window.URL.createObjectURL(blob);
            link.download = `Gita_Reminder_${type}.ics`;
            document.body.appendChild(link);
            link.click(); document.body.removeChild(link);

            subModal.classList.remove('active');
            alert("✅ Downloaded! Open the file to add it to your native Calendar.");
        });
    } catch (e) { console.error("Error injecting Subscription Modal:", e); }
}

function handleSubscriptionRouting() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const subId = urlParams.get('subId');
        
        if (!subId) return false; // Not a subscription link

        const type = urlParams.get('type');
        const initialStart = parseInt(urlParams.get('start'));
        const startDateStr = urlParams.get('date');

        const startDate = new Date(startDateStr);
        const today = new Date();
        const diffTime = Math.max(0, today - startDate); // Ensure no negative progression
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        let progressionSteps = 0;
        if (urlParams.get('freq') === 'daily') progressionSteps = diffDays;
        if (urlParams.get('freq') === 'weekly') progressionSteps = Math.floor(diffDays / 7);

        let targetIndex = 0;
        if (type === 'verse') {
            targetIndex = initialStart + progressionSteps;
            if (targetIndex >= globalGeetaData.length) {
                alert("🙏 You have completed all verses in your subscription! Link Expired.");
                return true;
            }
        } else if (type === 'chapter') {
            const chapters = Array.from(new Set(globalGeetaData.map(i => parseInt(i.Chapter))));
            const startChapIndex = chapters.indexOf(initialStart);
            const targetChapIndex = startChapIndex + progressionSteps;
            
            if (targetChapIndex >= chapters.length) {
                alert("🙏 You have completed all chapters! Link Expired.");
                return true;
            }
            const targetChapter = chapters[targetChapIndex];
            targetIndex = globalGeetaData.findIndex(v => parseInt(v.Chapter) === targetChapter);
        }

        console.log(`Routing to ${type} Mode. Absolute Index: ${targetIndex}`);
        openKaraoke(targetIndex, type);
        return true;
    } catch (e) {
        console.error("Routing error:", e);
        return false;
    }
}

// ==========================================
// 4. KARAOKE / PRESENTATION MODAL
// ==========================================
let kState = { index: 0, mode: 'chapter', interval: null, audio: new Audio() };

function injectKaraokeModal() {
    try {
        const modalHTML = `
        <div id="karaokeModal" class="karaoke-modal">
            <div class="k-close-hint">Click anywhere outside text to close</div>
            <div id="kContent" class="karaoke-content">
                <div id="kTitle" class="karaoke-title"></div>
                <div id="kLyrics" class="karaoke-lyrics"></div>
                <div id="kEnglish" class="karaoke-english"></div>
                
                <div id="kManualControls" class="mt-4" style="display:none;">
                    <button id="kRewind" class="btn btn-outline-light m-1">⏪ -5s</button>
                    <button id="kPlayPause" class="btn btn-light m-1 px-4">⏯️ Play</button>
                    <button id="kForward" class="btn btn-outline-light m-1">+5s ⏩</button>
                </div>
            </div>
            
            <div class="karaoke-controls" id="kControls">
                <button id="kPrevBtn" class="k-btn">⏮️ Prev Verse</button>
                <button id="kNextBtn" class="k-btn">Next Verse ⏭️</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        document.getElementById('karaokeModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'karaokeModal') closeKaraoke();
        });

        document.getElementById('kPrevBtn')?.addEventListener('click', () => traverseKaraoke(-1));
        document.getElementById('kNextBtn')?.addEventListener('click', () => traverseKaraoke(1));

        // Manual controls
        document.getElementById('kRewind')?.addEventListener('click', () => { if(kState.audio) kState.audio.currentTime -= 5; });
        document.getElementById('kForward')?.addEventListener('click', () => { if(kState.audio) kState.audio.currentTime += 5; });
        document.getElementById('kPlayPause')?.addEventListener('click', () => {
            if(kState.audio) kState.audio.paused ? kState.audio.play() : kState.audio.pause();
        });
    } catch (e) { console.error("Error injecting Karaoke Modal:", e); }
}

function openKaraoke(absoluteIndex, mode = 'chapter') {
    try {
        if (!globalGeetaData[absoluteIndex]) return;
        kState.index = absoluteIndex;
        kState.mode = mode; 
        
        // Pause underlying main page audio if playing
        if (currentChapterAudio) currentChapterAudio.pause();

        document.getElementById('karaokeModal').classList.add('active');
        document.getElementById('kControls').style.display = mode === 'verse' ? 'none' : 'flex';
        
        playCurrentKaraoke();
    } catch (e) { console.error("Error opening Karaoke:", e); }
}

function closeKaraoke() {
    try {
        document.getElementById('karaokeModal').classList.remove('active');
        kState.audio.pause();
        cancelAnimationFrame(kState.interval);
    } catch (e) { console.error("Error closing Karaoke:", e); }
}

function traverseKaraoke(direction) {
    try {
        const nextIdx = kState.index + direction;
        if (globalGeetaData[nextIdx]) {
            kState.index = nextIdx;
            playCurrentKaraoke();
        }
    } catch(e) { console.error(e); }
}

function playCurrentKaraoke() {
    try {
        const v = globalGeetaData[kState.index];
        const kContent = document.getElementById('kContent');
        const manualControls = document.getElementById('kManualControls');
        
        kContent.classList.add('fade-out');
        cancelAnimationFrame(kState.interval);

        setTimeout(() => {
            document.getElementById('kTitle').textContent = `Chapter ${v.Chapter}, Verse ${v.VerseNum}`;
            document.getElementById('kLyrics').innerHTML = v.OriginalText ? v.OriginalText.replace(/\n/g, '<br>') : 'Text Unavailable';
            document.getElementById('kEnglish').innerHTML = v.EnglishText ? v.EnglishText.replace(/\n/g, '<br>') : '';
            kContent.classList.remove('fade-out');

            const hasTimestamps = v.AudioStart !== undefined && v.AudioEnd > v.AudioStart;
            manualControls.style.display = hasTimestamps ? 'none' : 'block';

            if (v.AudioFileURL) {
                if (kState.audio.src.indexOf(v.AudioFileURL) === -1) {
                    kState.audio.src = v.AudioFileURL;
                    kState.audio.load();
                }

                if (hasTimestamps) {
                    kState.audio.currentTime = v.AudioStart;
                    kState.audio.play().catch(e => console.warn("Autoplay blocked by browser"));
                    
                    function monitorAudio() {
                        if (kState.audio.currentTime >= v.AudioEnd) {
                            if (kState.mode === 'verse') {
                                // Subscribed to specific verse: Loop it!
                                kState.audio.currentTime = v.AudioStart;
                                kState.interval = requestAnimationFrame(monitorAudio);
                            } else {
                                // Chapter mode: Auto Advance to next verse
                                if (globalGeetaData[kState.index + 1] && globalGeetaData[kState.index + 1].Chapter === v.Chapter) {
                                    kState.index++;
                                    playCurrentKaraoke();
                                } else {
                                    kState.audio.pause(); // End of chapter
                                }
                            }
                        } else {
                            kState.interval = requestAnimationFrame(monitorAudio);
                        }
                    }
                    kState.interval = requestAnimationFrame(monitorAudio);
                    
                } else {
                    // No timestamps: just play standard audio and let user control
                    kState.audio.play().catch(e => console.warn("Autoplay blocked"));
                }
            }
        }, 400); // Wait for CSS fade out
    } catch (e) {
        console.error("Error playing Karaoke:", e);
    }
}
