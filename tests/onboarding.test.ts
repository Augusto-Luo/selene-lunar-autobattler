import assert from 'node:assert/strict';
import { placeTutorialCard } from '../src/tutorial';
import type { TutorialRect } from '../src/tutorial';

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const overlap = (a: TutorialRect, b: TutorialRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const card = { width: 292, height: 240 };
check('coachmarks leave the highlighted roster, unit, orders and start control clickable', () => {
  for (const target of [
    { x: 22, y: 300, width: 220, height: 96 },
    { x: 640, y: 390, width: 48, height: 48 },
    { x: 0, y: 660, width: 1280, height: 140 },
    { x: 1050, y: 730, width: 210, height: 50 },
  ]) {
    const position = placeTutorialCard(target, card, { width: 1280, height: 800 });
    assert.equal(overlap({ ...position, ...card }, target), 0);
    assert(position.x >= 12 && position.x + card.width <= 1268);
    assert(position.y >= 12 && position.y + card.height <= 788);
  }
});
check('corner targets keep the complete card and close button inside the viewport', () => {
  for (const x of [0, 960 - 48]) for (const y of [0, 600 - 48]) {
    const target = { x, y, width: 48, height: 48 };
    const position = placeTutorialCard(target, card, { width: 960, height: 600 });
    assert.equal(overlap({ ...position, ...card }, target), 0);
    assert(position.x >= 12 && position.x + card.width <= 948);
    assert(position.y >= 12 && position.y + card.height <= 588);
  }
});
check('narrow or zoomed viewports keep a viewport-sized card visible', () => {
  for (const viewport of [{ width: 640, height: 400 }, { width: 320, height: 480 }, { width: 360, height: 220 }]) {
    const size = { width: Math.min(292, viewport.width - 24), height: Math.min(300, viewport.height - 24) };
    const position = placeTutorialCard({ x: viewport.width - 60, y: viewport.height - 60, width: 48, height: 48 }, size, viewport);
    assert(position.x >= 12 && position.x + size.width <= viewport.width - 12);
    assert(position.y >= 12 && position.y + size.height <= viewport.height - 12);
  }
});
check('moving or offscreen camera targets never send the tutorial outside the viewport', () => {
  for (const x of [-500, 0, 450, 900, 1400]) {
    const position = placeTutorialCard({ x, y: 320, width: 48, height: 48 }, card, { width: 960, height: 600 });
    assert(Number.isFinite(position.x) && Number.isFinite(position.y));
    assert(position.x >= 12 && position.x + card.width <= 948);
    assert(position.y >= 12 && position.y + card.height <= 588);
  }
});
console.log(`${passed} onboarding layout checks passed`);
