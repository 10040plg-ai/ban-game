const socket = io();
let myData = { name: '', avatar: '', x: 300, y: 400 };
let players = {}; 
let currentRoom, targetIdForWord;
const keys = {};

document.getElementById('imageInput').onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 150; canvas.height = 150;
            canvas.getContext('2d').drawImage(img, 0, 0, 150, 150);
            myData.avatar = canvas.toDataURL('image/jpeg', 0.8);
            document.getElementById('avatar-preview').innerHTML = `<img src="${myData.avatar}" style="width:100%;height:100%;border-radius:50%">`;
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(e.target.files[0]);
};

function finishSetup() {
    myData.name = document.getElementById('nickName').value;
    if (!myData.name || !myData.avatar) return alert("사진과 이름을 확인하세요!");
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';
}

function connectRoom() {
    currentRoom = document.getElementById('roomCode').value;
    socket.emit('join', { room: currentRoom, name: myData.name, avatar: myData.avatar });
    document.getElementById('room-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function gameLoop() {
    updateMyPosition();
    renderAllPlayers();
    requestAnimationFrame(gameLoop);
}

function updateMyPosition() {
    if (document.activeElement.tagName === 'INPUT') return;
    const speed = 4;
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= speed;
    if (keys['s'] || keys['arrowdown']) dy += speed;
    if (keys['a'] || keys['arrowleft']) dx -= speed;
    if (keys['d'] || keys['arrowright']) dx += speed;

    if (dx !== 0 || dy !== 0) {
        const nextX = Math.max(0, Math.min(window.innerWidth - 80, myData.x + dx));
        const nextY = Math.max(0, Math.min(window.innerHeight - 100, myData.y + dy));
        if (myData.x !== nextX || myData.y !== nextY) {
            myData.x = nextX;
            myData.y = nextY;
            socket.emit('move', { room: currentRoom, x: myData.x, y: myData.y, isMoving: true });
            clearTimeout(window.stopT);
            window.stopT = setTimeout(() => {
                socket.emit('move', { room: currentRoom, x: myData.x, y: myData.y, isMoving: false });
            }, 100);
        }
    }
}

socket.on('updatePlayers', (serverPlayers) => {
    for (let id in serverPlayers) {
        if (!players[id]) {
            players[id] = { ...serverPlayers[id], curX: serverPlayers[id].x, curY: serverPlayers[id].y };
        } else {
            Object.assign(players[id], serverPlayers[id]);
        }
    }
    for (let id in players) { if (!serverPlayers[id]) delete players[id]; }
    document.getElementById('leader-list').innerHTML = Object.values(serverPlayers).map(p => `
        <div class="leader-item"><span>${p.name}</span><span class="word-badge">${p.forbiddenWord || '???'}</span></div>
    `).join('');
});

function renderAllPlayers() {
    const layer = document.getElementById('avatar-layer');
    if (!layer) return;
    let html = "";
    for (let id in players) {
        const p = players[id];
        p.curX += (p.x - p.curX) * 0.15;
        p.curY += (p.y - p.curY) * 0.15;
        html += `
            <div class="avatar-wrapper ${p.isAlive ? '' : 'dead'}" style="transform: translate(${p.curX}px, ${p.curY}px);">
                <img src="${p.avatar}" class="avatar-img ${p.isMoving ? 'walking' : ''}">
                <div class="label">${p.name} ${p.isReady ? '✅' : ''}</div>
            </div>
        `;
    }
    layer.innerHTML = html;
}

function requestStart() { socket.emit('requestStart', currentRoom); }

function forceEnd() {
    if (confirm("게임을 강제로 종료하시겠습니까?")) {
        socket.emit('forceEndGame', currentRoom);
    }
}

socket.on('openWordSetter', (ps) => {
    const ids = Object.keys(ps);
    targetIdForWord = ids[(ids.indexOf(socket.id) + 1) % ids.length];
    document.getElementById('target-player-name').innerText = ps[targetIdForWord].name;
    document.getElementById('word-setter').style.display = 'block';
});

function confirmWord() {
    const word = document.getElementById('target-word-input').value;
    socket.emit('setWordAndReady', { room: currentRoom, targetId: targetIdForWord, word });
    document.getElementById('word-setter').style.display = 'none';
}

document.getElementById('chatInput').onkeypress = (e) => {
    if (e.key === 'Enter') {
        socket.emit('chat', { room: currentRoom, message: e.target.value });
        e.target.value = '';
    }
};

socket.on('newMessage', (d) => {
    const chat = document.getElementById('chat-display');
    const ghostClass = d.isAlive ? "" : "ghost-chat";
    const ghostTag = d.isAlive ? "" : "<span class='ghost-tag'>[탈락자]</span> ";
    chat.innerHTML += `<div class="${ghostClass}"><strong>${ghostTag}${d.name}:</strong> ${d.message}</div>`;
    chat.scrollTop = chat.scrollHeight;
});

socket.on('playerOut', (p) => alert(`${p.name} 탈락! 금지어: ${p.word}`));
socket.on('gameStarted', () => alert("게임 시작!"));
socket.on('gameEnded', () => {
    alert("게임이 종료되었습니다.");
    document.getElementById('word-setter').style.display = 'none';
});