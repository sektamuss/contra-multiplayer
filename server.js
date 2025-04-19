const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const ROOM_ID = "game-room";
const gravity = 0.15;
const floor = 400;
const initialLargeRadius = 30;
const FPS = 60;

let gameState = {
    players: {},
    enemies: [],
    powerUps: [],
    score: 0,
    level: 1,
    gameRunning: false
};

class Player {
    constructor(id, x, color) {
        this.id = id;
        this.x = x;
        this.y = floor - 32;
        this.width = 32;
        this.height = 32;
        this.vx = 0;
        this.speed = 3;
        this.color = color;
        this.lives = 3;
        this.invincible = 30;
        this.isAlive = true;
        this.harpoon = null;
        this.activePowerUp = null;
        this.powerUpTimer = 0;
        this.baseHarpoonSpeed = 7;
        this.harpoonSpeed = this.baseHarpoonSpeed;
        this.fixedRope = false;
        this.inputs = { left: false, right: false };
    }
}

class Harpoon {
    constructor(x, startY, color, speed, fixedRope) {
        this.x = x;
        this.startY = startY;
        this.y = startY;
        this.color = color;
        this.width = 3;
        this.speed = speed;
        this.isExtending = true;
        this.active = true;
        this.holdTimer = 0;
        this.holdDuration = fixedRope ? 180 : 15;
        this.fixedRope = fixedRope;
        this.hitSomething = false;
    }
    update() {
        if (!this.active) return;
        if (this.isExtending && !this.hitSomething) {
            this.y -= this.speed;
            if (this.y <= 0) {
                this.y = 0;
                this.isExtending = false;
                this.holdTimer = this.holdDuration;
            }
        } else if (this.holdTimer > 0 && !this.hitSomething) {
            this.holdTimer--;
        } else {
            this.active = false;
        }
    }
}

class EnemyBall {
    constructor(x, y, radius, dx) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        const maxInitialSpeedFactor = 1.5 + gameState.level * 0.2;
        this.dx = dx * Math.max(0.6, Math.min(maxInitialSpeedFactor, 30 / this.radius));
        this.dy = 0.1;
        const baseBounce = 6.0, radiusFactorBounce = 0.15, maxBounce = 10.5;
        this.bounciness = Math.min(maxBounce, baseBounce + this.radius * radiusFactorBounce);
        const baseMinBounce = 4.0, radiusFactorMinBounce = 0.10, maxMinBounce = 7.0;
        this.minBounce = Math.min(maxMinBounce, baseMinBounce + this.radius * radiusFactorMinBounce);
    }
    update() {
        this.dy += gravity;
        this.x += this.dx;
        this.y += this.dy;
        if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.dy = 0;
        }
        if (this.x - this.radius < 0 || this.x + this.radius > 800) {
            this.dx *= -1;
            this.x = Math.max(this.radius, Math.min(800 - this.radius, this.x));
        }
        if (this.y + this.radius >= floor) {
            this.y = floor - this.radius;
            this.dy = -this.bounciness * (0.7 + Math.random() * 0.25);
            if (Math.abs(this.dy) < this.minBounce) {
                this.dy = -this.minBounce;
            }
        }
    }
}

class PowerUp {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.width = 10;
        this.height = 10;
        this.type = type;
        this.timer = 600;
        this.active = true;
    }
    update() {
        if (!this.active) return;
        this.timer--;
        if (this.timer <= 0) {
            this.active = false;
        }
    }
}

function checkBallRectCollision(ball, rect) {
    if (!rect || !ball) return false;
    const cX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.width));
    const cY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.height));
    const dx = ball.x - cX;
    const dy = ball.y - cY;
    return (dx * dx + dy * dy) < (ball.radius * ball.radius);
}

