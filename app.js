const container = document.getElementById('container');

// // Initialize Three.js
// const scene = new THREE.Scene();
// const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// const renderer = new THREE.WebGLRenderer();
// renderer.setSize(window.innerWidth, window.innerHeight);
// container.appendChild(renderer.domElement);

// // Create a cube for visualization (replace with your 3D model)
// const geometry = new THREE.BoxGeometry();
// const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
// const cube = new THREE.Mesh(geometry, material);
// scene.add(cube);

// Clear Results button
document.getElementById('clearButton').addEventListener('click', clearResults);

function clearResults() {
    document.getElementById('container').innerHTML = '';
    document.getElementById('searchResults').innerHTML = '';
}

// Global reference for the dynamic chapter audio player
let currentChapterAudio = null;

const jsonData = []; // Load your JSON data here
// Load JSON data
fetch('data/geeta_complete.json') // UPDATED JSON PATH
    .then(response => response.json())
    .then(jsonData => {
        // Populate chapterSelect with options based on the number of chapters
        const chapters = Array.from(new Set(jsonData.map(item => item.Chapter))); // UPDATED KEY
        chapters.sort((a, b) => parseInt(a) - parseInt(b));

        const chapterSelect = document.getElementById('chapterSelect');
        chapters.forEach(chapter => {
            const option = document.createElement('option');
            option.value = chapter;
            option.textContent = `Chapter ${chapter}`;
            chapterSelect.appendChild(option);
        });
        loadChapter();
    })
    .catch(error => console.error('Error loading JSON data:', error));

// Load selected chapter
document.getElementById('chapterSelect').addEventListener('change', loadChapter);

