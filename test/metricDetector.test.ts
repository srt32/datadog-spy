import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectMetric, detectAllMetrics, buildMetricQuery, defaultAggregation } from '../src/metricDetector';

describe('detectMetric', () => {
  describe('Python', () => {
    it('detects statsd.increment', () => {
      const result = detectMetric("statsd.increment('orders.created', tags=['env:prod'])", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'orders.created');
      assert.strictEqual(result.metricType, 'count');
    });

    it('detects statsd.gauge with double quotes', () => {
      const result = detectMetric('statsd.gauge("cpu.usage", 42.5)', 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'cpu.usage');
      assert.strictEqual(result.metricType, 'gauge');
    });

    it('detects statsd.histogram', () => {
      const result = detectMetric("statsd.histogram('request.duration', elapsed)", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'request.duration');
      assert.strictEqual(result.metricType, 'histogram');
    });

    it('detects statsd.distribution', () => {
      const result = detectMetric("statsd.distribution('api.latency', latency_ms)", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'api.latency');
      assert.strictEqual(result.metricType, 'distribution');
    });

    it('detects dogstatsd.timing', () => {
      const result = detectMetric("dogstatsd.timing('db.query_time', duration)", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'db.query_time');
      assert.strictEqual(result.metricType, 'timing');
    });

    it('returns null for non-metric lines', () => {
      const result = detectMetric("print('hello world')", 'python');
      assert.strictEqual(result, null);
    });
  });

  describe('Go', () => {
    it('detects statsd.Incr', () => {
      const result = detectMetric('statsd.Incr("orders.created", tags, 1)', 'go');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'orders.created');
      assert.strictEqual(result.metricType, 'count');
    });

    it('detects statsd.Gauge', () => {
      const result = detectMetric('statsd.Gauge("memory.usage", memUsage, tags, 1)', 'go');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'memory.usage');
      assert.strictEqual(result.metricType, 'gauge');
    });

    it('detects statsd.Histogram', () => {
      const result = detectMetric('client.Histogram("request.size", float64(size), tags, 1)', 'go');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'request.size');
      assert.strictEqual(result.metricType, 'histogram');
    });

    it('detects statsd.Count', () => {
      const result = detectMetric('statsd.Count("api.calls", 1, tags, 1)', 'go');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'api.calls');
      assert.strictEqual(result.metricType, 'count');
    });
  });

  describe('Ruby', () => {
    it('detects StatsD.increment', () => {
      const result = detectMetric("StatsD.increment('orders.created', tags: ['env:prod'])", 'ruby');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'orders.created');
      assert.strictEqual(result.metricType, 'count');
    });

    it('detects StatsD.gauge', () => {
      const result = detectMetric("StatsD.gauge('queue.size', queue.length)", 'ruby');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'queue.size');
      assert.strictEqual(result.metricType, 'gauge');
    });
  });

  describe('JavaScript/TypeScript', () => {
    it('detects statsd.increment with single quotes', () => {
      const result = detectMetric("statsd.increment('page.views')", 'javascript');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'page.views');
      assert.strictEqual(result.metricType, 'count');
    });

    it('detects dogstatsd.gauge with backticks', () => {
      const result = detectMetric('dogstatsd.gauge(`memory.used`, value)', 'typescript');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'memory.used');
      assert.strictEqual(result.metricType, 'gauge');
    });

    it('detects metrics.histogram', () => {
      const result = detectMetric("metrics.histogram('api.response_time', ms)", 'javascript');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'api.response_time');
      assert.strictEqual(result.metricType, 'histogram');
    });

    it('works for typescriptreact', () => {
      const result = detectMetric("statsd.increment('click.button')", 'typescriptreact');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'click.button');
    });
  });

  describe('unsupported languages', () => {
    it('returns null for unknown language', () => {
      const result = detectMetric("statsd.increment('test')", 'rust');
      assert.strictEqual(result, null);
    });
  });

  describe('edge cases', () => {
    it('detects metric with leading whitespace (indented code)', () => {
      const result = detectMetric("    statsd.increment('orders.created')", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'orders.created');
      assert.ok(result.startIndex >= 4);
    });

    it('detects decrement', () => {
      const result = detectMetric("statsd.decrement('active.connections')", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'active.connections');
      assert.strictEqual(result.metricType, 'count');
    });

    it('detects Go Decr', () => {
      const result = detectMetric('statsd.Decr("active.connections", tags, 1)', 'go');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'active.connections');
      assert.strictEqual(result.metricType, 'count');
    });

    it('does not match inside comments (still matches — regex limitation)', () => {
      // This documents current behavior: we match inside comments
      const result = detectMetric("# statsd.increment('commented.out')", 'python');
      assert.ok(result, 'regex matches in comments (known limitation)');
    });

    it('handles metric names with dots and underscores', () => {
      const result = detectMetric("statsd.gauge('my_app.api.v2.response_time', val)", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'my_app.api.v2.response_time');
    });

    it('handles metric names with hyphens', () => {
      const result = detectMetric("statsd.increment('my-service.requests')", 'javascript');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'my-service.requests');
    });

    it('handles DogStatsd class in Python', () => {
      const result = detectMetric("DogStatsd.gauge('memory.used', mem)", 'python');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'memory.used');
    });

    it('handles Datadog::Statsd in Ruby', () => {
      const result = detectMetric("Datadog::Statsd.histogram('query.time', elapsed)", 'ruby');
      assert.ok(result);
      assert.strictEqual(result.metricName, 'query.time');
      assert.strictEqual(result.metricType, 'histogram');
    });

    it('returns correct startIndex and endIndex', () => {
      const line = "    statsd.increment('my.metric', 1)";
      const result = detectMetric(line, 'python');
      assert.ok(result);
      const matched = line.substring(result.startIndex, result.endIndex);
      assert.ok(matched.includes('statsd.increment'));
      assert.ok(matched.includes('my.metric'));
    });
  });
});

describe('detectAllMetrics', () => {
  it('finds multiple metrics on one line', () => {
    const line = "statsd.increment('a.b'); statsd.gauge('c.d', 1)";
    const results = detectAllMetrics(line, 'python');
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].metricName, 'a.b');
    assert.strictEqual(results[1].metricName, 'c.d');
  });
});

describe('buildMetricQuery', () => {
  it('builds query with default aggregation for count type', () => {
    const q = buildMetricQuery('orders.created', 'count');
    assert.strictEqual(q, 'sum:orders.created{*}');
  });

  it('builds query with avg for gauge type', () => {
    const q = buildMetricQuery('cpu.usage', 'gauge');
    assert.strictEqual(q, 'avg:cpu.usage{*}');
  });

  it('prepends prefix when provided', () => {
    const q = buildMetricQuery('orders.created', 'count', 'myapp.');
    assert.strictEqual(q, 'sum:myapp.orders.created{*}');
  });
});

describe('defaultAggregation', () => {
  it('returns sum for count', () => {
    assert.strictEqual(defaultAggregation('count'), 'sum');
  });

  it('returns avg for gauge', () => {
    assert.strictEqual(defaultAggregation('gauge'), 'avg');
  });

  it('returns avg for unknown types', () => {
    assert.strictEqual(defaultAggregation('unknown'), 'avg');
  });
});
