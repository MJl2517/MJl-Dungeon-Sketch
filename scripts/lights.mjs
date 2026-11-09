import {ID,feetPerUnit,reachNorm,tokenReachPosition} from "./model.mjs";

export const LIGHTS={
  light:{name:"Лампа",icon:"fa-lightbulb",bright:15,dim:30,color:"#ffce82",alpha:0.35,size:0.32,animation:null},
  torch:{name:"Факел",icon:"fa-fire-flame-curved",bright:20,dim:40,color:"#ff9a42",alpha:0.4,size:0.3,animation:{type:"torch",speed:4,intensity:3}},
  candle:{name:"Свеча",icon:"fa-fire",bright:5,dim:10,color:"#ffdba0",alpha:0.25,size:0.22,animation:{type:"torch",speed:2,intensity:1}},
  campfire:{name:"Костёр",icon:"fa-fire-burner",bright:20,dim:40,color:"#ff9a42",alpha:0.4,size:0.76,animation:{type:"torch",speed:3,intensity:4}},
  magic:{name:"Магический огонь",icon:"fa-wand-sparkles",bright:20,dim:40,color:"#7fc7ff",alpha:0.3,size:0.32,animation:{type:"pulse",speed:2,intensity:2}},
  crystal:{name:"Кристалл",icon:"fa-gem",bright:10,dim:20,color:"#ba94ff",alpha:0.4,size:0.36,animation:{type:"emanation",speed:1,intensity:2}}
};
export const LIGHT_COLORS=[["Золотой","#ffce82"],["Оранжевый","#ff9a42"],["Свечной","#ffdba0"],["Голубой","#7fc7ff"],["Фиолетовый","#ba94ff"],["Зелёный","#9bea9b"],["Белый","#eef4ff"]];

export function lightSource(kind,at,grid,{scale=1,color,animated=true}={}) {
  const preset=LIGHTS[kind];
  if(!preset)throw Error("Неизвестный источник света.");
  const factor=Math.max(0.25,Math.min(4,Number(scale)||1))/feetPerUnit(grid);
  return {kind,at,bright:Math.round(preset.bright*factor*100)/100,dim:Math.round(preset.dim*factor*100)/100,
    color:color??preset.color,alpha:preset.alpha,animation:structuredClone(animated&&preset.animation?preset.animation:{type:null})};
}
export const lightConfig=light=>({bright:light.bright,dim:light.dim,color:light.color,alpha:light.alpha??0.35,animation:light.animation??{type:null}});
export async function toggleLight(scene,level,id) {
  if(!game.user.isGM)throw Error("Свет переключает мастер.");
  const light=scene.lights.get(id);
  if(!light||light.getFlag(ID,"level")!==level)throw Error("Источник света удалён или находится на другом этаже.");
  await setLightHidden(light,!light.hidden);
}

async function setLightHidden(light,hidden) {
  if(light.hidden!==hidden)await light.update({hidden});
  if(light.hidden!==hidden)throw Error("Foundry не подтвердила переключение света.");
}

export function canReachLight(light,token,user,grid) {
  if(!token?.actor?.testUserPermission(user,"OWNER"))return false;
  const position=tokenReachPosition(token);
  if(position.hidden||position.level!==light.getFlag(ID,"level"))return false;
  const {width,height}=token.getSize(position);
  const dx=Math.max(0,position.x-light.x,light.x-position.x-width);
  const dy=Math.max(0,position.y-light.y,light.y-position.y-height);
  const dz=Math.max(0,position.elevation-light.elevation,light.elevation-position.elevation-(position.depth??1)*grid.distance);
  const unitsPerPixel=grid.distance/grid.size;
  return reachNorm(grid,dx*unitsPerPixel,dy*unitsPerPixel,dz)*feetPerUnit(grid)<=5+1e-6;
}

