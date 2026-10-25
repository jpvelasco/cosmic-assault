import { WRAP_MARGIN } from './config';
import type { Field } from './field';

export function wrapPosition(p: { x: number; y: number }, field: Field, margin: number = WRAP_MARGIN): void {
  if (p.x < -margin) {
    p.x = field.width + margin;
  } else if (p.x > field.width + margin) {
    p.x = -margin;
  }
  if (p.y < -margin) {
    p.y = field.height + margin;
  } else if (p.y > field.height + margin) {
    p.y = -margin;
  }
}
