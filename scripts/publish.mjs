import {ID, STAIRS, PASSAGES, empty, wallsFor, stairGate} from "./model.mjs";
import {drawMap, png} from "./art.mjs";
import {LIGHTS,lightConfig} from "./lights.mjs";
import {drawTrap,TRAPS,trapTile} from "./traps.mjs";
import {SURFACE_KEY,visibleOn,floorSurface} from "./levels.mjs";

export const styles = () => game.settings.get(ID, "styles");
export const dimensions = scene => {
  const {sceneX:x, sceneY:y, sceneWidth:width, sceneHeight:height, size} = scene.getDimensions();
  return {x, y, width, height, size};
};
export const read = (scene, level) => scene.getFlag(ID, level.id)
  ?? {version: 1, rev: 0, model: empty(), pending: null, mode: "tile"};
export const owned = (scene, type, level) => scene.getEmbeddedCollection(type).filter(d => d.getFlag(ID, "level") === level);

export function installStairGuard() {
  const Native=CONFIG.RegionBehavior.dataModels.changeLevel;
  const {TOKEN_MOVE_IN:enter,TOKEN_EXIT:exit}=CONST.REGION_EVENTS;
  const visits=new WeakSet();
  // Native changeLevel handles the dialog and movement. Only our stairs share one visit per token.
  CONFIG.RegionBehavior.dataModels.changeLevel=class extends Native {
    static events={...Native.events,
      [enter]:async function(event) {
        if (!this.region.getFlag(ID,"level")) return Native.events[enter].call(this,event);
        const token=event.data.token;
        if (!event.user.isSelf || event.data.movement.passed.waypoints.at(-1).action==="displace" || visits.has(token)) return;
        visits.add(token);
        try {return await Native.events[enter].call(this,event);}
        catch(error) {visits.delete(token);throw error;}
      },
      [exit]:async function(event) {
        await Native.events[exit].call(this,event);
        const token=event.data.token;
        if (![...token.regions].some(r=>r.getFlag(ID,"level")&&r.getFlag(ID,"key")!==SURFACE_KEY)) visits.delete(token);
      }
    };
  };
}

export async function reconcile(scene, type, level, desired) {
  const current = owned(scene, type, level);
  const byKey = new Map();
  const remove = [];
  for (const doc of current) {
    const key = doc.getFlag(ID, "key");
    if (byKey.has(key) || !desired.has(key)) remove.push(doc.id);
    else byKey.set(key, doc);
  }
  const create = [], update = [];
  for (const [key, payload] of desired) {
    const doc = byKey.get(key);
    const data = {...payload, flags: {[ID]: {level, key}}};
    if (!doc) create.push(data);
    else {
      // Door state belongs to gameplay. Its geometry and door type are part of the key.
      const {_id, behaviors, ...fields} = data;
      // Compare schema-normalized shapes: Foundry fills defaults and omits no-op updates from its reply.
      const diff = foundry.utils.diffObject(doc.toObject(), doc.clone(fields,{keepId:true}).toObject());
      if (Object.keys(diff).length) update.push({_id: doc.id, ...diff});
      for(const behavior of behaviors??[]){
        const matches=doc.behaviors.filter(b=>b.type===behavior.type);
        if(!matches.length)await doc.createEmbeddedDocuments("RegionBehavior",[behavior]);
        else{
          const first=matches[0],diff=foundry.utils.diffObject(first.toObject(),first.clone(behavior,{keepId:true}).toObject());
          if(Object.keys(diff).length)await first.update(diff);
          if(matches.length>1)await doc.deleteEmbeddedDocuments("RegionBehavior",matches.slice(1).map(b=>b.id));
        }
        if(!doc.behaviors.some(b=>b.type===behavior.type))throw Error("Не удалось восстановить поведение региона.");
      }
    }
  }
  if (update.length && (await scene.updateEmbeddedDocuments(type, update)).length !== update.length)
    throw Error(`Foundry не подтвердила обновление: ${type}.`);
  if (create.length && (await scene.createEmbeddedDocuments(type, create, {keepId: true})).length !== create.length)
    throw Error(`Foundry не подтвердила создание: ${type}.`);
  if (remove.length) await scene.deleteEmbeddedDocuments(type, remove);
  const verified = owned(scene, type, level);
  if (verified.length !== desired.size || new Set(verified.map(doc => doc.getFlag(ID, "key"))).size !== desired.size
    || verified.some(doc => !desired.has(doc.getFlag(ID, "key")))) throw Error(`Публикация ${type} не завершена.`);
}

