import { describe, expect, it } from 'vitest';

import { computeIsPassed, computeScoreScaled, computeVerb } from '../src';

describe('computeScoreScaled', () => {
  it('scales within the reported range', () => {
    expect(computeScoreScaled(2, 2)).toBe(1);
    expect(computeScoreScaled(1, 2)).toBe(0.5);
    expect(computeScoreScaled(0, 2)).toBe(0);
  });

  it('honours a non-zero minimum', () => {
    expect(computeScoreScaled(0, 2, -2)).toBe(0.5);
  });

  it('clamps scores outside the range instead of emitting >1 or <0', () => {
    expect(computeScoreScaled(3, 2)).toBe(1);
    expect(computeScoreScaled(-1, 2)).toBe(0);
  });

  it('returns null when the activity reported no usable score', () => {
    // 27% of PFY's legacy corpus cannot emit a score at all (Accordion,
    // ImageSlider, ImageHotspots, Collage). That must read as "no score",
    // never as zero.
    expect(computeScoreScaled(null, null)).toBeNull();
    expect(computeScoreScaled(1, null)).toBeNull();
    expect(computeScoreScaled(null, 2)).toBeNull();
    expect(computeScoreScaled(1, 0)).toBeNull();
  });
});

describe('computeIsPassed', () => {
  it('compares the scaled score against the activity threshold', () => {
    expect(computeIsPassed(1, 1)).toBe(true);
    expect(computeIsPassed(0.5, 0.5)).toBe(true);
    expect(computeIsPassed(0.49, 0.5)).toBe(false);
  });

  it('is null when there is nothing to judge', () => {
    expect(computeIsPassed(null, 1)).toBeNull();
    expect(computeIsPassed(1, null)).toBeNull();
  });
});

describe('computeVerb', () => {
  it('reports work in progress as answered', () => {
    expect(computeVerb(false, null)).toBe('answered');
    expect(computeVerb(false, true)).toBe('answered');
  });

  it('reports finished-but-unscored work as completed', () => {
    expect(computeVerb(true, null)).toBe('completed');
  });

  it('resolves scored completions to passed/failed', () => {
    expect(computeVerb(true, true)).toBe('passed');
    expect(computeVerb(true, false)).toBe('failed');
  });
});
