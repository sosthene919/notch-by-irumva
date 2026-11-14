import { describe, expect, it } from 'vitest';
import { batteryFill, segmentedFill } from './hud';

describe('segmentedFill (volume HUD ticks)', () => {
  it('lights ticks in proportion, like the 43% reference bar', () => {
    expect(segmentedFill(0.43, 36)).toBe(15);
    expect(segmentedFill(0, 36)).toBe(0);
    expect(segmentedFill(1, 36)).toBe(36);
    expect(segmentedFill(0.5, 40)).toBe(20);
  });
  it('any audible level lights at least one tick', () => {
    expect(segmentedFill(0.001, 36)).toBe(1);
  });
  it('muted, non-finite and over-range levels are safe', () => {
    expect(segmentedFill(0.7, 36, true)).toBe(0);
    expect(segmentedFill(Number.NaN, 36)).toBe(0);
    expect(segmentedFill(2, 36)).toBe(36);
    expect(segmentedFill(-1, 36)).toBe(0);
    expect(segmentedFill(0.5, 0)).toBe(0);
  });
});

describe('batteryFill', () => {
  it('clamps to a pill percentage', () => {
    expect(batteryFill(43)).toBe(43);
    expect(batteryFill(120)).toBe(100);
    expect(batteryFill(-5)).toBe(0);
    expect(batteryFill(null)).toBe(0);
    expect(batteryFill(undefined)).toBe(0);
  });
});
