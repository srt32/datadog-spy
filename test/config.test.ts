import { describe, it } from 'node:test';
import assert from 'node:assert';

// Inline the function to avoid importing from config.ts which depends on vscode
function timeRangeToSeconds(range: string): number {
  const map: Record<string, number> = {
    '1h': 3600,
    '4h': 14400,
    '24h': 86400,
    '1w': 604800,
  };
  return map[range] || 3600;
}

describe('timeRangeToSeconds', () => {
  it('converts 1h', () => {
    assert.strictEqual(timeRangeToSeconds('1h'), 3600);
  });

  it('converts 4h', () => {
    assert.strictEqual(timeRangeToSeconds('4h'), 14400);
  });

  it('converts 24h', () => {
    assert.strictEqual(timeRangeToSeconds('24h'), 86400);
  });

  it('converts 1w', () => {
    assert.strictEqual(timeRangeToSeconds('1w'), 604800);
  });

  it('defaults to 1h for unknown range', () => {
    assert.strictEqual(timeRangeToSeconds('5m'), 3600);
    assert.strictEqual(timeRangeToSeconds(''), 3600);
  });
});
