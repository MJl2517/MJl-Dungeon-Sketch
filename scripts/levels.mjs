import {ID,TITLE,feetPerUnit} from "./model.mjs";

export const orderedLevels=scene=>[...scene.levels].sort((a,b)=>(a.elevation.base??a.elevation.bottom??0)-(b.elevation.base??b.elevation.bottom??0)||a.sort-b.sort);
export const visibleOn=(scene,id)=>[id,...[...scene.levels].filter(l=>l.id!==id&&l.visibility?.levels?.has(id)).map(l=>l.id)];
export const SURFACE_KEY="floor-surface";

const floorPaths=new WeakMap();
export function pointUnderFloor(rings,x,y) {
  if(!floorPaths.has(rings))floorPaths.set(rings,rings.map(ring=>ring.map(([X,Y])=>({X,Y}))));
  let inside=false;
  for(const path of floorPaths.get(rings)){
    const hit=ClipperLib.Clipper.PointInPolygon({X:x,Y:y},path);
    if(hit===-1)return true;
    if(hit===1)inside=!inside;
  }
  return inside;
}

function coveredToken(token) {
  const scene=canvas.scene,view=canvas.level,doc=token?.document;
  if(!view||!doc||token.isPreview||doc.parent!==scene||doc.level===view.id||doc.elevation>=view.elevation.base)return false;
  const floors=[];
  for(const id of [view.id,...view.visibility.levels]){
    const floor=scene.levels.get(id);
    if(!floor||floor.elevation.base<=doc.elevation||floor.elevation.base>view.elevation.base)continue;
    const saved=scene.getFlag(ID,id);
    if(saved?.model?.floor?.length)floors.push(saved);
  }
  if(!floors.length)return false;
  const points=doc.getOcclusionTestPoints();
  return points.length>0&&points.every(({x,y})=>floors.some(({model,size})=>pointUnderFloor(model.floor,
    x-(size?.x??canvas.dimensions.sceneX),y-(size?.y??canvas.dimensions.sceneY))));
}

export function installFloorTokenVisibility() {
  const Token=CONFIG.Token.objectClass,layer=CONFIG.Canvas.layers.tokens,TokenLayer=layer.layerClass;
  CONFIG.Token.objectClass=class SketchToken extends Token {
    get isVisible(){
      if(!coveredToken(this))return super.isVisible;
      this.detectionFilter=null;
      return false;
    }
  };
  layer.layerClass=class SketchTokenLayer extends TokenLayer {
    setTargets(ids,options){
      if(options?.mode==="release")return super.setTargets(ids,options);
      const requested=[...ids],visible=requested.filter(id=>!coveredToken(this.get(id)));
      if(visible.length||!requested.length)return super.setTargets(visible,options);
    }
  };
  const refresh=()=>{
    if(!canvas.ready)return;
    for(const token of canvas.tokens.placeables)token.renderFlags.set({refreshVisibility:true});
  };
  Hooks.on("updateScene",(scene,changes)=>{
    if(scene===canvas.scene&&Object.hasOwn(changes.flags??{},ID))refresh();
  });
  Hooks.on("updateLevel",(level,changes)=>{
    if(level.parent===canvas.scene&&(changes.elevation||changes.visibility))refresh();
  });
  Hooks.on("updateToken",(doc,changes)=>{
    if(doc.parent===canvas.scene&&Object.hasOwn(changes,"elevation"))
      doc.object?.renderFlags.set({refreshVisibility:true});
  });
  Hooks.on("refreshToken",token=>{
    if(token.isTargeted&&!token.visible&&coveredToken(token))token.setTarget(false);
  });
}

