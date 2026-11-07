export const ID = "mjl-dungeon-sketch";
export const TITLE = "MJl - Dungeon Sketch";
export const feetPerUnit=grid=>/^(m|meters?|metres?|метр[аовы]*)$/i.test(String(grid.units).trim())?1/0.3048:1;
export const equalReachDiagonals=grid=>grid.isSquare&&grid.diagonals===(globalThis.CONST?.GRID_DIAGONALS?.EQUIDISTANT??0);
export function reachNorm(grid,...axes) {
  return equalReachDiagonals(grid)?Math.max(...axes.map(Math.abs)):Math.hypot(...axes);
}
export function tokenReachPosition(token,changes) {
  // Foundry animates the prepared TokenDocument independently on each client.
  const position=token._source??token;
  return changes?{...position,...changes}:position;
}
export const empty = () => ({floor: [], walls: [], doors: [], paint: [], lights: [], stairs: [], furniture: [], traps: [], openings:[],style: "stone"});
export const STAIR_COLOR="#d4c3a3";
export const PASSAGES={
  door:{name:"Деревянная дверь",icon:"fa-door-closed"},
  grateDoor:{name:"Решётчатая дверь",icon:"fa-bars",transparent:true},
  metalDoor:{name:"Металлическая дверь",icon:"fa-shield"},
  stoneDoor:{name:"Каменная дверь",icon:"fa-archway"},
  secret:{name:"Секретная дверь",icon:"fa-user-secret"},
  window:{name:"Окно",icon:"fa-window-frame"}
};
export const STAIRS={stair:{name:"Маршевая лестница",icon:"fa-stairs"},ladder:{name:"Приставная лестница",icon:"fa-grip-lines-vertical"},steps:{name:"Ступеньки",icon:"fa-shoe-prints"},hatch:{name:"Люк",icon:"fa-square-caret-down"}};
export const round = ([x, y]) => [Math.round(x), Math.round(y)];
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const rectangle = ([x, y], [r, b]) => [[x, y], [r, y], [r, b], [x, b]];
export const bounds = (a, b) => ({x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
  width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1])});
export function stairOutline({points,x,y,width,height,rotation=0}) {
  if (points) return points;
  const angle=rotation*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  return rectangle([-width/2,-height/2],[width/2,height/2]).map(([a,b])=>
    round([x+width/2+a*c-b*s,y+height/2+a*s+b*c]));
}
export function stairFromEdge(a,b,point) {
  const width=distance(a,b);
  if (width<2) return null;
  const ux=(b[0]-a[0])/width, uy=(b[1]-a[1])/width;
  const dx=point[0]-a[0],dy=point[1]-a[1],along=dx*ux+dy*uy,depth=dx*-uy+dy*ux;
  if (Math.abs(depth)<2) return null;
  const endWidth=Math.max(2,width*0.05,along<0 ? width-along : along>width ? along : Math.abs(2*along-width));
  const center=[(a[0]+b[0])/2-uy*depth,(a[1]+b[1])/2+ux*depth];
  return {points:[a,b,round([center[0]+ux*endWidth/2,center[1]+uy*endWidth/2]),
    round([center[0]-ux*endWidth/2,center[1]-uy*endWidth/2])]};
}
export function stairAt(model,point) {
  return model.stairs.findLast(stair=>{
    const ring=stairOutline(stair),crosses=ring.map((a,i)=>{const b=ring[(i+1)%ring.length];return (b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0]);});
    return crosses.every(c=>c>=-0.001)||crosses.every(c=>c<=0.001);
  });
}
export function stairLines(stair,spacing=18,minimum=4) {
  const [a,b,c,d]=stairOutline(stair);
  const length=distance([(a[0]+b[0])/2,(a[1]+b[1])/2],[(c[0]+d[0])/2,(c[1]+d[1])/2]);
  const count=Math.min(40,Math.max(minimum,Math.round(length/spacing)));
  return Array.from({length:count+1},(_,i)=>[pointAt(a,d,i/count),pointAt(b,c,i/count)]);
}
export function stairGate(stair,size=100) {
  const outline=stairOutline(stair);
  if(stair.kind==="hatch")return outline;
  // Legacy rectangles point towards their first edge; two-stage stairs point towards the far edge.
  const [a,b,c,d]=stair.points ? outline : [outline[3],outline[2],outline[1],outline[0]];
  const length=distance([(a[0]+b[0])/2,(a[1]+b[1])/2],[(c[0]+d[0])/2,(c[1]+d[1])/2]);
  // Half a grid cell admits native token test points and snapped landing positions.
  const fraction=Math.min(0.5,size*0.5/Math.max(1,length));
  return [pointAt(a,d,1-fraction),pointAt(b,c,1-fraction),c,d];
}
export function ellipse(a, b) {
  const {x, y, width, height} = bounds(a, b);
  return Array.from({length: 40}, (_, i) => {
    const angle = i * Math.PI / 20;
    return round([x + width * (1 + Math.cos(angle)) / 2, y + height * (1 + Math.sin(angle)) / 2]);
  });
}

