// =========================================================
// 🚀 GITA APP ENGINE (PWA + SUBSCRIPTIONS + KARAOKE + SHARING)
// =========================================================

const container = document.getElementById('container');
let globalGeetaData = [];
let currentChapterAudio = null;
let chunkMonitorId = null; 
let currentFirstDisplayedIndex = 0; 

// Dynamic Presentation Playlist (Handles Chapter and Search results)
let currentPlaylist = []; 
// Background pre-computed options to prevent UI freezing
let precomputedSubOptions = { chapter: [], verse: [] };

// ==========================================
// 1. SYSTEM INITIALIZATION & DATA LOADING
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("🚀 Initializing Main Gita Application...");
        
        // 1. Initialize PWA Install Prompt
        initPWAInstallPrompt();

        // 2. Fetch Master JSON Data
        const response = await fetch('data/geeta_complete.json');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        globalGeetaData = await response.json();
        
        // 3. Populate Chapter Dropdown
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

        // 4. Background Tasks & UI Injections
        precomputeSubscriptionOptions();
        injectSubscriptionModal();
        injectKaraokeModal();
        injectWelcomeScreen();

        // 5. Intelligent Routing
        const isSubscriptionLink = handleSubscriptionRouting();
        if (!isSubscriptionLink) {
            loadChapter(); // Only load default if we didn't route to a specific subscription verse
        }

        // 6. Global Presentation Button Event (Feeds currentPlaylist into Karaoke)
        document.getElementById('globalPresentationBtn')?.addEventListener('click', () => {
            const mode = document.getElementById('searchResults').innerHTML !== '' ? 'search' : 'chapter';
            openKaraoke(currentPlaylist, 0, mode);
        });

        // 7. Event Delegation for Inline Verse Play Icons
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.inline-play-btn');
            if (btn) {
                const absoluteIndex = parseInt(btn.getAttribute('data-index'));
                playVerseInline(absoluteIndex);
            }
        });

        // 8. Quick Subscribe Ad Banner Event
        document.getElementById('quickSubscribeAd')?.addEventListener('click', () => {
            openSubscriptionModalPreFilled('chapter', '12', 'daily');
        });

    } catch (error) {
        console.error('Initialization Error:', error);
        alert("Failed to load Gita data. Please check your internet connection.");
    }
});

// PWA Install Toast Logic
function initPWAInstallPrompt() {
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // Prevent native browser prompt
        deferredPrompt = e;
        const toast = document.getElementById('pwaInstallToast');
        // Show if not previously dismissed
        if (toast && !localStorage.getItem('pwa_toast_dismissed')) {
            toast.style.display = 'flex';
        }
    });

    document.getElementById('btnInstallPwa')?.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                document.getElementById('pwaInstallToast').style.display = 'none';
            }
            deferredPrompt = null;
        }
    });

    document.getElementById('btnClosePwaToast')?.addEventListener('click', () => {
        document.getElementById('pwaInstallToast').style.display = 'none';
        localStorage.setItem('pwa_toast_dismissed', 'true'); // Don't annoy user again
    });
}

// Build options array in the background for blazing fast UI
function precomputeSubscriptionOptions() {
    setTimeout(() => {
        try {
            const uniqueChapters = [];
            globalGeetaData.forEach(v => {
                if (!uniqueChapters.find(c => c.val === v.Chapter)) {
                    uniqueChapters.push({ val: v.Chapter, text: `Chapter ${v.Chapter}: ${v.Topic || 'Geeta'}` });
                }
            });
            precomputedSubOptions.chapter = uniqueChapters;

            globalGeetaData.forEach((v, idx) => {
                precomputedSubOptions.verse.push({ val: idx, text: `Ch ${v.Chapter}, Verse ${v.VerseNum}: ${v.Topic || ''}` });
            });
            console.log("✅ Subscription dropdown data pre-computed.");
        } catch(e) { console.error("Precompute error:", e); }
    }, 100);
}

// ==========================================
// 2. CORE READING UI (CHAPTERS & SEARCH)
// ==========================================
document.getElementById('clearButton')?.addEventListener('click', () => {
    try {
        document.getElementById('container').innerHTML = '';
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('globalPresentationBtn').style.display = 'none';
        if (currentChapterAudio) currentChapterAudio.pause();
        cancelAnimationFrame(chunkMonitorId);
        currentPlaylist = [];
    } catch (e) { console.error(e); }
});

