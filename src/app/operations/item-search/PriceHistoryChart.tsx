import type { PricePoint } from "@/lib/price-list-parse";
import { formatPrice, formatUpdated } from "@/lib/price-list-search";
import styles from "./PriceHistoryChart.module.css";

/** Drawing area, in the SVG's own units; it scales to the width of the card. */
const WIDTH = 320;
const HEIGHT = 132;
const PAD = { left: 56, right: 12, top: 12, bottom: 12 };

/**
 * An item's past prices: a step line that holds each price until the next one
 * began, running on to today, with a dot where each change was.
 *
 * Takes two or more points, oldest first. Below it, the same changes as words,
 * newest first, since a graph shows the shape and the list says exactly what.
 */
export default function PriceHistoryChart({ points }: { points: PricePoint[] }) {
  const prices = points.map((pt) => pt.p);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // All the same price cannot happen with a change in it, but a flat axis would divide by zero.
  const span = hi - lo || 1;

  const start = points[0].at;
  const end = Math.max(Date.now(), points[points.length - 1].at);
  const width = end - start || 1;

  const x = (at: number) => PAD.left + ((at - start) / width) * (WIDTH - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - (p - lo) / span) * (HEIGHT - PAD.top - PAD.bottom);

  // Hold each price flat until the next change, then step to it.
  let path = `M ${x(points[0].at)} ${y(points[0].p)}`;
  for (const pt of points.slice(1)) path += ` H ${x(pt.at)} V ${y(pt.p)}`;
  path += ` H ${x(end)}`;

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
        aria-label={`Price history: from ${formatPrice(points[0].p)} to ${formatPrice(points[points.length - 1].p)}`}
      >
        <line className={styles.grid} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(hi)} y2={y(hi)} />
        <line className={styles.grid} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(lo)} y2={y(lo)} />
        <text className={styles.axisLabel} x={0} y={y(hi) + 4}>
          {formatPrice(hi)}
        </text>
        {hi !== lo && (
          <text className={styles.axisLabel} x={0} y={y(lo) + 4}>
            {formatPrice(lo)}
          </text>
        )}
        <path className={styles.line} d={path} fill="none" strokeWidth={2} strokeLinejoin="round" />
        {points.map((pt) => (
          <circle key={pt.at} className={styles.dot} cx={x(pt.at)} cy={y(pt.p)} r={4} />
        ))}
      </svg>

      <div className={styles.dates}>
        <span>{formatUpdated(start)}</span>
        <span>Today</span>
      </div>

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
          <span className={styles.first}>{formatPrice(points[0].p)} first recorded</span>
        </li>
      </ul>
    </div>
  );
}