export async function handleLightSwitch(request,sender) {
  try {
    if(!game.users.activeGM?.isSelf)throw Error("Для переключения света нужен активный мастер.");
    if(!request||typeof request.hidden!=="boolean"||["scene","level","id","token"].some(k=>typeof request[k]!=="string"||request[k].length>64))throw Error("Некорректный запрос.");
    const scene=game.scenes.get(request.scene),user=game.users.get(sender),light=scene?.lights.get(request.id);
    if(!scene?.levels.has(request.level)||!user?.active||user.viewedScene!==scene.id||user.viewedLevel!==request.level)throw Error("Сцена или этаж недоступны.");
    if(!light||light.getFlag(ID,"level")!==request.level)throw Error("Источник света удалён или находится на другом этаже.");
    if(!canReachLight(light,scene.tokens.get(request.token),user,scene.grid))throw Error("Подведите свой токен к светильнику на расстояние до 5 футов.");
    await setLightHidden(light,request.hidden);
    return {ok:true};
  } catch(error) {
    return {ok:false,error:error.message};
  }
}

function nearbyToken(scene,light) {
  return canvas.tokens.controlled.find(token=>canReachLight(light,token.document,game.user,scene.grid));
}

async function clickLight(scene,level,light,requestSwitch) {
  if(game.user.isGM)return toggleLight(scene,level,light.id);
  const token=nearbyToken(scene,light);
  if(!token)throw Error("Подведите свой токен к светильнику на расстояние до 5 футов.");
  await requestSwitch({scene:scene.id,level,id:light.id,token:token.id,hidden:!light.hidden});
}

let markerRoot,markerKey,markerFrame,installed=false;
function refreshLightMarkers(requestSwitch) {
  if(!game.user||markerFrame)return;
  markerFrame=requestAnimationFrame(async()=>{
    markerFrame=null;if(!canvas.ready||!canvas.level||!canvas.controls)return;
    const scene=canvas.scene,level=canvas.level.id;
    const lights=scene.lights.filter(l=>l.getFlag(ID,"level")===level&&(game.user.isGM||nearbyToken(scene,l)));
    const key=`${scene.id}:${level}:${JSON.stringify(lights.map(l=>[l.id,l.x,l.y,l.hidden,l.name]))}`;
    if(!markerRoot||markerRoot.destroyed){markerRoot=canvas.controls.addChild(new PIXI.Container());markerRoot.name="mds-lights";markerKey=null;}
    if(markerKey===key)return;markerKey=key;for(const child of markerRoot.removeChildren())child.destroy({children:true});
    for(const light of lights){
      const off=light.hidden,icon=new foundry.canvas.containers.ControlIcon({texture:off?CONFIG.controlIcons.lightOff:CONFIG.controlIcons.light,size:30,tint:off?0xa6abb0:0xffd48a,borderColor:off?0x7e858d:0xd4b184});
      icon.tooltip.style=Object.assign(CONFIG.canvasTextStyle.clone(),{fontFamily:"system-ui",fontSize:16,strokeThickness:2});
      icon.name=`light:${light.id}`;
      icon.lightId=light.id;
      icon.position.set(light.x,light.y);
      const label=`${light.name||"Источник света"} · свет ${off?"выключен · включить":"включён · выключить"}`;
      icon.on("pointerover",()=>{icon.border.visible=true;icon.tooltip.text=label;icon.tooltip.visible=true;});icon.on("pointerout",()=>{icon.border.visible=false;icon.tooltip.visible=false;});
      let busy=false;
      icon.on("pointerdown",async event=>{
        if(event.button!==0)return;
        event.stopPropagation();
        if(busy||canvas.scene?.id!==scene.id||canvas.level?.id!==level)return;
        busy=true;
        try {await clickLight(scene,level,light,requestSwitch);}
        catch(error) {ui.notifications.warn(error.message);}
        finally {busy=false;}
      });
      markerRoot.addChild(icon);await icon.draw();if(icon.destroyed||markerKey!==key)return;icon.border.visible=false;icon.bg.tint=off?0x30343a:0x584229;
    }
  });
}
export function installLightInteraction(requestSwitch) {
  const refresh=()=>refreshLightMarkers(requestSwitch);
  refresh();if(installed)return;installed=true;
  for(const hook of ["updateScene","canvasReady","createAmbientLight","updateAmbientLight","deleteAmbientLight","updateToken","deleteToken","controlToken"])Hooks.on(hook,refresh);
  Hooks.on("canvasTearDown",()=>{markerKey=null;});
}