export function combine(subject, paths, operation = "ctUnion", lib = globalThis.ClipperLib) {
  if (!paths.length) return subject;
  const convert = rings => rings.map(ring => ring.map(([X, Y]) => ({X, Y})));
  const clip = convert(paths);
  if (operation === "ctUnion" || operation === "ctDifference") {
    for (const path of clip) if (!lib.Clipper.Orientation(path)) path.reverse();
  }
  const solver = new lib.Clipper();
  solver.AddPaths(convert(subject), lib.PolyType.ptSubject, true);
  solver.AddPaths(clip, lib.PolyType.ptClip, true);
  const result = new lib.Paths();
  if (!solver.Execute(lib.ClipType[operation], result, lib.PolyFillType.pftNonZero, lib.PolyFillType.pftNonZero)) return [];
  return result.map(ring => ring.map(({X, Y}) => [X, Y]));
}

export function brush(points, radius) {
  const rings = points.map(([x, y]) => ellipse([x - radius, y - radius], [x + radius, y + radius]));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (!length) continue;
    const dx = radius * (b[1] - a[1]) / length, dy = radius * (a[0] - b[0]) / length;
    rings.push([[a[0]+dx,a[1]+dy],[b[0]+dx,b[1]+dy],[b[0]-dx,b[1]-dy],[a[0]-dx,a[1]-dy]].map(round));
  }
  return rings;
}

export const edges = rings => rings.flatMap(r => r.map((a, i) => ({a, b: r[(i + 1) % r.length], kind: "wall"})));
const pointAt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function project(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  return {t, offset: distance(p, pointAt(a, b, Math.max(0, Math.min(t, 1))))};
}

export function placeDoor(model, point, width, kind) {
  const candidates = [...edges(model.floor), ...model.walls].filter(s => distance(s.a, s.b) >= 4)
    .map(s => ({...s, ...project(point, s.a, s.b)})).filter(s => s.offset <= width / 3)
    .sort((a, b) => a.offset - b.offset);
  const edge = candidates[0];
  if (!edge) throw Error("Укажите край комнаты или внутреннюю стену.");
  const half = Math.min(0.5, width / distance(edge.a, edge.b) / 2);
  const center = Math.max(half, Math.min(1 - half, edge.t));
  const door = {a: round(pointAt(edge.a, edge.b, center - half)),
    b: round(pointAt(edge.a, edge.b, center + half)), kind};
  if (model.doors.some(d => overlap(edge, d) && overlap(door, d))) throw Error("На этом участке уже есть дверь.");
  return door;
}

