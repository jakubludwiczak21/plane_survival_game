// Load menu
fetch('menu.html')
    .then(response => response.text())
    .then(data => {
        document.getElementById('menu-container').innerHTML = data;
    })
    .catch(error => {
        console.error("Błąd ładowania menu:", error);
    });

// --- FIREBASE KONFIGURACJA ---
let db = null;
let auth = null;
let firebaseReady = false;

// Sprawdzenie czy Firebase jest dostępny
if (typeof firebase !== 'undefined') {
    const firebaseConfig = {
        apiKey: "AIzaSyA49ZYTDFHKf2vR9Z5CR3eOIBzecEp3Rj0",
        authDomain: "plane-survival.firebaseapp.com",
        projectId: "plane-survival",
        storageBucket: "plane-survival.firebasestorage.app",
        messagingSenderId: "698994610302",
        appId: "1:698994610302:web:b11026c500cc3b5937082f"
    };

    try {
        // Inicjalizacja Firebase
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        
        // Autentykacja anonimowa
        auth.signInAnonymously().then(() => {
            firebaseReady = true;
            console.log("Firebase gotowy!");
        }).catch(error => {
            console.warn("Błąd autentykacji Firebase:", error);
            firebaseReady = false;
        });
    } catch (error) {
        console.warn("Błąd inicjalizacji Firebase:", error);
        firebaseReady = false;
    }
} else {
    console.warn("Firebase SDK nie załadował się");
}

let currentUser = null;
let playerData = null;

// --- KONFIGURACJA ŚWIATA I TŁA ---
const GAME_WIDTH = 1000;
const GAME_HEIGHT = 500;

const BG_WIDTH = 1900;
const BG_HEIGHT = 3450;
const WORLD_HEIGHT = BG_HEIGHT; // Świat ma wysokość obrazka (3450px)

// --- KONFIGURACJA WARSTW (Nowość!) ---
// Tutaj definiujesz pliki ręcznie.
// Kolejność: Od najdalszego tła (rysowane pierwsze) do najbliższego (rysowane ostatnie).
// speed: mnożnik prędkości (0 = stoi w miejscu, 1.0 = pełna prędkość, 1.2 = szybciej niż samolot)

const layersConfig = [

    { src: "7.png", speed: 0.1 },
    { src: "6.png", speed: 0.2 },
    { src: "5.png", speed: 0.3 },
    { src: "4.png", speed: 0.4 },
    { src: "3.png", speed: 0.5 },
    { src: "2.png", speed: 0.6 },
    { src: "1.png", speed: 0.8 },
    { src: "0.png", speed: 1.0 }  // Najbliższy plan (Porusza się najszybciej)
];

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Plane sprite
const planeImg = new Image();
planeImg.src = 'plane2d.png';
planeImg.onload = () => { console.log('Plane sprite loaded'); };
planeImg.onerror = () => { console.warn('Błąd ładowania pliku: plane2d.png'); };
// Stan
let gameRunning = false;
let gameMode = 'LOADING';
let controlType = 'touch';
let nickname = "Pilot";

// Tablica na załadowane obiekty grafik
const loadedLayers = [];
let imagesLoadedCount = 0;
let assetsReady = false;

// Fizyka
let frames = 0;
let score = 0;
let globalSpeed = 8;
let cameraY = 0;

let GRAVITY = 0.25;
let LIFT_FORCE = 0.6;
let DIVE_FORCE = 0.4;
const MAX_VELOCITY = 12;
let MAX_FUEL = 100;
let FUEL_CONSUMPTION = 0.20;
const OBSTACLE_PENALTY = 20;
const FUEL_REFILL = 30;

// Waluta i ulepszenia
let playerMoney = 0;
let playerUpgrades = {
    maxFuel: 0,
    efficiency: 0
};

// Gracz
const plane = {
    x: 150,
    y: WORLD_HEIGHT / 2,
    width: 60,
    height: 35,
    velocity: 0,
    fuel: MAX_FUEL,
    isCrashed: false,
    isOutOfFuel: false
};

let obstacles = [];
let fuels = [];
let input = { leftHeld: false, rightHeld: false, tilt: 0 };

// --- ŁADOWANIE (NOWA LOGIKA) ---