export function lightFixture(light,gridSize) {
  const size=gridSize*(LIGHTS[light.kind]?.size??0.3);
  return {kind:light.kind,x:light.at[0]-size/2,y:light.at[1]-size/2,width:size,height:size,rotation:0,color:light.color};
}

export function drawLightFixture(ctx,f) {
  if(!LIGHTS[f.kind])return;
  ctx.save();ctx.translate(f.x+f.width/2,f.y+f.height/2);ctx.scale(f.width/100,f.height/100);
  ctx.lineWidth=5;ctx.lineJoin=ctx.lineCap="round";ctx.strokeStyle="#47352a";
  const disk=(x,y,r,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();};
  const line=(x,y,a,b)=>{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke();};
  const flame=()=>{ctx.fillStyle=f.color;ctx.beginPath();ctx.moveTo(0,-42);ctx.bezierCurveTo(35,-8,23,20,0,20);ctx.bezierCurveTo(-28,16,-23,-13,0,-42);ctx.fill();ctx.stroke();ctx.fillStyle="#fff3cd";ctx.beginPath();ctx.ellipse(0,2,7,12,0,0,Math.PI*2);ctx.fill();};
  if(f.kind==="light"){
    disk(0,0,34,"#b18b54");disk(0,0,24,f.color);ctx.strokeStyle="#6b512f";
    line(-24,-24,24,24);line(24,-24,-24,24);disk(0,0,8,"#fff6ce");
  }else if(f.kind==="torch"){
    ctx.fillStyle="#805337";ctx.fillRect(-9,8,18,37);ctx.strokeRect(-9,8,18,37);flame();
  }else if(f.kind==="candle"){
    disk(0,8,32,"#c49b59");disk(0,5,20,"#f2e6cb");ctx.save();ctx.translate(0,-6);ctx.scale(0.55,0.65);flame();ctx.restore();
  }else if(f.kind==="campfire"){
    disk(0,0,36,"#41312c");
    for(let i=0;i<9;i++){
      const a=i*2*Math.PI/9;
      disk(Math.cos(a)*37,Math.sin(a)*37,8+(i%3),["#8d8170","#a79885","#716a61"][i%3]);
    }
    ctx.lineWidth=15;line(-21,-12,21,17);line(21,-12,-21,17);
    ctx.strokeStyle="#a2714a";ctx.lineWidth=9;line(-21,-12,21,17);line(21,-12,-21,17);
    ctx.strokeStyle="#47352a";ctx.lineWidth=5;
    ctx.save();ctx.translate(0,-5);ctx.scale(.76,.8);flame();ctx.restore();
  }else if(f.kind==="magic"){
    disk(0,0,25,f.color);ctx.strokeStyle="#e5f7ff";ctx.lineWidth=3;
    for(const [x,y] of [[0,-43],[43,0],[0,43],[-43,0]])line(x*0.75,y*0.75,x,y);
    disk(-7,-7,6,"#edfaff");
  }else{
    disk(0,17,29,"#827689");ctx.fillStyle=f.color;ctx.beginPath();ctx.moveTo(0,-43);ctx.lineTo(24,-12);ctx.lineTo(20,25);ctx.lineTo(0,38);ctx.lineTo(-20,25);ctx.lineTo(-24,-12);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle="#eee3ff";ctx.lineWidth=3;line(0,-38,8,-8);line(8,-8,0,32);line(8,-8,22,-12);
  }
  ctx.restore();
}