function loadChapter() {
    try {
        const chapterSelect = document.getElementById('chapterSelect');
        if (!chapterSelect) return;
        const selectedChapter = chapterSelect.value;

        const container = document.getElementById('container');
        container.style.display = 'block'; 
        document.getElementById('searchResults').innerHTML = ''; 
        container.innerHTML = ''; 
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        // Reset and populate Playlist for Chapter Mode
        currentPlaylist = [];
        const chapterData = globalGeetaData.filter((item, index) => {
            if (item.Chapter.toString() === selectedChapter.toString()) {
                currentPlaylist.push(index); // Push Absolute Index to playlist
                return true;
            }
            return false;
        });

        if (currentPlaylist.length > 0) {
            document.getElementById('globalPresentationBtn').style.display = 'inline-block';
        }

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
            verseElement.classList.add('verse', 'position-relative', 'p-3', 'mb-3', 'border', 'rounded', 'bg-white', 'shadow-sm'); 

            const hasAudio = verse.AudioStart !== undefined && verse.AudioEnd > verse.AudioStart;
            const absoluteIndex = globalGeetaData.findIndex(v => v.Chapter === verse.Chapter && v.VerseNum === verse.VerseNum);

            // Tiny Speaker Icon on mobile (Flexbox layout prevents overlap)
            let iconHtml = '';
            if (hasAudio) {
                iconHtml = `<button class="btn btn-light shadow-sm text-primary rounded-circle inline-play-btn" data-index="${absoluteIndex}" title="Play Verse Audio" style="width: 32px; height: 32px; padding: 0; display:flex; align-items:center; justify-content:center; font-size: 1rem; border: 1px solid #ddd; flex-shrink: 0;">🔊</button>`;
            }

            const sanText = verse.OriginalText ? verse.OriginalText.replace(/\n/g, '<br>') : '';
            const engText = verse.EnglishText ? verse.EnglishText.replace(/\n/g, '<br>') : '';
            const hinDesc = verse.OriginalMeaning ? verse.OriginalMeaning.replace(/\n/g, '<br>') : '';
            const engDesc = verse.EnglishMeaning ? verse.EnglishMeaning.replace(/\n/g, '<br>') : '';

            // Using padding-right to ensure text never slides under the button
            verseElement.innerHTML += `
                <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                    <div class="text-info font-weight-bold m-0">Chapter ${verse.Chapter}, Verse ${verse.VerseNum}</div>
                    ${iconHtml}
                </div>
                <div class="sanskrit-lines font-weight-bold text-center text-danger mb-2" style="padding-right: 10px; padding-left: 10px;">${sanText}</div>
                <div class="english-lines text-center font-italic mb-3" style="padding-right: 10px; padding-left: 10px;">${engText}</div>
                <hr>
                <div class="hindi-description mb-2">${hinDesc}</div>
                <div class="english-description text-muted">${engDesc}</div>
            `;
            container.appendChild(verseElement);
        });
    } catch (error) { console.error("Error rendering chapter:", error); }
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
        currentPlaylist = []; // Reset and populate with matched indices ONLY

        globalGeetaData.forEach((item, absoluteIndex) => {
            let verseHasMatch = false;
            for (const key in item) {
                if (item[key] && typeof item[key] === 'string') {
                    if (item[key].toLowerCase().includes(searchTerm)) {
                        verseHasMatch = true;
                        break; 
                    }
                }
            }

            if (verseHasMatch) {
                totalMatches++;
                currentPlaylist.push(absoluteIndex); 

                const resultElement = document.createElement('div');
                resultElement.classList.add('verse', 'position-relative', 'p-3', 'mb-3', 'border', 'rounded', 'bg-white', 'shadow-sm');

                const highlightMatch = (text) => text ? text.replace(new RegExp(`(${searchTerm})`, 'gi'), '<span class="highlight">$1</span>').replace(/\n/g, '<br>') : '';
                const hasAudio = item.AudioStart !== undefined && item.AudioEnd > item.AudioStart;
                
                let iconHtml = '';
                if (hasAudio) {
                    iconHtml = `<button class="btn btn-light shadow-sm text-primary rounded-circle inline-play-btn" data-index="${absoluteIndex}" title="Play Verse Audio" style="width: 32px; height: 32px; padding: 0; display:flex; align-items:center; justify-content:center; font-size: 1rem; border: 1px solid #ddd; flex-shrink: 0;">🔊</button>`;
                }

                resultElement.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                        <div class="text-info font-weight-bold m-0">Chapter ${item.Chapter}, Verse ${item.VerseNum}</div>
                        ${iconHtml}
                    </div>
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
        totalsElement.innerHTML = `<strong>Total matches found:</strong> ${totalMatches} verses`;
        searchResults.insertBefore(totalsElement, searchResults.firstChild);

        if (totalMatches > 0) {
            document.getElementById('globalPresentationBtn').style.display = 'inline-block';
        } else {
            searchResults.innerHTML = '<p class="text-center text-danger mt-3">No results found.</p>';
            document.getElementById('globalPresentationBtn').style.display = 'none';
        }
    } catch (error) { console.error('Error during search:', error); }
}

// Dedicated High-Precision Inline Player Logic
function playVerseInline(absoluteIndex) {
    try {
        const verse = globalGeetaData[absoluteIndex];
        if (!verse || !verse.AudioFileURL || verse.AudioStart === undefined) return;

        if (!currentChapterAudio) currentChapterAudio = new Audio();
        if (currentChapterAudio.src.indexOf(verse.AudioFileURL) === -1) currentChapterAudio.src = verse.AudioFileURL;

        cancelAnimationFrame(chunkMonitorId);
        currentChapterAudio.pause();
        currentChapterAudio.currentTime = verse.AudioStart;
        currentChapterAudio.play().catch(e => console.warn("Autoplay blocked", e));

        const end = verse.AudioEnd;
        const monitor = () => {
            if (currentChapterAudio.currentTime >= end) {
                currentChapterAudio.pause();
                currentChapterAudio.currentTime = verse.AudioStart; // Perfect Clipping
            } else if (!currentChapterAudio.paused) {
                chunkMonitorId = requestAnimationFrame(monitor);
            }
        };
        chunkMonitorId = requestAnimationFrame(monitor);
    } catch(e) { console.error("Inline play error:", e); }
}


// ==========================================
// 3. ADVANCED SUBSCRIPTION MODAL (SMART DEFAULTS)
// ==========================================

function openSubscriptionModalPreFilled(type, startValue, freq) {
    const subModal = document.getElementById('subModal');
    document.getElementById('subType').value = type;
    
    // Show loading to yield thread
    document.getElementById('subLoading').style.display = 'block';
    document.getElementById('subStart').style.display = 'none';
    
    setTimeout(() => {
        const subStart = document.getElementById('subStart');
        subStart.innerHTML = '';
        const dataToRender = type === 'chapter' ? precomputedSubOptions.chapter : precomputedSubOptions.verse;
        
        const frag = document.createDocumentFragment();
        dataToRender.forEach(opt => {
            const el = document.createElement('option');
            el.value = opt.val; el.textContent = opt.text;
            frag.appendChild(el);
        });
        subStart.appendChild(frag);

        subStart.value = startValue; 
        document.getElementById('subLoading').style.display = 'none';
        subStart.style.display = 'block';
    }, 10);

    document.getElementById('subFreq').value = freq;

    // Calculate exactly 21:15 GMT+7 (Bangkok Time) translated to User's Local Time
    const targetUTC = new Date();
    targetUTC.setUTCHours(14, 15, 0, 0); // 14:15 UTC is 21:15 BKK
    const localH = targetUTC.getHours().toString().padStart(2, '0');
    const localM = targetUTC.getMinutes().toString().padStart(2, '0');
    document.getElementById('subTime').value = `${localH}:${localM}`;
    
    subModal.classList.add('active');
}

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
                    <label class="font-weight-bold mb-1">Starting Point:</label>
                    <input type="text" id="subFilter" class="form-control mb-1" placeholder="🔍 Search chapter or verse...">
                    <div id="subFilterFeedback" class="filter-feedback text-muted"></div>
                    
                    <div id="subLoading" class="loading-spinner">⏳ Processing options...</div>
                    <select id="subStart" class="form-control" size="4" style="overflow-y: auto;"></select>
                </div>

                <div class="row">
                    <div class="col-sm-6 form-group">
                        <label class="font-weight-bold">Start Date:</label>
                        <input type="date" id="subDate" class="form-control">
                    </div>
                    <div class="col-sm-6 form-group">
                        <label class="font-weight-bold">Notification Time:</label>
                        <input type="time" id="subTime" class="form-control">
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
                    <button id="btnGoogleCal" class="btn btn-primary shadow-sm">➕ Add to Google Calendar</button>
                    <button id="btnAppleCal" class="btn btn-dark shadow-sm">🍎 Add to Apple / Outlook (.ics)</button>
                    <button id="btnCloseSub" class="btn btn-outline-secondary mt-2">Cancel</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const subModal = document.getElementById('subModal');
        const subType = document.getElementById('subType');
        const subStart = document.getElementById('subStart');
        const subFilter = document.getElementById('subFilter');
        const subFilterFeedback = document.getElementById('subFilterFeedback');
        const subLoading = document.getElementById('subLoading');
        
        const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
        document.getElementById('subDate').value = tmrw.toISOString().split('T')[0];

        // Standard Open Button
        document.getElementById('btnOpenSubModal')?.addEventListener('click', () => {
            openSubscriptionModalPreFilled('chapter', '1', 'daily'); // Default to Ch 1
        });
        
        document.getElementById('btnCloseSub')?.addEventListener('click', () => subModal.classList.remove('active'));

        subType?.addEventListener('change', () => {
            subFilter.value = '';
            openSubscriptionModalPreFilled(subType.value, '', document.getElementById('subFreq').value);
        });

        // Fast In-Memory Filtering
        subFilter?.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            subStart.innerHTML = '';
            const dataToSearch = subType.value === 'chapter' ? precomputedSubOptions.chapter : precomputedSubOptions.verse;
            
            let matchCount = 0;
            dataToSearch.forEach(opt => {
                if (opt.text.toLowerCase().includes(term)) {
                    subStart.innerHTML += `<option value="${opt.val}">${opt.text}</option>`;
                    matchCount++;
                }
            });

            subFilterFeedback.textContent = term ? `Showing ${matchCount} matching options` : ``;
            subFilterFeedback.classList.add('active');
            setTimeout(() => subFilterFeedback.classList.remove('active'), 300);
        });

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

        // GOOGLE CALENDAR LINK
        document.getElementById('btnGoogleCal')?.addEventListener('click', () => {
            if(!subStart.value) { alert("Please select a starting point"); return; }
            const appUrl = generateAppUrl();
            const freq = document.getElementById('subFreq').value.toUpperCase();
            const { dtStart, dtEnd } = getUTCStartAndEnd();
            
            const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=📖+Gita+Reading&dates=${dtStart}/${dtEnd}&details=Tap+the+link+to+open+today's+reading:%0A${encodeURIComponent(appUrl)}&recur=RRULE:FREQ=${freq}`;
            
            window.open(gCalUrl, '_blank');
            subModal.classList.remove('active');
        });

        // APPLE / OUTLOOK ICS DOWNLOAD
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

