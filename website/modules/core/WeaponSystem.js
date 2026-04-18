import { WEAPON_SPREAD } from './constants.js';
import { Projectile } from '../entities/Projectile.js';

export class WeaponSystem {
    constructor(state, audio) {
        this.state = state;
        this.audio = audio;
    }

    fire(data) {
        const { x, y, angle, baseVx, baseVy, speed, weaponMultiplier } = data;
        const effectiveLevel = this.state.weaponLevel * weaponMultiplier;
        const spread = WEAPON_SPREAD[Math.min(effectiveLevel, WEAPON_SPREAD.length - 1)];

        this.audio.play('shoot');

        spread.angles.forEach(offset => {
            this.state.projectiles.push(new Projectile(
                x, y,
                baseVx + Math.cos(angle + offset) * speed,
                baseVy + Math.sin(angle + offset) * speed
            ));
        });
    }
}
