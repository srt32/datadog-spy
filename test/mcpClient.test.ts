import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMetricsResponse } from '../src/parseMetrics';

describe('parseMetricsResponse', () => {
  it('parses Datadog series response with pointlist arrays', () => {
    const result = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          series: [{
            pointlist: [
              [1700000000000, 42],
              [1700000060000, 55],
              [1700000120000, 38],
            ],
          }],
        }),
      }],
    };
    const points = parseMetricsResponse(result);
    assert.strictEqual(points.length, 3);
    assert.strictEqual(points[0].timestamp, 1700000000);
    assert.strictEqual(points[0].value, 42);
    assert.strictEqual(points[1].timestamp, 1700000060);
    assert.strictEqual(points[1].value, 55);
    assert.strictEqual(points[2].timestamp, 1700000120);
    assert.strictEqual(points[2].value, 38);
  });

  it('parses response with point_list key', () => {
    const result = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          series: [{
            point_list: [
              [1700000000000, 10],
              [1700000060000, 20],
            ],
          }],
        }),
      }],
    };
    const points = parseMetricsResponse(result);
    assert.strictEqual(points.length, 2);
    assert.strictEqual(points[0].value, 10);
  });

  it('parses response with object-style points', () => {
    const result = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          series: [{
            pointlist: [
              { timestamp: 1700000000, value: 100 },
              { timestamp: 1700000060, value: 200 },
            ],
          }],
        }),
      }],
    };
    const points = parseMetricsResponse(result);
    assert.strictEqual(points.length, 2);
    assert.strictEqual(points[0].timestamp, 1700000000);
    assert.strictEqual(points[0].value, 100);
  });

  it('parses flat array response', () => {
    const result = {
      content: [{
        type: 'text',
        text: JSON.stringify([
          { timestamp: 1000, value: 5 },
          { timestamp: 2000, value: 10 },
        ]),
      }],
    };
    const points = parseMetricsResponse(result);
    assert.strictEqual(points.length, 2);
    assert.strictEqual(points[0].value, 5);
  });

  it('returns empty array for empty content', () => {
    assert.deepStrictEqual(parseMetricsResponse({ content: [] }), []);
  });

  it('returns empty array for null/undefined', () => {
    assert.deepStrictEqual(parseMetricsResponse(null), []);
    assert.deepStrictEqual(parseMetricsResponse(undefined), []);
  });

  it('returns empty array for empty series', () => {
    const result = {
      content: [{
        type: 'text',
        text: JSON.stringify({ series: [] }),
      }],
    };
    assert.deepStrictEqual(parseMetricsResponse(result), []);
  });

  it('returns empty array for malformed JSON', () => {
    const result = {
      content: [{ type: 'text', text: 'not valid json{{{' }],
    };
    assert.deepStrictEqual(parseMetricsResponse(result), []);
  });

  it('handles null values in pointlist', () => {
    const result = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          series: [{
            pointlist: [
              [1700000000000, null],
              [1700000060000, 42],
            ],
          }],
        }),
      }],
    };
    const points = parseMetricsResponse(result);
    assert.strictEqual(points.length, 2);
    assert.strictEqual(points[0].value, 0);
    assert.strictEqual(points[1].value, 42);
  });
});