// ==========================================
// 4. AUTOPLAY BYPASS & ROUTING
// ==========================================
function injectWelcomeScreen() {
    const splashHTML = `
    <div id="welcomeSplash" class="welcome-splash" style="display:none;">
        <div class="welcome-card">
            <div id="streakBadge" class="streak-badge" style="display:none;">🔥 1 Day Streak</div>
            <h2>Welcome Back!</h2>
            <p class="text-light mt-2 mb-4">Your daily Srimad Bhagavad Gita reading is ready.</p>
            <button id="btnBeginReading" class="btn-begin">▶️ Begin Reading</button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', splashHTML);
}

function handleSubscriptionRouting() {
    try {
        const urlParams = newSearchParams(window.location.search);
        const subId = urlParams.get('subId');
        
        if (!subId) return false; 

        // Update Reading Streak
        let streak = parseInt(localStorage.getItem('gita_streak')) || 0;
        let lastRead = localStorage.getItem('gita_last_read');
        const todayStr = new Date().toISOString().split('T')[0];

        if (lastRead !== todayStr) {
            streak++;
            localStorage.setItem('gita_streak', streak);
            localStorage.setItem('gita_last_read', todayStr);
        }
        
        const badge = document.getElementById('streakBadge');
        if (streak > 1 && badge) {
            badge.textContent = `🔥 ${streak} Day Streak`;
            badge.style.display = 'inline-block';
        }

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
        let pList = []; // Temporary playlist for routing

        if (type === 'verse') {
            targetIndex = initialStart + progressionSteps;
            if (targetIndex >= globalGeetaData.length) {
                alert("🙏 You have completed all verses in your subscription! Link Expired.");
                return true;
            }
            pList.push(targetIndex); 

        } else if (type === 'chapter') {
            const chapters = Array.from(new Set(globalGeetaData.map(i => parseInt(i.Chapter))));
            const startChapIndex = chapters.indexOf(initialStart);
            const targetChapIndex = startChapIndex + progressionSteps;
            
            if (targetChapIndex >= chapters.length) {
                alert("🙏 You have completed all chapters! Link Expired.");
                return true;
            }
            const targetChapter = chapters[targetChapIndex];
            
            // Build playlist for the entire chapter
            globalGeetaData.forEach((v, i) => {
                if (parseInt(v.Chapter) === targetChapter) pList.push(i);
            });
        }

        // Show Welcome Splash (Bypasses Browser Autoplay Policy)
        const splash = document.getElementById('welcomeSplash');
        splash.style.display = 'flex';
        
        document.getElementById('btnBeginReading').addEventListener('click', () => {
            splash.classList.add('fade-out');
            setTimeout(() => splash.style.display = 'none', 500);
            
            // Interaction achieved! Audio is now allowed to play.
            openKaraoke(pList, 0, type); // Passes 'chapter' or 'verse'
        });

        console.log(`Successfully routed to Subscription: ${type}`);
        return true;
    } catch (e) {
        console.error("Routing error:", e);
        return false;
    }
}

// ==========================================
// 5. ADVANCED PLAYLIST KARAOKE MODAL
// ==========================================
let kState = { 
    playlist: [], 
    listIndex: 0, 
    mode: 'chapter', 
    animId: null, 
    audio: new Audio() 
};

function injectKaraokeModal() {
    try {
        const modalHTML = `
        <div id="karaokeModal" class="karaoke-modal">
            <button id="kCloseBtn" class="k-close-btn">×</button>
            <button id="kShareBtn" class="k-share-btn">🔗 Share Verse</button>

            <div id="kContent" class="karaoke-content">
                <div id="kTitle" class="karaoke-title"></div>
                <div id="kLyrics" class="karaoke-lyrics"></div>
                <div id="kEnglish" class="karaoke-english"></div>
                
                <div id="kManualControls" class="k-manual-container" style="display:none;">
                    <button id="kRewind" class="k-icon-btn" title="Rewind 5s">⏪</button>
                    <button id="kPlayPause" class="k-icon-btn" title="Play/Pause">⏯️</button>
                    <button id="kForward" class="k-icon-btn" title="Forward 5s">⏩</button>
                </div>
            </div>
            
            <div class="karaoke-controls" id="kControls">
                <button id="kPrevBtn" class="k-btn">⏮️ Prev Verse</button>
                <button id="kNextBtn" class="k-btn">Next Verse ⏭️</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Events
        document.getElementById('kCloseBtn')?.addEventListener('click', closeKaraoke);
        document.getElementById('kPrevBtn')?.addEventListener('click', () => traverseKaraoke(-1));
        document.getElementById('kNextBtn')?.addEventListener('click', () => traverseKaraoke(1));

        document.getElementById('kRewind')?.addEventListener('click', () => { if(kState.audio) kState.audio.currentTime -= 5; });
        document.getElementById('kForward')?.addEventListener('click', () => { if(kState.audio) kState.audio.currentTime += 5; });
        document.getElementById('kPlayPause')?.addEventListener('click', () => {
            if(kState.audio) kState.audio.paused ? kState.audio.play() : kState.audio.pause();
        });

        // Share Feature Logic
        document.getElementById('kShareBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const v = globalGeetaData[kState.playlist[kState.listIndex]];
            const text = `Bhagavad Gita - Chapter ${v.Chapter}, Verse ${v.VerseNum}\n\n${v.OriginalText}\n\n${v.EnglishText}\n\nRead on Gita App!`;
            
            if (navigator.share) {
                navigator.share({ title: 'Bhagavad Gita', text: text, url: window.location.origin + window.location.pathname });
            } else {
                navigator.clipboard.writeText(text);
                alert("Verse copied to clipboard! You can paste it anywhere.");
            }
        });
    } catch (e) { console.error("Error injecting Karaoke Modal:", e); }
}

