import {ID, stairOutline, rectangle, feetPerUnit, equalReachDiagonals, reachNorm, tokenReachPosition} from "./model.mjs";
import {COINS, currency, queueInventory, transferLoot} from "./loot.mjs";
import {TRAPS} from "./traps.mjs";
import {handleLightSwitch} from "./lights.mjs";
export {COINS} from "./loot.mjs";

// Dimensions are in scene cells, irrespective of the scene's pixel resolution.
export const FURNITURE = {
  bed:{name:"Кровать",icon:"fa-bed",width:1,height:2},
  doubleBed:{name:"Двуспальная кровать",icon:"fa-bed",width:2,height:2},
  bunkBed:{name:"Двухъярусная кровать",icon:"fa-bed",width:1,height:2},
  vase:{name:"Ваза",icon:"fa-flask",width:0.5,height:0.5},
  amphora:{name:"Амфора",icon:"fa-jug",width:0.75,height:0.75,container:true},
  lever:{name:"Рычаг",icon:"fa-toggle-on",width:0.5,height:1},
  table:{name:"Стол",icon:"fa-table",width:2,height:1},
  roundTable:{name:"Круглый стол",icon:"fa-circle",width:2,height:2},
  chair:{name:"Стул",icon:"fa-chair",width:0.5,height:0.5},
  bench:{name:"Скамья",icon:"fa-grip-lines",width:2,height:0.5},
  chest:{name:"Сундук",icon:"fa-box",width:1,height:0.5,container:true},
  wardrobe:{name:"Шкаф",icon:"fa-door-closed",width:1,height:0.5,container:true},
  crate:{name:"Ящик",icon:"fa-box-open",width:1,height:1,container:true},
  barrel:{name:"Бочка",icon:"fa-drum",width:0.7,height:0.7,container:true},
  shelf:{name:"Стеллаж",icon:"fa-book",width:2,height:0.5,container:true},
  weaponRack:{name:"Оружейная стойка",icon:"fa-shield-halved",width:2,height:1,container:true},
  rug:{name:"Ковёр",icon:"fa-border-all",width:2,height:3}
};

export function furnitureAt(model, [x,y]) {
  return (model.furniture??[]).findLast(f=>{
    const angle=-(f.rotation??0)*Math.PI/180,dx=x-f.x-f.width/2,dy=y-f.y-f.height/2;
    return Math.abs(dx*Math.cos(angle)-dy*Math.sin(angle))<=f.width/2 &&
      Math.abs(dx*Math.sin(angle)+dy*Math.cos(angle))<=f.height/2;
  });
}

export function containerDistance(f,token,{size,sceneX=0,sceneY=0},grid) {
  const a=stairOutline(f),b=rectangle([token.x-sceneX,token.y-sceneY],[token.x-sceneX+token.width*size,token.y-sceneY+token.height*size]);
  const inside=(p,ring)=>{
    let result=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>p[1])!==(ring[j][1]>p[1]) && p[0]<(ring[j][0]-ring[i][0])*(p[1]-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])result=!result;
    return result;
  };
  if(inside(a[0],b)||inside(b[0],a))return 0;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const equalDiagonals=equalReachDiagonals(grid);
  const pointDistance=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],px=p[0]-a[0],py=p[1]-a[1];
    const clamp=t=>Math.max(0,Math.min(1,t));
    if(!equalDiagonals){
      const t=clamp((px*dx+py*dy)/(dx*dx+dy*dy||1));
      return Math.hypot(px-t*dx,py-t*dy);
    }
    // The maximum of the two axis distances changes slope where their magnitudes match.
    const candidates=[0,1];
    if(dx!==dy)candidates.push(clamp((px-py)/(dx-dy)));
    if(dx!==-dy)candidates.push(clamp((px+py)/(dx+dy)));
    return Math.min(...candidates.map(t=>Math.max(Math.abs(px-t*dx),Math.abs(py-t*dy))));
  };
  let distance=Infinity;
  for(let i=0;i<4;i++)for(let j=0;j<4;j++){
    const p=a[i],q=a[(i+1)%4],r=b[j],s=b[(j+1)%4];
    const crosses=cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0;
    if(crosses)return 0;
    distance=Math.min(distance,pointDistance(p,r,s),pointDistance(q,r,s),pointDistance(r,p,q),pointDistance(s,p,q));
  }
  return distance/size*grid.distance*feetPerUnit(grid);
}

const imagePath=value=>typeof value==="string"&&value.length<=2048&&!/^(?:javascript|vbscript|data|file):|^\/\//i.test(value)?value:"icons/svg/item-bag.svg";

export function furnitureRasterSize({width,height},limit=256) {
  const scale=limit/Math.max(width,height);
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),scale};
}

export function furnitureBounds(f) {
  const angle=(f.rotation??0)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const width=c*f.width+s*f.height,height=s*f.width+c*f.height;
  return {x:f.x+(f.width-width)/2,y:f.y+(f.height-height)/2,width,height};
}

export function positionFurniture(f,[x,y]) {
  const box=furnitureBounds(f),round=n=>Math.round(n*1e6)/1e6;
  return {...f,x:round(f.x+x-box.x),y:round(f.y+y-box.y)};
}

export function stepFurnitureScale(scale,direction,min=0.5,max=4) {
  const next=direction>0?(Math.floor(scale*10+1e-6)+1)/10:(Math.ceil(scale*10-1e-6)-1)/10;
  return Math.max(min,Math.min(max,next));
}

export function wheelFurniture(f,direction,resize,gridSize) {
  if(!resize)return {...f,rotation:((f.rotation??0)+direction*15+360)%360};
  const base=(FURNITURE[f.kind]?.width??TRAPS[f.kind]?.width??1)*gridSize,scale=f.width/base;
  const next=stepFurnitureScale(scale,direction,scale*gridSize*0.25/Math.min(f.width,f.height),scale*gridSize*20/Math.max(f.width,f.height));
  const width=Math.round(base*next*1e6)/1e6,height=Math.round(f.height*width/f.width*1e6)/1e6;
  return {...f,x:f.x+(f.width-width)/2,y:f.y+(f.height-height)/2,width,height};
}

