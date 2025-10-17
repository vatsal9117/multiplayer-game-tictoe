// server.js - WebSocket-based Multiplayer Game Server
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static('public'));

// Game state management
const games = new Map(); // roomId -> game state
const players = new Map(); // socketId -> player info
const waitingPlayers = []; // Queue for matchmaking

class Game {
  constructor(roomId, player1, player2) {
    this.roomId = roomId;
    this.board = Array(9).fill(null);
    this.players = {
      X: player1,
      O: player2
    };
    this.currentTurn = 'X';
    this.winner = null;
    this.isDraw = false;
    this.moveCount = 0;
    this.startTime = Date.now();
  }

  makeMove(position, symbol) {
    if (this.board[position] !== null || this.winner || this.isDraw) {
      return false;
    }
    
    this.board[position] = symbol;
    this.moveCount++;
    this.checkWinner();
    this.currentTurn = this.currentTurn === 'X' ? 'O' : 'X';
    return true;
  }

  checkWinner() {
    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
      [0, 4, 8], [2, 4, 6] // diagonals
    ];

    for (let pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (this.board[a] && 
          this.board[a] === this.board[b] && 
          this.board[a] === this.board[c]) {
        this.winner = this.board[a];
        return;
      }
    }

    if (this.moveCount === 9) {
      this.isDraw = true;
    }
  }

  getState() {
    return {
      board: this.board,
      currentTurn: this.currentTurn,
      winner: this.winner,
      isDraw: this.isDraw,
      players: this.players,
      moveCount: this.moveCount
    };
  }
}

// Metrics tracking
const metrics = {
  totalGames: 0,
  activeGames: 0,
  totalConnections: 0,
  peakConnections: 0,
  averageGameDuration: 0
};

io.on('connection', (socket) => {
  metrics.totalConnections++;
  metrics.peakConnections = Math.max(metrics.peakConnections, io.engine.clientsCount);
  
  console.log(`Player connected: ${socket.id} | Active connections: ${io.engine.clientsCount}`);

  socket.emit('connected', { 
    playerId: socket.id,
    metrics: {
      activeGames: metrics.activeGames,
      activePlayers: io.engine.clientsCount
    }
  });

  // Matchmaking - find opponent
  socket.on('findGame', () => {
    if (waitingPlayers.length > 0) {
      // Match with waiting player
      const opponent = waitingPlayers.shift();
      const roomId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create game
      const game = new Game(roomId, socket.id, opponent.id);
      games.set(roomId, game);
      
      // Join both players to room
      socket.join(roomId);
      opponent.join(roomId);
      
      // Store player info
      players.set(socket.id, { roomId, symbol: 'X', name: `Player1` });
      players.set(opponent.id, { roomId, symbol: 'O', name: `Player2` });
      
      metrics.totalGames++;
      metrics.activeGames++;
      
      // Notify both players
      io.to(socket.id).emit('gameStart', { 
        roomId, 
        symbol: 'X', 
        opponent: 'Player2',
        gameState: game.getState() 
      });
      
      io.to(opponent.id).emit('gameStart', { 
        roomId, 
        symbol: 'O', 
        opponent: 'Player1',
        gameState: game.getState() 
      });
      
      console.log(`Game started: ${roomId} | Active games: ${metrics.activeGames}`);
    } else {
      // Add to waiting queue
      waitingPlayers.push(socket);
      socket.emit('waiting', { message: 'Searching for opponent...' });
      console.log(`Player ${socket.id} waiting for opponent | Queue size: ${waitingPlayers.length}`);
    }
  });

  // Handle game moves
  socket.on('makeMove', ({ roomId, position }) => {
    const game = games.get(roomId);
    const player = players.get(socket.id);
    
    if (!game || !player) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    
    if (game.currentTurn !== player.symbol) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }
    
    const moveSuccess = game.makeMove(position, player.symbol);
    
    if (moveSuccess) {
      // Broadcast updated state to both players
      io.to(roomId).emit('gameUpdate', game.getState());
      
      // Check if game ended
      if (game.winner || game.isDraw) {
        const gameDuration = (Date.now() - game.startTime) / 1000;
        
        // Update metrics
        metrics.activeGames--;
        const totalDuration = metrics.averageGameDuration * (metrics.totalGames - 1) + gameDuration;
        metrics.averageGameDuration = totalDuration / metrics.totalGames;
        
        setTimeout(() => {
          io.to(roomId).emit('gameEnd', {
            winner: game.winner,
            isDraw: game.isDraw,
            duration: gameDuration,
            moves: game.moveCount
          });
          
          // Cleanup
          games.delete(roomId);
          players.delete(socket.id);
          const opponentId = game.players[player.symbol === 'X' ? 'O' : 'X'];
          players.delete(opponentId);
        }, 100);
        
        console.log(`Game ended: ${roomId} | Duration: ${gameDuration.toFixed(1)}s | Winner: ${game.winner || 'Draw'}`);
      }
    } else {
      socket.emit('error', { message: 'Invalid move' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Remove from waiting queue
    const waitingIndex = waitingPlayers.indexOf(socket);
    if (waitingIndex > -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Handle active game disconnect
    const player = players.get(socket.id);
    if (player && player.roomId) {
      const game = games.get(player.roomId);
      if (game) {
        const opponentId = game.players[player.symbol === 'X' ? 'O' : 'X'];
        io.to(opponentId).emit('opponentDisconnected', { 
          message: 'Opponent disconnected. You win!' 
        });
        
        games.delete(player.roomId);
        metrics.activeGames--;
        players.delete(opponentId);
      }
    }
    
    players.delete(socket.id);
  });

  // Get server metrics
  socket.on('getMetrics', () => {
    socket.emit('metrics', {
      ...metrics,
      activeConnections: io.engine.clientsCount,
      gamesInProgress: metrics.activeGames,
      waitingPlayers: waitingPlayers.length
    });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    metrics: {
      ...metrics,
      activeConnections: io.engine.clientsCount,
      timestamp: new Date().toISOString()
    }
  });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({
    ...metrics,
    activeConnections: io.engine.clientsCount,
    gamesInProgress: metrics.activeGames,
    waitingPlayers: waitingPlayers.length,
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Multiplayer Game Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
});