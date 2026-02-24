import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderSparkline, computeStats, formatNumber, svgToDataUri, DataPoint } from '../src/graphRenderer';

describe('renderSparkline', () => {
  it('renders SVG with data points', () => {
    const data: DataPoint[] = [
      { timestamp: 1000, value: 10 },
      { timestamp: 1060, value: 20 },
      { timestamp: 1120, value: 15 },
      { timestamp: 1180, value: 25 },
      { timestamp: 1240, value: 18 },
    ];
    const svg = renderSparkline(data);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.includes('<polyline'));
    assert.ok(svg.includes('<polygon'));
    assert.ok(svg.includes('</svg>'));
  });

  it('renders empty state when no data', () => {
    const svg = renderSparkline([]);
    assert.ok(svg.includes('No data'));
    assert.ok(svg.includes('<svg'));
  });

  it('handles single data point', () => {
    const data: DataPoint[] = [{ timestamp: 1000, value: 42 }];
    const svg = renderSparkline(data);
    assert.ok(svg.includes('<svg'));
  });

  it('uses custom colors', () => {
    const data: DataPoint[] = [
      { timestamp: 1000, value: 10 },
      { timestamp: 1060, value: 20 },
    ];
    const svg = renderSparkline(data, { lineColor: '#ff0000' });
    assert.ok(svg.includes('#ff0000'));
  });

  it('uses default dimensions', () => {
    const data: DataPoint[] = [
      { timestamp: 1000, value: 10 },
      { timestamp: 1060, value: 20 },
    ];
    const svg = renderSparkline(data);
    assert.ok(svg.includes('width="300"'));
    assert.ok(svg.includes('height="60"'));
  });
});

describe('computeStats', () => {
  it('computes correct stats', () => {
    const data: DataPoint[] = [
      { timestamp: 1, value: 10 },
      { timestamp: 2, value: 20 },
      { timestamp: 3, value: 30 },
    ];
    const stats = computeStats(data);
    assert.strictEqual(stats.min, 10);
    assert.strictEqual(stats.max, 30);
    assert.strictEqual(stats.avg, 20);
    assert.strictEqual(stats.latest, 30);
  });

  it('returns zeros for empty data', () => {
    const stats = computeStats([]);
    assert.strictEqual(stats.min, 0);
    assert.strictEqual(stats.max, 0);
    assert.strictEqual(stats.avg, 0);
    assert.strictEqual(stats.latest, 0);
  });

  it('handles single point', () => {
    const stats = computeStats([{ timestamp: 1, value: 42 }]);
    assert.strictEqual(stats.min, 42);
    assert.strictEqual(stats.max, 42);
    assert.strictEqual(stats.avg, 42);
    assert.strictEqual(stats.latest, 42);
  });
});

describe('formatNumber', () => {
  it('formats millions', () => {
    assert.strictEqual(formatNumber(1500000), '1.5M');
  });

  it('formats thousands', () => {
    assert.strictEqual(formatNumber(2500), '2.5K');
  });

  it('formats integers as-is', () => {
    assert.strictEqual(formatNumber(42), '42');
  });

  it('formats decimals to 2 places', () => {
    assert.strictEqual(formatNumber(3.14159), '3.14');
  });

  it('formats zero', () => {
    assert.strictEqual(formatNumber(0), '0');
  });

  it('formats negative millions', () => {
    assert.strictEqual(formatNumber(-2000000), '-2.0M');
  });
});

describe('svgToDataUri', () => {
  it('returns base64 data URI', () => {
    const svg = '<svg><text>hello</text></svg>';
    const uri = svgToDataUri(svg);
    assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
    const decoded = Buffer.from(uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString();
    assert.strictEqual(decoded, svg);
  });
});