export function drawFurniture(ctx,f) {
  if(!FURNITURE[f.kind])return;
  ctx.save();ctx.translate(f.x+f.width/2,f.y+f.height/2);ctx.rotate((f.rotation??0)*Math.PI/180);
  // One uniform unit keeps handles, pillows, books and line weights undistorted.
  const unit=Math.min(f.width,f.height)/100,w=f.width/unit,h=f.height/unit;
  ctx.scale(unit,unit);ctx.translate(-w/2,-h/2);
  ctx.fillStyle=f.color??"#9b7351";ctx.strokeStyle="#342b29";ctx.lineWidth=2.5;
  ctx.lineJoin=ctx.lineCap="round";
  const rect=(x,y,w,h)=>{ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);};
  const line=(x,y,a,b)=>{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke();};
  if(["vase","amphora"].includes(f.kind)){
    ctx.lineWidth=4;
    ctx.beginPath();ctx.ellipse(w/2,h/2,w*.37,h*.42,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(f.kind==="amphora")for(const sign of [-1,1]){
      ctx.beginPath();ctx.ellipse(w/2+sign*w*.36,h/2,w*.1,h*.22,0,0,Math.PI*2);ctx.stroke();
    }
    ctx.beginPath();ctx.ellipse(w/2,h/2,w*.22,h*.26,0,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle="#342b29";ctx.beginPath();ctx.ellipse(w/2,h/2,w*.12,h*.15,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#e5dbc4";ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(w/2,h/2,w*.29,h*.34,0,Math.PI,Math.PI*1.7);ctx.stroke();
  }else if(f.kind==="lever"){
    rect(9,9,w-18,h-18);ctx.fillStyle="#777778";rect(21,20,w-42,h-40);
    ctx.fillStyle="#342b29";rect(w/2-9,35,18,h-70);
    ctx.lineWidth=12;line(w/2,h*.73,w/2,h*.25);ctx.strokeStyle="#d5bb83";ctx.lineWidth=6;line(w/2,h*.73,w/2,h*.25);
    ctx.fillStyle=f.color??"#9b7351";ctx.strokeStyle="#342b29";ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(w/2,h*.25,13,0,Math.PI*2);ctx.fill();ctx.stroke();
    for(const x of [16,w-16])for(const y of [17,h-17]){ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.stroke();}
  }else if(["barrel","roundTable"].includes(f.kind)){
    ctx.beginPath();ctx.ellipse(w/2,h/2,w/2-4,h/2-4,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.save();ctx.clip();ctx.globalAlpha=0.4;
    for(let x=20;x<w;x+=20)line(x,0,x,h);
    ctx.restore();
    if(f.kind==="barrel"){ctx.lineWidth=7;line(w*0.12,h*0.26,w*0.88,h*0.26);line(w*0.12,h*0.74,w*0.88,h*0.74);ctx.lineWidth=2;}
    else{ctx.beginPath();ctx.ellipse(w/2,h/2,w/2-11,h/2-11,0,0,Math.PI*2);ctx.stroke();}
  }else{
    rect(4,4,w-8,h-8);
    if(["bed","doubleBed","bunkBed"].includes(f.kind)){
      const pillow=Math.min(30,h*0.23),blanket=22+pillow;
      ctx.fillStyle="#e5dbc4";
      if(f.kind==="doubleBed"){rect(10,12,w/2-15,pillow);rect(w/2+5,12,w/2-15,pillow);}else rect(10,12,w-20,pillow);
      ctx.fillStyle=f.color??"#9b7351";
      rect(9,blanket,w-18,h-blanket-11);line(9,blanket+9,w-9,blanket+9);line(9,h-21,w-9,h-21);
      ctx.lineWidth=5;line(4,4,w-4,4);line(4,h-4,w-4,h-4);
      if(f.kind==="doubleBed"){ctx.lineWidth=2;line(w/2,blanket,w/2,h-12);}
      if(f.kind==="bunkBed"){
        ctx.fillStyle="#d5bb83";rect(w-24,blanket+13,20,h-blanket-37);
        for(let y=blanket+23;y<h-24;y+=19)line(w-23,y,w-5,y);
        for(const x of [5,w-5])for(const y of [6,h-6]){ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.stroke();}
      }
    }else if(f.kind==="chest"){
      line(4,h*0.4,w-4,h*0.4);ctx.fillStyle="#d5bb83";rect(16,4,9,h-8);rect(w-25,4,9,h-8);rect(w/2-5,h*0.4-9,10,27);
    }else if(f.kind==="wardrobe"){
      line(w/2,4,w/2,h-4);ctx.fillStyle="#d5bb83";rect(w/2-10,h/2-7,4,14);rect(w/2+6,h/2-7,4,14);
    }else if(f.kind==="crate"){
      ctx.lineWidth=7;line(10,10,w-10,h-10);line(w-10,10,10,h-10);ctx.lineWidth=2;ctx.strokeRect(12,12,w-24,h-24);
    }else if(f.kind==="shelf"){
      const count=Math.max(1,Math.min(40,Math.floor((w-20)/16))),slot=(w-20)/count;
      for(let i=0;i<count;i++){const height=Math.min(h-24,54+(i%3)*8);ctx.fillStyle=["#6b8182","#a35748","#c1a671"][i%3];rect(10+i*slot,h-12-height,Math.min(14,slot-2),height);}
    }else if(f.kind==="weaponRack"){
      ctx.fillStyle="#3d312e";rect(13,13,w-26,h-26);
      ctx.fillStyle=f.color??"#9b7351";rect(9,27,w-18,10);rect(9,64,w-18,10);
      const blade=points=>{ctx.beginPath();ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);ctx.closePath();ctx.fill();ctx.stroke();};
      for(const [i,x] of [w*.25,w*.5,w*.75].entries()){
        ctx.fillStyle="#a7754c";rect(x-3,27,6,60);
        ctx.fillStyle="#c8c9c4";
        if(i===0){blade([[x,10],[x+7,22],[x+6,62],[x-6,62],[x-7,22]]);ctx.fillStyle="#d1ab6f";rect(x-13,62,26,6);}
        if(i===1)blade([[x,10],[x+10,28],[x,40],[x-10,28]]);
        if(i===2)blade([[x,21],[x+17,13],[x+22,25],[x+20,42],[x+12,45],[x,34]]);
      }
    }else if(f.kind==="chair"){
      ctx.lineWidth=9;line(8,8,w-8,8);ctx.lineWidth=2;ctx.strokeRect(15,27,w-30,h-42);
    }else if(f.kind==="rug"){
      ctx.strokeStyle="#eee0bd";ctx.strokeRect(13,10,w-26,h-20);ctx.beginPath();ctx.moveTo(w/2,24);ctx.lineTo(w-23,h/2);ctx.lineTo(w/2,h-24);ctx.lineTo(23,h/2);ctx.closePath();ctx.stroke();
      for(let x=10;x<w;x+=10){line(x,0,x,5);line(x,h-5,x,h);}
    }else{
      ctx.globalAlpha=0.4;for(let y=25;y<h;y+=25)line(5,y,w-5,y);ctx.globalAlpha=1;
      ctx.strokeRect(11,12,w-24,h-24);
    }
  }
  ctx.restore();
}

export const INVENTORY_PACK=`world.${ID}-inventories`;
const STORE_ID="MDSInventory0001";
let loading;
export function inventoryStore() {
  if(!game.user.isGM)throw Error("Содержимое доступно мастеру.");
  return loading??=(async()=>{
    const pack=game.packs.get(INVENTORY_PACK)??await foundry.documents.collections.CompendiumCollection.createCompendium({
      name:`${ID}-inventories`,label:"Dungeon Sketch · Контейнеры",type:"JournalEntry",
      ownership:{GAMEMASTER:"OWNER",ASSISTANT:"OWNER",TRUSTED:"NONE",PLAYER:"NONE"}});
    const doc=await pack.getDocument(STORE_ID)??await JournalEntry.create({_id:STORE_ID,name:"JSON контейнеров",
      flags:{[ID]:{data:{version:1,containers:{}}}}},{pack:pack.collection,keepId:true});
    validateInventories(doc.getFlag(ID,"data"));
    return doc;
  })().finally(()=>{loading=null;});
}
let saving=false;

export function validateInventories(data) {
  if(data?.version!==1 || !data.containers || typeof data.containers!=="object" || Array.isArray(data.containers) || Object.keys(data.containers).length>10000)throw Error("Неверный формат JSON контейнеров.");
  for(const [key,record] of Object.entries(data.containers)){
    if(!/^[A-Za-z0-9]+_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(key) || !Number.isSafeInteger(record?.rev) || record.rev<1 || !Array.isArray(record.items) || record.items.length>10000)throw Error("Повреждена запись контейнера.");
    for(const item of record.items)if(typeof item?.uuid!=="string" || item.uuid.length>512 || !/^(Item|Compendium|Actor|Scene)\./.test(item.uuid) || typeof item.name!=="string" || item.name.length>1000 || (item.img!==undefined&&imagePath(item.img)!==item.img) || !Number.isSafeInteger(item.quantity) || item.quantity<1 || item.quantity>999999)throw Error("Неверная ссылка или количество предметов.");
    if((record.currency!==undefined&&(!record.currency||typeof record.currency!=="object"||Array.isArray(record.currency)))||Object.values(currency(record.currency)).some(n=>!Number.isSafeInteger(n)||n<0||n>999999999))throw Error("Неверное количество монет.");
  }
  return data;
}

async function itemImages(items) {
  return Promise.all(items.map(async item=>{
    if(item.img)return {...item,img:imagePath(item.img)};
    try{return {...item,img:imagePath((await fromUuid(item.uuid))?.img)};}
    catch{return {...item,img:"icons/svg/item-bag.svg"};}
  }));
}

const inventoryWindows=new Set();
export function validateContainerAccess(scene,level,id,tokenId,user,changes=null) {
  if(!user?.active || !scene?.levels.has(level))throw Error("Сцена или этаж недоступны.");
  const f=scene.getFlag(ID,level)?.model.furniture?.find(f=>f.id===id&&f.container),token=scene.tokens.get(tokenId);
  if(!f)throw Error("Этот контейнер удалён.");
  if(!token?.actor?.testUserPermission(user,"OWNER"))throw Error("Выберите свой токен существа.");
  const position=tokenReachPosition(token,changes);
  if(position.hidden&&!user.isGM)throw Error("Выберите свой токен существа.");
  if(position.level!==level)throw Error("Контейнер находится на другом этаже.");
  const elevation=scene.levels.get?.(level)?.elevation.base,floor=Number.isFinite(elevation)?elevation:0,base=position.elevation??floor;
  const vertical=Math.max(0,base-floor,floor-base-(position.depth??1)*scene.grid.distance)*feetPerUnit(scene.grid);
  if(reachNorm(scene.grid,containerDistance(f,position,scene.getDimensions(),scene.grid),vertical)>5+1e-6)throw Error("Подойдите к контейнеру: расстояние должно быть не больше 5 футов.");
  return f;
}

let socket;
export function containerConnectionIssue() {
  const library=game.modules.get("socketlib"),version=library?.version?.replace(/^v/i,"");
  if(!library?.active)return "Для действий игрока с контейнерами и светильниками включите socketlib в этом мире.";
  if(!version||foundry.utils.isNewerVersion("1.1.4",version))return `Требуется socketlib 1.1.4 или новее. Загружена версия: ${version||"неизвестна"}.`;
  if(!game.modules.get(ID)?.socket)return "Foundry использует старый манифест Dungeon Sketch без сетевого канала. Перезапустите Foundry целиком, затем обновите страницы мастера и игроков; одного F5 недостаточно.";
  if(!globalThis.socketlib)return "Socketlib ещё не завершил инициализацию. Дождитесь загрузки мира.";
  return null;
}

async function containerContents(request,sender) {
  try {
    if(!game.users?.activeGM?.isSelf)throw Error("Дождитесь активного мастера.");
    if(!request || ["scene","level","id","token"].some(k=>typeof request[k]!=="string"||request[k].length>64))throw Error("Некорректный запрос.");
    const scene=game.scenes.get(request.scene),user=game.users.get(sender);
    validateContainerAccess(scene,request.level,request.id,request.token,user);
    const store=await inventoryStore(),key=`${request.scene}_${request.level}_${request.id}`;
    const state=store.getFlag(ID,"data"),record=state.containers[key]??{rev:0,items:[]};
    const items=await itemImages(record.items);
    validateContainerAccess(scene,request.level,request.id,request.token,user);
    const op=state.pending,recover=op?.key===key&&op.actor===scene.tokens.get(request.token).actor.uuid&&(op.user===sender||user.isGM);
    return {ok:true,record:{rev:record.rev,items,currency:currency(record.currency),pending:op?(recover?{request:op.request,actor:op.actorName}:{busy:true}):null}};
  }catch(error){return {ok:false,error:error.message};}
}

export function containerTake(request,sender) {
  return queueInventory(async()=>{
    let error;
    try{
      if(!game.users?.activeGM?.isSelf)throw Error("Выдачу выполняет активный мастер.");
      if(!request||["scene","level","id","token"].some(k=>typeof request[k]!=="string"||request[k].length>64))throw Error("Некорректная выдача.");
      const scene=game.scenes.get(request.scene),user=game.users.get(sender);
      validateContainerAccess(scene,request.level,request.id,request.token,user);
      const store=await inventoryStore(),actor=scene.tokens.get(request.token).actor,key=`${request.scene}_${request.level}_${request.id}`;
      const access=()=>validateContainerAccess(scene,request.level,request.id,request.token,user);
      try{await transferLoot(store,request,actor,user,key,access);}
      catch(failure){
        if(!store.getFlag(ID,"data").receipts?.some(r=>r.id===request.operation))throw failure;
        // A committed receipt can resolve a lost final acknowledgement without issuing anything again.
        await transferLoot(store,request,actor,user,key,access);
      }
    }catch(failure){error=failure.message;}
    const result=await containerContents(request,sender);
    return {...result,ok:!error&&result.ok,error:error??result.error,retryable:!!result.record?.pending?.request&&result.record.pending.request.operation===request?.operation};
  });
}

export function connectContainers() {
  if(socket)return socket;
  if(containerConnectionIssue())return null;
  const connection=globalThis.socketlib.registerModule(ID);
  if(!connection)return null;
  connection.register("containerView",function(request){return containerContents(request,this.socketdata.userId);});
  connection.register("containerTake",function(request){return containerTake(request,this.socketdata.userId);});
  connection.register("lightSwitch",function(request){return handleLightSwitch(request,this.socketdata.userId);});
  socket=connection;
  return socket;
}

export async function requestLightSwitch(request) {
  const gm=game.users.activeGM;
  if(!gm)throw Error("Для переключения света нужен подключённый мастер.");
  const issue=containerConnectionIssue();
  if(issue)throw Error(issue);
  const connection=connectContainers();
  if(!connection)throw Error("Сетевой канал света ещё не готов.");
  const result=await connection.executeAsUser("lightSwitch",gm.id,request);
  if(!result.ok)throw Error(result.error);
}

const requestFlights=new Map();
const requestStorage=r=>`${ID}:loot:${r.scene}:${r.level}:${r.id}:${r.token}`;
export async function takeContainerLoot(context,selection) {
  const scene=game.scenes.get(context.scene);validateContainerAccess(scene,context.level,context.id,context.token,game.user);
  const actor=scene.tokens.get(context.token).actor;
  if(selection.actor&&selection.actor!==actor.uuid)throw Error("Перетащите предмет на лист персонажа выбранного токена рядом с контейнером.");
  const storage=requestStorage(context);
  let stored;try{stored=JSON.parse(sessionStorage.getItem(storage));}catch{}
  const request=stored??{...context,...selection,actor:actor.uuid,operation:selection.operation??foundry.utils.randomID()};
  if(requestFlights.has(request.operation))return requestFlights.get(request.operation);
  sessionStorage.setItem(storage,JSON.stringify(request));
  const windows=[...inventoryWindows].filter(w=>w.scene===context.scene&&w.level===context.level&&w.id===context.id&&w.token===context.token);
  for(const window of windows)window.setBusy?.(true);
  const promise=(async()=>{
    const gm=game.users.activeGM;if(!gm)throw Error("Для выдачи нужен подключённый мастер.");
    let result;
    if(gm.isSelf)result=await containerTake(request,game.user.id);
    else {
      const issue=containerConnectionIssue();if(issue)throw Error(issue);
      const connection=connectContainers();if(!connection)throw Error("Сетевой канал выдачи ещё не готов.");
      result=await connection.executeAsUser("containerTake",gm.id,request);
    }
    if(result.ok||!result.retryable)sessionStorage.removeItem(storage);
    for(const window of inventoryWindows)if(window.scene===context.scene&&window.level===context.level&&window.id===context.id&&window.token===context.token&&result.record)window.refresh?.(result.record);
    if(!result.ok)throw Error(result.error??"Выдача не подтверждена. Повторите то же действие.");
    return result;
  })().finally(()=>{requestFlights.delete(request.operation);for(const window of windows)window.setBusy?.(false);});
  requestFlights.set(request.operation,promise);
  return promise;
}

async function takeQuantity(item) {
  if(item.quantity===1)return 1;
  const escape=foundry.utils.escapeHTML;
  return foundry.applications.api.DialogV2.prompt({window:{title:"Забрать предмет",icon:"fa-solid fa-hand"},classes:["mjl-brand","mds-take-dialog"],position:{width:400},modal:true,rejectClose:false,
    content:`<div class="mds-take-item"><img src="${escape(imagePath(item.img))}" alt=""><strong>${escape(item.name)}</strong></div><label>Количество <input name="quantity" type="number" min="1" max="${item.quantity}" step="1" value="1" required></label><p>Доступно: ${item.quantity}</p>`,
    ok:{label:"Забрать",callback:(_event,button)=>button.form.elements.quantity.valueAsNumber}});
}

let dragHookInstalled=false;
export function installLootDragDrop() {
  if(dragHookInstalled)return;dragHookInstalled=true;
  const dropping=new Set();
  const drop=(actor,data)=>{
    if(data?.type!=="MJLContainerLoot")return;
    const payload=data[ID];
    if(!payload||dropping.has(payload.operation))return false;
    dropping.add(payload.operation);
    (async()=>{
      try{
        const scene=game.scenes.get(payload.scene);
        validateContainerAccess(scene,payload.level,payload.id,payload.token,game.user);
        if(!actor||actor.uuid!==scene.tokens.get(payload.token).actor.uuid)throw Error("Перетащите добычу на лист или токен выбранного персонажа рядом с контейнером.");
        const kind=payload.kind??"item";
        let quantity;
        if(kind==="item"){
          if(!Number.isSafeInteger(payload.quantity)||payload.quantity<1)throw Error("Некорректное количество.");
          quantity=await takeQuantity(payload);if(!quantity)return;
        }else if(!["money","items"].includes(kind))throw Error("Неизвестный вид добычи.");
        await takeContainerLoot({scene:payload.scene,level:payload.level,id:payload.id,token:payload.token,rev:payload.rev},
          {kind,...(kind==="item"&&{index:payload.index,uuid:payload.uuid,quantity}),operation:payload.operation,actor:actor.uuid});
        ui.notifications.info("Добыча передана персонажу.");
      }catch(error){ui.notifications.warn(error.message);}
      finally{dropping.delete(payload.operation);}
    })();
    // Consume the native drop: it must not independently copy the template Item.
    return false;
  };
  Hooks.on("dropActorSheetData",(actor,_sheet,data)=>drop(actor,data));
  Hooks.on("dropCanvasData",(_canvas,data)=>{
    if(data?.type!=="MJLContainerLoot")return;
    const token=canvas.tokens.placeables.findLast(t=>t.visible&&t.bounds.contains(data.x,data.y));
    return drop(token?.actor,data);
  });
}

async function containerSnapshot(scene,level,f,tokenId) {
  validateContainerAccess(scene,level,f.id,tokenId,game.user);
  const gm=game.users.activeGM,request={scene:scene.id,level,id:f.id,token:tokenId};
  if(!gm)throw Error("Для открытия контейнера нужен подключённый мастер.");
  let result;
  if(gm?.isSelf)result=await containerContents(request,game.user.id);
  else {
    const issue=containerConnectionIssue();if(issue)throw Error(issue);
    const connection=connectContainers();
    if(!connection)throw Error(containerConnectionIssue()??"Не удалось зарегистрировать сетевой канал Dungeon Sketch. Проверьте консоль и перезагрузите мир.");
    result=await connection.executeAsUser("containerView",gm.id,request);
  }
  if(!result?.ok)throw Error(result?.error??"Мастер не подтвердил открытие.");
  validateContainerAccess(scene,level,f.id,tokenId,game.user);
  return result.record;
}
export async function viewContainer(scene,level,f,tokenId) {
  return openContainer(scene,level,f,{record:await containerSnapshot(scene,level,f,tokenId),tokenId});
}

export async function openContainer(scene,level,f,{record,tokenId}={}) {
  const editable=game.user.isGM&&!record;
  if(!editable&&!record)throw Error("Откройте контейнер своим токеном рядом с маркером.");
  if(editable&&!game.users.activeGM?.isSelf)throw Error("Контейнеры редактирует активный мастер.");
  const store=editable?await inventoryStore():null,read=()=>store.getFlag(ID,"data");
  const key=`${scene.id}_${level}_${f.id}`;
  let previous=record??read().containers[key]??{rev:0,items:[]},taking=false;
  const items=await itemImages(structuredClone(previous.items)),money=currency(previous.currency);
  const actor=tokenId?scene.tokens.get(tokenId)?.actor:null,canLoot=!editable&&game.system.id==="dnd5e"&&["character","npc"].includes(actor?.type);
  const context={scene:scene.id,level,id:f.id,token:tokenId};
  const content=document.createElement("div"),escape=foundry.utils.escapeHTML;
  content.innerHTML=`<div class="mds-inventory"><header class="mds-inventory-header"><i class="fa-solid ${FURNITURE[f.kind]?.icon??"fa-box"}" aria-hidden="true"></i><div><strong>${escape(f.name||FURNITURE[f.kind]?.name||"Контейнер")}</strong><small>${escape(scene.name)} · ${escape(scene.levels.get(level).name)}</small></div><span class="mds-inventory-mode">${editable?"Редактирование":"В пределах 5 футов"}</span></header>
    <div class="mds-wallet">${Object.entries(COINS).map(([coin,label])=>`<label><span class="mds-coin mds-${coin}">${label}</span>${editable?`<input type="number" name="${coin}" data-coin="${coin}" min="0" max="999999999" step="1" value="${money[coin]}" aria-label="Монеты ${label}">`:`<strong data-balance="${coin}">${money[coin]}</strong>`}</label>`).join("")}</div>
    ${canLoot?`<div class="mds-loot-recipient"><img src="${escape(imagePath(actor.img))}" alt=""><span>Получатель: <strong>${escape(actor.name)}</strong></span><button type="button" data-loot="refresh" title="Обновить содержимое" aria-label="Обновить содержимое"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button></div><div class="mds-loot-actions"><button type="button" data-loot="money"><i class="fa-solid fa-coins" aria-hidden="true"></i> Забрать все деньги</button><button type="button" data-loot="items"><i class="fa-solid fa-box-open" aria-hidden="true"></i> Забрать все вещи</button></div><button type="button" data-loot="resume" hidden>Продолжить передачу</button><p data-loot-status aria-live="polite"></p>`:""}
    <label class="mds-inventory-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" placeholder="Найти предмет" aria-label="Поиск предметов" data-search></label>
    <div class="mds-inventory-items"></div><p data-empty><i class="fa-solid fa-box-open" aria-hidden="true"></i><span>Здесь пока пусто</span></p>
    <footer>${editable?'<i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Перетащите сюда предмет. Измените количество и монеты, затем нажмите «Сохранить».':'Заберите вещи кнопкой или перетащите на лист указанного персонажа. Токен должен оставаться в пределах 5 футов.'}</footer></div>`;
  const rows=content.querySelector(".mds-inventory-items");
  const pendingState=()=>{
    if(previous.pending)return previous.pending;
    if(!canLoot)return null;
    try{const request=JSON.parse(sessionStorage.getItem(requestStorage(context)));return request?{request,actor:actor.name}:null;}catch{return null;}
  };
  content.addEventListener("error",event=>{if(event.target.tagName==="IMG"&&event.target.getAttribute("src")!=="icons/svg/item-bag.svg")event.target.src="icons/svg/item-bag.svg";},true);
  const render=()=>{
    const pending=pendingState();
    const query=content.querySelector("[data-search]").value.toLocaleLowerCase();
    content.querySelector("[data-empty]").hidden=!!items.length;
    rows.innerHTML=items.map((item,i)=>({item,i})).filter(({item})=>item.name.toLocaleLowerCase().includes(query)).map(({item,i})=>`<div class="mds-inventory-row" data-row="${i}" draggable="${canLoot&&!taking&&!pending}"><img src="${escape(imagePath(item.img))}" alt="" loading="lazy" draggable="false"><button type="button" data-open="${i}" title="Открыть предмет"><strong>${escape(item.name)}</strong><small>${item.uuid.startsWith("Compendium.")?"Компендиум":"Предмет мира"}</small></button>${editable?`<input aria-label="Количество ${escape(item.name)}" type="number" min="1" max="999999" step="1" value="${item.quantity}" data-quantity="${i}"><button type="button" data-remove="${i}" title="Убрать из контейнера" aria-label="Убрать ${escape(item.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`:`<span class="mds-item-quantity">× ${item.quantity}</span>${canLoot?`<button type="button" data-take="${i}" title="Забрать предмет" aria-label="Забрать ${escape(item.name)}" ${taking||pending?"disabled":""}><i class="fa-solid fa-hand" aria-hidden="true"></i></button>`:""}`}</div>`).join("");
    for(const e of content.querySelectorAll("[data-balance]"))e.textContent=money[e.dataset.balance];
    if(canLoot){
      for(const button of content.querySelectorAll("[data-loot]")){
        const kind=button.dataset.loot;button.hidden=kind==="resume"&&!pending?.request;
        button.disabled=taking||!["resume","refresh"].includes(kind)&&(!!pending||(kind==="money"?!Object.values(money).some(Boolean):!items.length));
        button.draggable=["money","items"].includes(kind)&&!button.disabled;
        if(button.draggable)button.title="Нажмите или перетащите на лист / токен получателя";
      }
      content.querySelector("[data-loot-status]").textContent=taking?"Передача…":pending?.request?`Незавершённая выдача: ${pending.actor}. Можно продолжить.`:pending?"Дождитесь завершения предыдущей выдачи и обновите список.":"";
    }
  };
  if(canLoot){
    content.addEventListener("dragstart",event=>{
      const kind=event.target.closest("[data-loot]")?.dataset.loot??"item",index=Number(event.target.closest("[data-row]")?.dataset.row),item=items[index];
      if(taking||pendingState()||(kind==="item"?!item:!["items","money"].includes(kind))){event.preventDefault();return;}
      event.dataTransfer.effectAllowed="move";
      event.dataTransfer.setData("text/plain",JSON.stringify({type:"MJLContainerLoot",[ID]:{...context,rev:previous.rev,operation:foundry.utils.randomID(),kind,...(item&&{index,uuid:item.uuid,name:item.name,img:item.img,quantity:item.quantity})}}));
    });
  }
  content.addEventListener("input",event=>{if(event.target.matches("[data-search]"))render();});
  content.addEventListener("change",event=>{
    if(!editable)return;
    const quantity=Number(event.target.value),coin=event.target.dataset.coin;
    if(coin in COINS){if(Number.isSafeInteger(quantity)&&quantity>=0&&quantity<=999999999)money[coin]=quantity;event.target.value=money[coin];}
    else if(event.target.dataset.quantity!==undefined){if(Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=999999)items[Number(event.target.dataset.quantity)].quantity=quantity;render();}
  });
  content.addEventListener("click",async event=>{
    const kind=event.target.closest("[data-loot]")?.dataset.loot,take=event.target.closest("[data-take]")?.dataset.take;
    if(canLoot&&(kind||take!==undefined)){
      if(taking)return;taking=true;render();
      try{
        let selection;
        if(kind==="refresh"){tracked.refresh(await containerSnapshot(scene,level,f,tokenId));return;}
        if(kind==="resume")selection=pendingState().request;
        else if(take!==undefined){const index=Number(take),item=items[index],quantity=await takeQuantity(item);if(!quantity)return;selection={kind:"item",index,uuid:item.uuid,quantity};}
        else selection={kind};
        await takeContainerLoot({...context,rev:previous.rev},selection);
        ui.notifications.info("Добыча передана персонажу.");
      }catch(error){ui.notifications.warn(error.message);}
      finally{taking=false;render();}
      return;
    }
    const remove=event.target.closest("[data-remove]")?.dataset.remove,open=event.target.closest("[data-open]")?.dataset.open;
    if(editable&&remove!==undefined){items.splice(Number(remove),1);render();}
    if(open!==undefined)try{const doc=await fromUuid(items[Number(open)].uuid);if(doc?.documentName==="Item")doc.sheet.render({force:true});else ui.notifications.warn("Исходный предмет удалён или компендиум недоступен.");}catch(error){ui.notifications.error(error.message);}
  });
  if(editable){
    content.addEventListener("dragover",event=>{event.preventDefault();content.classList.add("mds-drop-active");});
    content.addEventListener("dragleave",()=>content.classList.remove("mds-drop-active"));
    content.addEventListener("drop",async event=>{
      event.preventDefault();event.stopPropagation();content.classList.remove("mds-drop-active");
      try{
        const data=foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if(data.type!=="Item"||typeof data.uuid!=="string")return;
        const doc=await fromUuid(data.uuid);if(doc?.documentName!=="Item")return;
        const existing=items.find(item=>item.uuid===doc.uuid);
        if(existing)existing.quantity=Math.min(999999,existing.quantity+1);
        else items.push({uuid:doc.uuid,name:doc.name,img:imagePath(doc.img),quantity:1});
        render();
      }catch(error){ui.notifications.error(error.message);}
    });
  }
  render();
  const tracked={scene:scene.id,level,id:f.id,token:tokenId,setBusy:value=>{taking=value;render();},refresh:next=>{
    previous=next;items.splice(0,items.length,...next.items);Object.assign(money,currency(next.currency));render();
  }};
  return foundry.applications.api.DialogV2.prompt({window:{title:f.name||FURNITURE[f.kind]?.name||"Контейнер",icon:"fa-solid fa-box-open"},classes:["mjl-brand","mds-inventory-dialog",...(!editable?["mds-inventory-readonly"]:[]),...(canLoot?["mds-inventory-lootable"]:[])],position:{width:600},content,rejectClose:false,
    render:(_event,app)=>{app.element.querySelector(".dialog-content").replaceChildren(content);if(tokenId){tracked.app=app;inventoryWindows.add(tracked);}},
    close:()=>inventoryWindows.delete(tracked),
    ok:{label:editable?"Сохранить":"Закрыть",callback:async()=>{
      if(!editable)return;
      if(!game.users.activeGM?.isSelf)throw Error("Контейнеры редактирует активный мастер.");
      if(saving)throw Error("Дождитесь сохранения другого контейнера.");
      saving=true;
      try{
        await queueInventory(async()=>{
          if(read().pending)throw Error("Сначала завершите выдачу добычи.");
          if((read().containers[key]?.rev??0)!==previous.rev)throw Error("Содержимое уже изменилось. Откройте контейнер заново.");
          const data={...read(),version:1,containers:{...read().containers,[key]:{rev:previous.rev+1,items,currency:money}}};
          validateInventories(data);await store.setFlag(ID,"data",data);
          if(read().containers[key]?.rev!==previous.rev+1)throw Error("Не удалось сохранить содержимое контейнера.");
        });
        return true;
      }finally{saving=false;}
    }}});
}

export async function inventoryBackup() {
  if(!game.user.isGM)return;
  const store=await inventoryStore(),read=()=>store.getFlag(ID,"data");
  const content='<p>Все контейнеры мира хранятся одним JSON в закрытом мастерском компендиуме. Резервная копия содержит UUID предметов; сами предметы и сцены должны сохранить свои ID.</p><input type="file" accept=".json,application/json" name="inventoryFile" aria-label="JSON контейнеров"><p>Импорт объединяет списки; совпавшие контейнеры заменяются после подтверждения.</p>';
  return foundry.applications.api.DialogV2.wait({window:{title:"Резервная копия контейнеров",icon:"fa-solid fa-box-open"},classes:["mjl-brand"],content,rejectClose:false,buttons:[
    {action:"export",label:"Скачать JSON",callback:()=>foundry.utils.saveDataToFile(JSON.stringify(read(),null,2),"application/json",`dungeon-sketch-${game.world.id}-containers.json`)},
    {action:"import",label:"Импорт JSON",callback:async(_event,button)=>{
      if(!game.users.activeGM?.isSelf)throw Error("Импорт выполняет активный мастер.");
      const file=button.form.elements.inventoryFile.files[0];
      if(!file || file.size>10*1024*1024)throw Error("Выберите JSON-файл до 10 МБ.");
      const data=validateInventories(JSON.parse(await file.text()));
      if(data.pending)throw Error("Эта копия содержит незавершённую выдачу. Сначала завершите её в исходном мире.");
      if(!await foundry.applications.api.DialogV2.confirm({window:{title:"Импорт контейнеров",icon:"fa-solid fa-box-open"},classes:["mjl-brand"],content:`Загрузить ${Object.keys(data.containers).length} контейнеров? Совпадающие записи будут заменены.`,modal:true,rejectClose:false}))return;
      if(saving)throw Error("Дождитесь сохранения контейнера.");
      saving=true;
      try {
        await queueInventory(async()=>{
          if(read().pending)throw Error("Сначала завершите выдачу добычи.");
          const containers=structuredClone(read().containers);
          for(const [key,record] of Object.entries(data.containers))containers[key]={rev:(containers[key]?.rev??0)+1,items:record.items,currency:currency(record.currency)};
          await store.setFlag(ID,"data",{...read(),version:1,containers});
        });
      }finally{saving=false;}
      ui.notifications.info("JSON контейнеров импортирован.");
    }}
  ]});
}

export const containerMarkerCenter=(f,{sceneX=0,sceneY=0})=>({x:sceneX+f.x+f.width/2,y:sceneY+f.y+f.height/2});

let markerRoot,markerKey,markerFrame;
function controlledToken(scene,level,f) {
  const tokens=canvas.tokens.controlled.map(t=>t.document);
  return tokens.find(token=>{try{validateContainerAccess(scene,level,f.id,token.id,game.user);return true;}catch{return false;}})??tokens[0];
}

function validateOpenWindows(token,changes) {
  for(const entry of inventoryWindows){
    try{
      if(!canvas.ready||entry.scene!==canvas.scene?.id||entry.level!==canvas.level?.id)throw Error("Этаж изменился");
      const pendingPosition=token?.documentName==="Token"&&token.id===entry.token&&token.parent?.id===entry.scene?changes:null;
      validateContainerAccess(canvas.scene,entry.level,entry.id,entry.token,game.user,pendingPosition);
    }catch{entry.app.close();inventoryWindows.delete(entry);}
  }
}
export function refreshContainerMarkers(token,changes) {
  validateOpenWindows(token,changes); // v14 updateToken can precede prepared position data and the next visual frame.
  if(markerFrame)return;
  markerFrame=requestAnimationFrame(async()=>{
    markerFrame=null;
    if(!canvas.ready||!canvas.level||!canvas.controls)return;
    const scene=canvas.scene,level=canvas.level.id,state=scene.getFlag(ID,level);
    const key=`${scene.id}:${level}:${state?.rev??0}`;
    if(!markerRoot||markerRoot.destroyed){markerRoot=canvas.controls.addChild(new PIXI.Container());markerRoot.name="mds-containers";markerKey=null;}
    if(markerKey!==key){
      markerKey=key;for(const child of markerRoot.removeChildren())child.destroy({children:true});
      const dims=scene.getDimensions();
      for(const f of state?.model.furniture??[]){
        if(!f.container)continue;
        const icon=new foundry.canvas.containers.ControlIcon({texture:"icons/svg/chest.svg",size:32,borderColor:0xd4b184});
        icon.name=`container:${f.id}`;icon.containerId=f.id;
        // ControlIcon supplies its own central pivot. Rotation never changes the furniture's center.
        const center=containerMarkerCenter(f,dims);
        icon.position.set(center.x,center.y);
        icon.on("pointerover",()=>{icon.border.visible=true;icon.tooltip.text=icon.accessLabel;icon.tooltip.visible=true;});icon.on("pointerout",()=>{icon.border.visible=false;icon.tooltip.visible=false;});
        icon.on("pointerdown",event=>{
          if(event.button!==0)return;event.stopPropagation();
          const token=controlledToken(scene,level,f);
          viewContainer(scene,level,f,token?.id).catch(error=>ui.notifications.warn(error.message));
        });
        markerRoot.addChild(icon);await icon.draw();
        if(icon.destroyed)return;
        icon.border.visible=false;
      }
    }
    if(markerRoot.destroyed)return;
    markerRoot.visible=!canvas.dungeonSketch?.active;
    const furniture=markerRoot.visible?new Map((state?.model.furniture??[]).map(f=>[f.id,f])):new Map();
    for(const icon of markerRoot.visible?markerRoot.children:[]){
      const f=furniture.get(icon.containerId);if(!f)continue;
      const dims=scene.getDimensions(),point={x:f.x+f.width/2+dims.sceneX,y:f.y+f.height/2+dims.sceneY};
      icon.visible=game.user.isGM||!canvas.visibility.tokenVision||canvas.visibility.testVisibility(point,{tolerance:0});
      const token=controlledToken(scene,level,f);let near=false;
      try{validateContainerAccess(scene,level,f.id,token?.id,game.user);near=true;}catch{}
      icon.alpha=near?1:0.5;icon.accessLabel=`${f.name||FURNITURE[f.kind]?.name||"Контейнер"} · ${near?"Открыть":"Подойдите на 5 футов"}`;
    }
    validateOpenWindows();
  });
}

let interactionInstalled=false;
export function installContainerInteraction() {
  refreshContainerMarkers();
  if(interactionInstalled)return;
  interactionInstalled=true;
  for(const hook of ["updateToken","deleteToken","controlToken","updateScene","canvasReady","sightRefresh"])Hooks.on(hook,refreshContainerMarkers);
  Hooks.on("canvasTearDown",()=>{for(const entry of inventoryWindows)entry.app.close();inventoryWindows.clear();markerKey=null;});
  let consumed,rightClick;
  const hit=event=>{
    const p=canvas.canvasCoordinatesFromClient({x:event.clientX,y:event.clientY}),dims=canvas.scene.getDimensions();
    const f=furnitureAt(canvas.scene.getFlag(ID,canvas.level.id)?.model??{},[p.x-dims.sceneX,p.y-dims.sceneY]);
    return {p,f};
  };
  window.addEventListener("pointermove",event=>{
    if(event.pointerId===rightClick?.pointerId&&Math.hypot(event.clientX-rightClick.x,event.clientY-rightClick.y)>5)rightClick=null;
  },true);
  for(const type of ["pointerup","pointercancel"])window.addEventListener(type,event=>{
    if(event.pointerId===consumed){consumed=undefined;event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.pointerId!==rightClick?.pointerId)return;
    const click=rightClick;rightClick=null;
    if(type!=="pointerup"||event.button!==2||event.target!==canvas.app.view||!canvas.ready||canvas.scene!==click.scene||
      canvas.level?.id!==click.level||canvas.dungeonSketch?.active||Math.hypot(event.clientX-click.x,event.clientY-click.y)>5)return;
    const {f}=hit(event);
    if(f?.container&&f.id===click.id)openContainer(click.scene,click.level,f).catch(error=>ui.notifications.warn(error.message));
  },true);
  window.addEventListener("pointerdown",event=>{
    if(!canvas.ready||!canvas.level||event.target!==canvas.app.view)return;
    if(event.button===2&&game.user.isGM&&!canvas.dungeonSketch?.active){
      const {f}=hit(event);
      rightClick=f?.container?{pointerId:event.pointerId,scene:canvas.scene,level:canvas.level.id,id:f.id,x:event.clientX,y:event.clientY}:null;
      return;
    }
    if(!event.altKey||event.button!==0)return;
    const {p,f}=hit(event);
    if(!f?.container||(!game.user.isGM&&canvas.visibility.tokenVision&&!canvas.visibility.testVisibility(p,{tolerance:0})))return;
    consumed=event.pointerId;event.preventDefault();event.stopImmediatePropagation();
    const promise=game.user.isGM&&canvas.dungeonSketch?.active?openContainer(canvas.scene,canvas.level.id,f):viewContainer(canvas.scene,canvas.level.id,f,controlledToken(canvas.scene,canvas.level.id,f)?.id);
    promise.catch(error=>ui.notifications.warn(error.message));
  },true);
}
