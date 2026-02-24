export interface MetricMatch {
  metricName: string;
  metricType: string;
  startIndex: number;
  endIndex: number;
}

interface LanguagePattern {
  pattern: RegExp;
  nameGroup: number;
  typeGroup: number;
}

const PYTHON_PATTERNS: LanguagePattern[] = [
  {
    pattern: /(?:statsd|datadog|stats|dogstatsd)\.(increment|decrement|gauge|histogram|timing|set|distribution|count)\s*\(\s*['"]([^'"]+)['"]/gi,
    nameGroup: 2,
    typeGroup: 1,
  },
  {
    pattern: /DogStatsd\.(increment|decrement|gauge|histogram|timing|set|distribution|count)\s*\(\s*['"]([^'"]+)['"]/gi,
    nameGroup: 2,
    typeGroup: 1,
  },
];

const GO_PATTERNS: LanguagePattern[] = [
  {
    pattern: /(?:statsd|statsClient|client)\.(Incr|Increment|Decr|Gauge|Count|Histogram|Distribution|Timing|TimeInMilliseconds|Set|Event)\s*\(\s*"([^"]+)"/gi,
    nameGroup: 2,
    typeGroup: 1,
  },
];

const RUBY_PATTERNS: LanguagePattern[] = [
  {
    pattern: /(?:StatsD|Datadog::Statsd|DogStatsD|statsd)\.(increment|decrement|gauge|histogram|timing|set|count|distribution)\s*\(\s*['"]([^'"]+)['"]/gi,
    nameGroup: 2,
    typeGroup: 1,
  },
];

const JS_TS_PATTERNS: LanguagePattern[] = [
  {
    pattern: /(?:statsd|dogstatsd|StatsD|client|metrics|datadog)\.(increment|decrement|gauge|histogram|timing|set|count|distribution)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    nameGroup: 2,
    typeGroup: 1,
  },
];

const LANGUAGE_PATTERNS: Record<string, LanguagePattern[]> = {
  python: PYTHON_PATTERNS,
  go: GO_PATTERNS,
  ruby: RUBY_PATTERNS,
  javascript: JS_TS_PATTERNS,
  typescript: JS_TS_PATTERNS,
  javascriptreact: JS_TS_PATTERNS,
  typescriptreact: JS_TS_PATTERNS,
};

/**
 * Normalizes a metric type string to a canonical form.
 */
function normalizeMetricType(raw: string): string {
  const lower = raw.toLowerCase();
  const map: Record<string, string> = {
    increment: 'count',
    incr: 'count',
    decrement: 'count',
    decr: 'count',
    count: 'count',
    gauge: 'gauge',
    histogram: 'histogram',
    distribution: 'distribution',
    timing: 'timing',
    timeinmilliseconds: 'timing',
    set: 'set',
    event: 'event',
  };
  return map[lower] || lower;
}

/**
 * Detects a metric call in a line of text for a given language.
 * Returns the first match found, or null.
 */
export function detectMetric(line: string, languageId: string): MetricMatch | null {
  const patterns = LANGUAGE_PATTERNS[languageId];
  if (!patterns) {
    return null;
  }

  for (const { pattern, nameGroup, typeGroup } of patterns) {
    // Reset lastIndex since we reuse the regex
    const re = new RegExp(pattern.source, pattern.flags);
    const match = re.exec(line);
    if (match) {
      return {
        metricName: match[nameGroup],
        metricType: normalizeMetricType(match[typeGroup]),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      };
    }
  }

  return null;
}

/**
 * Detects all metric calls in a line of text for a given language.
 */
export function detectAllMetrics(line: string, languageId: string): MetricMatch[] {
  const patterns = LANGUAGE_PATTERNS[languageId];
  if (!patterns) {
    return [];
  }

  const matches: MetricMatch[] = [];

  for (const { pattern, nameGroup, typeGroup } of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      matches.push({
        metricName: match[nameGroup],
        metricType: normalizeMetricType(match[typeGroup]),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  return matches;
}

/**
 * Returns the default Datadog aggregation function for a metric type.
 */
export function defaultAggregation(metricType: string): string {
  switch (metricType) {
    case 'count':
      return 'sum';
    case 'gauge':
      return 'avg';
    case 'histogram':
    case 'distribution':
    case 'timing':
      return 'avg';
    case 'set':
      return 'count';
    default:
      return 'avg';
  }
}

/**
 * Builds a Datadog metrics query string from a metric match.
 */
export function buildMetricQuery(metricName: string, metricType: string, prefix: string = ''): string {
  const agg = defaultAggregation(metricType);
  const fullName = prefix ? `${prefix}${metricName}` : metricName;
  return `${agg}:${fullName}{*}`;
}
