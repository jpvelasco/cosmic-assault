/**
 * AI Player - Intelligent automated game player for stress testing
 *
 * Strategies:
 * - SURVIVAL: Focus on dodging asteroids, only shoot when safe
 * - AGGRESSIVE: Actively hunt asteroids, maximize score
 * - POWERUP_HUNTER: Prioritize collecting powerups
 * - CHAOS: Random unpredictable movements for edge case testing
 */

class AIPlayer {
  constructor(page, options = {}) {
    this.page = page;
    this.strategy = options.strategy || 'AGGRESSIVE';
    this.reactionTime = options.reactionTime || 100; // ms between decisions
    this.skillLevel = options.skillLevel || 0.8; // 0-1, affects accuracy
    this.running = false;
    this.stats = {
      decisions: 0,
      dodges: 0,
      shots: 0,
      powerupsCollected: 0,
      deaths: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Get full game state from test API
   */
  async getGameData() {
    return await this.page.evaluate(() => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      return {
        state: api.getState(),
        player: api.getPlayer(),
        entities: api.getEntityCounts(),
        asteroids: api.getAsteroids(),
        powerups: api.getPowerups(),
        canvas: api.getCanvasDimensions()
      };
    });
  }

  /**
   * Calculate distance between two points
   */
  distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  /**
   * Calculate angle from point 1 to point 2
   */
  angleTo(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  }

  /**
   * Normalize angle to -PI to PI
   */
  normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Analyze threats - asteroids that could hit the player
   */
  analyzeThreats(player, asteroids, canvas) {
    if (!player || !asteroids) return [];

    const threats = [];
    const dangerRadius = 150; // Pixels to consider dangerous

    for (const asteroid of asteroids) {
      const dist = this.distance(player.x, player.y, asteroid.x, asteroid.y);

      if (dist < dangerRadius + asteroid.size) {
        // Calculate if asteroid is approaching
        const relVx = asteroid.vx - player.vx;
        const relVy = asteroid.vy - player.vy;
        const approachSpeed = this.getApproachSpeed(
          player.x, player.y, asteroid.x, asteroid.y, relVx, relVy
        );

        if (approachSpeed > 0 || dist < 80) {
          threats.push({
            ...asteroid,
            distance: dist,
            approachSpeed,
            danger: (dangerRadius - dist + asteroid.size) * (1 + approachSpeed / 100),
            angle: this.angleTo(player.x, player.y, asteroid.x, asteroid.y)
          });
        }
      }
    }

    // Sort by danger level (highest first)
    return threats.sort((a, b) => b.danger - a.danger);
  }

  /**
   * Calculate how fast an object is approaching
   */
  getApproachSpeed(px, py, ox, oy, vx, vy) {
    const dx = ox - px;
    const dy = oy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return 0;

    // Dot product of velocity with direction to player
    return -(dx * vx + dy * vy) / dist;
  }

  /**
   * Find best powerup to pursue
   */
  findBestPowerup(player, powerups) {
    if (!player || !powerups || powerups.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const powerup of powerups) {
      const dist = this.distance(player.x, player.y, powerup.x, powerup.y);
      // Score based on distance (closer is better) and type priority
      const typePriority = {
        'shield': 10,
        'fieldBomb': 8,
        'rapidFire': 6,
        'doubleShot': 5
      };
      const priority = typePriority[powerup.type] || 5;
      const score = priority * 100 - dist;

      if (score > bestScore) {
        bestScore = score;
        best = { ...powerup, distance: dist, score };
      }
    }

    return best;
  }

  /**
   * Find best asteroid to target
   */
  findBestTarget(player, asteroids) {
    if (!player || !asteroids || asteroids.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const asteroid of asteroids) {
      const dist = this.distance(player.x, player.y, asteroid.x, asteroid.y);
      if (dist > 400) continue; // Too far

      // Prefer medium-distance asteroids (not too close, not too far)
      // and larger asteroids (more points)
      const distScore = 200 - Math.abs(dist - 150);
      const sizeScore = asteroid.size * 2;
      const score = distScore + sizeScore;

      if (score > bestScore) {
        bestScore = score;
        best = { ...asteroid, distance: dist, score };
      }
    }

    return best;
  }

  /**
   * Calculate safe direction to move (away from threats)
   */
  calculateEvasionVector(player, threats, canvas) {
    if (threats.length === 0) return { angle: player.angle, thrust: false };

    // Sum up repulsion vectors from all threats
    let repelX = 0;
    let repelY = 0;

    for (const threat of threats) {
      const weight = threat.danger;
      const dx = player.x - threat.x;
      const dy = player.y - threat.y;
      const dist = Math.max(threat.distance, 1);

      repelX += (dx / dist) * weight;
      repelY += (dy / dist) * weight;
    }

    // Also repel from edges
    const edgeBuffer = 80;
    if (player.x < edgeBuffer) repelX += (edgeBuffer - player.x) * 0.5;
    if (player.x > canvas.width - edgeBuffer) repelX -= (player.x - (canvas.width - edgeBuffer)) * 0.5;
    if (player.y < edgeBuffer) repelY += (edgeBuffer - player.y) * 0.5;
    if (player.y > canvas.height - edgeBuffer) repelY -= (player.y - (canvas.height - edgeBuffer)) * 0.5;

    const evasionAngle = Math.atan2(repelY, repelX);
    const urgency = Math.sqrt(repelX * repelX + repelY * repelY);

    return {
      angle: evasionAngle,
      thrust: urgency > 20,
      urgency
    };
  }

  /**
   * Make a decision based on current game state
   */
  async makeDecision() {
    const data = await this.getGameData();

    if (data.state.gameState !== 'playing' || !data.player || !data.player.alive) {
      return { action: 'wait', reason: 'not playing' };
    }

    const { player, asteroids, powerups, canvas } = data;
    const threats = this.analyzeThreats(player, asteroids, canvas);
    const bestPowerup = this.findBestPowerup(player, powerups);
    const bestTarget = this.findBestTarget(player, asteroids);

    let decision = {
      thrust: false,
      turnLeft: false,
      turnRight: false,
      shoot: false,
      targetAngle: player.angle,
      reason: ''
    };

    // Strategy-specific behavior
    switch (this.strategy) {
      case 'SURVIVAL':
        decision = this.survivalStrategy(player, threats, bestPowerup, bestTarget, canvas);
        break;
      case 'AGGRESSIVE':
        decision = this.aggressiveStrategy(player, threats, bestPowerup, bestTarget, canvas);
        break;
      case 'POWERUP_HUNTER':
        decision = this.powerupHunterStrategy(player, threats, bestPowerup, bestTarget, canvas);
        break;
      case 'CHAOS':
        decision = this.chaosStrategy(player, canvas);
        break;
      default:
        decision = this.aggressiveStrategy(player, threats, bestPowerup, bestTarget, canvas);
    }

    this.stats.decisions++;
    return decision;
  }

  /**
   * Survival strategy - prioritize not dying
   */
  survivalStrategy(player, threats, bestPowerup, bestTarget, canvas) {
    const decision = { thrust: false, turnLeft: false, turnRight: false, shoot: false, reason: '' };

    if (threats.length > 0 && threats[0].danger > 50) {
      // Evade!
      const evasion = this.calculateEvasionVector(player, threats, canvas);
      decision.targetAngle = evasion.angle;
      decision.thrust = evasion.thrust;
      decision.reason = 'evading threat';
      this.stats.dodges++;

      // Shoot while evading if safe
      if (bestTarget && threats[0].distance > 100) {
        decision.shoot = true;
        decision.targetAngle = this.angleTo(player.x, player.y, bestTarget.x, bestTarget.y);
      }
    } else if (bestTarget) {
      // Safe to hunt
      decision.targetAngle = this.angleTo(player.x, player.y, bestTarget.x, bestTarget.y);
      decision.thrust = bestTarget.distance > 100;
      decision.shoot = true;
      decision.reason = 'hunting target';
    }

    // Calculate turn direction
    const angleDiff = this.normalizeAngle(decision.targetAngle - player.angle);
    if (Math.abs(angleDiff) > 0.1) {
      decision.turnLeft = angleDiff < 0;
      decision.turnRight = angleDiff > 0;
    }

    if (decision.shoot) this.stats.shots++;
    return decision;
  }

  /**
   * Aggressive strategy - maximize kills
   */
  aggressiveStrategy(player, threats, bestPowerup, bestTarget, canvas) {
    const decision = { thrust: false, turnLeft: false, turnRight: false, shoot: false, reason: '' };

    // Only evade immediate danger
    if (threats.length > 0 && threats[0].distance < 60) {
      const evasion = this.calculateEvasionVector(player, threats.slice(0, 2), canvas);
      decision.targetAngle = evasion.angle;
      decision.thrust = true;
      decision.shoot = true; // Shoot while dodging
      decision.reason = 'emergency evade';
      this.stats.dodges++;
    } else if (bestTarget) {
      // Hunt aggressively
      decision.targetAngle = this.angleTo(player.x, player.y, bestTarget.x, bestTarget.y);
      decision.thrust = bestTarget.distance > 80;
      decision.shoot = true;
      decision.reason = 'aggressive hunting';
    } else {
      // No targets, move around
      decision.thrust = true;
      decision.reason = 'searching';
    }

    const angleDiff = this.normalizeAngle(decision.targetAngle - player.angle);
    if (Math.abs(angleDiff) > 0.1) {
      decision.turnLeft = angleDiff < 0;
      decision.turnRight = angleDiff > 0;
    }

    if (decision.shoot) this.stats.shots++;
    return decision;
  }

  /**
   * Powerup hunter strategy - prioritize powerups
   */
  powerupHunterStrategy(player, threats, bestPowerup, bestTarget, canvas) {
    const decision = { thrust: false, turnLeft: false, turnRight: false, shoot: false, reason: '' };

    // Evade if necessary
    if (threats.length > 0 && threats[0].danger > 80) {
      const evasion = this.calculateEvasionVector(player, threats, canvas);
      decision.targetAngle = evasion.angle;
      decision.thrust = evasion.thrust;
      decision.reason = 'evading for safety';
      this.stats.dodges++;
    } else if (bestPowerup && bestPowerup.distance < 300) {
      // Go for powerup
      decision.targetAngle = this.angleTo(player.x, player.y, bestPowerup.x, bestPowerup.y);
      decision.thrust = true;
      decision.reason = `pursuing ${bestPowerup.type}`;

      // Shoot asteroids in the way
      if (bestTarget && bestTarget.distance < 150) {
        decision.shoot = true;
      }
    } else if (bestTarget) {
      // No powerup, hunt asteroids to spawn more
      decision.targetAngle = this.angleTo(player.x, player.y, bestTarget.x, bestTarget.y);
      decision.thrust = bestTarget.distance > 100;
      decision.shoot = true;
      decision.reason = 'hunting for powerup spawns';
    }

    const angleDiff = this.normalizeAngle(decision.targetAngle - player.angle);
    if (Math.abs(angleDiff) > 0.1) {
      decision.turnLeft = angleDiff < 0;
      decision.turnRight = angleDiff > 0;
    }

    if (decision.shoot) this.stats.shots++;
    return decision;
  }

  /**
   * Chaos strategy - random unpredictable behavior for edge case testing
   */
  chaosStrategy(player, canvas) {
    const decision = {
      thrust: Math.random() > 0.3,
      turnLeft: Math.random() > 0.6,
      turnRight: Math.random() > 0.6,
      shoot: Math.random() > 0.2,
      reason: 'chaos mode'
    };

    // Occasionally do nothing
    if (Math.random() > 0.9) {
      decision.thrust = false;
      decision.turnLeft = false;
      decision.turnRight = false;
      decision.shoot = false;
    }

    // Occasionally spam everything
    if (Math.random() > 0.95) {
      decision.thrust = true;
      decision.turnLeft = Math.random() > 0.5;
      decision.turnRight = !decision.turnLeft;
      decision.shoot = true;
    }

    if (decision.shoot) this.stats.shots++;
    return decision;
  }

  /**
   * Execute a decision by simulating inputs
   */
  async executeDecision(decision) {
    await this.page.evaluate((d) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;

      // Release all keys first
      api.simulateKeyUp('ArrowUp');
      api.simulateKeyUp('ArrowLeft');
      api.simulateKeyUp('ArrowRight');
      api.simulateKeyUp(' ');

      // Apply new inputs
      if (d.thrust) api.simulateKeyDown('ArrowUp');
      if (d.turnLeft) api.simulateKeyDown('ArrowLeft');
      if (d.turnRight) api.simulateKeyDown('ArrowRight');
      if (d.shoot) api.simulateKeyDown(' ');
    }, decision);
  }