// Iterujemy po ręcznie zdefiniowanej liście layersConfig
layersConfig.forEach((layerData, index) => {
    const img = new Image();
    img.src = layerData.src;

    // Przygotowujemy obiekt warstwy
    const layerObj = {
        img: img,
        speed: layerData.speed,
        ready: false
    };

    // Wstawiamy go do tablicy loadedLayers w tej samej kolejności
    loadedLayers[index] = layerObj;

    img.onload = () => {
        layerObj.ready = true;
        imagesLoadedCount++;
        checkLoadStatus();
    };

    img.onerror = () => {
        console.warn(`Błąd ładowania pliku: ${layerData.src}`);
        imagesLoadedCount++; // Zliczamy mimo błędu, żeby gra ruszyła
        checkLoadStatus();
    };
});

function checkLoadStatus() {
    const percent = Math.floor((imagesLoadedCount / layersConfig.length) * 100);
    const statusElement = document.getElementById('loading-status');
    if (statusElement) {
        statusElement.innerText = `${percent}%`;
    }

    if (imagesLoadedCount === layersConfig.length) {
        // Sprawdzamy czy chociaż jedna warstwa się załadowała poprawnie
        const anySuccess = loadedLayers.some(l => l.ready);

        if (anySuccess) {
            assetsReady = true;
            setTimeout(onAssetsLoaded, 200);
        } else {
            const statusEl = document.getElementById('loading-status');
            if (statusEl) statusEl.innerText = "Błąd: Brak grafik. Tryb awaryjny.";
            setTimeout(onAssetsLoaded, 1000);
        }
    }
}

function forceStart() {
    onAssetsLoaded();
}

function onAssetsLoaded() {
    showScreen('login-screen');
    gameMode = 'LOGIN';
    cameraY = (WORLD_HEIGHT - GAME_HEIGHT) / 2;
    resizeCanvas();
    requestAnimationFrame(loop);
}

// Responsive canvas sizing (preserve aspect ratio and use devicePixelRatio)
function resizeCanvas() {
    const DPR = window.devicePixelRatio || 1;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const aspect = GAME_WIDTH / GAME_HEIGHT;

    // Fit to viewport while preserving aspect
    let displayWidth = viewportW;
    let displayHeight = Math.floor(displayWidth / aspect);
    if (displayHeight > viewportH) {
        displayHeight = viewportH;
        displayWidth = Math.floor(displayHeight * aspect);
    }

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    // Backing store size (for crisp rendering)
    canvas.width = Math.floor(GAME_WIDTH * DPR);
    canvas.height = Math.floor(GAME_HEIGHT * DPR);

    // Scale drawing operations so code can use GAME coordinates
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

window.addEventListener('resize', () => {
    resizeCanvas();
});

// --- UI ---

function showScreen(screenName) {
    // Ukryj wszystkie screeny
    const screens = ['loading-screen','login-screen','menu-screen','upgrades-screen','gameover-screen','leaderboard-screen'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    // Pokaż wybrany screen
    const screenEl = document.getElementById(screenName);
    if (screenEl) {
        screenEl.classList.remove('hidden');
    }
}

function goToMenu() {
    nickname = document.getElementById('nickname-input').value || "Pilot";
    // Wymagamy połączenia z Firebase
    if (!firebaseReady || !db) {
        alert('Brak połączenia z Firebase. Spróbuj ponownie później.');
        return;
    }
    showScreen('menu-screen');
    document.getElementById('welcome-text').innerText = `Witaj, ${nickname}!`;
    gameMode = 'MENU';
    // Załaduj dane gracza z Firebase
    loadPlayerData();
}

function setControls(type) {
    controlType = type;
    document.getElementById('control-info').innerText = `Wybrano: ${type === 'touch' ? 'Dotyk' : 'Żyroskop'}`;
    if (type === 'gyro' && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(console.error);
    }
}

function startGame() {
    // Hide any open UI screens and use canvas HUD instead of DOM HUD
    const screens = document.querySelectorAll('.screen');
    screens.forEach(s => s.classList.add('hidden'));
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.classList.add('hidden');
    resetGameLogic();
    resizeCanvas();
    gameRunning = true;
    gameMode = 'GAME';
}

function showLeaderboard() {
    showScreen('leaderboard-screen');
    gameMode = 'LEADERBOARD';
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;
    listEl.innerHTML = '<p>Ładowanie...</p>';

    if (!firebaseReady || !db) {
        listEl.innerHTML = '<p>Brak połączenia z Firebase. Nie można pobrać leaderboard.</p>';
        return;
    }

    db.collection('players').orderBy('bestRun', 'desc').limit(5).get()
        .then(snapshot => {
            if (snapshot.empty) {
                listEl.innerHTML = '<p>Brak danych.</p>';
                return;
            }
            const rows = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                rows.push(`<div style="padding:8px 0;border-bottom:1px solid #eee;"><strong>${d.nickname || doc.id}</strong> — ${d.bestRun || 0}m</div>`);
            });
            listEl.innerHTML = rows.join('');
        })
        .catch(err => {
            console.warn('Błąd pobierania leaderboard:', err);
            listEl.innerHTML = '<p>Błąd pobierania danych.</p>';
        });
}

