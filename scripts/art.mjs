import {ID, STAIR_COLOR, PASSAGES, wallsFor, seeded, stairOutline, stairLines, stairGate} from "./model.mjs";
import {drawFurniture} from "./furniture.mjs";
import {drawLightFixture,lightFixture} from "./lights.mjs";
import {drawTrap,trapHidden} from "./traps.mjs";

export const PRESETS = {
  stone: {name: "Камень", floor: "#b7a99e", wall: "#3c3438", width: 7, floorTexture: `modules/${ID}/art/stone.svg`, wallTexture: ""},
  cave: {name: "Пещера", floor: "#c6a173", wall: "#543e34", width: 8, floorTexture: `modules/${ID}/art/cave.svg`, wallTexture: ""},
  blue: {name: "Чертёж", floor: "#b9d6df", wall: "#254960", width: 6, floorTexture: `modules/${ID}/art/blue.svg`, wallTexture: ""}
};

const asset = name => `modules/${ID}/art/${name}.svg`;
export const FLOOR_TEXTURES = [
  ["", "Без узора"], ["tiles", "Квадратная плитка"], ["slabs", "Каменные плиты"],
  ["cobbles", "Брусчатка"], ["planks", "Доски"], ["soil", "Земля"],
  ["stone", "Маркерная кладка"], ["cave", "Штрихи"], ["blue", "Штриховка"]
].map(([name, label]) => [name ? asset(name) : "", label]);
export const WALL_TEXTURES = [
  ["", "Сплошной маркер"], ["masonry", "Кладка"], ["rubble", "Грубый камень"], ["timber", "Деревянные балки"]
].map(([name, label]) => [name ? asset(name) : "", label]);
export const COLORS = [
  ["Серый", "#a5a6a5"], ["Коричневый", "#9b7351"], ["Бежевый", "#d4c3a3"],
  ["Песочный", "#d7b876"], ["Белый", "#ece7dc"], ["Тёмный", "#535158"],
  ["Терракотовый", "#b97861"], ["Мшистый", "#8e9b72"], ["Серо-синий", "#7c96a3"]
];
const tintable = new Set([...FLOOR_TEXTURES, ...WALL_TEXTURES].map(([src]) => src).filter(Boolean));
const builtinFloors = new Set(FLOOR_TEXTURES.map(([src])=>src).filter(Boolean));
const colored = new Map();

// Built-in SVG coordinates use 100 units per grid cell, independently of scene padding and shift.
export const floorPatternPlacement = ({size=100,x=0,y=0},resolution=1) => ({x:-x,y:-y,scale:size/(100*resolution)});

export function inkColor(color, wall = false) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error("Укажите цвет в формате #RRGGBB.");
  const rgb = color.slice(1).match(/../g).map(n => parseInt(n, 16));
  const lighten = wall || rgb.reduce((n,c) => n+c, 0) < 240;
  return "#" + rgb.map(c => Math.round(lighten ? c + (255-c)*0.52 : c*0.53).toString(16).padStart(2,"0")).join("");
}

const images = new Map();
function load(src) {
  if (!src) return null;
  if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => {images.delete(src); reject(Error(`Текстура недоступна: ${src}`));};
    image.src = tintable.has(src) ? `${src}?v=${globalThis.game?.modules?.get(ID)?.version ?? "0.13.1"}` : src;
  }));
  return images.get(src);
}

async function texture(src, color, wall = false, resolution=1) {
  const image = await load(src);
  if (!image || !tintable.has(src)) return image;
  const key = `${src}:${color}:${wall}:${resolution}`;
  if (!colored.has(key)) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth*resolution;
    canvas.height = image.naturalHeight*resolution;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0,canvas.width,canvas.height);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = inkColor(color, wall);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // ponytail: 64 tinted variants; use a byte budget if very large grids need tighter memory limits.
    if (colored.size>=64) colored.delete(colored.keys().next().value);
    colored.set(key, canvas);
  }
  return colored.get(key);
}

function polygon(rings) {
  const path = new Path2D();
  for (const ring of rings) {
    if (!ring.length) continue;
    path.moveTo(...ring[0]);
    for (const point of ring.slice(1)) path.lineTo(...point);
    path.closePath();
  }
  return path;
}

const line = (ctx, a, b) => {
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
};

