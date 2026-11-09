import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {ID, STAIRS, STAIR_COLOR, PASSAGES, empty, rectangle, ellipse, brush, combine, placeDoor, wallsFor, eraseObjects, generate, stairOutline, stairFromEdge, stairAt, stairLines, stairGate, distance} from "../scripts/model.mjs";
import {reconcile, publish, publishDraft, installStairGuard} from "../scripts/publish.mjs";
import {inkColor, FLOOR_TEXTURES, WALL_TEXTURES, floorPatternPlacement,drawStair,drawPassage} from "../scripts/art.mjs";
import {FURNITURE, furnitureAt, drawFurniture, furnitureRasterSize, furnitureBounds, positionFurniture, stepFurnitureScale, wheelFurniture, validateInventories, containerDistance, validateContainerAccess, containerMarkerCenter, containerConnectionIssue, connectContainers} from "../scripts/furniture.mjs";
import {LIGHTS,lightSource,lightConfig,lightFixture,drawLightFixture,toggleLight,canReachLight,handleLightSwitch} from "../scripts/lights.mjs";
import {TRAPS,drawTrap,trapHidden,trapTile,trapMarkerPoint} from "../scripts/traps.mjs";
import {floorPlan,visibleOn,floorSurface,SURFACE_KEY,floorShade,dimFloorTint,refreshLevelContrast,pointUnderFloor} from "../scripts/levels.mjs";
import {chronicleMap} from "../scripts/points.mjs";
const require = createRequire(import.meta.url);
const root = process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
globalThis.ClipperLib = require(root + "/public/scripts/clipper/clipper.js");
{
 const grid={isSquare:true,diagonals:0,size:100,distance:5,units:"ft"};
 const dims={size:100,sceneX:1000,sceneY:800},user={active:true};
 const token={x:2400,y:900,width:1,height:1,level:"A",elevation:0,depth:1,actor:{testUserPermission:()=>true},getSize:()=>({width:100,height:100})};
 const candle={x:2588,y:1096,elevation:0,getFlag:()=>"A"};
 assert.equal(canReachLight(candle,token,user,{...grid,diagonals:1}),false);
 assert.equal(canReachLight(candle,token,user,grid),true);
 assert.equal(canReachLight(candle,{...token,y:895},user,grid),false);
 assert.equal(canReachLight(candle,{...token,level:"B"},user,grid),false);
 const chest={id:"chest",container:true,x:1400,y:200,width:110,height:55,rotation:0};
 const byChest={...token,x:2600,y:1100};
 assert(containerDistance(chest,byChest,dims,{...grid,diagonals:1})>5);
 assert.equal(containerDistance(chest,byChest,dims,grid),4.5);
 const scene={grid,levels:new Map([["A",{elevation:{base:0}}]]),getDimensions:()=>dims,getFlag:()=>({model:{furniture:[chest]}}),tokens:new Map([["T",byChest]])};
 assert.equal(validateContainerAccess(scene,"A","chest","T",user),chest);
 assert.throws(()=>validateContainerAccess(scene,"A","chest","T",user,{x:2611}),/5 футов/);
 const near={x:2500,y:1000,width:1,height:1,elevation:0,depth:1,level:"A"},far={...near,x:2100};
 const animated={...token,...far,_source:near};
 scene.tokens.set("T",animated);
 assert.equal(canReachLight(candle,animated,user,grid),true);
 assert.equal(validateContainerAccess(scene,"A","chest","T",user),chest);
 Object.assign(animated,near,{_source:far});
 assert.equal(canReachLight(candle,animated,user,grid),false);
 assert.throws(()=>validateContainerAccess(scene,"A","chest","T",user),/5 футов/);
 console.log("OK: the candle and chest use committed token positions despite animation lag and respect 5-foot reach on the scene grid.");
}
{
 const previousGame=globalThis.game;
 const owner={id:"owner",active:true,viewedScene:"S",viewedLevel:"A"},stranger={...owner,id:"stranger"};
 const token={actor:{testUserPermission:user=>user===owner},x:0,y:0,elevation:0,depth:1,level:"A",getSize:()=>({width:100,height:100})};
 let writes=0;
 const light={x:200,y:50,elevation:0,hidden:false,getFlag:()=>"A",update:async ({hidden})=>{light.hidden=hidden;writes++;}};
 const scene={id:"S",levels:new Set(["A","B"]),tokens:new Map([["T",token]]),lights:new Map([["L",light]]),grid:{size:100,distance:5,units:"ft"}};
 const request={scene:"S",level:"A",id:"L",token:"T",hidden:true};
 globalThis.game={scenes:new Map([["S",scene]]),users:Object.assign(new Map([[owner.id,owner],[stranger.id,stranger]]),{activeGM:{isSelf:true}})};
 try {
   assert.deepEqual(await handleLightSwitch(request,"owner"),{ok:true});
   assert.deepEqual(await handleLightSwitch(request,"owner"),{ok:true});
   assert.equal(writes,1);
   for(const change of [{x:-1},{elevation:1},{level:"B"},{hidden:true}]){
     const before={...token};Object.assign(token,change);
     assert.equal((await handleLightSwitch({...request,hidden:false},"owner")).ok,false);
     Object.assign(token,before);delete token.hidden;
   }
   assert.equal((await handleLightSwitch({...request,hidden:false,userId:"owner"},"stranger")).ok,false);
   owner.viewedLevel="B";
   assert.equal((await handleLightSwitch({...request,hidden:false},"owner")).ok,false);
   assert.equal(writes,1);
 }finally{globalThis.game=previousGame;}
 console.log("OK: light RPC enforces sender ownership, same floor, elevation and the exact 5-foot limit; repeated requests are idempotent.");
}
{
 const previousGame=globalThis.game,config={bright:15,dim:30,color:"#ffce82",animation:{type:"torch"}},light={hidden:false,config,getFlag:()=>"A",update:async data=>{assert.deepEqual(Object.keys(data),["hidden"]);light.hidden=data.hidden;}},scene={lights:new Map([["lamp",light]])};
 try{
   globalThis.game={user:{isGM:true}};await toggleLight(scene,"A","lamp");assert.equal(light.hidden,true);assert.strictEqual(light.config,config);
   await toggleLight(scene,"A","lamp");assert.equal(light.hidden,false);await assert.rejects(toggleLight(scene,"B","lamp"),/этаже/);await assert.rejects(toggleLight(scene,"A","missing"),/удалён/);
   game.user.isGM=false;await assert.rejects(toggleLight(scene,"A","lamp"),/мастер/);
 }finally{globalThis.game=previousGame;}
 const strokes=[[[40,100],[170,100],[50,130]],[[20,20],[180,20],[25,35],[180,50]],[[10,20],[150,170],[10,170],[150,20]]];
 const segmentDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
 for(const points of strokes)for(const ring of combine([],brush(points,16)))for(const p of ring)assert(Math.min(...points.slice(1).map((b,i)=>segmentDistance(p,points[i],b)))<=17.5);
 console.log("OK: native light toggles preserve configuration and reject non-GMs/wrong floors; sharp brush geometry stays within the round brush radius.");
}
for(const kind of Object.keys(PASSAGES)){
 const model={...empty(),floor:[rectangle([0,0],[300,300])],doors:[{a:[100,0],b:[200,0],kind,free:true}]};
 const spans=wallsFor(model);assert.equal(spans.filter(s=>s.kind===kind).length,1);assert(!spans.some(s=>s.kind===undefined&&s.a[1]===0&&s.b[1]===0&&Math.min(s.a[0],s.b[0])<200&&Math.max(s.a[0],s.b[0])>100));
 const fills=[],calls=[],ctx=new Proxy({},{get:(_,key)=>(...args)=>{calls.push(key);if(key==="fillRect")fills.push(args);}});
 drawPassage(ctx,[0,0],[100,0],kind,{width:7,wall:"#302b29"});
 if(kind==="secret")assert.equal(calls.length,0);else assert(calls.includes("rotate")&&fills.length);
 if(kind==="grateDoor")assert(!fills.some(([x,y,w,h])=>w>50&&h>5));
 eraseObjects(model,{x:145,y:-5,width:10,height:10});assert.equal(model.doors.length,0);
}
console.log("OK: all six passage tools cut matching walls, erase normally and render distinct doors; secret art stays concealed and grating has no opaque panel.");
const furnished={...empty(),furniture:[{id:"chest",kind:"chest",x:100,y:100,width:100,height:50,rotation:90},{id:"rug",kind:"rug",x:400,y:400,width:200,height:300}]};
assert(Object.keys(FURNITURE).length>=10);
for(const [kind,definition] of Object.entries(FURNITURE))for(const size of [50,100,140,200]){
  const f={kind,x:0,y:0,width:definition.width*size,height:definition.height*size,rotation:45};
  const scales=[],ctx=new Proxy({},{get:(_,key)=>key==="scale"?(x,y)=>scales.push([x,y]):()=>{}});
  drawFurniture(ctx,f);assert.equal(scales.length,1);assert.equal(scales[0][0],scales[0][1]);
  const raster=furnitureRasterSize(f);assert.equal(Math.max(raster.width,raster.height),256);
  assert(Math.abs(raster.width-f.width*raster.scale)<=0.5);assert(Math.abs(raster.height-f.height*raster.scale)<=0.5);
}
assert.deepEqual(furnitureRasterSize({width:100,height:200}),{width:128,height:256,scale:1.28});
console.log(`OK: all ${Object.keys(FURNITURE).length} furniture designs use uniform scaling and aspect-correct preview rasters at four grid sizes.`);
{
 const levels=Array.from({length:4},(_,i)=>({id:String(i),index:i,sort:i,elevation:{base:i*10},visibility:{levels:new Set(Array.from({length:i},(_,j)=>String(j)))},background:{tint:"#806040"},foreground:{tint:"#ffffff"}}));
 levels.get=id=>levels.find(l=>l.id===id);const scene={levels};
 assert.equal(floorShade(scene,levels[0],levels[0]),1);assert.equal(floorShade(scene,levels[3],levels[0]),0.84**3);
 assert.equal(floorShade(scene,levels[0],levels[3]),1);assert.equal(floorShade(scene,levels[1],levels[0]),.84);
 assert.equal(dimFloorTint("#806040",.84),0x6c5136);assert.equal(dimFloorTint("#806040",1),0x806040);
 const previousCanvas=globalThis.canvas,previousGame=globalThis.game;let enabled=true;
 const doc={getFlag:()=>"0",levels:new Set(["0","3"]),elevation:0,texture:{tint:"#806040"},hidden:true};
 const tile={document:doc,mesh:{tint:0x806040,alpha:.3,visible:false}},background={name:"Level.0.background",tint:0x806040,alpha:.7};
 globalThis.canvas={ready:true,scene,level:levels[3],tiles:{placeables:[tile]},primary:{levelTextures:[background]}};
 globalThis.game={settings:{get:()=>enabled}};
 try{
   refreshLevelContrast();const tint=tile.mesh.tint;assert.equal(tint,dimFloorTint("#806040",0.84**3));assert.equal(background.tint,tint);
   for(let i=0;i<30;i++)refreshLevelContrast();assert.equal(tile.mesh.tint,tint);
   assert.equal(tile.mesh.visible,false);assert.equal(tile.mesh.alpha,.3);assert.equal(doc.hidden,true);assert.equal(doc.texture.tint,"#806040");
   enabled=false;refreshLevelContrast();assert.equal(tile.mesh.tint,0x806040);assert.equal(background.tint,0x806040);
   enabled=true;canvas.level=levels[0];refreshLevelContrast();assert.equal(tile.mesh.tint,0x806040);
 }finally{globalThis.canvas=previousCanvas;globalThis.game=previousGame;}
 console.log("OK: lower floors darken progressively, preserve original tint/alpha/hidden state, never accumulate shading, and restore on toggle or floor change.");
}
{
 for(const kind of ["doubleBed","bunkBed","vase","amphora","lever"])assert(FURNITURE[kind]);
 for(let i=0;i<100;i++)assert.equal(stepFurnitureScale(stepFurnitureScale(1,-1),1),1);
 let scale=1;for(let i=0;i<30;i++)scale=stepFurnitureScale(scale,-1);assert.equal(scale,.5);
 for(let i=0;i<5;i++)scale=stepFurnitureScale(scale,1);assert.equal(scale,1);
 assert.equal(stepFurnitureScale(1.078,-1),1);assert.equal(stepFurnitureScale(4,1),4);
 const close=(a,b)=>assert(Math.abs(a-b)<1e-5,`${a} != ${b}`);
 for(const [kind,d] of Object.entries({...FURNITURE,...TRAPS}))for(const size of [50,100,140,200]){
   let f={kind,x:300,y:400,width:d.width*size,height:d.height*size,rotation:0};const original={...f};
   for(let i=0;i<24;i++){
     const before=furnitureBounds(f);f=positionFurniture(wheelFurniture(f,1,false,size),[before.x,before.y]);
     const box=furnitureBounds(f);close(box.x,300);close(box.y,400);
     const placed=positionFurniture({...f,x:0,y:0},[size*3,size*4]);const bounds=furnitureBounds(placed);close(bounds.x,size*3);close(bounds.y,size*4);
   }
   close(f.x,original.x);close(f.y,original.y);assert.equal(f.rotation,0);
   f=wheelFurniture(wheelFurniture(original,-1,true,size),1,true,size);close(f.width,original.width);close(f.height,original.height);
 }
 console.log("OK: rotated furniture/traps anchor to their actual bounds without rotation-cycle drift; fixed tenth steps return to exactly 1, including after hitting limits.");
}
{
 const original={id:"chair",kind:"chair",x:37,y:53,width:200,height:50,rotation:350};
 const rotated=wheelFurniture(original,1,false,100);assert.equal(rotated.rotation,5);assert.equal(original.rotation,350);
 const resized=wheelFurniture(original,1,true,100);assert(Math.abs(resized.width/resized.height-4)<1e-9);
 assert.equal(resized.x+resized.width/2,original.x+original.width/2);assert.equal(resized.y+resized.height/2,original.y+original.height/2);
 const maximum=wheelFurniture({...original,width:2000,height:500},1,true,100);assert.equal(maximum.width,2000);
 const minimum=wheelFurniture({...original,width:100,height:25},-1,true,100);assert.equal(minimum.height,25);
 for(const [kind,preset] of Object.entries(LIGHTS)){
   const source=lightSource(kind,[150,250],{units:"ft"});assert.equal(source.bright,preset.bright);assert.equal(source.dim,preset.dim);
   const metric=lightSource(kind,[150,250],{units:"m"});assert(Math.abs(metric.bright-preset.bright*0.3048)<0.006);
   assert.equal(lightSource(kind,[0,0],{units:"ft"},{animated:false}).animation.type,null);
   const fixture=lightFixture(source,100);assert.equal(fixture.x+fixture.width/2,150);assert.equal(fixture.y+fixture.height/2,250);
   drawLightFixture(new Proxy({},{get:()=>()=>{}}),fixture);
 }
 assert.equal(lightSource("torch",[0,0],{units:"ft"},{scale:2,color:"#abcdef"}).dim,80);
 assert.deepEqual(lightConfig(lightSource("campfire",[0,0],{units:"ft"})).animation,{type:"torch",speed:3,intensity:4});
 assert.equal(FURNITURE.weaponRack.container,true);
 assert.deepEqual(lightConfig({bright:10,dim:20,color:"#ff0000"}),{bright:10,dim:20,color:"#ff0000",alpha:0.35,animation:{type:null}});
}
console.log("OK: wheel rotation wraps, scaling preserves center/aspect/limits; light presets, metric radii, animation toggle, fixture centers and legacy light config.");
assert.equal(furnitureAt(furnished,[150,80]).id,"chest");
assert.equal(furnitureAt(furnished,[110,120]),undefined);
assert.equal(furnitureAt({},[100,100]),undefined);
for(const rotation of [0,45,90,180,270])for(const size of [50,100,200]){
  const f={x:73,y:191,width:size*2,height:size*0.5,rotation};
  assert.deepEqual(containerMarkerCenter(f,{sceneX:137,sceneY:61}),{x:137+73+size,y:61+191+size*0.25});
}
eraseObjects(furnished,{x:126,y:77,width:5,height:5});assert.equal(furnished.furniture.length,1);
eraseObjects(furnished,{x:450,y:450,width:5,height:5});assert.equal(furnished.furniture.length,0);
console.log("OK: furniture catalog, rotated hit testing, legacy models and small-area deletion inside furniture.");
{
 assert.equal(Object.keys(TRAPS).length,6);assert(trapHidden({}));assert(trapHidden({hidden:true}));assert.equal(trapHidden({hidden:false}),false);
 for(const [kind,type] of Object.entries(TRAPS)){
   const scales=[],ctx=new Proxy({},{get:(_,key)=>key==="scale"?(x,y)=>scales.push([x,y]):()=>{}}),trap={id:kind,kind,x:100,y:200,width:type.width*100,height:type.height*100,rotation:90};
   drawTrap(ctx,trap);assert.equal(scales.length,1);assert.equal(scales[0][0],scales[0][1]);
   const tile=trapTile(trap,{x:200,y:100,level:"upper",elevation:20,asset:"trap.png"});assert.equal(tile.hidden,true);assert.deepEqual(tile.levels,["upper"]);assert.equal(tile.x,300+trap.width/2);assert.equal(tile.y,300+trap.height/2);assert.equal(tile.rotation,90);assert(tile.locked);
   assert.equal(trapTile({...trap,hidden:false},{level:"upper",asset:"trap.png"}).hidden,false);
   const marker=trapMarkerPoint(trap,{sceneX:200,sceneY:100}),ring=stairOutline(trap);assert(marker.x>200+Math.max(...ring.map(p=>p[0])));assert(marker.y<100+Math.min(...ring.map(p=>p[1])));
   const model={...empty(),traps:[trap]};eraseObjects(model,{x:trap.x+trap.width/2-2,y:trap.y+trap.height/2-2,width:4,height:4});assert.equal(model.traps.length,0);
 }
}
console.log("OK: six trap drawings preserve natural aspect; default-hidden native Tiles bind to a floor; GM markers lie outside rotated bounds; small-area deletion works.");
{
 const a={id:"A",visibility:{levels:new Set(["C"])}},b={id:"B",visibility:{levels:new Set(["A"])}},c={id:"C",visibility:{levels:new Set(["A","B"])}};
 const plan=floorPlan([a,b,c],[{id:"A",name:"1 этаж",surface:false},{id:"B",name:"2 этаж",seeBelow:true,surface:true},{id:"C",name:"3 этаж",seeBelow:false,surface:true}],{height:10,base:-10});
 assert.deepEqual(plan.map(l=>l.elevation),[{bottom:-10,top:0},{bottom:0,top:10},{bottom:10,top:20}]);assert.deepEqual(plan[0].visibility.levels,["C"]);assert.deepEqual(plan[1].visibility.levels,["A"]);assert.deepEqual(plan[2].visibility.levels,[]);
 assert.deepEqual(visibleOn({levels:[a,b,c]},"A"),["A","B","C"]);
 assert.throws(()=>floorPlan([a],[{id:"B",name:"2"}],{height:10}),/изменился/);assert.throws(()=>floorPlan([],[{id:"A",name:"1"}],{height:0}),/высоту/);assert.throws(()=>floorPlan([],[{id:"A",name:""}],{height:10}),/название/);
 const model={...empty(),floor:[rectangle([0,0],[600,600])]};const cut=rectangle([400,-100],[700,700]);model.floor=combine(model.floor,[cut],"ctDifference");model.openings=[{points:cut,railing:true}];
 let walls=wallsFor(model);assert(walls.some(w=>w.kind==="railing"&&w.a[0]===400&&w.b[0]===400));assert(!walls.some(w=>w.kind==="wall"&&w.a[0]===400&&w.b[0]===400));
 eraseObjects(model,{x:395,y:200,width:10,height:10});assert.equal(model.openings[0].railing,false);walls=wallsFor(model);assert(!walls.some(w=>w.a[0]===400&&w.b[0]===400));
 model.walls.push({a:[400,100],b:[400,300],kind:"railing"});walls=wallsFor(model);assert(walls.some(w=>w.kind==="railing"&&distance(w.a,w.b)===200));
 const hole=combine([rectangle([0,0],[600,600])],[rectangle([200,200],[400,400])],"ctDifference"),level={name:"2 этаж",elevation:{base:10},getFlag:()=>true};
 const surface=floorSurface(level,{...empty(),floor:hole},{x:100,y:200},["B"]);assert.equal(surface.shapes.filter(s=>s.hole).length,1);assert.equal(surface.behaviors[0].type,"defineSurface");assert.deepEqual(surface.elevation,{bottom:10,top:10});
 assert.equal(floorSurface({...level,getFlag:()=>false},{...empty(),floor:hole},{x:0,y:0},["B"]),null);
 assert.equal(pointUnderFloor(hole,100,100),true);
 assert.equal(pointUnderFloor(hole,300,300),false);
 assert.equal(pointUnderFloor(hole,700,100),false);
 const island=combine(hole,[rectangle([275,275],[325,325])]);
 assert.equal(pointUnderFloor(island,300,300),true);
 assert.equal(pointUnderFloor(island,350,350),false);
}
console.log("OK: floor plan keeps IDs/above-level links, applies heights and below visibility; voids remove walls, railings override partial boundaries, floor surfaces keep holes and exact elevations.");
const inventory={version:1,containers:{scene_level_chest:{rev:1,items:[{uuid:"Compendium.dnd5e.items.Item.ruby",name:"Ruby",quantity:2}]}}};
assert.equal(validateInventories(inventory),inventory);
assert.throws(()=>validateInventories({...inventory,version:2}));
assert.throws(()=>validateInventories({version:1,containers:{bad:{rev:1,items:[]}}}));
inventory.containers.scene_level_chest.items[0].quantity=-1;assert.throws(()=>validateInventories(inventory));
inventory.containers.scene_level_chest.items[0].quantity=2;
inventory.containers.scene_level_chest.currency={gp:123};assert.equal(validateInventories(inventory),inventory);
inventory.containers.scene_level_chest.currency.gp=-1;assert.throws(()=>validateInventories(inventory));
inventory.containers.scene_level_chest.currency.gp=0;inventory.containers.scene_level_chest.items[0].img="javascript:alert(1)";assert.throws(()=>validateInventories(inventory));
console.log("OK: JSON inventory import rejects invalid versions, keys and quantities.");
{
const container={id:"box",container:true,x:500,y:500,width:100,height:50,rotation:0};
const dims={size:100,sceneX:0,sceneY:0},grid={distance:5,units:"ft"};
const token={x:300,y:500,width:1,height:1,level:"floor",actor:{testUserPermission:()=>true}};
assert.equal(containerDistance(container,token,dims,grid),5);
assert(containerDistance(container,{...token,x:299},dims,grid)>5);
assert.equal(containerDistance(container,{...token,x:500},dims,grid),0);
assert.equal(containerDistance({...container,rotation:90},{...token,x:325},dims,grid),5);
assert.equal(containerDistance(container,{...token,x:200,width:2},dims,grid),5);
assert.equal(containerDistance(container,{...token,x:400}, {...dims,sceneX:100},grid),5);
assert(Math.abs(containerDistance(container,token,dims,{distance:1.524,units:"m"})-5)<1e-9);
const accessScene={levels:new Set(["floor"]),getFlag:()=>({model:{furniture:[container]}}),tokens:new Map([["token",token]]),getDimensions:()=>dims,grid};
assert.equal(validateContainerAccess(accessScene,"floor","box","token",{active:true}),container);
assert.throws(()=>validateContainerAccess(accessScene,"floor","box","token",{active:true},{x:299}),/5 футов/);
assert.throws(()=>validateContainerAccess(accessScene,"other","box","token",{active:true}));
assert.throws(()=>validateContainerAccess(accessScene,"floor","missing","token",{active:true}));
token.x=299;assert.throws(()=>validateContainerAccess(accessScene,"floor","box","token",{active:true}),/5 футов/);token.x=300;
token.elevation=6;assert.throws(()=>validateContainerAccess(accessScene,"floor","box","token",{active:true}),/5 футов/);token.elevation=0;
token.actor.testUserPermission=()=>false;assert.throws(()=>validateContainerAccess(accessScene,"floor","box","token",{active:true}),/свой токен/);
console.log("OK: exact five-foot boundary, rotation, creature footprint, scene offsets/metres and access ownership/level guards.");
}
assert.equal(inkColor("#a5a6a5"),"#575857");
assert.equal(inkColor("#a5a6a5",true),"#d4d4d4");
assert.notEqual(inkColor("#9b7351"),inkColor("#d4c3a3"));
assert.throws(()=>inkColor("invalid"),/RRGGBB/);
assert(FLOOR_TEXTURES.length>=6 && WALL_TEXTURES.length>=4);
for (const size of [50,100,140,200]) for (const resolution of [1,2,3]) {
  const placement=floorPatternPlacement({size,x:167,y:-43},resolution);
  assert.equal(placement.x,-167);assert.equal(placement.y,43);
  assert(Math.abs(100*resolution*placement.scale-size)<1e-9);
}
assert.deepEqual(floorPatternPlacement({}),{x:-0,y:-0,scale:1});
console.log("OK: built-in floor patterns use exactly one grid cell per 100 SVG units, with scene-origin alignment and raster-resolution independence.");
const room = rectangle([0,0],[200,200]), other = rectangle([100,0],[300,200]);
const model = empty();
model.floor = combine([], [room, other]);
assert.equal(model.floor.length,1);
assert.equal(wallsFor(model).length,4);
model.floor = combine(model.floor,[rectangle([30,30],[60,70])],"ctDifference");
assert.equal(model.floor.length,2);
assert.equal(wallsFor(model).length,8);
model.doors.push(placeDoor(model,[160,1],50,"secret"));
const segments = wallsFor(model);
assert.equal(segments.filter(s=>s.kind==="secret").length,1);
assert.equal(segments.length,10);
assert.deepEqual(segments.find(s=>s.kind==="secret").a.concat(segments.find(s=>s.kind==="secret").b).sort((a,b)=>a-b),[0,0,135,185]);
model.walls.push({a:[120,0],b:[120,200],kind:"invisible"});
model.doors.push(placeDoor(model,[120,170],30,"door"));
assert(wallsFor(model).some(s=>s.kind==="door"));
eraseObjects(model,{x:104,y:162,width:35,height:20});
assert(!model.walls.length);
assert.equal(model.doors.length,1);
model.doors.push(placeDoor(model,[300,100],50,"window"));
assert.equal(wallsFor(model).filter(w=>w.kind==="window").length,1);
const free={...empty(),doors:[{a:[137,143],b:[278,219],kind:"door",free:true}]};
assert.deepEqual(wallsFor(free).map(({a,b,kind})=>({a,b,kind})),[{a:[137,143],b:[278,219],kind:"door"}]);
free.floor=[rectangle([0,0],[100,100])];
assert.equal(wallsFor(free).filter(w=>w.kind==="door").length,1);
const cut={...empty(),floor:[rectangle([0,0],[300,300])],doors:[{a:[100,0],b:[200,0],kind:"door",free:true}]};
assert.equal(wallsFor(cut).filter(w=>w.kind==="wall").length,5);
assert.deepEqual(stairOutline({x:100,y:100,width:100,height:200,rotation:90}),[[250,150],[250,250],[50,250],[50,150]]);
const steps={...empty(),stairs:[{x:100,y:100,width:100,height:200,rotation:90}]};
eraseObjects(steps,{x:40,y:170,width:30,height:20});assert.equal(steps.stairs.length,0);
const taper=stairFromEdge([100,100],[300,100],[250,400]);
assert.deepEqual(taper.points,[[100,100],[300,100],[250,400],[150,400]]);
assert.deepEqual(stairFromEdge([100,100],[300,100],[300,400]).points,[[100,100],[300,100],[300,400],[100,400]]);
assert.deepEqual(stairFromEdge([100,100],[100,300],[400,250]).points,[[100,100],[100,300],[400,250],[400,150]]);
assert.deepEqual(stairFromEdge([100,100],[300,300],[400,100]).points,[[100,100],[300,300],[400,100],[300,0]]);
assert.equal(stairFromEdge([100,100],[100,100],[300,300]),null);
assert.equal(stairFromEdge([100,100],[300,100],[200,100]),null);
const narrow=stairFromEdge([100,100],[300,100],[200,400]).points;
assert.equal(distance(narrow[2],narrow[3]),10);
const treads=stairLines(taper);
assert.deepEqual(treads[0],[[100,100],[300,100]]);
assert.deepEqual(treads.at(-1),[[150,400],[250,400]]);
const taperedModel={...empty(),stairs:[taper]};
eraseObjects(taperedModel,{x:190,y:250,width:10,height:10});assert.equal(taperedModel.stairs.length,0);
assert.deepEqual(stairGate({points:[[100,100],[300,100],[250,1100],[150,1100]]},100),[[147.5,1050],[252.5,1050],[250,1100],[150,1100]]);
assert.deepEqual(stairGate({points:[[100,100],[200,100],[200,200],[100,200]]},100),[[100,150],[200,150],[200,200],[100,200]]);
assert.deepEqual(stairGate({x:100,y:100,width:100,height:200,rotation:90},100),[[200,150],[200,250],[250,250],[250,150]]);
console.log("OK: stair transitions occupy only the directed final edge for long, one-cell and legacy rotated stairs.");
console.log("OK: two-phase stair geometry, horizontal/vertical/diagonal anchors, taper limit, degenerate input, matching treads and interior erase.");
{
  const hatch={id:"hatch",kind:"hatch",color:"#535158",points:rectangle([100,100],[200,200])},old={id:"old",x:300,y:100,width:100,height:200,rotation:90};
  assert.deepEqual(stairGate(hatch),hatch.points);assert.equal(stairAt({stairs:[hatch]},[150,150]),hatch);assert.equal(stairAt({stairs:[hatch]},[100,150]),hatch);assert.equal(stairAt({stairs:[hatch]},[99,150]),undefined);
  assert.equal(stairAt({stairs:[old]},[350,200]),old);assert.equal(stairAt({stairs:[{id:"first",...taper},{id:"last",...taper}]},[200,200]).id,"last");
  assert.equal(stairLines({...hatch,kind:"steps"},100,1).length,2);
  globalThis.Path2D=class {moveTo(){}lineTo(){}closePath(){}};
  for(const kind of Object.keys(STAIRS))for(const color of [STAIR_COLOR,"#535158","#ece7dc"]){
    const fills=[],ctx=new Proxy({globalAlpha:.2},{get:(target,key)=>key==="fill"?()=>fills.push([target.fillStyle,target.globalAlpha]):key in target?target[key]:()=>{}});
    drawStair(ctx,{...hatch,kind,color,target:"second"});assert.deepEqual(fills[0],[color,1]);
  }
  const erased={...empty(),stairs:[hatch]};eraseObjects(erased,{x:145,y:145,width:10,height:10});assert.equal(erased.stairs.length,0);
  delete globalThis.Path2D;
}
console.log("OK: four floor-transition designs have opaque selected colors; hatch uses its full footprint, stairs retain edge gates; pointer handles taper/rotation/edges/topmost and area deletion.");
const circle=ellipse([20,20],[120,120]);
assert.equal(circle.length,40);
assert.equal(combine([],brush([[10,100],[100,130],[170,140]],12)).length,1);
assert.throws(()=>generate({width:6000,height:6000,size:100,seed:"x",mode:"rooms",count:NaN}),/от 1 до 40/);
for(const mode of ["rooms","loop","cave"]){
  const settings={width:3600,height:3600,size:60,seed:"marker",mode,count:40};
  const first=generate(settings);
  assert(first.length);
  assert.deepEqual(first,generate(settings));
  assert.notDeepEqual(first,generate({...settings,seed:"new"}));
}
const docs = new Map();
const mk = (id,data) => ({id, getFlag:(_,key)=>data.flags?.[ID]?.[key],toObject:()=>data,clone:fields=>mk(id,{...data,...fields})});
docs.set("manual",mk("manual",{c:[0,0,100,100]}));
docs.set("other",mk("other",{flags:{[ID]:{key:"a",level:"B"}}}));
docs.set("door",mk("door",{flags:{[ID]:{key:"a",level:"A"}},c:[0,0,10,0],ds:1}));
let newId=0, fail=false;
globalThis.foundry={utils:{diffObject:(a,b)=>Object.fromEntries(Object.entries(b).filter(([k,v])=>JSON.stringify(a[k])!==JSON.stringify(v)))}};
const scene={
  getEmbeddedCollection:()=>({filter:fn=>[...docs.values()].filter(fn)}),
  createEmbeddedDocuments:async (_,payload)=>{
    const created=payload.map(data=>{const id=String(++newId); const doc=mk(id,data); docs.set(id,doc); return doc;});
    if(fail) throw Error("ack lost");
    return created;
  },
  updateEmbeddedDocuments:async (_,payload)=>payload.map(({_id,...data})=>{const doc=mk(_id,{...docs.get(_id).toObject(),...data});docs.set(_id,doc);return doc;}),
  deleteEmbeddedDocuments:async (_,ids)=>ids.map(id=>docs.delete(id))
};
const desired = new Map([["a",{_id:"future-id",c:[0,0,10,0]}],["b",{_id:"new-id",c:[0,0,0,10]}]]);
fail=true;
await assert.rejects(reconcile(scene,"Wall","A",desired),/ack lost/);
fail=false;
await reconcile(scene,"Wall","A",desired);
assert.equal(newId,1);
assert.equal(docs.get("door").toObject().ds,1);
await reconcile(scene,"Wall","A",new Map());
assert.deepEqual([...docs.keys()],["manual","other"]);
docs.set("lamp",mk("lamp",{flags:{[ID]:{key:"lamp",level:"A"}},hidden:true,x:10,y:20,config:{bright:15,dim:30}}));
await reconcile(scene,"AmbientLight","A",new Map([["lamp",{_id:"lamp",x:30,y:40,config:{bright:20,dim:40}}]]));
assert.equal(docs.get("lamp").toObject().hidden,true);assert.equal(docs.get("lamp").toObject().config.bright,20);
console.log("OK: union, holes, brush, door splitting, region erase, deterministic generators, native document reconciliation after lost ack.");
let prompts=0;
const enter="tokenMoveIn", exit="tokenExit";
globalThis.CONST={REGION_EVENTS:{TOKEN_MOVE_IN:enter,TOKEN_EXIT:exit}};
class Native {static events={[enter]:async()=>{prompts++;},[exit]:async()=>{}};}
globalThis.CONFIG={RegionBehavior:{dataModels:{changeLevel:Native}}};
installStairGuard();
const handlers=CONFIG.RegionBehavior.dataModels.changeLevel.events;
const stair={getFlag:()=>"floor"}, second={getFlag:()=>"other"}, foreign={getFlag:()=>undefined};
const token={regions:new Set([stair,second])};
const event={user:{isSelf:true},data:{token,movement:{passed:{waypoints:[{action:"walk"}]}}}};
await Promise.all([handlers[enter].call({region:stair},event),handlers[enter].call({region:second},event)]);
assert.equal(prompts,1);
token.regions.delete(stair);await handlers[exit].call({region:stair},event);
await handlers[enter].call({region:second},event);assert.equal(prompts,1);
token.regions.clear();await handlers[exit].call({region:second},event);
token.regions.add(stair);await handlers[enter].call({region:stair},event);assert.equal(prompts,2);
await handlers[enter].call({region:foreign},event);assert.equal(prompts,3);
token.regions=new Set([{getFlag:(_,key)=>key==="key"?SURFACE_KEY:"floor"}]);await handlers[exit].call({region:stair},event);await handlers[enter].call({region:stair},event);assert.equal(prompts,4);
console.log("OK: free doors, matching wall cut, rotated stairs/erase, one stair prompt per visit across overlapping regions; foreign regions keep native behavior.");

