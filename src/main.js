import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';
import platform from './platform.js';

async function start() {
  await platform.init();
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 720,
    height: 1280,
    backgroundColor: '#0a0420',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 1 },
    disableContextMenu: true,
    render: { antialias: true },
    scene: [GameScene],
  });
}

start();