function overlap(edge, door) {
  const a = project(door.a, edge.a, edge.b), b = project(door.b, edge.a, edge.b);
  const dx=edge.b[0]-edge.a[0],dy=edge.b[1]-edge.a[1],length=Math.hypot(dx,dy);
  const offset=p=>Math.abs((p[0]-edge.a[0])*dy-(p[1]-edge.a[1])*dx)/length;
  if (offset(door.a)>1||offset(door.b)>1) return null;
  const from = Math.max(0, Math.min(a.t, b.t)), to = Math.min(1, Math.max(a.t, b.t));
  return to - from > 0.001 ? {from, to, door} : null;
}

export function wallsFor(model) {
  const result = new Map(), used = new Set();
  const add = (a, b, kind) => {
    a = round(a); b = round(b);
    if (distance(a, b) < 1) return;
    const key = [a.join(","), b.join(",")].sort().join(":");
    result.set(key, {a, b, kind, key});
  };
  const floorEdges=[];
  const overrides=[...(model.openings??[]).flatMap(o=>edges([o.points]).map(e=>({...e,kind:o.railing?"railing":"open"}))),...model.walls.filter(w=>w.kind==="railing")];
  for(const edge of edges(model.floor)){
    const spans=overrides.map(o=>{const span=overlap(edge,o);return span&&{...span,kind:o.kind};}).filter(Boolean);
    const cuts=[...new Set([0,1,...spans.flatMap(s=>[s.from,s.to])])].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++){
      const from=cuts[i-1],to=cuts[i],kind=spans.findLast(s=>s.from<=(from+to)/2&&s.to>=(from+to)/2)?.kind??edge.kind;
      if(kind!=="open")floorEdges.push({a:pointAt(edge.a,edge.b,from),b:pointAt(edge.a,edge.b,to),kind});
    }
  }
  for (const edge of [...floorEdges, ...model.walls]) {
    if (distance(edge.a, edge.b) < 1) continue;
    const gaps = model.doors.map(d => overlap(edge, d)).filter(Boolean).sort((a, b) => a.from - b.from);
    let cursor = 0;
    for (const gap of gaps) {
      if (gap.from > cursor) add(pointAt(edge.a, edge.b, cursor), pointAt(edge.a, edge.b, gap.from), edge.kind);
      cursor = Math.max(cursor, gap.to);
      used.add(gap.door);
    }
    if (cursor < 1) add(pointAt(edge.a, edge.b, cursor), edge.b, edge.kind);
  }
  for (const door of model.doors) if (door.free || used.has(door)) add(door.a, door.b, door.kind);
  return [...result.values()];
}

export function eraseObjects(model, box) {
  const inside = ([x, y]) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  const hits = ({a, b}) => {
    if (inside(a) || inside(b)) return true;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return [box.x, box.x + box.width].some(x => dx && (x-a[0])/dx >= 0 && (x-a[0])/dx <= 1 && inside([x, a[1]+(x-a[0])*dy/dx]))
      || [box.y, box.y + box.height].some(y => dy && (y-a[1])/dy >= 0 && (y-a[1])/dy <= 1 && inside([a[0]+(y-a[1])*dx/dy, y]));
  };
  model.walls = model.walls.filter(s => !hits(s));
  for(const opening of model.openings??[])if(edges([opening.points]).some(hits))opening.railing=false;
  model.doors = model.doors.filter(s => !hits(s));
  model.lights = model.lights.filter(l => !inside(l.at));
  for(const collection of ["furniture","traps"])model[collection] = (model[collection]??[]).filter(f=>{
    const ring=stairOutline(f);
    return !edges([ring]).some(hits) && ClipperLib.Clipper.PointInPolygon({X:box.x,Y:box.y},ring.map(([X,Y])=>({X,Y})))===0;
  });
  model.stairs = model.stairs.filter(s => {
    const ring=stairOutline(s);
    const cornerInside=ClipperLib.Clipper.PointInPolygon({X:box.x,Y:box.y},ring.map(([X,Y])=>({X,Y})))!==0;
    return !edges([ring]).some(hits) && !cornerInside;
  });
  const cutter = [rectangle([box.x,box.y],[box.x+box.width,box.y+box.height])];
  model.paint = model.paint.map(p => ({...p, shape: combine(p.shape, cutter, "ctDifference")})).filter(p => p.shape.length);
}

