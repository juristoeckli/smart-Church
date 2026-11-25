const maxLatitude = 85.05112878;
const tileSize = 256;
export const mapMinZoom = 2;
export const mapMaxZoom = 18;

export type Point = { x: number; y: number };
export type PinCoordinates = { latitude: number; longitude: number };
export type MapView = { center: Point; zoom: number };

export function worldPoint({ latitude, longitude }: PinCoordinates): Point {
  const angle = Math.max(-maxLatitude, Math.min(maxLatitude, latitude)) * Math.PI / 180;
  return { x: (longitude + 180) / 360, y: (1 - Math.asinh(Math.tan(angle)) / Math.PI) / 2 };
}

const wrap = (x: number) => x - Math.floor(x);
const worldSize = (zoom: number) => tileSize * 2 ** zoom;

export function normalizeView(center: Point, zoom: number): MapView {
  return { center: { x: wrap(center.x), y: Math.min(1, Math.max(0, center.y)) },
    zoom: Math.min(mapMaxZoom, Math.max(mapMinZoom, zoom)) };
}

export function panMap(view: MapView, x: number, y: number): MapView {
  const size = worldSize(view.zoom);
  return normalizeView({ x: view.center.x - x / size, y: view.center.y - y / size }, view.zoom);
}

export function fitPins(points: Point[], width: number, height: number): MapView {
  if (!points.length) return normalizeView({ x: 0.5, y: 0.5 }, mapMinZoom);
  const sorted = points.map(point => wrap(point.x)).sort((first, second) => first - second);
  let largestGap = -1;
  let start = sorted[0];
  for (let index = 0; index < sorted.length; index++) {
    const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + 1;
    const gap = next - sorted[index];
    if (gap > largestGap) { largestGap = gap; start = next; }
  }
  const longitudeSpan = 1 - largestGap;
  let top = 1;
  let bottom = 0;
  for (const point of points) {
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  const fit = Math.floor(Math.log2(Math.min(
    Math.max(width - 100, 1) / (tileSize * Math.max(longitudeSpan, 0.0000001)),
    Math.max(height - 100, 1) / (tileSize * Math.max(bottom - top, 0.0000001)),
  )));
  return normalizeView({ x: start + longitudeSpan / 2, y: (top + bottom) / 2 }, Math.min(fit, 15));
}

export function pinPixel(point: Point, view: MapView, width: number, height: number): Point {
  const size = worldSize(view.zoom);
  const x = wrap(point.x - view.center.x + 0.5) - 0.5;
  return { x: x * size + width / 2, y: (point.y - view.center.y) * size + height / 2 };
}

export function visibleTiles(view: MapView, width: number, height: number) {
  const size = worldSize(view.zoom);
  const worldTiles = 2 ** view.zoom;
  const left = view.center.x * size - width / 2;
  const top = view.center.y * size - height / 2;
  const tiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  for (let y = Math.max(0, Math.floor(top / tileSize)); y <= Math.min(worldTiles - 1, Math.floor((top + height) / tileSize)); y++) {
    for (let x = Math.floor(left / tileSize); x <= Math.floor((left + width) / tileSize); x++) {
      const canonicalX = ((x % worldTiles) + worldTiles) % worldTiles;
      tiles.push({ key: `${view.zoom}/${x}/${y}`, url: `https://tile.openstreetmap.org/${view.zoom}/${canonicalX}/${y}.png`,
        left: x * tileSize - left, top: y * tileSize - top });
    }
  }
  return tiles;
}

export function clusterMapPins<T>(pins: Array<{ item: T; point: Point }>, view: MapView, width: number, height: number) {
  const cells = new Map<string, { x: number; y: number; items: T[] }>();
  for (const { item, point } of pins) {
    const pixel = pinPixel(point, view, width, height);
    if (pixel.x < 0 || pixel.x > width || pixel.y < 0 || pixel.y > height) continue;
    const bucket = `${Math.floor(pixel.x / 48)},${Math.floor(pixel.y / 48)}`;
    const cell = cells.get(bucket);
    if (cell) { cell.x += pixel.x; cell.y += pixel.y; cell.items.push(item); }
    else cells.set(bucket, { ...pixel, items: [item] });
  }
  return [...cells.entries()].map(([key, cell]) => ({ key, items: cell.items, x: cell.x / cell.items.length, y: cell.y / cell.items.length }));
}
