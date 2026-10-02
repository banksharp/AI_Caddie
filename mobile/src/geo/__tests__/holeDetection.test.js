import { toLocal } from '../distance';
import { suggestHole, createHoleDetectionState } from '../holeDetection';

const L = toLocal([32.9, -117.25]);
const at = (x, y) => L.unproject({ x, y });

// Three parallel holes running north, 100 m apart. Hole 2's tee is next to
// hole 1's green; hole 3 runs back south.
const holes = [
  { hole_number: 1, tee: at(0, 0), line: [at(0, 0), at(0, 350)], green: { center: at(0, 350) } },
  { hole_number: 2, tee: at(100, 380), line: [at(100, 380), at(100, 700)], green: { center: at(100, 700) } },
  { hole_number: 3, tee: at(200, 700), line: null, green: { center: at(200, 350) } },
];

describe('suggestHole', () => {
  test('rule 1: on the next tee, away from the current green -> high', () => {
    const s = createHoleDetectionState();
    expect(suggestHole(at(105, 385), holes, 1, [], s)).toEqual({
      holeNumber: 2,
      confidence: 'high',
      reason: 'next_tee',
    });
  });

  test('rule 1 does not fire while still near the current green', () => {
    const close = [
      holes[0],
      { ...holes[1], tee: at(20, 360) },
      holes[2],
    ];
    expect(suggestHole(at(20, 360), close, 1, [], createHoleDetectionState())).toBeNull();
  });

  test('accepts the current hole as an object', () => {
    expect(suggestHole(at(100, 380), holes, holes[0], [], createHoleDetectionState())?.holeNumber).toBe(2);
  });

  test('next tee skips scored holes', () => {
    // On hole 1 with hole 2 already scored: hole 3 tee is "next".
    const r = suggestHole(at(200, 700), holes, 1, [2], createHoleDetectionState());
    expect(r).toEqual({ holeNumber: 3, confidence: 'high', reason: 'next_tee' });
  });

  test('no current hole: standing on a tee', () => {
    expect(suggestHole(at(3, 3), holes, null, [], createHoleDetectionState())).toEqual({
      holeNumber: 1,
      confidence: 'high',
      reason: 'at_tee',
    });
  });

  test('rule 2: low confidence only after 3 consecutive fixes', () => {
    const s = createHoleDetectionState();
    // Mid-fairway on hole 3 (tee->green line), current hole 1.
    expect(suggestHole(at(190, 500), holes, 1, [], s)).toBeNull();
    expect(suggestHole(at(195, 510), holes, 1, [], s)).toBeNull();
    expect(suggestHole(at(205, 520), holes, 1, [], s)).toEqual({
      holeNumber: 3,
      confidence: 'low',
      reason: 'on_hole_line',
    });
  });

  test('rule 2 resets when a fix breaks the streak', () => {
    const s = createHoleDetectionState();
    suggestHole(at(190, 500), holes, 1, [], s);
    suggestHole(at(195, 510), holes, 1, [], s);
    expect(suggestHole(at(0, 200), holes, 1, [], s)).toBeNull(); // back on hole 1
    expect(s.count).toBe(0);
    expect(suggestHole(at(205, 520), holes, 1, [], s)).toBeNull();
  });

  test('on the current hole -> null', () => {
    const s = createHoleDetectionState();
    for (let i = 0; i < 5; i++) expect(suggestHole(at(5, 100 + i), holes, 1, [], s)).toBeNull();
  });

  test('far from every hole -> null', () => {
    const s = createHoleDetectionState();
    for (let i = 0; i < 5; i++) expect(suggestHole(at(50, 100), holes, 1, [], s)).toBeNull();
  });

  test('scored holes are not suggested by rule 2', () => {
    const s = createHoleDetectionState();
    for (let i = 0; i < 4; i++) expect(suggestHole(at(100, 500), holes, 1, [2], s)).toBeNull();
  });

  test('without state, rule 2 never suggests', () => {
    for (let i = 0; i < 4; i++) expect(suggestHole(at(100, 500), holes, 1, [])).toBeNull();
  });

  test('bad input', () => {
    expect(suggestHole(null, holes, 1, [], createHoleDetectionState())).toBeNull();
    expect(suggestHole(at(0, 0), [], 1, [], createHoleDetectionState())).toBeNull();
    expect(suggestHole(at(0, 0), null, 1, [], createHoleDetectionState())).toBeNull();
  });
});
