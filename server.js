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

io.on('connection', (socket) => {
    // 플레이어 입장 및 방장 설정
    socket.on('join', (data) => {
        const { room, name, avatar } = data;
        socket.join(room);
        
        if (!rooms[room]) {
            // 방이 없으면 생성하고 첫 입장자를 방장(hostId)으로 설정
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
            isHost: (rooms[room].hostId === socket.id) // 방장 여부 저장
        };
        io.to(room).emit('updatePlayers', rooms[room].players);
    });

    // 캐릭터 이동
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

    // 시작 버튼 클릭 (방장만 가능)
    socket.on('requestStart', (room) => {
        const session = rooms[room];
        if (session && session.hostId === socket.id) {
            io.to(room).emit('openWordSetter', session.players);
        }
    });

    // 강제 종료 (방장만 가능)
    socket.on('forceEndGame', (room) => {
        const session = rooms[room];
        if (session && session.hostId === socket.id) {
            resetGameStatus(room);
            io.to(room).emit('gameEnded'); 
        }
    });

    // 금지어 설정 및 준비 완료
    socket.on('setWordAndReady', (data) => {
        const { room, targetId, word } = data;
        const session = rooms[room];
        if (session && session.players[targetId]) {
            session.players[targetId].forbiddenWord = word;
            session.players[socket.id].isReady = true;
            
            // 모든 플레이어가 준비되었는지 확인
            const allReady = Object.values(session.players).every(p => p.isReady);
            if (allReady) {
                session.status = 'playing';
                io.to(room).emit('gameStarted');
            }
            io.to(room).emit('updatePlayers', session.players);
        }
    });

    // 채팅 및 금지어 체크 + 승리 판정
    socket.on('chat', (data) => {
        const { room, message } = data;
        const session = rooms[room];
        if (!session) return;
        const player = session.players[socket.id];
        if (!player) return;

        // 게임 중일 때 금지어 검사
        if (session.status === 'playing' && player.isAlive && player.forbiddenWord && message.includes(player.forbiddenWord)) {
            player.isAlive = false;
            io.to(room).emit('playerOut', { name: player.name, word: player.forbiddenWord });
            
            // 생존자 확인 후 승리 판정
            const alivePlayers = Object.values(session.players).filter(p => p.isAlive);
            if (alivePlayers.length === 1) {
                io.to(room).emit('gameWinner', alivePlayers[0].name);
                resetGameStatus(room);
            }
        } else {
            io.to(room).emit('newMessage', { 
                name: player.name, 
                message: message, 
                isAlive: player.isAlive 
            });
        }
        io.to(room).emit('updatePlayers', session.players);
    });

    // 퇴장 처리 및 방장 위임
    socket.on('disconnect', () => {
        for (const r in rooms) {
            if (rooms[r].players && rooms[r].players[socket.id]) {
                const wasHost = (rooms[r].hostId === socket.id);
                delete rooms[r].players[socket.id];
                
                if (wasHost && Object.keys(rooms[r].players).length > 0) {
                    const nextHostId = Object.keys(rooms[r].players)[0];
                    rooms[r].hostId = nextHostId;
                    rooms[r].players[nextHostId].isHost = true;
                }
                io.to(r).emit('updatePlayers', rooms[r].players);
            }
        }
    });

    // 게임 상태 리셋 함수
    function resetGameStatus(room) {
        const session = rooms[room];
        if (session) {
            session.status = 'waiting';
            for (const id in session.players) {
                session.players[id].isAlive = true;
                session.players[id].isReady = false;
                session.players[id].forbiddenWord = '';
            }
            io.to(room).emit('updatePlayers', session.players);
        }
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`서버 실행 중: http://localhost:${PORT}`);
});