const asMap = pairs => new Map(pairs);
const elevation = level => Number.isFinite(level.elevation.base) ? level.elevation.base : (level._source.elevation.bottom ?? 0);
const hasArt = model => model.floor.length || model.walls.length || model.doors.length || model.stairs.length || model.furniture?.length || model.lights.some(l=>LIGHTS[l.kind]);
const worldFolder = () => `worlds/${game.world.id}`;
const imageFolder = () => `${worldFolder()}/${ID}`;
const inImageFolder = src => src?.startsWith(`${imageFolder()}/`);
const legacyImage = src => src?.startsWith(`${worldFolder()}/${ID}-`) && !src.slice(worldFolder().length+1).split("?")[0].includes("/");

export function hasLegacyImages(scene,level) {
  const state=read(scene,level);
  return !state.pending && (legacyImage(state.asset) || owned(scene,"Tile",level.id).some(tile=>legacyImage(tile.texture.src)));
}

export async function discardDeletedFloor(scene,levelId) {
  if(scene.levels.has(levelId) || !scene.getFlag(ID,levelId)?.model) return;
  const tiles=owned(scene,"Tile",levelId).map(tile=>tile.id);
  if(tiles.length) await scene.deleteEmbeddedDocuments("Tile",tiles);
  await scene.unsetFlag(ID,levelId);
}

export async function publishDraft(scene,level,draft) {
  const state=read(scene,level),model=draft.model,expected=draft.clear?empty():state.pending?.model??model,base=draft.rev;
  if(state.version!==1||state.rev!==base)throw Error("Карта уже изменена. Откройте актуальную версию.");
  let result;
  try {result=await publish(scene,level,model,base,state.mode,{clear:!!draft.clear});}
  catch(error) {
    // A lost final acknowledgement is already committed. Do not replay it as a new revision.
    result=read(scene,level);
    if(result.pending||result.rev!==base+1||JSON.stringify(result.model)!==JSON.stringify(expected))throw error;
  }
  draft.rev=result.rev;
  draft.clear=false;
  // Editing continues while the snapshot is being published. Keep newer edits and undo history.
  draft.dirty=JSON.stringify(draft.model)!==JSON.stringify(result.model);
  return result;
}

export async function publish(scene, level, model, base, mode, {clear=false}={}) {
  if (!game.user.isGM || !game.users.activeGM?.isSelf) throw Error("Карту публикует активный мастер.");
  if (!scene.levels.has(level.id)) throw Error("Этот этаж удалён.");
  const state = read(scene, level);
  if (state.version !== 1 || state.rev !== base) throw Error("Карта уже изменена. Откройте актуальную версию.");
  if (clear) model=empty();
  let pending = clear ? null : state.pending;
  if (!pending) {
    const size = dimensions(scene);
    for (const stair of model.stairs) if (stair.target && (stair.target === level.id || !scene.levels.has(stair.target))) throw Error("Выберите существующий этаж для лестницы.");
    const palette = styles();
    const transparent=!!level.getFlag?.(ID,"floorSurface")||!!level.visibility?.levels?.size;
    const sameArt=mode===state.mode&&transparent===!!state.transparent&&JSON.stringify(size)===JSON.stringify(state.size)&&JSON.stringify({...model,traps:[]})===JSON.stringify({...state.model,traps:[]});
    const asset = hasArt(model) ? sameArt&&state.asset&&inImageFolder(state.asset) ? state.asset : await upload(scene, level, model, size, palette, mode === "background"&&!transparent) : null;
    const trapAssets = await publishTrapImages(scene,level,state,model.traps??[]);
    const latest = read(scene, level);
    if (latest.rev !== base || (!clear && latest.pending) || (clear && JSON.stringify(latest.pending)!==JSON.stringify(state.pending)))
      throw Error("Другая публикация уже началась.");
    const previousAssets=[state.pending?.previousBackground,state.mode==="background" && state.asset,state.pending?.mode==="background" && state.pending.asset].filter(Boolean);
    const previousBackground=previousAssets.includes(level.background.src) ? level.background.src : null;
    const before=state.pending && Object.hasOwn(state.pending,"beforeBackground") ? state.pending.beforeBackground : state.beforeBackground;
    pending = {model, size, asset, trapAssets,mode,transparent, ...(clear && {operation:"clear"}), previousBackground,
      beforeBackground: previousBackground ? before ?? null : level.background.src ?? null};
  }
  if (!pending.ids) {
    const keys = [
      ...wallsFor(pending.model).map(({kind,key}) => `Wall:${kind}:${key}`),
      ...pending.model.lights.map(light => `AmbientLight:${light.id}`),
      ...pending.model.stairs.filter(s=>s.target).map(stair => `Region:${stair.id}`),
      ...(floorSurface(level,pending.model,pending.size,visibleOn(scene,level.id))?[`Region:${SURFACE_KEY}`]:[]),
      ...(pending.model.traps??[]).map(t=>`Tile:trap:${t.id}`),"Tile:map"
    ];
    pending = {...pending, ids: Object.fromEntries(keys.map(key => [key, foundry.utils.randomID()]))};
    await scene.setFlag(ID, level.id, {...state, pending});
    if (!read(scene, level).pending) throw Error("Не удалось сохранить черновик публикации.");
  }
  return finish(scene, level, state, pending);
}