function closeLeaderboard() {
    showScreen('menu-screen');
    gameMode = 'MENU';
}

function resetToMenu() {
    showScreen('menu-screen');
    gameMode = 'MENU';
    loadPlayerData();
}

function resetGameLogic() {
    plane.y = WORLD_HEIGHT / 2;
    plane.velocity = 0;
    plane.fuel = MAX_FUEL;
    plane.isCrashed = false;
    plane.isOutOfFuel = false;
    obstacles = [];
    fuels = [];
    score = 0;
    frames = 0;
    cameraY = (WORLD_HEIGHT - GAME_HEIGHT) / 2;
}

// --- INPUT ---

function handleStart(e) {
    if (gameMode !== 'GAME') return;
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++) {
        if (touches[i].clientX < window.innerWidth / 2) input.leftHeld = true;
        else input.rightHeld = true;
    }
}
function handleEnd(e) {
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++) {
        if (touches[i].clientX < window.innerWidth / 2) input.leftHeld = false;
        else input.rightHeld = false;
    }
}
window.addEventListener('mousedown', (e) => {
    if (gameMode !== 'GAME') return;
    if (e.clientX < window.innerWidth / 2) input.leftHeld = true; else input.rightHeld = true;
});
window.addEventListener('mouseup', () => { input.leftHeld = false; input.rightHeld = false; });
window.addEventListener('touchstart', (e) => { e.preventDefault(); handleStart(e); }, {passive: false});
window.addEventListener('touchend', (e) => { e.preventDefault(); handleEnd(e); }, {passive: false});

window.addEventListener('deviceorientation', (event) => {
    if (controlType !== 'gyro') return;
    let tilt = event.beta;
    if (tilt) input.tilt = Math.max(-1, Math.min(1, tilt / 30));
});

// --- LOGIKA ---

function update() {
    if (!gameRunning) return;

    frames++;
    score += globalSpeed / 10;

    if (plane.fuel <= 0) { plane.isOutOfFuel = true; plane.fuel = 0; }

    let acceleration = GRAVITY;
    if (!plane.isOutOfFuel) {
        if (controlType === 'touch') {
            if (input.leftHeld) { acceleration -= LIFT_FORCE; plane.fuel -= FUEL_CONSUMPTION; }
            if (input.rightHeld) { acceleration += DIVE_FORCE; }
        } else if (controlType === 'gyro') {
            if (input.tilt < -0.2) { acceleration -= LIFT_FORCE * Math.abs(input.tilt); plane.fuel -= FUEL_CONSUMPTION; }
            else if (input.tilt > 0.2) { acceleration += DIVE_FORCE * Math.abs(input.tilt); }
        }
    }

    plane.velocity += acceleration;
    if (plane.velocity > MAX_VELOCITY) plane.velocity = MAX_VELOCITY;
    if (plane.velocity < -MAX_VELOCITY) plane.velocity = -MAX_VELOCITY;

    plane.y += plane.velocity;

    // Kolizje Świat
    if (plane.y < 0) gameOver("Wleciałeś w kosmos!");
    if (plane.y + plane.height > WORLD_HEIGHT) gameOver("Rozbicie o ziemię!");

    // Kamera
    let targetCameraY = plane.y - (GAME_HEIGHT / 2) + (plane.height / 2);
    if (targetCameraY < 0) targetCameraY = 0;
    if (targetCameraY > WORLD_HEIGHT - GAME_HEIGHT) targetCameraY = WORLD_HEIGHT - GAME_HEIGHT;
    cameraY = targetCameraY;

    // Spawning
    if (frames % 80 === 0) {
        if (Math.random() < 0.35) spawnFuel();
        else spawnObstacle();
    }

    updateEntities(obstacles, 'obstacle');
    updateEntities(fuels, 'fuel');

    // HUD will be drawn on canvas (not DOM)
}

