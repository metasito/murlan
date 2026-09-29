export function readFlightFromDom(): number {
  if (typeof document === "undefined") return 0;
  const cards = document.querySelectorAll('[data-testid="flying-card"]');
  const slots = document.querySelectorAll('[data-testid="flight-slot"]');
  let far = 0;
  cards.forEach((c, i) => {
    const a = c.getBoundingClientRect();
    const b = slots[i]?.getBoundingClientRect();
    if (b) far = Math.max(far, Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2));
  });
  return far;
}