export function floorShade(scene,view,source) {
  if(!view||!source||!view.visibility.levels.has(source.id)||source.elevation.base>=view.elevation.base)return 1;
  const levels=orderedLevels(scene),depth=levels.indexOf(view)-levels.indexOf(source);
  return Math.max(0.55,0.84**Math.max(0,depth));
}
export function dimFloorTint(tint,shade) {
  const color=typeof tint==="string"?parseInt(tint.replace(/^#/,""),16):Number(tint??0xffffff);
  return [16,8,0].reduce((result,shift)=>result|(Math.round((color>>shift&255)*shade)<<shift),0);
}
export function refreshFloorTile(tile) {
  const scene=canvas.scene,view=canvas.level,doc=tile.document;
  if(!scene||!view||!tile.mesh||tile.mesh.destroyed)return;
  const enabled=game.settings.get(ID,"lowerFloorContrast"),owner=scene.levels.get(doc.getFlag(ID,"level"));
  // Shared tiles use their elevation to identify the source floor, not the list of floors showing them.
  const source=owner??[...(doc.levels??[])].map(id=>scene.levels.get(id)).filter(Boolean)
    .sort((a,b)=>Math.abs(a.elevation.base-doc.elevation)-Math.abs(b.elevation.base-doc.elevation))[0];
  tile.mesh.tint=dimFloorTint(doc.texture.tint,enabled?floorShade(scene,view,source):1);
}
export function refreshLevelContrast() {
  if(!canvas?.ready||!canvas.scene||!canvas.level)return;
  for(const tile of canvas.tiles.placeables)refreshFloorTile(tile);
  const enabled=game.settings.get(ID,"lowerFloorContrast");
  for(const mesh of canvas.primary.levelTextures){
    const match=/^Level\.(\d+)\.(background|foreground)$/.exec(mesh.name??"");if(!match)continue;
    const level=canvas.scene.levels.find(l=>l.index===Number(match[1]));if(!level)continue;
    mesh.tint=dimFloorTint(level[match[2]].tint,enabled?floorShade(canvas.scene,canvas.level,level):1);
  }
}

export function floorSurface(level,model,size,levels) {
  if(!level.getFlag?.(ID,"floorSurface")||!model.floor.length)return null;
  const base=level.elevation.base??level.elevation.bottom??0;
  return {name:`Перекрытие · ${level.name}`,levels,elevation:{bottom:base,top:base},
    shapes:model.floor.map(ring=>({type:"polygon",points:ring.flatMap(([x,y])=>[x+size.x,y+size.y]),hole:!ClipperLib.Clipper.Orientation(ring.map(([X,Y])=>({X,Y})))})),
    behaviors:[{type:"defineSurface",name:"Сплошной пол",system:{placement:"bottom",light:true,sight:true,move:true,sound:true,occlusion:true,exposure:false}}]};
}
export function floorPlan(existing,rows,{height,base=0}) {
  height=Number(height);base=Number(base);
  if(!Number.isFinite(height)||height<=0||height>10000||!Number.isFinite(base))throw Error("Укажите положительную высоту этажа и числовую отметку земли.");
  if(!rows.length||rows.length>20||rows.length<existing.length)throw Error("Можно настроить от 1 до 20 этажей; существующие этажи не удаляются.");
  const ids=new Set(rows.map(r=>r.id));
  if(ids.size!==rows.length||existing.some(l=>!ids.has(l.id)))throw Error("Список этажей изменился. Откройте настройку заново.");
  return rows.map((row,i)=>{
    const name=String(row.name??"").trim().slice(0,80);if(!name)throw Error("Укажите название каждого этажа.");
    const original=existing.find(l=>l.id===row.id),below=rows.slice(0,i).map(r=>r.id),old=original?[...original.visibility.levels]:[];
    return {_id:row.id,name,elevation:{bottom:Math.round((base+i*height)*1000)/1000,top:Math.round((base+(i+1)*height)*1000)/1000},sort:i*100000,
      visibility:{levels:[...new Set([...old.filter(id=>ids.has(id)&&!below.includes(id)&&id!==row.id),...(row.seeBelow?below:[])])]},
      flags:{[ID]:{floorSurface:!!row.surface}}};
  });
}

export async function configureFloors(scene,{beforeSave,afterSave}) {
  if(!game.user.isGM||!game.users.activeGM?.isSelf)throw Error("Этажи настраивает активный мастер.");
  const existing=orderedLevels(scene),units=scene.grid.units||"ft",defaultHeight=existing[0]?.elevation.top-existing[0]?.elevation.base;
  const height=Number.isFinite(defaultHeight)&&defaultHeight>0?defaultHeight:feetPerUnit(scene.grid)>1?3:10;
  const base=Number.isFinite(existing[0]?.elevation.base)?existing[0].elevation.base:0;
  const rows=existing.map((l,i)=>({id:l.id,name:/^(Level|Default|Уровень)$/i.test(l.name)?`${i+1} этаж`:l.name,seeBelow:i>0&&existing.slice(0,i).every(b=>l.visibility.levels.has(b.id)),surface:l.getFlag(ID,"floorSurface")??i>0}));
  if(rows.length===1)rows.push({id:foundry.utils.randomID(),name:"2 этаж",seeBelow:true,surface:true});
  let count=rows.length;
  return foundry.applications.api.DialogV2.input({window:{title:`${TITLE} · Настройка этажей`,icon:"fa-solid fa-layer-group"},classes:["mjl-brand","mds-level-dialog"],position:{width:680},modal:true,rejectClose:false,
    content:`<section class="mjl-dungeon-panel mds-level-setup"><p>Укажите число этажей и высоту от пола до пола. Модуль расставит высоты, перенесёт принадлежащие ему рисунки и свет, сохранив ID этажей и положение токенов относительно пола.</p>
      <div class="mds-pair"><label>Этажей <input name="count" type="number" min="${existing.length}" max="20" step="1" value="${count}" required></label><label>Высота этажа, ${foundry.utils.escapeHTML(units)} <input name="height" type="number" min="0.1" max="10000" step="any" value="${height}" required></label></div>
      <label>Отметка первого этажа, ${foundry.utils.escapeHTML(units)} <input name="base" type="number" step="any" value="${base}" required></label>
      <div data-floor-rows></div><p>«Видеть этажи ниже» открывает вид через проёмы. Нарисованный пол скрывает токены под ним от игроков и мастера. «Сплошное перекрытие» дополнительно влияет на лучи обзора, свет, звук и движение между этажами.</p><output data-floor-save></output></section>`,
    ok:{label:"Настроить этажи",callback:async(_event,button,dialog)=>{
      const form=button.form,selected=Array.from({length:count},(_,i)=>({id:rows[i].id,name:form.elements[`floorName${i}`].value,seeBelow:form.elements[`below${i}`].checked,surface:form.elements[`surface${i}`].checked}));
      const output=form.querySelector("[data-floor-save]");output.textContent="Настройка этажей…";
      try{
        const plan=floorPlan(existing,selected,{height:form.elements.height.value,base:form.elements.base.value});
        await beforeSave();
        if(existing.some(l=>!scene.levels.has(l.id))||scene.levels.size!==existing.length)throw Error("Список этажей изменился. Откройте настройку заново.");
        const oldBases=new Map(existing.map(l=>[l.id,l.elevation.base])),created=plan.filter(l=>!scene.levels.has(l._id));
        if(created.length)await scene.createEmbeddedDocuments("Level",created.map(l=>({...l,visibility:{levels:[]}})),{keepId:true});
        await scene.updateEmbeddedDocuments("Level",plan);
        const tokens=scene.tokens.filter(t=>oldBases.has(t.level)).map(t=>({_id:t.id,elevation:scene.levels.get(t.level).clampElevation(t.elevation-oldBases.get(t.level)+scene.levels.get(t.level).elevation.base,t.depth),action:"displace"})).filter(t=>t.elevation!==scene.tokens.get(t._id).elevation);
        if(tokens.length)await scene.updateEmbeddedDocuments("Token",tokens,{animate:false});
        await afterSave();ui.notifications.info("Этажи настроены.");return true;
      }catch(error){ui.notifications.error(error.message);console.error(ID,error);return false;}
    }},
    render:event=>{
      const root=event.target.element,form=root.querySelector("form"),container=root.querySelector("[data-floor-rows]");
      const remember=()=>{for(let i=0;i<count;i++){const name=form.elements[`floorName${i}`];if(name){rows[i].name=name.value;rows[i].seeBelow=form.elements[`below${i}`].checked;rows[i].surface=form.elements[`surface${i}`].checked;}}};
      const render=()=>{
        while(rows.length<count)rows.push({id:foundry.utils.randomID(),name:`${rows.length+1} этаж`,seeBelow:true,surface:true});
        container.innerHTML=Array.from({length:count},(_,i)=>`<fieldset class="mds-floor-row"><legend>${i+1} этаж <small data-height-row="${i}"></small></legend><input name="floorName${i}" type="text" maxlength="80" value="${foundry.utils.escapeHTML(rows[i].name)}" required aria-label="Название этажа ${i+1}"><label class="mds-toggle"><input type="checkbox" role="switch" name="below${i}" ${rows[i].seeBelow?"checked":""} ${i===0?"disabled":""}><span>Видеть этажи ниже</span></label><label class="mds-toggle"><input type="checkbox" role="switch" name="surface${i}" ${rows[i].surface?"checked":""}><span>Пол — сплошное перекрытие</span></label></fieldset>`).join("");updateHeights();
      };
      const updateHeights=()=>{const h=Number(form.elements.height.value),b=Number(form.elements.base.value);for(let i=0;i<count;i++)container.querySelector(`[data-height-row="${i}"]`).textContent=`${Math.round((b+i*h)*100)/100}–${Math.round((b+(i+1)*h)*100)/100} ${units}`;};
      form.elements.count.addEventListener("change",()=>{remember();count=Math.max(existing.length,Math.min(20,Math.round(Number(form.elements.count.value)||existing.length)));form.elements.count.value=count;render();});
      form.elements.height.addEventListener("input",updateHeights);form.elements.base.addEventListener("input",updateHeights);render();
    }});
}

export async function placeTokens(scene,level) {
  if(!game.user.isGM||!game.users.activeGM?.isSelf)throw Error("Существ размещает активный мастер.");
  if(!scene.tokens.size){ui.notifications.warn("Сначала добавьте токены на сцену.");return;}
  const chosen=new Set(canvas.tokens.controlled.map(t=>t.id)),tokens=[...scene.tokens],escape=foundry.utils.escapeHTML;
  return foundry.applications.api.DialogV2.input({window:{title:`Существа → ${level.name}`,icon:"fa-solid fa-layer-group"},classes:["mjl-brand","mds-level-dialog"],modal:true,rejectClose:false,
    content:`<section class="mjl-dungeon-panel"><p>Выберите существ: их координаты, HP и инвентарь сохранятся, высота станет высотой пола выбранного этажа.</p><div class="mds-level-token-list">${tokens.map(t=>`<label class="mds-toggle"><input name="token${t.id}" type="checkbox" role="switch" ${chosen.has(t.id)?"checked":""}><img src="${escape(t.texture.src)}" alt=""><span>${escape(t.name)} <small>${escape(scene.levels.get(t.level)?.name??"")}</small></span></label>`).join("")}</div></section>`,
    ok:{label:"Перенести",callback:async(_event,button)=>{
      const ids=tokens.filter(t=>button.form.elements[`token${t.id}`].checked&&scene.tokens.has(t.id)).map(t=>t.id);
      if(!ids.length){ui.notifications.warn("Выберите хотя бы одно существо.");return false;}
      try{
        if(!scene.levels.has(level.id))throw Error("Этаж удалён.");
        await scene.updateEmbeddedDocuments("Token",ids.map(id=>({_id:id,level:level.id,elevation:level.elevation.base,action:"displace"})),{animate:false});
        await scene.view({level:level.id});return true;
      }catch(error){ui.notifications.error(error.message);console.error(ID,error);return false;}
    }}});
}