export function drawStair(ctx,stair,size=100) {
  const ring=stairOutline(stair),[a,b,c,d]=ring,color=stair.color??STAIR_COLOR,kind=stair.kind??"stair";
  const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],at=(u,v)=>mix(mix(a,b,u),mix(d,c,u),v);
  const luminance=parseInt(color.slice(1,3),16)*0.299+parseInt(color.slice(3,5),16)*0.587+parseInt(color.slice(5,7),16)*0.114;
  const ink=luminance<140?"#f5ebd6":"#342e2a",width=Math.min(Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(c[0]-d[0],c[1]-d[1]));
  ctx.save();ctx.globalAlpha=1;ctx.lineJoin=ctx.lineCap="round";
  ctx.fillStyle=color;ctx.fill(polygon([ring]));ctx.strokeStyle=ink;ctx.lineWidth=Math.max(1.5,size*0.025);ctx.stroke(polygon([ring]));
  if(kind==="hatch"){
    ctx.lineWidth=Math.max(1.5,size*0.02);ctx.stroke(polygon([[at(.12,.12),at(.88,.12),at(.88,.88),at(.12,.88)]]));
    for(const u of [.3,.5,.7])line(ctx,at(u,.14),at(u,.86));
    ctx.lineWidth=Math.max(3,size*0.045);for(const v of [.25,.75])line(ctx,at(.07,v),at(.2,v));
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(...at(.77,.5),Math.max(2,width*.06),0,Math.PI*2);ctx.fill();ctx.stroke();
    if(stair.target){ctx.lineWidth=Math.max(3,size*.04);ctx.stroke(polygon([ring]));}
  }else{
    const spacing=size*(kind==="steps"?.5:kind==="ladder"?.3:.18);
    const treads=stairLines(stair,Math.max(12,spacing),kind==="steps"?1:4);
    if(kind==="ladder"){
      ctx.lineWidth=Math.max(3,size*.045);line(ctx,at(.18,0),at(.18,1));line(ctx,at(.82,0),at(.82,1));
      for(const [left,right] of treads.slice(1,-1))line(ctx,mix(left,right,.2),mix(left,right,.8));
    }else for(const [left,right] of treads)line(ctx,left,right);
    let start=at(.5,0),end=at(.5,1);if(!stair.points)[start,end]=[end,start];
    const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);
    if(length>2){
      const tip=mix(start,end,.8),head=Math.min(width*.17,length*.1),segments=[[mix(start,end,.2),tip],...[-1,1].map(side=>[tip,[tip[0]-(dx+side*dy)/length*head,tip[1]-(dy-side*dx)/length*head]])];
      for(const [stroke,lineWidth] of [[color,Math.max(5,size*.06)],[ink,Math.max(1.5,size*.02)]]){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;for(const [a,b] of segments)line(ctx,a,b);}
    }
    if(stair.target){
      const gate=stairGate(stair,size);ctx.strokeStyle=ink;ctx.lineWidth=Math.max(3,size*.045);line(ctx,gate[2],gate[3]);
      ctx.lineWidth=1;ctx.setLineDash([4,4]);line(ctx,gate[0],gate[1]);ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

export function drawPassage(ctx,a,b,kind,theme) {
  if(!PASSAGES[kind]||kind==="secret")return;
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1)return;
  const thickness=Math.min(length*0.35,Math.max(kind==="stoneDoor"?18:12,theme.width*1.8)),post=Math.min(length*0.1,Math.max(4,theme.width*0.65));
  ctx.save();ctx.translate(...a);ctx.rotate(Math.atan2(b[1]-a[1],b[0]-a[0]));
  ctx.lineWidth=Math.max(1.5,theme.width*0.2);ctx.strokeStyle=theme.wall;
  if(kind==="grateDoor"){
    // Bars leave real gaps: the floor beneath is never covered by an opaque panel.
    ctx.strokeStyle="#353d43";ctx.lineWidth=Math.max(2,thickness*.16);
    ctx.strokeRect(0,-thickness/2,length,thickness);
    const count=Math.max(2,Math.ceil(length/12));
    for(let i=1;i<count;i++)line(ctx,[length*i/count,-thickness/2],[length*i/count,thickness/2]);
    ctx.fillStyle="#b4bec6";ctx.fillRect(length*.81,-thickness*.27,Math.min(7,length*.08),thickness*.54);
  }else{
    ctx.fillStyle=({door:"#aa7951",window:"#a6d4dc",metalDoor:"#78838e",stoneDoor:"#b3b0a3"})[kind];
    ctx.fillRect(0,-thickness/2,length,thickness);ctx.strokeRect(0,-thickness/2,length,thickness);
    if(kind==="door"){
      ctx.strokeStyle="#644530";ctx.strokeRect(length*.13,-thickness*.28,length*.3,thickness*.56);ctx.strokeRect(length*.52,-thickness*.28,length*.3,thickness*.56);
      ctx.fillStyle="#ead1a1";ctx.beginPath();ctx.arc(length*.9,0,Math.max(1.5,thickness*.12),0,Math.PI*2);ctx.fill();
    }else if(kind==="metalDoor"){
      ctx.strokeStyle="#c4cbd0";line(ctx,[length*.07,-thickness*.3],[length*.93,-thickness*.3]);
      ctx.fillStyle="#444d56";for(const x of [length*.2,length*.72])ctx.fillRect(x,-thickness/2,Math.min(6,length*.06),thickness);
      ctx.fillStyle="#dce0e3";for(const x of [length*.1,length*.3,length*.6,length*.9])for(const y of [-thickness*.26,thickness*.26]){ctx.beginPath();ctx.arc(x,y,Math.max(1,thickness*.08),0,Math.PI*2);ctx.fill();}
      ctx.strokeStyle="#242b32";ctx.beginPath();ctx.arc(length*.87,0,thickness*.17,0,Math.PI*2);ctx.stroke();
    }else if(kind==="stoneDoor"){
      ctx.strokeStyle="#e0dbca";ctx.lineWidth=2;line(ctx,[length*.06,-thickness*.32],[length*.94,-thickness*.32]);
      ctx.strokeStyle="#6b685f";line(ctx,[length*.06,thickness*.32],[length*.94,thickness*.32]);
      line(ctx,[length*.3,-thickness*.48],[length*.27,0]);line(ctx,[length*.27,0],[length*.31,thickness*.48]);
      const cx=length*.63,r=Math.min(length*.08,thickness*.27);ctx.beginPath();ctx.moveTo(cx-r,0);ctx.lineTo(cx,-r);ctx.lineTo(cx+r,0);ctx.lineTo(cx,r);ctx.closePath();ctx.stroke();
    }else{
      ctx.strokeStyle="#e4f5f3";line(ctx,[length*.12,-thickness*.15],[length*.38,thickness*.2]);line(ctx,[length*.62,-thickness*.15],[length*.88,thickness*.2]);
      ctx.strokeStyle=theme.wall;line(ctx,[length/2,-thickness/2],[length/2,thickness/2]);
    }
  }
  ctx.fillStyle=theme.wall;for(const x of [0,length])ctx.fillRect(x-post/2,-thickness*.8,post,thickness*1.6);
  ctx.restore();
}