function openKaraoke(playlistArr, startListIndex = 0, mode = 'chapter') {
    try {
        if (!playlistArr || playlistArr.length === 0) {
            alert("No verses available to present.");
            return;
        }

        kState.playlist = playlistArr;
        kState.listIndex = startListIndex;
        kState.mode = mode; // 'chapter', 'verse', or 'search'
        
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
        cancelAnimationFrame(kState.animId);
    } catch (e) { console.error("Error closing Karaoke:", e); }
}

function traverseKaraoke(direction) {
    try {
        const nextListIdx = kState.listIndex + direction;
        if (nextListIdx >= 0 && nextListIdx < kState.playlist.length) {
            kState.listIndex = nextListIdx;
            playCurrentKaraoke();
        }
    } catch(e) { console.error(e); }
}

function playCurrentKaraoke() {
    try {
        const absoluteIndex = kState.playlist[kState.listIndex];
        const v = globalGeetaData[absoluteIndex];
        
        const kContent = document.getElementById('kContent');
        const manualControls = document.getElementById('kManualControls');
        
        kContent.classList.add('fade-out');
        cancelAnimationFrame(kState.animId);

        setTimeout(() => {
            document.getElementById('kTitle').textContent = `Chapter ${v.Chapter}, Verse ${v.VerseNum} ${v.Topic ? ' - ' + v.Topic : ''}`;
            document.getElementById('kLyrics').innerHTML = v.OriginalText ? v.OriginalText.replace(/\n/g, '<br>') : 'Text Unavailable';
            document.getElementById('kEnglish').innerHTML = v.EnglishText ? v.EnglishText.replace(/\n/g, '<br>') : '';
            kContent.classList.remove('fade-out');

            const hasTimestamps = v.AudioStart !== undefined && v.AudioEnd > v.AudioStart;
            manualControls.style.display = hasTimestamps ? 'none' : 'flex';

            if (v.AudioFileURL) {
                let fileChanged = false;
                if (kState.audio.src.indexOf(v.AudioFileURL) === -1) {
                    kState.audio.src = v.AudioFileURL;
                    fileChanged = true;
                }

                if (hasTimestamps) {
                    const timeDiff = Math.abs(kState.audio.currentTime - v.AudioStart);
                    const isContiguous = !fileChanged && !kState.audio.paused && timeDiff < 0.4;

                    if (!isContiguous) {
                        kState.audio.currentTime = v.AudioStart;
                        kState.audio.play().catch(e => console.warn("Autoplay blocked by browser"));
                    }
                    
                    function monitorAudio() {
                        if (kState.audio.currentTime >= v.AudioEnd) {
                            if (kState.mode === 'verse') {
                                // Loop single verse
                                kState.audio.currentTime = v.AudioStart;
                                kState.animId = requestAnimationFrame(monitorAudio);
                            } else {
                                // Auto advance through PLAYLIST
                                if (kState.listIndex < kState.playlist.length - 1) {
                                    kState.listIndex++;
                                    playCurrentKaraoke(); 
                                } else {
                                    kState.audio.pause(); // Reached end of playlist
                                }
                            }
                        } else {
                            kState.animId = requestAnimationFrame(monitorAudio);
                        }
                    }
                    kState.animId = requestAnimationFrame(monitorAudio);
                    
                } else {
                    // Search Mode: Silences chapter audio if missing timestamps
                    if (kState.mode !== 'search') {
                        kState.audio.play().catch(e => console.warn("Autoplay blocked"));
                    } else {
                        kState.audio.pause();
                    }
                }
            }
        }, 300); 
    } catch (e) {
        console.error("Error playing Karaoke:", e);
    }
}