function spawnObstacle() {
    obstacles.push({
        x: GAME_WIDTH + 100,
        y: 100 + Math.random() * (WORLD_HEIGHT - 300),
        width: 50, height: 100 + Math.random() * 150, active: true
    });
}
function spawnFuel() {
    fuels.push({
        x: GAME_WIDTH + 100,
        y: 100 + Math.random() * (WORLD_HEIGHT - 200),
        width: 40, height: 40, active: true
    });
}

function updateEntities(list, type) {
    for (let i = 0; i < list.length; i++) {
        let e = list[i];
        e.x -= globalSpeed;
        if (e.active && plane.x < e.x + e.width && plane.x + plane.width > e.x &&
            plane.y < e.y + e.height && plane.y + plane.height > e.y) {
            e.active = false;
            if (type === 'obstacle') plane.fuel -= OBSTACLE_PENALTY;
            else if (type === 'fuel') { plane.fuel += FUEL_REFILL; if(plane.fuel > MAX_FUEL) plane.fuel = MAX_FUEL; }
        }
        if (e.x + e.width < -100) { list.splice(i, 1); i--; }
    }
}

function gameOver(reason) {
    gameRunning = false;
    showScreen('gameover-screen');
    document.getElementById('final-reason').innerText = reason;
    const finalScore = Math.floor(score);
    document.getElementById('final-score').innerText = finalScore;
    
    // Dodaj walutę (score * 0.1)
    const earnedCurrency = Math.floor(finalScore * 0.1);
    document.getElementById('earned-currency').innerText = `Zarobiono: $${earnedCurrency}`;
    
    // Zapisz wynik do Firebase
    savePlayerResult(finalScore, earnedCurrency);
}

// --- RYSOWANIE ---

function draw() {
    try {
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        if (assetsReady) {
            drawBackgroundImages();
        } else {
            drawFallbackBackground();
        }

        drawEntities();
        drawPlane();

        // Draw HUD elements onto the canvas only during gameplay
        if (gameMode === 'GAME') drawCanvasHUD();

    } catch (e) {
        console.error(e);
        document.getElementById('error-log').innerText = "Błąd: " + e.message;
    }
}

function drawCanvasHUD() {
    // Use GAME coordinate space
    ctx.save();

    const padding = 14;
    const boxW = 320;
    const boxH = 60;

    // Background panel
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = 'black';
    ctx.fillRect(padding - 8, padding - 8, boxW, boxH);
    ctx.globalAlpha = 1;

    // Distance text
    ctx.fillStyle = 'white';
    ctx.font = '20px sans-serif';
    ctx.fillText(`DYSTANS: ${Math.floor(score)}m`, padding, padding + 22);

    // Fuel label
    ctx.font = '14px sans-serif';
    ctx.fillText('PALIWO', padding, padding + 44);

    // Fuel bar
    const barX = padding + 90;
    const barY = padding + 30;
    const barW = 210;
    const barH = 16;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    const pct = Math.max(0, Math.min(1, plane.fuel / MAX_FUEL));
    ctx.fillStyle = plane.fuel < 25 ? 'red' : 'orange';
    ctx.fillRect(barX + 1, barY + 1, (barW - 2) * pct, barH - 2);

    ctx.restore();
}

function drawBackgroundImages() {
    const numTiles = Math.ceil(GAME_WIDTH / BG_WIDTH) + 1;

    // Rysujemy warstwy w kolejności zdefiniowanej w tablicy layersConfig
    // Indeks 0 = Tło (rysowane pierwsze)
    // Indeks Ostatni = Pierwszy plan (rysowany ostatni)
    loadedLayers.forEach((layer, i) => {
        if (!layer.ready) return;

        // Każda warstwa ma swoją prędkość (layer.speed)
        // Make background static (no scroll) when not in GAME mode
        let currentScroll = 0;
        if (gameMode === 'GAME') {
            currentScroll = (score * 10 * layer.speed) % BG_WIDTH;
        }
        let drawY = 0 - cameraY;

        for(let t = 0; t < numTiles; t++) {
            let drawX = (t * BG_WIDTH) - currentScroll;
            // Rysowanie 1:1 bez skalowania
            ctx.drawImage(layer.img, drawX, drawY, BG_WIDTH, BG_HEIGHT);
        }
    });
}

