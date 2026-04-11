// =========================================================
// 🚀 GITA APP ENGINE (PWA + SUBSCRIPTIONS + KARAOKE)
// =========================================================

const container = document.getElementById('container');
let globalGeetaData = [];
let currentChapterAudio = null;
let chunkMonitorId = null; // Used to track high-precision audio clipping
let currentFirstDisplayedIndex = 0; // Tracks the first visible verse for Presentation mode

// ==========================================
// 1. SYSTEM INITIALIZATION & DATA LOADING
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("🚀 Initializing Main Gita Application...");
        
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

        // Inject UI Modals
        injectSubscriptionModal();
        injectKaraokeModal();

        // Check if user arrived via a Subscription Link
        const isSubscriptionLink = handleSubscriptionRouting();
        
        if (!isSubscriptionLink) {
            loadChapter();
        }

        // Global Presentation Button Event
        document.getElementById('globalPresentationBtn')?.addEventListener('click', () => {
            openKaraoke(currentFirstDisplayedIndex, 'chapter');
        });

    } catch (error) {
        console.error('Error during app initialization:', error);
        alert("Failed to load Gita data. Please check your internet connection.");
    }
});

// ==========================================
// 2. CORE READING UI (CHAPTERS & SEARCH)
// ==========================================
document.getElementById('clearButton')?.addEventListener('click', () => {
    try {
        document.getElementById('container').innerHTML = '';
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('globalPresentationBtn').style.display = 'none';
        if (currentChapterAudio) currentChapterAudio.pause();
    } catch (e) { console.error(e); }
});

function loadChapter() {
    try {
        const chapterSelect = document.getElementById('chapterSelect');
        if (!chapterSelect) return;
        const selectedChapter = chapterSelect.value;

        const chapterData = globalGeetaData.filter(item => item.Chapter.toString() === selectedChapter.toString());

        const container = document.getElementById('container');
        container.style.display = 'block'; 
        document.getElementById('searchResults').innerHTML = ''; 
        container.innerHTML = ''; 
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        // Show Global Presentation Button
        document.getElementById('globalPresentationBtn').style.display = 'inline-block';
        
        // Determine first index of this chapter for presentation mode
        currentFirstDisplayedIndex = globalGeetaData.findIndex(v => v.Chapter.toString() === selectedChapter.toString());

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

            const hasAudio = verse.AudioStart !== undefined && verse.AudioEnd > verse.AudioStart;

            // Verse Play Icon
            const playBtn = document.createElement('button');
            playBtn.innerHTML = hasAudio ? '🎤 Play Verse' : '▶️ Play Chapter Here';
            playBtn.classList.add('btn', 'btn-sm', hasAudio ? 'btn-success' : 'btn-secondary');
            playBtn.style.position = 'absolute';
            playBtn.style.top = '10px';
            playBtn.style.right = '10px';
            
            // Precision Playback logic
            playBtn.onclick = function() {
                if (currentChapterAudio) {
                    cancelAnimationFrame(chunkMonitorId); // Cancel previous monitors
                    currentChapterAudio.pause();
                    
                    if (hasAudio) {
                        currentChapterAudio.currentTime = verse.AudioStart;
                        currentChapterAudio.play();
                        
                        // HIGH PRECISION CLIPPING
                        const end = verse.AudioEnd;
                        const monitor = () => {
                            if (currentChapterAudio.currentTime >= end) {
                                currentChapterAudio.pause();
                                currentChapterAudio.currentTime = verse.AudioStart; // Reset to start
                            } else if (!currentChapterAudio.paused) {
                                chunkMonitorId = requestAnimationFrame(monitor);
                            }
                        };
                        chunkMonitorId = requestAnimationFrame(monitor);
                    } else {
                        // Fallback if no precise timestamps exist
                        const absoluteIndex = globalGeetaData.findIndex(v => v.Chapter === verse.Chapter && v.VerseNum === verse.VerseNum);
                        openKaraoke(absoluteIndex, 'chapter'); 
                    }
                }
            };
            
            verseElement.appendChild(playBtn);

            const sanText = verse.OriginalText ? verse.OriginalText.replace(/\n/g, '<br>') : '';
            const engText = verse.EnglishText ? verse.EnglishText.replace(/\n/g, '<br>') : '';
            const hinDesc = verse.OriginalMeaning ? verse.OriginalMeaning.replace(/\n/g, '<br>') : '';
            const engDesc = verse.EnglishMeaning ? verse.EnglishMeaning.replace(/\n/g, '<br>') : '';

            verseElement.innerHTML += `
                <div class="sanskrit-lines font-weight-bold text-center text-danger mb-2">${sanText}</div>
                <div class="english-lines text-center font-italic mb-3">${engText}</div>
                <hr>
                <div class="hindi-description mb-2">${hinDesc}</div>
                <div class="english-description text-muted">${engDesc}</div>
            `;
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
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (!searchTerm) return;

        const searchResults = document.getElementById('searchResults');
        searchResults.innerHTML = '';
        document.getElementById('container').innerHTML = '';
        if (currentChapterAudio) currentChapterAudio.pause();
        cancelAnimationFrame(chunkMonitorId);

        let totalMatches = 0;
        let totalVerses = 0;
        let firstMatchAbsoluteIndex = -1;

        globalGeetaData.forEach((item, absoluteIndex) => {
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
                if (firstMatchAbsoluteIndex === -1) firstMatchAbsoluteIndex = absoluteIndex;

                const resultElement = document.createElement('div');
                resultElement.classList.add('verse', 'position-relative');

                const highlightMatch = (text) => text ? text.replace(new RegExp(`(${searchTerm})`, 'gi'), '<span class="highlight">$1</span>').replace(/\n/g, '<br>') : '';

                resultElement.innerHTML = `
                    <div class="text-info font-weight-bold mb-2">Chapter ${item.Chapter}, Verse ${item.VerseNum}</div>
                    <p class="font-weight-bold text-danger">${highlightMatch(item.OriginalText)}</p>
                    <p class="font-italic">${highlightMatch(item.EnglishText)}</p>
                    <hr>
                    <p>${highlightMatch(item.OriginalMeaning)}</p>
                    <p class="text-muted">${highlightMatch(item.EnglishMeaning)}</p>
                `;
                searchResults.appendChild(resultElement);
            }
        });

        const totalsElement = document.createElement('div');
        totalsElement.classList.add('search-totals', 'alert', 'alert-info');
        totalsElement.innerHTML = `<strong>Total matches:</strong> ${totalMatches} <br> <strong>Total verses:</strong> ${totalVerses}`;
        searchResults.insertBefore(totalsElement, searchResults.firstChild);

        if (totalVerses > 0) {
            currentFirstDisplayedIndex = firstMatchAbsoluteIndex;
            document.getElementById('globalPresentationBtn').style.display = 'inline-block';
        } else {
            searchResults.innerHTML = '<p class="text-center text-danger mt-3">No results found.</p>';
            document.getElementById('globalPresentationBtn').style.display = 'none';
        }
    } catch (error) {
        console.error('Error during search:', error);
    }
}