  /**
   * Run the AI for a specified duration
   */
  async play(durationMs, options = {}) {
    const { onDecision, onDeath, verbose = false } = options;

    this.running = true;
    this.stats.startTime = Date.now();

    const endTime = Date.now() + durationMs;
    let lastLives = null;

    while (this.running && Date.now() < endTime) {
      const decision = await this.makeDecision();

      if (decision.action === 'wait') {
        await this.page.waitForTimeout(100);
        continue;
      }

      await this.executeDecision(decision);

      if (onDecision) onDecision(decision);
      if (verbose && this.stats.decisions % 50 === 0) {
        console.log(`[AI] ${decision.reason} | Decisions: ${this.stats.decisions}`);
      }

      // Check for death
      const state = await this.page.evaluate(() =>
        window.__COSMIC_ASSAULT_TEST_API__.getState()
      );

      if (lastLives !== null && state.lives < lastLives) {
        this.stats.deaths++;
        if (onDeath) onDeath(this.stats.deaths);
      }
      lastLives = state.lives;

      await this.page.waitForTimeout(this.reactionTime);
    }

    // Release all keys
    await this.page.evaluate(() => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      api.simulateKeyUp('ArrowUp');
      api.simulateKeyUp('ArrowLeft');
      api.simulateKeyUp('ArrowRight');
      api.simulateKeyUp(' ');
    });

    this.stats.endTime = Date.now();
    this.running = false;

    return this.getReport();
  }

  /**
   * Stop the AI
   */
  stop() {
    this.running = false;
  }

  /**
   * Get performance report
   */
  getReport() {
    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    return {
      strategy: this.strategy,
      duration: `${duration.toFixed(1)}s`,
      decisions: this.stats.decisions,
      decisionsPerSecond: (this.stats.decisions / duration).toFixed(1),
      shots: this.stats.shots,
      dodges: this.stats.dodges,
      deaths: this.stats.deaths,
      survivalRate: duration > 0 ? `${((1 - this.stats.deaths / Math.max(duration / 10, 1)) * 100).toFixed(0)}%` : 'N/A'
    };
  }
}

module.exports = { AIPlayer };
