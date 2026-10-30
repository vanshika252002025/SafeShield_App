export type Sensitivity = "low" | "medium" | "high";

// spikeG: how hard a push must be (in g, with gravity taken out)
// spikes / reversals: how many hard pushes, and how many of them must swing the opposite way
// The Android service uses the same numbers.
export const SHAKE_PRESETS: Record<Sensitivity, { spikeG: number; spikes: number; reversals: number }> = {
  low: { spikeG: 2.1, spikes: 5, reversals: 3 }, // hardest to trigger (best if you jog a lot)
  medium: { spikeG: 1.8, spikes: 4, reversals: 2 },
  high: { spikeG: 1.5, spikes: 4, reversals: 1 }, // easiest to trigger
};

const GRAVITY_FILTER = 0.9;
const WINDOW_MS = 2000;
const MIN_GAP_MS = 150; // one swing counts as one spike
const REVERSAL_DOT = -0.3; // two spikes pointing opposite ways

// Call the returned function with every accelerometer reading (in g).
// It calls onShake once when it sees a deliberate back-and-forth shake.
// Running and stairs push the same way on every step, so they don't count as reversals.
export function createShakeDetector(level: Sensitivity, onShake: () => void) {
  const { spikeG, spikes: spikesNeeded, reversals: reversalsNeeded } = SHAKE_PRESETS[level];

  let hasGravity = false;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  let hasLast = false;
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  let lastM = 0;
  let lastSpikeAt = 0;
  let spikeTimes: number[] = [];
  let reversalTimes: number[] = [];
  let fired = false;

  return function feed(x: number, y: number, z: number, now: number) {
    if (fired) return;

    if (!hasGravity) {
      gx = x;
      gy = y;
      gz = z;
      hasGravity = true;
      return;
    }
    gx = GRAVITY_FILTER * gx + (1 - GRAVITY_FILTER) * x;
    gy = GRAVITY_FILTER * gy + (1 - GRAVITY_FILTER) * y;
    gz = GRAVITY_FILTER * gz + (1 - GRAVITY_FILTER) * z;

    const lx = x - gx;
    const ly = y - gy;
    const lz = z - gz;
    const m = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (m < spikeG || now - lastSpikeAt < MIN_GAP_MS) return;

    if (hasLast && now - lastSpikeAt <= WINDOW_MS) {
      const dot = (lx * lastX + ly * lastY + lz * lastZ) / (m * lastM);
      if (dot < REVERSAL_DOT) reversalTimes.push(now);
    }
    lastX = lx;
    lastY = ly;
    lastZ = lz;
    lastM = m;
    hasLast = true;
    lastSpikeAt = now;

    spikeTimes.push(now);
    spikeTimes = spikeTimes.filter((t) => now - t <= WINDOW_MS);
    reversalTimes = reversalTimes.filter((t) => now - t <= WINDOW_MS);
    if (__DEV__) {
      console.log("Shake spike:", m.toFixed(2), "spikes:", spikeTimes.length, "reversals:", reversalTimes.length);
    }

    if (spikeTimes.length >= spikesNeeded && reversalTimes.length >= reversalsNeeded) {
      fired = true;
      onShake();
    }
  };
}