export async function drawMap(model, dimensions, presets, {preview = false, background = false, traps=true} = {}) {
  const canvas = document.createElement("canvas");
  // ponytail: one image up to 4096px; tile the bake if larger scenes need full resolution.
  const scale = Math.min(1, 4096 / Math.max(dimensions.width, dimensions.height));
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / dimensions.width, canvas.height / dimensions.height);
  ctx.lineJoin = ctx.lineCap = "round";
  const styles = {...PRESETS, ...presets};
  const base = styles[model.style] ?? PRESETS.stone;
  const floorResolution=Math.max(1,Math.ceil((dimensions.size??100)*scale/100));
  const palette = await Promise.all([base, ...model.paint.map(p => styles[p.style] ?? base)].map(async style => ({
    ...style, floorImage: await texture(style.floorTexture, style.floor,false,floorResolution), wallImage: await texture(style.wallTexture, style.wall, true)
  })));
  const [theme] = palette;
  const applyFloor = (path, style) => {
    ctx.fillStyle = style.floor;
    ctx.fill(path, "evenodd");
    if (style.floorImage) {
      const pattern=ctx.createPattern(style.floorImage,"repeat");
      if (builtinFloors.has(style.floorTexture)) {
        const placement=floorPatternPlacement(dimensions,floorResolution);
        pattern.setTransform(new DOMMatrix().translate(placement.x,placement.y).scale(placement.scale));
      }
      ctx.fillStyle = pattern;
      ctx.fill(path, "evenodd");
    }
  };
  if (background) {
    ctx.fillStyle = "#f3ecdf";
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);
  }
  const floor = polygon(model.floor);
  applyFloor(floor, theme);
  ctx.save();
  ctx.clip(floor, "evenodd");
  model.paint.forEach((patch, i) => applyFloor(polygon(patch.shape), palette[i+1]));
  ctx.restore();
  const segments = wallsFor(model);
  const stroke = style => {
    const pattern = style.wallImage ? ctx.createPattern(style.wallImage, "repeat") : null;
    ctx.strokeStyle = style.wall;
    for (const {a,b,kind,key} of segments) {
      if (["invisible","railing"].includes(kind) || (PASSAGES[kind] && kind!=="secret")) continue;
      const random = seeded(key);
      const dx = b[0]-a[0], dy=b[1]-a[1], length=Math.hypot(dx,dy);
      ctx.lineWidth = pattern ? style.width : style.width * (0.86 + random() * 0.28);
      ctx.beginPath(); ctx.moveTo(...a);
      if (!pattern && length > 18) {
        const bend = (random()-0.5)*style.width*0.55;
        ctx.lineTo(a[0]+dx*0.48-dy/length*bend,a[1]+dy*0.48+dx/length*bend);
      }
      ctx.lineTo(...b); ctx.stroke();
      if (pattern) {
        // Keep the full texture strip across the wall and repeat along its direction.
        const height=style.wallImage.naturalHeight || style.wallImage.height;
        pattern.setTransform(new DOMMatrix().translate(...a).rotate(Math.atan2(dy,dx)*180/Math.PI)
          .scale(style.width/height).translate(0,-height/2));
        ctx.strokeStyle = pattern;
        ctx.stroke();
        ctx.strokeStyle = style.wall;
      }
    }
  };
  stroke(theme);
  model.paint.forEach((patch, i) => {
    ctx.save(); ctx.clip(polygon(patch.shape),"evenodd"); stroke(palette[i+1]); ctx.restore();
  });
  for (const {a,b,kind} of segments) {
    if(kind==="railing"){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,gap=(dimensions.size??100)*.035;
      ctx.strokeStyle=theme.wall;ctx.lineWidth=2;
      for(const side of [-1,1])line(ctx,[a[0]+nx*gap*side,a[1]+ny*gap*side],[b[0]+nx*gap*side,b[1]+ny*gap*side]);
      const count=Math.max(1,Math.ceil(length/((dimensions.size??100)*.5)));ctx.lineWidth=3;
      for(let i=0;i<=count;i++){const x=a[0]+dx*i/count,y=a[1]+dy*i/count;line(ctx,[x-nx*gap*2,y-ny*gap*2],[x+nx*gap*2,y+ny*gap*2]);}
    }
    drawPassage(ctx,a,b,kind,theme);
    if (preview && ["invisible","secret"].includes(kind)) {
      ctx.strokeStyle = kind === "secret" ? "#dcab59" : "#4fbdcd";
      ctx.lineWidth = 3; ctx.setLineDash([7,5]); line(ctx,a,b); ctx.setLineDash([]);
    }
  }
  for (const stair of model.stairs)drawStair(ctx,stair,dimensions.size??100);
  for (const f of (model.furniture??[]).filter(f=>f.kind==="rug")) drawFurniture(ctx,f);
  for (const f of (model.furniture??[]).filter(f=>f.kind!=="rug")) drawFurniture(ctx,f);
  for (const light of model.lights) {
    if(light.kind)drawLightFixture(ctx,lightFixture(light,dimensions.size??100));
    else if(preview){ctx.fillStyle = "#efbd61"; ctx.beginPath(); ctx.arc(...light.at,8,0,2*Math.PI); ctx.fill();}
  }
  if(traps)for(const trap of model.traps??[]){
    if(trapHidden(trap)&&!(preview&&globalThis.game?.user?.isGM))continue;
    ctx.save();ctx.globalAlpha=trapHidden(trap) ? 0.45 : 1;drawTrap(ctx,trap);ctx.restore();
  }
  return canvas;
}

export const png = canvas => new Promise((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("Не удалось создать PNG.")), "image/png"));
