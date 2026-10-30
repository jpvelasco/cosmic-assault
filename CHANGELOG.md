# Changelog

All notable changes to Cosmic Assault are listed here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-10-29

### Changed

- Every galaxy has its own sky: the stars, the nebula and one set-piece (a planet, moon, sun, station or similar) are
  drawn from the galaxy, in its Dimension's colours. Bosses get a larger set-piece, and the Daily Galaxy has its own sky
  for its date.

## [2.0.0] - 2026-10-29

Cosmic Assault 2.0: the game, rebuilt.

### Added

- Five Dimensions of six galaxies each, thirty in all, with a boss at the end of every Dimension: the Monolith, the
  Hive Carrier, the Warden, the Leviathan and the Eclipse. Bosses fight in phases, and every attack winds up with a
  visible tell before it can hurt you.
- New foes (splitters, drones, gunships, mines, phasers and armoured rocks), new hazards (warp rifts and a black hole,
  alongside gravity wells, repulsion fields and danger zones), and new pickups (Weapon Core, Spread Laser, Piercing
  Beam, Homing Missiles, Wingman, Nova and Time Warp, alongside Shield, Double Shot, Rapid Fire and Field Bomb). Each
  hazard shows a harmless warning before it turns hostile, and a pickup's first drop is announced.
- Three ways to play: Rank, one campaign from the first galaxy to the last boss that saves between galaxies; Free play,
  any galaxy you have opened, for its best score and stars; and the Daily Galaxy, a new galaxy every day with a twist,
  a target score and a streak.
- Stars for every galaxy, and ship skins and engine trails to unlock with them in the Hangar. Looks never change how
  the ship handles.
- An attract demo: a pilot flies a galaxy behind the title screen when it is left alone.
- The same controls on every device: a Pause button on desktop and phone, one Back on every screen, hints that follow
  whether you use keys, a touch screen or a gamepad, and hold the mouse button to fire.
- An installable app that plays offline after one visit.
- Gamepad support; settings for music and effects volume, screen shake and a left-handed touch layout; and screen shake
  that follows the system's reduced-motion setting.

### Changed

- Rebuilt in TypeScript, with the same ship handling: turning, thrust and drag match the classic game.
- Difficulty follows the galaxy you are in, not your score.
- Meteor showers are scheduled and announced by arrows at the screen's edge, instead of arriving at random.
- Your classic high score is kept, and shows in Records as "Classic best".

### Removed

- The classic game at the main address. It is kept at the [`v1.0.0`](https://github.com/jpvelasco/cosmic-assault/tree/v1.0.0)
  tag.
- The preview address: `/next/` now leads to the main address, and the preview's offline copy removes itself.

[2.0.1]: https://github.com/jpvelasco/cosmic-assault/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/jpvelasco/cosmic-assault/compare/v1.0.0...v2.0.0
