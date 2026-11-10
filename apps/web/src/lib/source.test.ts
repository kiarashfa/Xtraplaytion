import { describe, expect, it } from 'vitest';
import {
  defaultColumns,
  drawnFunction,
  drawStroke,
  latticeFor,
  parseTable,
  pointsFrom,
  pointsLayout,
  quantize,
  type Table,
} from './source.ts';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('missing');
  return v;
}

describe('drawings', () => {
  const lattice = latticeFor([0, 256]); // knots at every integer

  it('turn a stroke into knots and interpolate between them', () => {
    const d = must(
      drawStroke(
        null,
        [
          { x: 10, y: 0 },
          { x: 20, y: 10 },
        ],
        lattice,
      ),
    );
    expect(d.x0).toBe(10);
    expect(d.x1).toBe(20);
    expect(d.ys).toHaveLength(11);
    const f = drawnFunction(d);
    expect(f(15)).toBeCloseTo(5, 10);
    expect(f(15.5)).toBeCloseTo(5.5, 10);
    expect(f(9)).toBeNaN();
    expect(f(21)).toBeNaN();
  });

  it('let a later stroke replace part of the drawing and bridge gaps', () => {
    const a = drawStroke(
      null,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      lattice,
    );
    const b = must(
      drawStroke(
        a,
        [
          { x: 5, y: 4 },
          { x: 8, y: 4 },
        ],
        lattice,
      ),
    );
    expect(b.ys.slice(0, 11)).toEqual([0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0]);
    const c = must(
      drawStroke(
        b,
        [
          { x: 20, y: 10 },
          { x: 22, y: 10 },
        ],
        lattice,
      ),
    );
    expect(c.x1).toBe(22);
    expect(drawnFunction(c)(15)).toBeCloseTo(5, 10); // bridged from (10, 0) to (20, 10)
  });

  it('take the latest pass when a stroke goes back', () => {
    const d = must(
      drawStroke(
        null,
        [
          { x: 0, y: 1 },
          { x: 10, y: 1 },
          { x: 5, y: 3 },
        ],
        lattice,
      ),
    );
    expect(d.ys[7]).toBeCloseTo(2.2, 10);
    expect(d.ys[0]).toBe(1);
  });

  it('ignore strokes that are too short', () => {
    expect(drawStroke(null, [{ x: 3.2, y: 1 }], lattice)).toBeNull();
  });

  it('round values to a short, stable form', () => {
    expect(quantize([0.123456, 1.5])).toEqual([0.123, 1.5]);
    expect(quantize(quantize([3.14159265, -2]))).toEqual(quantize([3.14159265, -2]));
  });
});

describe('tables', () => {
  const ok = (t: Table | string): Table => {
    if (typeof t === 'string') throw new Error(t);
    return t;
  };

  it('read CSV with a header', () => {
    const t = ok(parseTable('time,value,other\n0,1.5,a\n1,2.5,b\n2,3.5,c\n'));
    expect(t.header).toBe(true);
    expect(t.columns).toEqual(['time', 'value', 'other']);
    expect(defaultColumns(t)).toEqual([0, 1]);
    const p = must(pointsFrom(t, 0, 1));
    expect(p.xs).toEqual([0, 1, 2]);
    expect(p.ys).toEqual([1.5, 2.5, 3.5]);
  });

  it('read semicolons with decimal commas, tabs and spaces', () => {
    const semi = ok(parseTable('x;y\n0,5;1,25\n1,5;2\n'));
    expect(must(pointsFrom(semi, 0, 1)).xs).toEqual([0.5, 1.5]);
    expect(must(pointsFrom(ok(parseTable('1\t2\n3\t4\n')), 0, 1)).ys).toEqual([2, 4]);
    expect(must(pointsFrom(ok(parseTable('1 2\n 3   4\n# note\n\n5 6')), 0, 1)).ys).toEqual([
      2, 4, 6,
    ]);
    expect(must(pointsFrom(ok(parseTable('"a","b"\n"1","2"\n"3","−4"\n')), 0, 1)).ys).toEqual([
      2, -4,
    ]);
  });

  it('use the row number when there is one column, and drop bad rows', () => {
    const t = ok(parseTable('v\n3\n4\nn/a\n6\n'));
    expect(defaultColumns(t)).toEqual([-1, 0]);
    const p = must(pointsFrom(t, -1, 0));
    expect(p.xs).toEqual([0, 1, 3]);
    expect(p.dropped).toBe(1);
  });

  it('report empty, wordy and huge inputs', () => {
    expect(parseTable('  \n\n')).toBe('empty');
    expect(parseTable('hello\nworld')).toBe('noNumbers');
    expect(parseTable('1,2\n'.repeat(1_400_000))).toBe('tooBig');
  });

  it('thin out evenly above the point limit', () => {
    const text = Array.from({ length: 12000 }, (_, i) => `${i},${i * 2}`).join('\n');
    const p = must(pointsFrom(ok(parseTable(text)), 0, 1));
    expect(p.xs).toHaveLength(5000);
    expect(p.thinnedFrom).toBe(12000);
    expect(p.xs[0]).toBe(0);
    expect(p.xs[4999]).toBe(11999);
  });

  it('suggest a plot range and a first training range', () => {
    const l = pointsLayout([0, 10]);
    expect(l.domain).toEqual([-0.5, 10.5]);
    expect(l.bands).toEqual([[0, 7]]);
  });
});
