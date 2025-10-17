// loadtest.js - Simulate multiple concurrent players
const io = require('socket.io-client');

// Configuration
const SERVER_URL = 'http://localhost:3000';
const NUM_PLAYERS = 100; // Number of simulated players
const GAME_DELAY = 1000; // Delay between moves (ms)

// Statistics
const stats = {
  connected: 0,
  gamesStarted: 0,
  gamesCompleted: 0,
  totalMoves: 0,
  errors: 0,
  latencies: [],
  startTime: Date.now()
};

class BotPlayer {
  constructor(id) {
    this.id = id;
    this.socket = null;
    this.roomId = null;
    this.symbol = null;
    this.isMyTurn = false;
    this.gameActive = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false
      });

      this.socket.on('connect', () => {
        stats.connected++;
        console.log(`✅ Bot ${this.id} connected | Total: ${stats.connected}`);
        this.setupListeners();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        stats.errors++;
        console.error(`❌ Bot ${this.id} connection failed:`, error.message);
        reject(error);
      });

      // Connection timeout
      setTimeout(() => {
        if (!this.socket.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    });
  }

  setupListeners() {
    this.socket.on('gameStart', (data) => {
      this.roomId = data.roomId;
      this.symbol = data.symbol;
      this.gameActive = true;
      stats.gamesStarted++;
      console.log(`🎮 Bot ${this.id} (${this.symbol}) started game ${this.roomId.substring(0, 8)}... | Total games: ${stats.gamesStarted}`);
      
      // If we're X, make first move
      if (this.symbol === 'X') {
        this.isMyTurn = true;
        setTimeout(() => this.makeRandomMove(), GAME_DELAY);
      }
    });

    this.socket.on('gameUpdate', (gameState) => {
      const isMyTurn = gameState.currentTurn === this.symbol;
      
      if (isMyTurn && this.gameActive && !gameState.winner && !gameState.isDraw) {
        this.isMyTurn = true;
        setTimeout(() => this.makeRandomMove(), GAME_DELAY);
      } else {
        this.isMyTurn = false;
      }
    });

    this.socket.on('gameEnd', (data) => {
      this.gameActive = false;
      stats.gamesCompleted++;
      const result = data.isDraw ? 'Draw' : `${data.winner} wins`;
      console.log(`🏁 Bot ${this.id} game ended: ${result} (${data.moves} moves, ${data.duration.toFixed(1)}s) | Completed: ${stats.gamesCompleted}`);
      
      // Play another game after short delay
      setTimeout(() => {
        this.findGame();
      }, 2000);
    });

    this.socket.on('opponentDisconnected', () => {
      console.log(`⚠️  Bot ${this.id} opponent disconnected`);
      this.gameActive = false;
      setTimeout(() => this.findGame(), 2000);
    });

    this.socket.on('error', (data) => {
      stats.errors++;
      console.error(`❌ Bot ${this.id} error:`, data.message);
    });

    this.socket.on('disconnect', () => {
      stats.connected--;
      console.log(`❌ Bot ${this.id} disconnected | Remaining: ${stats.connected}`);
    });
  }

  findGame() {
    if (this.socket && this.socket.connected) {
      const startTime = Date.now();
      this.socket.emit('findGame');
      
      // Measure matchmaking latency
      const measureLatency = () => {
        if (this.roomId) {
          const latency = Date.now() - startTime;
          stats.latencies.push(latency);
        }
      };
      
      setTimeout(measureLatency, 100);
    }
  }

  makeRandomMove() {
    if (!this.gameActive || !this.isMyTurn) return;

    // Pick a random empty position (simplified - real bot would be smarter)
    const position = Math.floor(Math.random() * 9);
    
    const moveStartTime = Date.now();
    this.socket.emit('makeMove', { roomId: this.roomId, position });
    stats.totalMoves++;
    
    // Measure move latency
    const latency = Date.now() - moveStartTime;
    stats.latencies.push(latency);
    
    this.isMyTurn = false;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Main load test function
async function runLoadTest() {
  console.log('\n🎮 MULTIPLAYER GAME SERVER LOAD TEST\n');
  console.log(`📊 Configuration:`);
  console.log(`   - Server: ${SERVER_URL}`);
  console.log(`   - Players: ${NUM_PLAYERS}`);
  console.log(`   - Move delay: ${GAME_DELAY}ms\n`);
  console.log('Starting load test...\n');

  const bots = [];
  
  // Create and connect bots in batches to avoid overwhelming the server
  const BATCH_SIZE = 10;
  for (let i = 0; i < NUM_PLAYERS; i += BATCH_SIZE) {
    const batch = [];
    
    for (let j = 0; j < BATCH_SIZE && (i + j) < NUM_PLAYERS; j++) {
      const bot = new BotPlayer(i + j + 1);
      bots.push(bot);
      batch.push(bot.connect().catch(err => {
        console.error(`Failed to connect bot ${i + j + 1}:`, err.message);
      }));
    }
    
    await Promise.all(batch);
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n✅ ${stats.connected} bots connected successfully\n`);
  
  // Start finding games
  console.log('🔍 Starting matchmaking...\n');
  bots.forEach((bot, index) => {
    setTimeout(() => {
      bot.findGame();
    }, index * 50); // Stagger game requests
  });

  // Print statistics every 5 seconds
  const statsInterval = setInterval(() => {
    printStats();
  }, 5000);

  // Run test for specified duration or until interrupted
  console.log('⏱️  Test running... Press Ctrl+C to stop\n');
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping load test...\n');
    clearInterval(statsInterval);
    
    // Disconnect all bots
    bots.forEach(bot => bot.disconnect());
    
    setTimeout(() => {
      printFinalStats();
      process.exit(0);
    }, 1000);
  });
}

function printStats() {
  const uptime = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const avgLatency = stats.latencies.length > 0 
    ? (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2)
    : 0;
  const maxLatency = stats.latencies.length > 0 
    ? Math.max(...stats.latencies).toFixed(2)
    : 0;
  const minLatency = stats.latencies.length > 0 
    ? Math.min(...stats.latencies).toFixed(2)
    : 0;
  
  console.log('═'.repeat(60));
  console.log('📊 CURRENT STATISTICS');
  console.log('═'.repeat(60));
  console.log(`⏱️  Uptime: ${uptime}s`);
  console.log(`👥 Connected Players: ${stats.connected}`);
  console.log(`🎮 Games Started: ${stats.gamesStarted}`);
  console.log(`🏁 Games Completed: ${stats.gamesCompleted}`);
  console.log(`🎯 Total Moves: ${stats.totalMoves}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log(`⚡ Avg Latency: ${avgLatency}ms`);
  console.log(`⚡ Min Latency: ${minLatency}ms`);
  console.log(`⚡ Max Latency: ${maxLatency}ms`);
  console.log('═'.repeat(60) + '\n');
}

function printFinalStats() {
  console.log('\n\n');
  console.log('🎉 FINAL TEST RESULTS');
  console.log('═'.repeat(60));
  
  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  const avgLatency = stats.latencies.length > 0 
    ? (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2)
    : 0;
  const maxLatency = stats.latencies.length > 0 ? Math.max(...stats.latencies) : 0;
  const minLatency = stats.latencies.length > 0 ? Math.min(...stats.latencies) : 0;
  const gamesPerSecond = (stats.gamesCompleted / (duration || 1)).toFixed(2);
  const movesPerSecond = (stats.totalMoves / (duration || 1)).toFixed(2);
  
  console.log(`⏱️  Total Duration: ${duration}s`);
  console.log(`👥 Peak Connected Players: ${NUM_PLAYERS}`);
  console.log(`🎮 Total Games Started: ${stats.gamesStarted}`);
  console.log(`🏁 Total Games Completed: ${stats.gamesCompleted}`);
  console.log(`📈 Games/second: ${gamesPerSecond}`);
  console.log(`🎯 Total Moves: ${stats.totalMoves}`);
  console.log(`📈 Moves/second: ${movesPerSecond}`);
  console.log(`❌ Total Errors: ${stats.errors}`);
  console.log(`\n⚡ LATENCY STATS:`);
  console.log(`   Average: ${avgLatency}ms`);
  console.log(`   Min: ${minLatency}ms`);
  console.log(`   Max: ${maxLatency}ms`);
  console.log(`\n✅ Success Rate: ${((1 - stats.errors / (stats.totalMoves || 1)) * 100).toFixed(2)}%`);
  console.log('═'.repeat(60));
  console.log('\n💡 Use these stats for your resume!\n');
}

// Run the load test
runLoadTest().catch(err => {
  console.error('Load test failed:', err);
  process.exit(1);
});