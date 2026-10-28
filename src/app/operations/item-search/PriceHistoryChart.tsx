import type { PricePoint } from "@/lib/price-list-parse";
import { formatPrice, formatUpdated } from "@/lib/price-list-search";
import styles from "./PriceHistoryChart.module.css";

/** Drawing area, in the SVG's own units; it scales to the width of the card. */
const WIDTH = 320;
const HEIGHT = 176;
const PAD = { left: 46, right: 18, top: 22, bottom: 26 };

/** How many prices the graph shows: the latest this many. Older ones are left off. */
const MAX_POINTS = 8;

/** Half the width of a price label, to tell when one would spill over an edge. */
const LABEL_HALF = 17;

/** Closest two price labels may sit before the earlier one is left off. */
const MIN_LABEL_GAP = 38;

type XY = [x: number, y: number];

/**
 * An axis that starts and ends on round numbers: four or so even steps of 1, 2,
 * 2.5 or 5 (times a power of ten) covering the lowest and highest price.
 */
function niceScale(lo: number, hi: number): { min: number; max: number; step: number; ticks: number[] } {
  // One price all the way along would give an axis of no height.
  const span = hi - lo || Math.abs(hi) * 0.2 || 1;
  const rough = span / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min, max: ticks[ticks.length - 1], step, ticks };
}

const axisPrice = (v: number, step: number) => `$${v.toFixed(Number.isInteger(step) ? 0 : 2)}`;

/** "28 Jun", or "Jun 2026" when the graph runs for the better part of a year. */
function axisDate(ms: number, withYear: boolean): string {
  return new Date(ms).toLocaleDateString("en-AU", {
    ...(withYear ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" }),
    timeZone: "Australia/Sydney",
  });
}

/**
 * An item's past prices as a line graph in the manner of a share price: a
 * line through the price at each change, gridlines and a scale on the left,
 * dates along the bottom, and the price written at the points.
 *
 * Takes two or more points, oldest first, and draws the latest eight of them: a
 * long history squeezed into a phone's width is a smear, and what the kitchen
 * wants is the recent run of prices. The last price carries on, dashed, to
 * today. Below the graph the same changes are listed as words, newest first,
 * since a graph shows the shape and the list says exactly what.
 */
export default function PriceHistoryChart({ points: all }: { points: PricePoint[] }) {
  const points = all.slice(-MAX_POINTS);
  const cutOff = all.length > points.length;
  const { min, max, step, ticks } = niceScale(
    Math.min(...points.map((pt) => pt.p)),
    Math.max(...points.map((pt) => pt.p)),
  );

  const start = points[0].at;
  const last = points[points.length - 1];
  const end = Math.max(Date.now(), last.at);
  const width = end - start || 1;

  const x = (at: number) => PAD.left + ((at - start) / width) * (WIDTH - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - (p - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom);

  const coords: XY[] = points.map((pt) => [x(pt.at), y(pt.p)]);
  const line = coords.map(([cx, cy], i) => `${i === 0 ? "M" : "L"} ${cx} ${cy}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];

  // Which points get their price written beside them: the latest always, then
  // back through the rest, skipping any that would sit on top of the one after.
  const labelled = new Set<number>();
  let nextX = Infinity;
  for (let i = coords.length - 1; i >= 0; i -= 1) {
    if (i === coords.length - 1 || nextX - coords[i][0] >= MIN_LABEL_GAP) {
      labelled.add(i);
      nextX = coords[i][0];
    }
  }

  const dayMs = 86_400_000;
  const withYear = end - start > 300 * dayMs;
  const dateTicks = [0, 1, 2, 3].map((i) => start + (width * i) / 3);

  const changes = points
    .slice(1)
    .map((pt, i) => ({ at: pt.at, from: points[i].p, to: pt.p }))
    .reverse();

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Price history: from ${formatPrice(points[0].p)} to ${formatPrice(last.p)}`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className={styles.grid} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(v)} y2={y(v)} />
            <text className={`${styles.axisLabel} ${styles.axisLabelEnd}`} x={PAD.left - 6} y={y(v) + 4}>
              {axisPrice(v, step)}
            </text>
          </g>
        ))}

        {dateTicks.map((at, i) => (
          <g key={i}>
            <line className={styles.grid} x1={x(at)} x2={x(at)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <text
              className={`${styles.axisLabel} ${i === 0 ? styles.axisLabelStart : i === 3 ? styles.axisLabelEnd : styles.axisLabelMid}`}
              x={x(at)}
              y={HEIGHT - 8}
            >
              {axisDate(at, withYear)}
            </text>
          </g>
        ))}

        {end > last.at && (
          <line className={styles.carry} x1={lastX} x2={x(end)} y1={lastY} y2={lastY} strokeWidth={2} strokeDasharray="4 4" />
        )}
        <path className={styles.line} d={line} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {coords.map(([cx, cy], i) => (
          <g key={points[i].at}>
            <circle className={styles.dot} cx={cx} cy={cy} r={3.5} />
            {labelled.has(i) && (
              <text
                className={`${styles.valueLabel} ${
                  // A label centred on a point at either edge would run over the scale or off the card.
                  cx - LABEL_HALF < PAD.left ? styles.valueLabelStart : cx + LABEL_HALF > WIDTH ? styles.valueLabelEnd : ""
                }`}
                x={cx - LABEL_HALF < PAD.left ? cx - 2 : cx + LABEL_HALF > WIDTH ? cx + 2 : cx}
                y={cy < PAD.top + 8 ? cy + 16 : cy - 8}
              >
                {formatPrice(points[i].p)}
              </text>
            )}
          </g>
        ))}
      </svg>

      <ul className={styles.changes}>
        {changes.map((c) => (
          <li key={c.at} className={styles.change}>
            <span className={styles.changeDate}>{formatUpdated(c.at)}</span>
            <span className={c.to > c.from ? styles.up : styles.down}>
              {c.to > c.from ? "▲" : "▼"} {formatPrice(c.from)} {"→"} {formatPrice(c.to)}
            </span>
          </li>
        ))}
        <li className={styles.change}>
          <span className={styles.changeDate}>{formatUpdated(start)}</span>
          <span className={styles.first}>
            {formatPrice(points[0].p)} {cutOff ? "earlier price" : "first recorded"}
          </span>
        </li>
      </ul>
    </div>
  );
}