const fileHash=async blob=>crypto.subtle
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())).slice(0, 10),
      b => b.toString(16).padStart(2, "0")).join("")
    : foundry.utils.randomID();
let imageDirectory;
async function uploadImage(file) {
  const folder=imageFolder(),picker=foundry.applications.apps.FilePicker.implementation;
  if(imageDirectory?.folder!==folder){
    const ready=picker.createDirectory("data",folder).catch(async error=>{
      if((await picker.browse("data",folder)).target!==folder) throw error;
    });
    imageDirectory={folder,ready};
    ready.catch(()=>{if(imageDirectory?.ready===ready)imageDirectory=null;});
  }
  await imageDirectory.ready;
  const result=await picker.upload("data",folder,file,{}, {notify:false});
  if(!result?.path)throw Error("Не удалось загрузить изображение Dungeon Sketch.");
  return result.path;
}

async function publishTrapImages(scene,level,state,traps) {
  if(!traps.length)return {};
  const tiles=new Map(owned(scene,"Tile",level.id).map(tile=>[tile.getFlag(ID,"key"),tile.texture.src]));
  const byStyle=new Map();
  const style=trap=>`${trap.kind}:${trap.color??"#9b7351"}`;
  for(const trap of state.model.traps??[]){
    const src=tiles.get(`trap:${trap.id}`);
    if(inImageFolder(src)) byStyle.set(style(trap),src);
  }
  return Object.fromEntries(await Promise.all(traps.map(async trap=>{
    const key=style(trap);
    if(!byStyle.has(key))byStyle.set(key,trapImage(trap));
    return [trap.id,await byStyle.get(key)];
  })));
}

async function trapImage(trap) {
  if(!TRAPS[trap.kind])throw Error("Неизвестный рисунок ловушки.");
  const type=TRAPS[trap.kind],scale=256/Math.max(type.width,type.height),image=document.createElement("canvas");image.width=Math.round(type.width*scale);image.height=Math.round(type.height*scale);
  drawTrap(image.getContext("2d"),{kind:trap.kind,color:trap.color,x:0,y:0,width:image.width,height:image.height});
  const blob=await png(image),hash=await fileHash(blob),file=new File([blob],`${ID}-trap-image-${hash}.png`,{type:"image/png"});
  return uploadImage(file);
}
async function upload(scene, level, model, size, palette, background) {
  const blob = await png(await drawMap(model, size, palette, {background,traps:false})),hash=await fileHash(blob);
  const name=`${ID}-${scene.id}-${level.id}-map-${hash}.png`;
  const file = new File([blob],name,{type: "image/png"});
  return uploadImage(file);
}

