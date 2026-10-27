import { clearRows, formatTable, readRows } from './targets';

/**
 * Clears the rows of an earlier run before the galaxy files play, and prints the whole table once they have, passing
 * or failing, so every run of the balance suite reports its rates.
 */
export default function setup(): () => void {
  clearRows();
  return () => {
    const rows = readRows();
    if (rows.length > 0) console.log(`\nBot difficulty over 40 seeds a galaxy:\n${formatTable(rows)}\n`);
  };
}
