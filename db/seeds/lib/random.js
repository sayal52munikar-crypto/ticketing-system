// A tiny seeded random number generator (mulberry32).
// Math.random() can't be seeded; this can, so every run generates the same data,
// and two generators started with the same seed produce the same sequence.

function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 0 <= n < 1, like Math.random()
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // inclusive
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (probability) => next() < probability,
  };
}

module.exports = { createRandom };