function checkRectRectCollision(rect1, rect2) {
    if (!rect1 || !rect2) return false;
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function spawnEnemiesForLevel() {
    gameState.enemies = [];
    const baseEnemies = 2 + Math.floor(gameState.level / 2);
    const speedIncrease = 1.5 + gameState.level * 0.2;
    for (let i = 0; i < baseEnemies; i++) {
        const x = (800 / (baseEnemies + 1)) * (i + 1);
        const dx = (i % 2 === 0 ? 1 : -1) * speedIncrease;
        gameState.enemies.push(new EnemyBall(x, 80, initialLargeRadius, dx));
    }
}

function updateGameState() {
    if (!gameState.gameRunning) return;

    // Oyuncular
    for (let id in gameState.players) {
        const player = gameState.players[id];
        if (!player.isAlive) {
            if (player.harpoon) player.harpoon.active = false;
            player.harpoon = null;
            continue;
        }
        if (player.invincible > 0) player.invincible--;
        if (player.powerUpTimer > 0) {
            player.powerUpTimer--;
            if (player.powerUpTimer <= 0) {
                if (player.activePowerUp === 'bulletSpeed') {
                    player.harpoonSpeed = player.baseHarpoonSpeed;
                } else if (player.activePowerUp === 'fixedRope') {
                    player.fixedRope = false;
                }
                player.activePowerUp = null;
            }
        }
        player.vx = 0;
        if (player.inputs.left) player.vx = -player.speed;
        if (player.inputs.right) player.vx = player.inputs.left ? 0 : player.speed;
        player.x += player.vx;
        if (player.x < 0) player.x = 0;
        if (player.x + player.width > 800) player.x = 800 - player.width;
        if (player.harpoon && player.harpoon.active) {
            player.harpoon.update();
            if (!player.harpoon.active) player.harpoon = null;
        }
    }

    // Güçlendirmeler
    gameState.powerUps = gameState.powerUps.filter(p => p.active);
    for (let powerUp of gameState.powerUps) {
        powerUp.update();
        const powerUpRect = {
            x: powerUp.x - powerUp.width / 2,
            y: powerUp.y - powerUp.height / 2,
            width: powerUp.width,
            height: powerUp.height
        };
        for (let id in gameState.players) {
            const player = gameState.players[id];
            if (!player.isAlive) continue;
            const playerRect = { x: player.x, y: player.y, width: player.width, height: player.height };
            if (checkRectRectCollision(playerRect, powerUpRect)) {
                powerUp.active = false;
                if (player.activePowerUp) {
                    if (player.activePowerUp === 'bulletSpeed') {
                        player.harpoonSpeed = player.baseHarpoonSpeed;
                    } else if (player.activePowerUp === 'fixedRope') {
                        player.fixedRope = false;
                    }
                }
                player.activePowerUp = powerUp.type;
                player.powerUpTimer = 600;
                if (powerUp.type === 'bulletSpeed') {
                    player.harpoonSpeed = player.baseHarpoonSpeed * 1.5;
                } else if (powerUp.type === 'fixedRope') {
                    player.fixedRope = true;
                }
            }
        }
    }

    // Düşmanlar
    let newEnemies = [];
    for (let i = gameState.enemies.length - 1; i >= 0; i--) {
        const enemy = gameState.enemies[i];
        enemy.update();
        let enemyHit = false;
        let hittingPlayer = null;
        for (let id in gameState.players) {
            const player = gameState.players[id];
            if (player.harpoon && player.harpoon.active) {
                const hr = {
                    x: player.harpoon.x - player.harpoon.width / 2,
                    y: player.harpoon.y,
                    width: player.harpoon.width,
                    height: player.harpoon.startY - player.harpoon.y
                };
                if (checkBallRectCollision(enemy, hr)) {
                    hittingPlayer = player;
                    enemyHit = true;
                    break;
                }
            }
        }
        if (enemyHit) {
            gameState.score += Math.ceil(150 / enemy.radius);
            if (enemy.radius >= 10) {
                const splitY = enemy.y;
                let pSM = Math.abs(enemy.dx);
                let nSM = Math.min(2.0 + gameState.level * 0.1, pSM);
                nSM = Math.max(0.6, nSM) * 0.8;
                const nB1 = new EnemyBall(enemy.x, splitY, enemy.radius / 2, -nSM);
                const nB2 = new EnemyBall(enemy.x, splitY, enemy.radius / 2, nSM);
                nB1.dy = -4.0;
                nB2.dy = -4.0;
                newEnemies.push(nB1, nB2);
                if (Math.random() < 0.1) {
                    const powerUpType = Math.random() < 0.5 ? 'bulletSpeed' : 'fixedRope';
                    gameState.powerUps.push(new PowerUp(enemy.x, floor - 10, powerUpType));
                }
            }
            gameState.enemies.splice(i, 1);
            if (hittingPlayer) {
                hittingPlayer.harpoon.hitSomething = true;
                hittingPlayer.harpoon.active = false;
                hittingPlayer.harpoon = null;
            }
        } else {
            for (let id in gameState.players) {
                const player = gameState.players[id];
                if (!player.isAlive || player.invincible > 0) continue;
                const playerRect = { x: player.x, y: player.y, width: player.width, height: player.height };
                if (checkBallRectCollision(enemy, playerRect)) {
                    player.lives--;
                    if (player.lives <= 0) {
                        player.isAlive = false;
                    } else {
                        player.invincible = Math.max(30, 120 - gameState.level * 10);
                    }
                }
            }
        }
    }
    gameState.enemies.push(...newEnemies);

    // Seviye ve Oyun Sonu Kontrolü
    if (gameState.enemies.length === 0) {
        gameState.level++;
        spawnEnemiesForLevel();
        for (let id in gameState.players) {
            gameState.players[id].invincible = 30;
        }
        io.to(ROOM_ID).emit("next-level", { level: gameState.level });
    }

    let allDead = Object.keys(gameState.players).every(id => !gameState.players[id].isAlive);
    if (allDead) {
        gameState.gameRunning = false;
        io.to(ROOM_ID).emit("game-over", { score: gameState.score, level: gameState.level });
    }
}

io.on("connection", (socket) => {
    console.log("Oyuncu bağlandı:", socket.id);

    socket.on("join-game", (roomId) => {
        if (roomId !== ROOM_ID || Object.keys(gameState.players).length >= 2) {
            socket.emit("join-game", "Oda dolu veya geçersiz!");
            return;
        }
        socket.join(roomId);
        const color = Object.keys(gameState.players).length === 0 ? "red" : "blue";
        const x = color === "red" ? 50 : 800 - 50 - 32;
        gameState.players[socket.id] = new Player(socket.id, x, color);
        io.to(roomId).emit("player-joined", socket.id);
        if (Object.keys(gameState.players).length === 1) {
            gameState.gameRunning = true;
            spawnEnemiesForLevel();
        }
    });

    socket.on("player-input", (data) => {
        if (data.room !== ROOM_ID || !gameState.players[socket.id]) return;
        const player = gameState.players[socket.id];
        if (data.action === "move-left") {
            player.inputs.left = data.state;
        } else if (data.action === "move-right") {
            player.inputs.right = data.state;
        } else if (data.action === "shoot" && player.isAlive && !player.harpoon) {
            player.harpoon = new Harpoon(
                player.x + player.width / 2,
                player.y,
                player.color,
                player.harpoonSpeed,
                player.fixedRope
            );
        }
    });

    socket.on("disconnect", () => {
        console.log("Oyuncu ayrıldı:", socket.id);
        delete gameState.players[socket.id];
        io.to(ROOM_ID).emit("player-left", socket.id);
        if (Object.keys(gameState.players).length === 0) {
            gameState.gameRunning = false;
            gameState.enemies = [];
            gameState.powerUps = [];
            gameState.score = 0;
            gameState.level = 1;
        }
    });
});

setInterval(() => {
    if (gameState.gameRunning) {
        updateGameState();
        io.to(ROOM_ID).emit("game-state", gameState);
    }
}, 1000 / FPS);

server.listen(3000, () => {
    console.log("Sunucu çalışıyor: http://localhost:3000");
});