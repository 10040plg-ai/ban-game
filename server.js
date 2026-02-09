const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7 
});

app.use(express.static('public'));

let rooms = {};
let gameTimers = {}; 

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        const { room, name, avatar } = data;
        socket.join(room);
        if (!rooms[room]) {
            rooms[room] = { players: {}, status: 'waiting', hostId: socket.id };
        }
        rooms[room].players[socket.id] = {
            id: socket.id, 
            name: name, 
            avatar: avatar, 
            x: Math.random() * 300 + 50, 
            y: Math.random() * 300 + 100,
            forbiddenWord: '', 
            isAlive: true, 
            isReady: false, 
            isMoving: false,
            isHost: (rooms[room].hostId === socket.id)
        };
        io.to(room).emit('updatePlayers', rooms[room].players);
    });

    socket.on('move', (data) => {
        const { room, x, y, isMoving } = data;
        const session = rooms[room];
        if (session && session.players[socket.id]) {
            session.players[socket.id].x = x;
            session.players[socket.id].y = y;
            session.players[socket.id].isMoving = isMoving;
            io.to(room).emit('updatePlayers', session.players);
        }
    });

    socket.on('requestStart', (room) => {
        const session = rooms[room];
        if (session && session.hostId === socket.id) {
            io.to(room).emit('openWordSetter', session.players);
        }
    });

    socket.on('setWordAndReady', (data) => {
        const { room, targetId, word } = data;
        const session = rooms[room];
        if (session && session.players[targetId]) {
            session.players[targetId].forbiddenWord = word;
            session.players[socket.id].isReady = true;
            const allReady = Object.values(session.players).every(p => p.isReady);
            if (allReady) {
                session.status = 'playing';
                io.to(room).emit('gameStarted');
                Object.keys(session.players).forEach(pid => {
                    startAFKTimer(room, pid);
                });
            }
            io.to(room).emit('updatePlayers', session.players);
        }
    });

    socket.on('chat', (data) => {
        const { room, message } = data;
        const session = rooms[room];
        if (!session) return;
        const player = session.players[socket.id];
        if (!player) return;

        if (session.status === 'playing' && player.isAlive) {
            startAFKTimer(room, socket.id); // 채팅 시 타이머 초기화

            if (player.forbiddenWord && message.includes(player.forbiddenWord)) {
                eliminatePlayer(room, socket.id, "금지어 사용"); // 사유 전달
            } else {
                io.to(room).emit('newMessage', { 
                    name: player.name, 
                    message: message, 
                    isAlive: true 
                });
            }
        } else {
            io.to(room).emit('newMessage', { name: player.name, message: message, isAlive: player.isAlive });
        }
    });

    socket.on('disconnect', () => {
        for (const r in rooms) {
            if (rooms[r].players && rooms[r].players[socket.id]) {
                const wasHost = (rooms[r].hostId === socket.id);
                delete rooms[r].players[socket.id];
                if (gameTimers[socket.id]) clearTimeout(gameTimers[socket.id]);
                if (wasHost && Object.keys(rooms[r].players).length > 0) {
                    const nextHostId = Object.keys(rooms[r].players)[0];
                    rooms[r].hostId = nextHostId;
                    rooms[r].players[nextHostId].isHost = true;
                }
                io.to(r).emit('updatePlayers', rooms[r].players);
            }
        }
    });

    socket.on('forceEndGame', (room) => {
        const session = rooms[room];
        if (session && session.hostId === socket.id) {
            resetGameStatus(room);
            io.to(room).emit('gameEnded'); 
        }
    });

    function eliminatePlayer(room, playerId, reason) {
        const session = rooms[room];
        if (!session || !session.players[playerId]) return;
        const player = session.players[playerId];
        if (!player.isAlive) return;

        player.isAlive = false;
        if (gameTimers[playerId]) clearTimeout(gameTimers[playerId]);
        
        // 클라이언트로 탈락 사유(reason)를 보냄
        io.to(room).emit('playerOut', { name: player.name, word: player.forbiddenWord, reason: reason });
        
        const alivePlayers = Object.values(session.players).filter(p => p.isAlive);
        if (alivePlayers.length === 1) {
            io.to(room).emit('gameWinner', alivePlayers[0].name);
            resetGameStatus(room);
        }
        io.to(room).emit('updatePlayers', session.players);
    }

    function startAFKTimer(room, playerId) {
        if (gameTimers[playerId]) clearTimeout(gameTimers[playerId]);
        gameTimers[playerId] = setTimeout(() => {
            eliminatePlayer(room, playerId, "30초 시간 초과"); // 시간 초과 사유 전달
        }, 30000);
    }

    function resetGameStatus(room) {
        const session = rooms[room];
        if (session) {
            session.status = 'waiting';
            for (const id in session.players) {
                session.players[id].isAlive = true;
                session.players[id].isReady = false;
                session.players[id].forbiddenWord = '';
                if (gameTimers[id]) clearTimeout(gameTimers[id]);
            }
            io.to(room).emit('updatePlayers', session.players);
        }
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`서버 실행 중: http://localhost:${PORT}`);
});