globalThis.game={user:{isGM:true},users:{activeGM:{isSelf:true}},settings:{get:()=>({})}};
Object.assign(CONST,{EDGE_SENSE_TYPES:{NONE:0,NORMAL:20,PROXIMITY:30},WALL_DOOR_TYPES:{NONE:0,DOOR:1,SECRET:2}});
foundry.utils.randomID=()=>`clear-${++newId}`;
for (const originalBackground of [null,"original.png"]) {
  let state={version:1,rev:3,mode:"tile",asset:"old-tile.png",beforeBackground:"older-unrelated.png",model:empty(),
    pending:{mode:"background",asset:"half-published.png",beforeBackground:originalBackground,model:{...empty(),stairs:[{target:"deleted-level"}]}}};
  const collections=Object.fromEntries(["Wall","AmbientLight","Region","Tile"].map(type=>[type,new Map([
    ["own",mk("own",{flags:{[ID]:{level:"A",key:"leftover"}}})],
    ["manual",mk("manual",{})],["other",mk("other",{flags:{[ID]:{level:"B",key:"preserve"}}})]
  ])]));
  const level={id:"A",background:{src:"half-published.png"},update:async data=>{level.background.src=data["background.src"];}};
  let loseAck=true;
  const clearingScene={levels:new Map([["A",level]]),getDimensions:()=>({sceneX:0,sceneY:0,sceneWidth:1000,sceneHeight:1000,size:100}),
    getFlag:()=>state,setFlag:async(_,__,value)=>{state=structuredClone(value);},
    getEmbeddedCollection:type=>[...collections[type].values()],
    createEmbeddedDocuments:async()=>{throw Error("Clear must never create geometry");},
    updateEmbeddedDocuments:async()=>{throw Error("Clear must never update foreign geometry");},
    deleteEmbeddedDocuments:async(type,ids)=>{ids.forEach(id=>collections[type].delete(id));if(type==="AmbientLight" && loseAck){loseAck=false;throw Error("delete ack lost");}}
  };
  await assert.rejects(publish(clearingScene,level,empty(),2,"tile",{clear:true}),/Карта уже изменена/);
  assert(collections.Wall.has("own"));
  await assert.rejects(publish(clearingScene,level,empty(),3,"tile",{clear:true}),/delete ack lost/);
  assert.deepEqual(state.pending.model,empty());
  assert.equal(state.pending.previousBackground,"half-published.png");
  assert.equal(level.background.src,"half-published.png");
  const originalDimensions=clearingScene.getDimensions;
  clearingScene.getDimensions=()=>({...originalDimensions(),size:200});
  await assert.rejects(publish(clearingScene,level,empty(),3,"tile"),/сетка/);
  assert(collections.Region.has("own"));
  clearingScene.getDimensions=originalDimensions;
  const cleared=await publish(clearingScene,level,empty(),3,"tile",{clear:originalBackground===null});
  assert.equal(cleared.rev,4);assert.equal(cleared.pending,null);assert.deepEqual(cleared.model,empty());
  assert.equal(level.background.src,originalBackground);
  for (const docs of Object.values(collections)) assert.deepEqual([...docs.keys()],["manual","other"]);
}
console.log("OK: clear replaces abandoned publication, removes orphan walls/light/regions/tiles, preserves foreign/other-level objects, rejects stale revisions, restores partial backgrounds after lost delete acknowledgement.");
{
  let state={version:1,rev:0,mode:"tile",model:empty(),pending:null},editDuringSave=true,loseFinalAck=true;
  const level={id:"A",background:{src:null}};
  const draft={rev:0,model:{...empty(),style:"blue"},dirty:true,undo:[empty()]};
  const scene={levels:new Map([["A",level]]),getDimensions:()=>({sceneX:0,sceneY:0,sceneWidth:1000,sceneHeight:1000,size:100}),getFlag:()=>state,
    getEmbeddedCollection:()=>[],setFlag:async(_,__,value)=>{
      state=structuredClone(value);
      if(value.pending&&editDuringSave){editDuringSave=false;draft.model={...draft.model,style:"cave"};}
      if(!value.pending&&loseFinalAck){loseFinalAck=false;throw Error("final ack lost");}
    }};
  await publishDraft(scene,level,draft);
  assert.equal(state.model.style,"blue");assert.equal(draft.model.style,"cave");assert.equal(draft.rev,1);assert(draft.dirty);assert.equal(draft.undo.length,1);
  await publishDraft(scene,level,draft);assert.equal(state.model.style,"cave");assert.equal(draft.rev,2);assert.equal(draft.dirty,false);
  state={...state,pending:{mode:"tile",model:{...empty(),stairs:[{target:"deleted"}]}}};draft.clear=true;draft.model=empty();draft.dirty=true;
  await publishDraft(scene,level,draft);assert.equal(draft.clear,false);assert.equal(draft.dirty,false);assert.deepEqual(state.model,empty());
  state={...state,rev:4};await assert.rejects(publishDraft(scene,level,draft),/Карта уже изменена/);
}
console.log("OK: autosave retains edits and undo history made during publication, resolves lost final acknowledgement, saves the next snapshot and rejects stale revisions.");
{
  const modules=new Map([[ID,{socket:false}],["socketlib",{active:true,version:"v1.1.4"}]]);
  globalThis.game={modules}; // socketlib.ready fires before the User collection is initialized.
  globalThis.foundry={utils:{isNewerVersion:(a,b)=>a.localeCompare(b,undefined,{numeric:true})>0}};
  const manifest=JSON.parse(await readFile(new URL("../module.json",import.meta.url),"utf8"));
  assert.deepEqual(manifest.relationships.requires??[],[]);
  assert.deepEqual(manifest.relationships.recommends.map(r=>r.id),["socketlib","mjl-campaign-journal","ag-fifthpendium"]);
  modules.get("socketlib").active=false;
  assert.match(containerConnectionIssue(),/действий игрока/);
  assert.equal(connectContainers(),null);
  modules.get("socketlib").active=true;
  const api={mapLocations(){},prepareMapLocation(){},openMapLocation(){}};
  assert.equal(chronicleMap(),undefined);
  modules.set("mjl-campaign-journal",{active:false,version:"1.3.6",api});
  assert.equal(chronicleMap(),undefined);
  modules.set("mjl-campaign-journal",{active:true,version:"1.3.5",api});
  assert.equal(chronicleMap(),undefined);
  modules.set("mjl-campaign-journal",{active:true,version:"1.3.6",api:{prepareMapLocation(){}}});
  assert.equal(chronicleMap(),undefined);
  modules.get("mjl-campaign-journal").api=api;
  assert.equal(chronicleMap(),api);
  globalThis.socketlib={registerModule:()=>{throw Error("Must not register a stale manifest");}};
  assert.match(containerConnectionIssue(),/старый манифест/);
  assert.equal(connectContainers(),null);
  modules.get(ID).socket=true;
  globalThis.socketlib=undefined;assert.match(containerConnectionIssue(),/инициализацию/);assert.equal(connectContainers(),null);
  globalThis.socketlib={registerModule:()=>undefined};assert.equal(connectContainers(),null);
  modules.get("socketlib").version="v1.0.0";assert.match(containerConnectionIssue(),/версия: 1.0.0/);
  modules.get("socketlib").version="v1.1.4";
  let registered=0;
  const connection={register:(name,handler)=>{assert(["containerView","containerTake","lightSwitch"].includes(name));assert.equal(typeof handler,"function");registered++;}};
  globalThis.socketlib={registerModule:()=>connection};
  assert.equal(connectContainers(),connection);assert.equal(connectContainers(),connection);assert.equal(registered,3);
}
console.log("OK: centered container markers across rotations/scales/scene offsets; socket setup before User initialization, stale manifest, delayed library, refused registration and idempotent retry.");
