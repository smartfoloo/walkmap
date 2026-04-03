const WALK_SPEED = 80;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchStreetNetwork(lat, lon, radiusMeters) {
  const q = `
    [out:json][timeout:45];
    (
      way["highway"~"^(footway|path|pedestrian|steps|residential|living_street|service|unclassified|tertiary|secondary|primary|cycleway|track)$"]
        (around:${radiusMeters},${lat},${lon});
      >;
    );
    out body;
  `;
  const res = await fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`
  );
  if (!res.ok) throw new Error('Overpass API request failed');
  return res.json();
}

function buildGraph(osm) {
  const nodes = {};
  const adj = {};

  for (const el of osm.elements) {
    if (el.type === 'node') nodes[el.id] = { lat: el.lat, lon: el.lon };
  }

  for (const el of osm.elements) {
    if (el.type !== 'way' || !el.nodes) continue;
    const speedFactor = el.tags?.highway === 'steps' ? 0.5 : 1.0;

    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = el.nodes[i], b = el.nodes[i + 1];
      if (!nodes[a] || !nodes[b]) continue;
      const dist = haversine(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon) / speedFactor;
      if (!adj[a]) adj[a] = [];
      if (!adj[b]) adj[b] = [];
      adj[a].push({ id: b, dist });
      adj[b].push({ id: a, dist });
    }
  }

  return { nodes, adj };
}

function findNearest(nodes, lat, lon) {
  let best = null, bestDist = Infinity;
  for (const [id, pos] of Object.entries(nodes)) {
    const d = haversine(lat, lon, pos.lat, pos.lon);
    if (d < bestDist) { bestDist = d; best = id; }
  }
  return best;
}

function dijkstra(adj, startId, maxDist) {
  const dist = { [startId]: 0 };
  const queue = [{ id: startId, d: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const { id, d } = queue.shift();
    if (d > (dist[id] ?? Infinity) || d > maxDist) continue;

    for (const { id: nb, dist: ed } of adj[id] || []) {
      const nd = d + ed;
      if (nd <= maxDist && (dist[nb] === undefined || nd < dist[nb])) {
        dist[nb] = nd;
        queue.push({ id: nb, d: nd });
      }
    }
  }

  return dist;
}

function cross(O, A, B) {
  return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
}
function convexHull(points) {
  if (points.length < 3) return points;
  const s = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [], upper = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/**
 * Main entry point.
 * @param {number} lat - Start latitude
 * @param {number} lon - Start longitude
 * @param {number} minutes - Walk time in minutes
 * @returns {{ reachableEdges: GeoJSON, polygon: GeoJSON|null, reachableCount: number }}
 */
async function computeIsochrone(lat, lon, minutes) {
  const maxDist = minutes * WALK_SPEED;
  const radius = maxDist * 1.3 + 200;

  const osm = await fetchStreetNetwork(lat, lon, radius);
  const { nodes, adj } = buildGraph(osm);
  const startId = findNearest(nodes, lat, lon);

  if (!startId) throw new Error('No walkable streets found near this location');

  const reachDist = dijkstra(adj, startId, maxDist);
  const ids = Object.keys(reachDist);

  const edgeFeatures = [];
  const seen = new Set();
  for (const id of ids) {
    for (const { id: nb } of adj[id] || []) {
      const key = [id, nb].sort().join('-');
      if (!seen.has(key) && reachDist[nb] !== undefined) {
        seen.add(key);
        const a = nodes[id], b = nodes[nb];
        if (a && b) {
          const progress = Math.max(reachDist[id], reachDist[nb]) / maxDist;
          edgeFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
            properties: { progress },
          });
        }
      }
    }
  }

  const pts = ids.map(id => nodes[id]).filter(Boolean).map(p => [p.lon, p.lat]);
  const hull = convexHull(pts);
  const polygon = hull.length >= 3
    ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...hull, hull[0]]] }, properties: {} }
    : null;

  return {
    reachableEdges: { type: 'FeatureCollection', features: edgeFeatures },
    polygon,
    reachableCount: ids.length,
  };
}