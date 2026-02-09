const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.static('public'));
let rooms = {};

io.on('connection', (socket) => {
    socket.on('join', ({ room, name, avatar }) => {
        socket.join(room);
        if (!rooms[room]) rooms[room] = { players: {}, status: 'waiting' };
        
        rooms[room].players[socket.id] = {
            id: socket.id, name, avatar, 
            x: Math.random() * 200 + 50, y: Math.random() * 200 + 100,
            forbiddenWord: '', isAlive: true, isReady: false, isMoving: false
        };
        io.to(room).emit('updatePlayers', rooms[room].players);
    });

    socket.on('move', ({ room, x, y, isMoving }) => {
        const session = rooms[room];
        if (session && session.players[socket.id]) {
            session.players[socket.id].x = x;
            session.players[socket.id].y = y;
            session.players[socket.id].isMoving = isMoving;
            io.to(room).emit('updatePlayers', session.players);
        }
    });

    socket.on('requestStart', (room) => {
        if (rooms[room]) io.to(room).emit('openWordSetter', rooms[room].players);
    });

    socket.on('forceEndGame', (room) => {
        const session = rooms[room];
        if (session) {
            session.status = 'waiting';
            for (let id in session.players) {
                session.players[id].isAlive = true;
                session.players[id].isReady = false;
                session.players[id].forbiddenWord = '';
            }
            io.to(room).emit('gameEnded'); 
            io.to(room).emit('updatePlayers', session.players);
        }
    });

    socket.on('setWordAndReady', ({ room, targetId, word }) => {
        const session = rooms[room];
        if (session && session.players[targetId]) {
            session.players[targetId].forbiddenWord = word;
            session.players[socket.id].isReady = true;
            if (Object.values(session.players).every(p => p.isReady)) {
                session.status = 'playing';
                io.to(room).emit('gameStarted');
            }
            io.to(room).emit('updatePlayers', session.players);
        }
    });

    socket.on('chat', ({ room, message }) => {
        const session = rooms[room];
        if (!session) return;
        const player = session.players[socket.id];
        if (!player) return;

        if (session.status === 'playing' && player.isAlive && player.forbiddenWord && message.includes(player.forbiddenWord)) {
            player.isAlive = false;
            io.to(room).emit('playerOut', { name: player.name, word: player.forbiddenWord });
        } else {
            io.to(room).emit('newMessage', { 
                name: player.name, 
                message, 
                isAlive: player.isAlive 
            });
        }
        io.to(room).emit('updatePlayers', session.players);
    });

    socket.on('disconnect', () => {
        for (let r in rooms) {
            if (rooms[r].players[socket.id]) {
                delete rooms[r].players[socket.id];
                io.to(r).emit('updatePlayers', rooms[r].players);
            }
        }
    });
});

server.listen(3000, () => console.log('서버 실행 중: http://localhost:3000'));