function drawFallbackBackground() {
    let drawY = 0 - cameraY;
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, drawY + WORLD_HEIGHT - 200, GAME_WIDTH, 200);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, drawY, GAME_WIDTH, 50);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    for(let y = 0; y < WORLD_HEIGHT; y+=500) {
         ctx.beginPath(); ctx.moveTo(0, y - cameraY); ctx.lineTo(GAME_WIDTH, y - cameraY); ctx.stroke();
    }
}

function drawEntities() {
    obstacles.forEach(o => {
        if(o.active) {
            ctx.fillStyle = '#444';
            ctx.fillRect(o.x, o.y - cameraY, o.width, o.height);
        }
    });
    fuels.forEach(f => {
        if(f.active) {
            ctx.fillStyle = 'gold';
            ctx.fillRect(f.x, f.y - cameraY, f.width, f.height);
            ctx.fillStyle = 'black';
            ctx.font = '20px Arial';
            ctx.fillText("F", f.x + 10, f.y - cameraY + 25);
        }
    });
}

function drawPlane() {
    let screenY = plane.y - cameraY;
    ctx.save();
    ctx.translate(plane.x + plane.width/2, screenY + plane.height/2);
    ctx.rotate((plane.velocity * 2.5) * (Math.PI / 180));

    if (planeImg && planeImg.complete && planeImg.naturalWidth > 0) {
        ctx.drawImage(planeImg, -plane.width/2, -plane.height/2, plane.width, plane.height);
    } else {
        ctx.fillStyle = plane.isOutOfFuel ? '#555' : '#e74c3c';
        ctx.fillRect(-plane.width/2, -plane.height/2, plane.width, plane.height);
        ctx.fillStyle = 'white';
        ctx.fillRect(plane.width/4, -5, 10, 10);
    }

    ctx.restore();
}

function loop() {
    update();
    draw();
    if (gameMode !== 'GAME') {
        // Keep camera static and do not advance score when not playing
        cameraY = (WORLD_HEIGHT - GAME_HEIGHT) / 2;
    }
    requestAnimationFrame(loop);
}

// --- FIREBASE FUNKCJE ---

function loadPlayerData() {
    if (!nickname || nickname === "Pilot") return;
    
    if (!firebaseReady || !db) {
        alert('Brak połączenia z Firebase. Nie można załadować danych gracza.');
        return;
    }

    db.collection("players").doc(nickname).get()
        .then(doc => {
            if (doc.exists) {
                playerData = doc.data();
                playerMoney = playerData.money || 0;
                playerUpgrades = playerData.upgrades || { maxFuel: 0, efficiency: 0 };
                playerData.bestRun = playerData.bestRun || 0;
                applyUpgrades();
                console.log("Dane załadowane z Firebase");
            } else {
                // Pierwszy raz gracz - utwórz dokument
                playerData = {
                    nickname: nickname,
                    money: 0,
                    upgrades: { maxFuel: 0, efficiency: 0 },
                    totalScore: 0,
                    bestRun: 0,
                    gamesPlayed: 0,
                    lastGame: null
                };
                playerMoney = 0;
                playerUpgrades = { maxFuel: 0, efficiency: 0 };
                db.collection("players").doc(nickname).set(playerData)
                    .then(() => console.log('Utworzono nowego gracza w Firebase'))
                    .catch(err => console.warn('Błąd tworzenia gracza w Firebase:', err));
                applyUpgrades();
                console.log("Nowy gracz");
            }
            updateCurrencyDisplay();
        })
        .catch(error => {
            console.warn("Błąd ładowania z Firebase:", error);
            alert('Błąd komunikacji z Firebase.');
        });
}

