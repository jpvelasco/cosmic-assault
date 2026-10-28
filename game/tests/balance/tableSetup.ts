import { clearRows, formatClearTimes, formatTable, readRows } from './targets';

/**
 * Before the galaxy files play, keeps the last run's rows as the previous run's and starts afresh; once they have,
 * prints the whole table, passing or failing, and the expert's clear time per Dimension, so every run of the balance
 * suite reports its rates.
 */
export default function setup(): () => void {
  clearRows();
  return () => {
    const rows = readRows();
    if (rows.length > 0) console.log(`\nBot difficulty over 40 seeds a galaxy:\n${formatTable(rows)}\n\n${formatClearTimes(rows)}\n`);
  };
}