// ==========================================
// 3. ADVANCED SUBSCRIPTION MODAL
// ==========================================
function injectSubscriptionModal() {
    try {
        const modalHTML = `
        <div id="subModal" class="karaoke-modal" style="z-index: 105000;">
            <div class="karaoke-content bg-light text-dark p-4 rounded text-left" style="max-width:550px; width: 95%;">
                <h3 class="text-primary mb-3">📅 Setup Daily Reading</h3>
                
                <div class="form-group">
                    <label class="font-weight-bold">Subscribe to:</label>
                    <select id="subType" class="form-control border-primary">
                        <option value="chapter">One Chapter at a time</option>
                        <option value="verse">One Verse at a time</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="font-weight-bold">Starting Point:</label>
                    <input type="text" id="subFilter" class="form-control mb-1" placeholder="🔍 Search chapter or verse...">
                    <select id="subStart" class="form-control" size="4" style="overflow-y: auto;"></select>
                </div>

                <div class="row">
                    <div class="col-sm-6 form-group">
                        <label class="font-weight-bold">Start Date:</label>
                        <input type="date" id="subDate" class="form-control">
                    </div>
                    <div class="col-sm-6 form-group">
                        <label class="font-weight-bold">Notification Time:</label>
                        <input type="time" id="subTime" class="form-control" value="08:00">
                    </div>
                </div>

                <div class="form-group">
                    <label class="font-weight-bold">Frequency:</label>
                    <select id="subFreq" class="form-control">
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                    </select>
                </div>

                <div class="d-flex flex-column gap-2 mt-4">
                    <button id="btnGoogleCal" class="btn btn-primary mb-2 shadow-sm">➕ Add to Google Calendar</button>
                    <button id="btnAppleCal" class="btn btn-dark mb-2 shadow-sm">🍎 Add to Apple / Outlook (.ics)</button>
                    <button id="btnCloseSub" class="btn btn-outline-secondary">Cancel</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const subModal = document.getElementById('subModal');
        const subType = document.getElementById('subType');
        const subStart = document.getElementById('subStart');
        const subFilter = document.getElementById('subFilter');
        
        let currentOptionsData = [];

        // Set Default date to tomorrow
        const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
        document.getElementById('subDate').value = tmrw.toISOString().split('T')[0];

        document.getElementById('btnOpenSubModal')?.addEventListener('click', () => {
            populateSubStartOptions('chapter');
            subModal.classList.add('active');
        });
        
        document.getElementById('btnCloseSub')?.addEventListener('click', () => subModal.classList.remove('active'));

        subType?.addEventListener('change', () => {
            subFilter.value = '';
            populateSubStartOptions(subType.value);
        });

        // Search Filter Logic for Options
        subFilter?.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            subStart.innerHTML = '';
            currentOptionsData.forEach(opt => {
                if (opt.text.toLowerCase().includes(term)) {
                    subStart.innerHTML += `<option value="${opt.val}">${opt.text}</option>`;
                }
            });
        });

        function populateSubStartOptions(type) {
            currentOptionsData = [];
            subStart.innerHTML = '';
            if (type === 'chapter') {
                const uniqueChapters = [];
                globalGeetaData.forEach(v => {
                    if (!uniqueChapters.find(c => c.val === v.Chapter)) {
                        const title = `Chapter ${v.Chapter}: ${v.Topic || 'Geeta'}`;
                        uniqueChapters.push({ val: v.Chapter, text: title });
                    }
                });
                currentOptionsData = uniqueChapters;
            } else {
                globalGeetaData.forEach((v, idx) => {
                    const title = `Ch ${v.Chapter}, Verse ${v.VerseNum}: ${v.Topic || ''}`;
                    currentOptionsData.push({ val: idx, text: title });
                });
            }
            
            // Render Initial
            currentOptionsData.forEach(opt => {
                subStart.innerHTML += `<option value="${opt.val}">${opt.text}</option>`;
            });
        }

        function generateAppUrl() {
            const type = subType.value;
            const startVal = subStart.value;
            const freq = document.getElementById('subFreq').value;
            const startDate = document.getElementById('subDate').value;
            const subId = 'sub_' + Date.now();
            return window.location.origin + window.location.pathname + `?subId=${subId}&type=${type}&start=${startVal}&freq=${freq}&date=${startDate}`;
        }

        function getUTCStartAndEnd() {
            const dateVal = document.getElementById('subDate').value;
            const timeVal = document.getElementById('subTime').value;
            const localDate = new Date(`${dateVal}T${timeVal}:00`);
            
            const formatUTC = (d) => d.toISOString().replace(/-|:|\.\d+/g, '');
            const dtStart = formatUTC(localDate);
            const dtEnd = formatUTC(new Date(localDate.getTime() + 15 * 60000)); // 15 mins later
            return { dtStart, dtEnd };
        }

        // GOOGLE CALENDAR
        document.getElementById('btnGoogleCal')?.addEventListener('click', () => {
            if(!subStart.value) { alert("Please select a starting point"); return; }
            const appUrl = generateAppUrl();
            const freq = document.getElementById('subFreq').value.toUpperCase();
            const { dtStart, dtEnd } = getUTCStartAndEnd();
            
            const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=📖+Gita+Reading&dates=${dtStart}/${dtEnd}&details=Tap+the+link+to+open+today's+reading:%0A${encodeURIComponent(appUrl)}&recur=RRULE:FREQ=${freq}`;
            
            window.open(gCalUrl, '_blank');
            subModal.classList.remove('active');
        });

        // APPLE / OUTLOOK ICS
        document.getElementById('btnAppleCal')?.addEventListener('click', () => {
            if(!subStart.value) { alert("Please select a starting point"); return; }
            const type = subType.value;
            const appUrl = generateAppUrl();
            const freq = document.getElementById('subFreq').value.toUpperCase();
            const { dtStart } = getUTCStartAndEnd();
            
            const icsData = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//GitaApp//EN\nCALSCALE:GREGORIAN\nBEGIN:VEVENT\nSUMMARY:📖 Gita Reading\nDTSTART:${dtStart}\nRRULE:FREQ=${freq}\nDESCRIPTION:Tap to open today's reading:\\n${appUrl}\nURL:${appUrl}\nSTATUS:CONFIRMED\nBEGIN:VALARM\nTRIGGER:-PT0M\nACTION:DISPLAY\nDESCRIPTION:Reminder\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR`;

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
        
        if (!subId) return false; 

        const type = urlParams.get('type');
        const initialStart = parseInt(urlParams.get('start'));
        const startDateStr = urlParams.get('date');
        const freq = urlParams.get('freq');

        const startDate = new Date(startDateStr);
        const today = new Date();
        const diffTime = Math.max(0, today - startDate); 
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        let progressionSteps = 0;
        if (freq === 'daily') progressionSteps = diffDays;
        if (freq === 'weekly') progressionSteps = Math.floor(diffDays / 7);
        if (freq === 'monthly') {
            progressionSteps = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth());
            if (progressionSteps < 0) progressionSteps = 0;
        }

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
        
        if (currentChapterAudio) currentChapterAudio.pause();
        cancelAnimationFrame(chunkMonitorId);

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
            document.getElementById('kTitle').textContent = `Chapter ${v.Chapter}, Verse ${v.VerseNum} ${v.Topic ? ' - ' + v.Topic : ''}`;
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
                                // Loop single verse
                                kState.audio.currentTime = v.AudioStart;
                                kState.interval = requestAnimationFrame(monitorAudio);
                            } else {
                                // Auto advance chapter
                                if (globalGeetaData[kState.index + 1] && globalGeetaData[kState.index + 1].Chapter === v.Chapter) {
                                    kState.index++;
                                    playCurrentKaraoke();
                                } else {
                                    kState.audio.pause(); 
                                }
                            }
                        } else {
                            kState.interval = requestAnimationFrame(monitorAudio);
                        }
                    }
                    kState.interval = requestAnimationFrame(monitorAudio);
                    
                } else {
                    kState.audio.play().catch(e => console.warn("Autoplay blocked"));
                }
            }
        }, 400); 
    } catch (e) {
        console.error("Error playing Karaoke:", e);
    }
}