function savePlayerResult(finalScore, earnedCurrency) {
    if (!nickname || nickname === "Pilot") return;
    
    playerMoney += earnedCurrency;
    
    if (!firebaseReady || !db) {
        alert('Brak połączenia z Firebase. Wynik nie został zapisany.');
        return;
    }
    
    const newMoney = playerMoney;
    const newTotalScore = (playerData?.totalScore || 0) + finalScore;
    const newGamesPlayed = (playerData?.gamesPlayed || 0) + 1;
    const newBestRun = Math.max((playerData?.bestRun || 0), finalScore);

    db.collection("players").doc(nickname).set({
        nickname: nickname,
        money: newMoney,
        upgrades: playerUpgrades,
        totalScore: newTotalScore,
        bestRun: newBestRun,
        gamesPlayed: newGamesPlayed,
        lastGame: new Date()
    })
    .then(() => {
        if (playerData) {
            playerData.money = newMoney;
            playerData.totalScore = newTotalScore;
            playerData.bestRun = newBestRun;
            playerData.gamesPlayed = newGamesPlayed;
        }
        console.log("Wynik zapisany do Firebase");
    })
    .catch(error => {
        console.warn("Błąd zapisu do Firebase:", error);
    });
    
    document.getElementById('earned-currency').innerText = `Zarobiono: +$${earnedCurrency}`;
    updateCurrencyDisplay();
}

function applyUpgrades() {
    // Zwiększenie paliwa początkowego (każdy poziom = +20 paliwa)
    MAX_FUEL = 100 + (playerUpgrades.maxFuel || 0) * 20;
    
    // Zmniejszenie zużycia paliwa (każdy poziom = -0.05 zużycia, minimum 0.05)
    FUEL_CONSUMPTION = Math.max(0.05, 0.20 - (playerUpgrades.efficiency || 0) * 0.05);
    
    // Resetuj paliwo gracza
    plane.fuel = MAX_FUEL;
}

function goToUpgrades() {
    showScreen('upgrades-screen');
    gameMode = 'UPGRADES';
    updateCurrencyDisplay();
}

function updateCurrencyDisplay() {
    const amt = document.getElementById('currency-amount');
    if (amt) amt.innerText = Math.floor(playerMoney || 0);
    const flevel = document.getElementById('fuel-upgrade-level');
    if (flevel) flevel.innerText = `Poziom: ${playerUpgrades.maxFuel || 0}`;
    const elevel = document.getElementById('efficiency-upgrade-level');
    if (elevel) elevel.innerText = `Poziom: ${playerUpgrades.efficiency || 0}`;
}

function buyUpgrade(upgradeType) {
    if (!firebaseReady || !db) {
        alert('Brak połączenia z Firebase. Nie można kupować ulepszeń.');
        return;
    }
    const costMaxFuel = 10;
    const costEfficiency = 15;
    
    if (upgradeType === 'maxFuel') {
        if (playerMoney >= costMaxFuel) {
            playerMoney -= costMaxFuel;
            playerUpgrades.maxFuel = (playerUpgrades.maxFuel || 0) + 1;
            saveUpgrades();
            alert('Ulepszenie kupione! Paliwo początkowe +20');
        } else {
            alert('Za mało pieniędzy! Potrzebujesz $' + costMaxFuel);
        }
    } else if (upgradeType === 'efficiency') {
        if (playerMoney >= costEfficiency) {
            playerMoney -= costEfficiency;
            playerUpgrades.efficiency = (playerUpgrades.efficiency || 0) + 1;
            saveUpgrades();
            alert('Ulepszenie kupione! Zużycie paliwa zmniejszone o 0.05');
        } else {
            alert('Za mało pieniędzy! Potrzebujesz $' + costEfficiency);
        }
    }
    updateCurrencyDisplay();
}

function saveUpgrades() {
    if (!nickname || nickname === "Pilot") return;
    if (!firebaseReady || !db) {
        alert('Brak połączenia z Firebase. Nie można zapisać ulepszeń.');
        return;
    }

    db.collection("players").doc(nickname).update({
        money: playerMoney,
        upgrades: playerUpgrades
    })
    .then(() => {
        applyUpgrades();
        console.log("Ulepszenia zapisane do Firebase");
    })
    .catch(error => {
        console.warn("Błąd zapisu upgradów do Firebase:", error);
        alert('Błąd zapisu ulepszeń do Firebase.');
    });
}