async function finish(scene, level, state, pending) {
  const {model, size, asset, mode, beforeBackground,transparent=false} = pending;
  const now = dimensions(scene);
  if (["x","y","width","height","size"].some(k => now[k] !== size[k])) throw Error("Размеры, сетка или смещение сцены изменились. Верните их перед продолжением.");
  const levels = [level.id];
  const visibleLevels=visibleOn(scene,level.id);
  const edge = CONST.EDGE_SENSE_TYPES;
  const door = CONST.WALL_DOOR_TYPES;
  const x = size.x, y = size.y;
  const identified = (type, pairs) => asMap(pairs.map(([key,data]) => [key, {...data, _id:pending.ids[`${type}:${key}`]}]));
  for (const stair of model.stairs) if (stair.target && (stair.target === level.id || !scene.levels.has(stair.target)))
    throw Error("Этаж назначения лестницы удалён.");
  await reconcile(scene, "Wall", level.id, identified("Wall", wallsFor(model).map(({a,b,key,kind}) => [
    `${kind}:${key}`, {c: [a[0]+x,a[1]+y,b[0]+x,b[1]+y].map(Math.round), levels,
      door: kind === "secret" ? door.SECRET : PASSAGES[kind] && kind!=="window" ? door.DOOR : door.NONE,
      sight: ["invisible","railing"].includes(kind) || PASSAGES[kind]?.transparent ? edge.NONE : kind === "window" ? edge.PROXIMITY : edge.NORMAL,
      light: ["invisible","railing"].includes(kind) || PASSAGES[kind]?.transparent ? edge.NONE : kind === "window" ? edge.PROXIMITY : edge.NORMAL,
      sound: ["invisible","railing"].includes(kind) || PASSAGES[kind]?.transparent ? edge.NONE : edge.NORMAL,
      ...(kind === "window" && {threshold:{light:2*scene.grid.distance,sight:2*scene.grid.distance,attenuation:true}})}
  ])));
  await reconcile(scene, "AmbientLight", level.id, identified("AmbientLight", model.lights.map(light => [light.id, {
    ...(LIGHTS[light.kind]&&{name:LIGHTS[light.kind].name}),x: light.at[0]+x, y: light.at[1]+y, elevation: elevation(level), levels:visibleLevels, config: lightConfig(light)
  }])));
  const regions=model.stairs.filter(s=>s.target).map(stair => [stair.id, {
    name: `${STAIRS[stair.kind??"stair"]?.name??"Лестница"} · Dungeon Sketch`, levels: [level.id, stair.target],
    shapes: [{type:"polygon",points:stairGate(stair,size.size).flatMap(([a,b])=>[a+x,b+y]),hole:false}],
    behaviors: [{type: "changeLevel", name: "Сменить этаж", system: {}}]
  }]);
  const surface=floorSurface(level,model,size,visibleLevels);if(surface)regions.push([SURFACE_KEY,surface]);
  await reconcile(scene,"Region",level.id,identified("Region",regions));
  if (mode === "background" && asset) {
    if (level.background.src !== asset) await level.update({"background.src": asset});
    if (level.background.src !== asset) throw Error("Foundry не подтвердила фон этажа.");
  } else if ([pending.previousBackground,state.mode==="background" && state.asset,state.pending?.mode==="background" && state.pending.asset].filter(Boolean).includes(level.background.src)) {
    await level.update({"background.src": beforeBackground});
    if (level.background.src !== beforeBackground) throw Error("Не удалось восстановить фон этажа.");
  }
  const tiles=mode === "tile" && asset ? [["map", {
    name: "Dungeon Sketch", texture: {src:asset, anchorX:0, anchorY:0}, x,y,width:size.width,height:size.height,
    elevation: elevation(level), levels:visibleLevels, sort: -100000, locked: true
  }]] : [];
  for(const trap of model.traps??[]){
    const asset=pending.trapAssets?.[trap.id];if(!asset)throw Error("Не найден рисунок ловушки для завершения сохранения.");
    tiles.push([`trap:${trap.id}`,{...trapTile(trap,{x,y,level:level.id,elevation:elevation(level),asset}),levels:visibleLevels}]);
  }
  await reconcile(scene, "Tile", level.id, identified("Tile",tiles));
  await scene.setFlag(ID, level.id, {version:1, rev:state.rev+1, model, pending:null, asset,size,mode,transparent, beforeBackground});
  const result = read(scene, level);
  if (result.pending || result.rev !== state.rev+1) throw Error("Публикация применена, но запись не завершена.");
  return result;
}