export function seeded(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => {
    n = (n + 0x6D2B79F5) | 0;
    let t = Math.imul(n ^ n >>> 15, n | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generate({width, height, size, seed, mode, count = 12}) {
  count = Number(count);
  if (!["rooms","loop","cave"].includes(mode) || !Number.isInteger(count) || count < 1 || count > 40)
    throw Error("Выберите тип генерации и число комнат от 1 до 40.");
  if (![width,height,size].every(n => Number.isFinite(n) && n > 0)) throw Error("Некорректные размеры сцены.");
  const random = seeded(seed);
  const cols = Math.min(90, Math.floor(width / size)), rows = Math.min(90, Math.floor(height / size));
  if (cols < 8 || rows < 8) throw Error("Для генерации нужно поле от 8 × 8 клеток.");
  const paths = [], rooms = [];
  const rect = (x, y, w, h) => paths.push(rectangle([x*size,y*size],[(x+w)*size,(y+h)*size]));
  const connect = (a, b) => {
    rect(Math.min(a[0],b[0]),a[1],Math.abs(a[0]-b[0])+1,1);
    rect(b[0],Math.min(a[1],b[1]),1,Math.abs(a[1]-b[1])+1);
  };
  if (mode === "cave") {
    let grid = Array.from({length: rows}, (_, y) => Array.from({length: cols}, (_, x) =>
      x > 0 && y > 0 && x < cols-1 && y < rows-1 && random() < 0.55));
    for (let step=0; step<4; step++) grid = grid.map((row,y) => row.map((cell,x) => {
      if (!x || !y || x===cols-1 || y===rows-1) return false;
      let neighbors=0;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) if((dx||dy) && grid[y+dy][x+dx]) neighbors++;
      return neighbors >= (cell ? 4 : 5);
    }));
    const seen = new Set(), anchors = [];
    for(let y=1;y<rows-1;y++) for(let x=1;x<cols-1;x++) {
      if (!grid[y][x]) continue;
      rect(x,y,1,1);
      const code = y*cols+x;
      if(seen.has(code)) continue;
      anchors.push([x,y]);
      const queue=[[x,y]];
      seen.add(code);
      for(const [cx,cy] of queue) for(const [nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
        const next=ny*cols+nx;
        if(grid[ny]?.[nx] && !seen.has(next)) {seen.add(next);queue.push([nx,ny]);}
      }
    }
    for(let i=1;i<anchors.length;i++) connect(anchors[i-1],anchors[i]);
    if(!paths.length) rect(2,2,cols-4,rows-4);
  } else {
    const limit = Math.min(40, Math.max(1, count));
    for (let i=0;i<limit*70 && rooms.length<limit;i++) {
      const w=3+Math.floor(random()*Math.min(7,cols-5)), h=3+Math.floor(random()*Math.min(7,rows-5));
      const x=1+Math.floor(random()*(cols-w-1)), y=1+Math.floor(random()*(rows-h-1));
      if(rooms.some(r => r.x<=x+w && r.x+r.w>=x && r.y<=y+h && r.y+r.h>=y)) continue;
      const mid=[x+Math.floor(w/2),y+Math.floor(h/2)];
      if(rooms.length) {
        const nearest=rooms.reduce((a,b) => distance(a.mid,mid)<distance(b.mid,mid)?a:b);
        connect(nearest.mid,mid);
      }
      rect(x,y,w,h); rooms.push({x,y,w,h,mid});
    }
    if(mode==="loop") for(let i=2;i<rooms.length;i+=2) connect(rooms[i].mid, rooms[i-2].mid);
  }
  return combine([], paths);
}
