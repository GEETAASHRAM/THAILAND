const container = document.getElementById('container');

// Initialize Three.js
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Create a cube for visualization (replace with your 3D model)
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Clear Results button
document.getElementById('clearButton').addEventListener('click', clearResults);

function clearResults() {
    document.getElementById('container').innerHTML = '';
    document.getElementById('searchResults').innerHTML = '';
}


const jsonData = []; // Load your JSON data here
// Load JSON data
fetch('data/shlokas_tbl.json')
    .then(response => response.json())
    .then(jsonData => {
        // Populate chapterSelect with options based on the number of chapters
        const chapters = Array.from(new Set(jsonData.map(item => item.chapter)));
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
    const selectedChapter = chapterSelect.value;

    // Fetch JSON data first
    fetch('data/shlokas_tbl.json')
        .then(response => response.json())
        .then(jsonData => {
            const chapterData = jsonData.filter(item => item.chapter === selectedChapter);

            const container = document.getElementById('container');
            container.style.display = 'block'; // Show the container
            document.getElementById('searchResults').innerHTML = ''; // Clear search results

            // Clear previous data
            container.innerHTML = ''; 
            // Clear the search input value
            searchInput.value = '';
            
            // Loop through each verse in the selected chapter
            chapterData.forEach(verse => {
                const verseElement = document.createElement('div');
                verseElement.classList.add('verse');

                // Sanskrit Lines
                const sanskritLinesElement = document.createElement('div');
                sanskritLinesElement.classList.add('sanskrit-lines');
                sanskritLinesElement.innerHTML = `${verse.ShlokaSanLine1}<br>${verse.ShlokaSanLine2}<br>${verse.ShlokaSanLine3}<br>${verse.ShlokaSanLine4}`;
                verseElement.appendChild(sanskritLinesElement);
                
                // English Lines
                const engLinesElement = document.createElement('div');
                engLinesElement.classList.add('english-lines');
                engLinesElement.innerHTML = `${verse.ShlokaEngLine1}<br>${verse.ShlokaEngLine2}<br>${verse.ShlokaEngLine3}<br>${verse.ShlokaEngLine4}`;
                verseElement.appendChild(engLinesElement);
                
                // Add a separator
                const separator = document.createElement('hr');
                verseElement.appendChild(separator);
                
                // Hindi Description
                const hindiDescriptionElement = document.createElement('div');
                hindiDescriptionElement.classList.add('hindi-description');
                hindiDescriptionElement.innerHTML = verse.DescriptionSan.replace(/\n/g, '<br>');
                verseElement.appendChild(hindiDescriptionElement);
                
                // English Description
                const engDescriptionElement = document.createElement('div');
                engDescriptionElement.classList.add('english-description');
                engDescriptionElement.innerHTML = verse.Description.replace(/\n/g, '<br>');
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

function searchWord() {
    const searchTerm = searchInput.value.trim().toLowerCase();

    // Hide the main container
    document.getElementById('container').style.display = 'none';

    const searchResults = document.getElementById('searchResults');
    searchResults.innerHTML = ''; // Clear previous search results

    // Fetch JSON data if not loaded
    if (!jsonData) {
        fetch('data/shlokas_tbl.json')
            .then(response => response.json())
            .then(data => {
                jsonData = data;
                console.log('fetched json data and will performSearch');
                performSearch();
            })
            .catch(error => console.error('Error loading JSON data:', error));
    } else {
        console.log('will performSearch');
        performSearch();
    }

    function performSearch() {
        console.log('will now look for matchingResults');
        console.log(jsonData);
        const matchingResults = jsonData.filter(item => {
            for (const key in item) {
                if (typeof item[key] === 'string' && item[key].toLowerCase().includes(searchTerm)) {
                    return true;
                }
            }
            return false;
        });

        if (matchingResults.length > 0) {
            matchingResults.forEach(result => {
                const resultElement = document.createElement('div');
                resultElement.classList.add('search-result');

                const jsonString = JSON.stringify(result, null, 2);
                const highlightedJsonString = jsonString.replace(
                    new RegExp(searchTerm, 'gi'),
                    match => `<span class="highlight">${match}</span>`
                );

                const jsonElement = document.createElement('pre');
                jsonElement.innerHTML = highlightedJsonString;
                resultElement.appendChild(jsonElement);

                const separator = document.createElement('hr');
                resultElement.appendChild(separator);

                searchResults.appendChild(resultElement);
            });
        } else {
            // Display a message if no results found
            const noResultsElement = document.createElement('p');
            noResultsElement.textContent = 'No results found.';
            searchResults.appendChild(noResultsElement);
        }
    }
}



// Render loop
function animate() {
    requestAnimationFrame(animate);
    // Update your 3D scene here
    renderer.render(scene, camera);
}
animate();