function loadChapter() {
    const selectedChapter = document.getElementById('chapterSelect').value;

    // Fetch JSON data first
    fetch('data/geeta_complete.json') // UPDATED JSON PATH
        .then(response => response.json())
        .then(jsonData => {
            // UPDATED KEY: Ensure strict type comparison or parse it
            const chapterData = jsonData.filter(item => item.Chapter.toString() === selectedChapter.toString());

            const container = document.getElementById('container');
            container.style.display = 'block'; // Show the container
            document.getElementById('searchResults').innerHTML = ''; // Clear search results

            // Clear previous data
            container.innerHTML = ''; 
            // Clear the search input value
            document.getElementById('searchInput').value = '';
            
            // --- NEW: CHAPTER AUDIO PLAYER ---
            if (chapterData.length > 0 && chapterData[0].AudioFileURL) {
                const audioContainer = document.createElement('div');
                audioContainer.style.textAlign = 'center';
                audioContainer.style.marginBottom = '20px';
                audioContainer.style.padding = '15px';
                audioContainer.style.background = '#f8f9fa';
                audioContainer.style.borderRadius = '10px';
                
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
            // ----------------------------------

            // Loop through each verse in the selected chapter
            chapterData.forEach(verse => {
                const verseElement = document.createElement('div');
                verseElement.classList.add('verse');
                verseElement.style.position = 'relative'; // Added for absolute positioning of play icon

                // --- NEW: VERSE PLAY ICON ---
                if (verse.AudioStart && verse.AudioEnd && verse.AudioEnd > verse.AudioStart) {
                    const playBtn = document.createElement('button');
                    playBtn.innerHTML = '▶️ Play Verse';
                    playBtn.classList.add('btn', 'btn-sm', 'btn-success');
                    playBtn.style.position = 'absolute';
                    playBtn.style.top = '10px';
                    playBtn.style.right = '10px';
                    
                    playBtn.onclick = function() {
                        if (currentChapterAudio) {
                            currentChapterAudio.currentTime = verse.AudioStart;
                            currentChapterAudio.play();
                            
                            // Clip the audio when it reaches AudioEnd
                            const checkEnd = () => {
                                if (currentChapterAudio.currentTime >= verse.AudioEnd) {
                                    currentChapterAudio.pause();
                                    currentChapterAudio.removeEventListener('timeupdate', checkEnd);
                                }
                            };
                            currentChapterAudio.addEventListener('timeupdate', checkEnd);
                        }
                    };
                    verseElement.appendChild(playBtn);
                }
                // ----------------------------

                // Sanskrit Lines (UPDATED KEYS)
                const sanskritLinesElement = document.createElement('div');
                sanskritLinesElement.classList.add('sanskrit-lines');
                sanskritLinesElement.innerHTML = verse.OriginalText ? verse.OriginalText.replace(/\n/g, '<br>') : '';
                verseElement.appendChild(sanskritLinesElement);
                
                // English Lines (UPDATED KEYS)
                const engLinesElement = document.createElement('div');
                engLinesElement.classList.add('english-lines');
                engLinesElement.innerHTML = verse.EnglishText ? verse.EnglishText.replace(/\n/g, '<br>') : '';
                verseElement.appendChild(engLinesElement);
                
                // Add a separator
                const separator = document.createElement('hr');
                verseElement.appendChild(separator);
                
                // Hindi Description (UPDATED KEYS)
                const hindiDescriptionElement = document.createElement('div');
                hindiDescriptionElement.classList.add('hindi-description');
                hindiDescriptionElement.innerHTML = verse.OriginalMeaning ? verse.OriginalMeaning.replace(/\n/g, '<br>') : '';
                verseElement.appendChild(hindiDescriptionElement);
                
                // English Description (UPDATED KEYS)
                const engDescriptionElement = document.createElement('div');
                engDescriptionElement.classList.add('english-description');
                engDescriptionElement.innerHTML = verse.EnglishMeaning ? verse.EnglishMeaning.replace(/\n/g, '<br>') : '';
                verseElement.appendChild(engDescriptionElement);

                container.appendChild(verseElement);
            });
        })
        .catch(error => console.error('Error loading JSON data:', error));
}

document.getElementById('searchButton').addEventListener('click', searchWord);
// Listen for "Enter" key press in the search input
document.getElementById('searchInput').addEventListener('keyup', function (event) {
    if (event.key === 'Enter') {
        searchWord();
    }
});

async function searchWord() {
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput.value.toLowerCase();
    const searchResults = document.getElementById('searchResults');

    // Clear previous search results
    searchResults.innerHTML = '';
    document.getElementById('container').innerHTML = '';

    try {
        const response = await fetch('data/geeta_complete.json'); // UPDATED JSON PATH
        const jsonData = await response.json();

        let totalMatches = 0;
        let totalVerses = 0;

        jsonData.forEach(item => {
        
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

                // Display Sanskrit Lines with highlighted matching word (UPDATED KEYS)
                const sanskritLines = document.createElement('p');
                const sanText = item.OriginalText || '';
                sanskritLines.innerHTML = sanText.replace(
                    new RegExp(`(${searchTerm})`, 'gi'),
                    '<span class="highlight">$1</span>'
                ).replace(/\n/g, '<br>');
                resultElement.appendChild(sanskritLines);

                // Display English Lines with highlighted matching word (UPDATED KEYS)
                const engLines = document.createElement('p');
                const engText = item.EnglishText || '';
                engLines.innerHTML = engText.replace(
                    new RegExp(`(${searchTerm})`, 'gi'),
                    '<span class="highlight">$1</span>'
                ).replace(/\n/g, '<br>');
                resultElement.appendChild(engLines);

                // Add a separator
                const separator = document.createElement('hr');
                resultElement.appendChild(separator);

                // Display Hindi Description with highlighted matching word (UPDATED KEYS)
                const hindiDescription = document.createElement('p');
                const hinDesc = item.OriginalMeaning || '';
                hindiDescription.innerHTML = hinDesc.replace(
                    new RegExp(`(${searchTerm})`, 'gi'),
                    '<span class="highlight">$1</span>'
                ).replace(/\n/g, '<br>');
                resultElement.appendChild(hindiDescription);

                // Display English Description with highlighted matching word (UPDATED KEYS)
                const engDescription = document.createElement('p');
                const engDesc = item.EnglishMeaning || '';
                engDescription.innerHTML = engDesc.replace(
                    new RegExp(`(${searchTerm})`, 'gi'),
                    '<span class="highlight">$1</span>'
                ).replace(/\n/g, '<br>');
                resultElement.appendChild(engDescription);

                searchResults.appendChild(resultElement);
            }
        });

        const totalsElement = document.createElement('div');
        totalsElement.classList.add('search-totals');
        totalsElement.innerHTML = `Total matches: ${totalMatches}<br>Total verses: ${totalVerses}`;
        searchResults.insertBefore(totalsElement, searchResults.firstChild);

        if (searchResults.innerHTML === '') {
            searchResults.innerHTML = '<p>No results found.</p>';
        }
    } catch (error) {
        console.error('Error fetching JSON data:', error);
    }
}

// Get toggle buttons
const sanskritToggle = document.getElementById('sanskrit-toggle');
const englishToggle = document.getElementById('english-toggle');
const hindiToggle = document.getElementById('hindi-toggle');
const descriptionToggle = document.getElementById('description-toggle');

// Add click event listeners to toggle buttons
if(sanskritToggle) sanskritToggle.addEventListener('click', toggleDisplay);
if(englishToggle) englishToggle.addEventListener('click', toggleDisplay);
if(hindiToggle) hindiToggle.addEventListener('click', toggleDisplay);
if(descriptionToggle) descriptionToggle.addEventListener('click', toggleDisplay);

// Function to toggle display of respective content
function toggleDisplay(event) {
    const target = event.target;
    const targetClass = target.id.split('-')[0];

    if (target.classList.contains('active-toggle')) {
        target.classList.remove('active-toggle');
        target.classList.add('inactive-toggle');
        document.querySelectorAll(`.${targetClass}`).forEach(elem => {
            elem.style.display = 'none';
        });
    } else {
        target.classList.remove('inactive-toggle');
        target.classList.add('active-toggle');
        document.querySelectorAll(`.${targetClass}`).forEach(elem => {
            elem.style.display = 'block';
        });
    }
}

// Default: All sections are displayed
document.querySelectorAll('.active-toggle').forEach(button => {
    button.click();
});

// // Render loop
// function animate() {
//     requestAnimationFrame(animate);
//     // Update your 3D scene here
//     renderer.render(scene, camera);
// }
// animate();
