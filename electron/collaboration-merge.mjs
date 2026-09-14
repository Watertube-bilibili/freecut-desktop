// Plain JSON equality shared by the room authority and renderer rebasing.
export function sameJSON(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const left = Object.keys(a).filter(key => a[key] !== undefined), right = Object.keys(b).filter(key => b[key] !== undefined);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && sameJSON(a[key], b[key]));
}
const same = sameJSON;
export function mergeProjects(base, current, incoming) {
  const conflicts = [];
  function merge(b, c, n, location) {
    if (same(n, b)) return c;
    if (same(c, b) || same(c, n)) return n;
    if ([b, c, n].every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      const result = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(c), ...Object.keys(n)])) {
        const value = merge(b[key], c[key], n[key], `${location}.${key}`);
        if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    if ([b, c, n].every((v) => Array.isArray(v) && v.every((item) => item && typeof item.id === 'string') && new Set(v.map((item) => item.id)).size === v.length)) {
      const maps = [b, c, n].map((list) => new Map(list.map((item) => [item.id, item])));
      const common = new Set(b.filter((item) => maps[1].has(item.id) && maps[2].has(item.id)).map((item) => item.id));
      const orders = [b, c, n].map((list) => list.filter((item) => common.has(item.id)).map((item) => item.id));
      if (!same(orders[0], orders[1]) && !same(orders[0], orders[2]) && !same(orders[1], orders[2])) conflicts.push(`${location}.order`);
      const preferred = same(orders[0], orders[2]) ? c : n;
      const order = [...new Set([...preferred, ...c, ...n, ...b].map((item) => item.id))];
      return order.map((id) => merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), `${location}[${id}]`)).filter((item) => item !== undefined);
    }
    conflicts.push(location);
    return c;
  }
  const project = merge(base, current, incoming, 'project');
  return { project: structuredClone(project), conflicts: conflicts.slice(0, 64) };
}
