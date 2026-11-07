import {ID,stairOutline} from "./model.mjs";

export const TRAPS={
  pit:{name:"Яма",icon:"fa-square",width:2,height:2},
  spikes:{name:"Шипы",icon:"fa-caret-up",width:2,height:2},
  bearTrap:{name:"Капкан",icon:"fa-teeth",width:1,height:1},
  tripwire:{name:"Растяжка",icon:"fa-grip-lines",width:3,height:.5},
  pressurePlate:{name:"Нажимная плита",icon:"fa-border-all",width:1,height:1},
  runeTrap:{name:"Магическая руна",icon:"fa-star",width:1,height:1}
};
export const trapHidden=trap=>trap.hidden!==false;
export function trapMarkerPoint(trap,{sceneX=0,sceneY=0}) {
  const ring=stairOutline(trap);
  return {x:sceneX+Math.max(...ring.map(p=>p[0]))+18,y:sceneY+Math.min(...ring.map(p=>p[1]))-18};
}
export function trapTile(trap,{x=0,y=0,level,elevation=0,asset}) {
  return {name:trap.name||TRAPS[trap.kind].name,texture:{src:asset,anchorX:.5,anchorY:.5},x:Math.round(x+trap.x+trap.width/2),y:Math.round(y+trap.y+trap.height/2),width:Math.round(trap.width),height:Math.round(trap.height),
    rotation:trap.rotation??0,levels:[level],elevation,sort:100000,locked:true,hidden:trapHidden(trap)};
}

export function drawTrap(ctx,f) {
  if(!TRAPS[f.kind])return;
  const color=f.color??"#9b7351",ink="#342d2b",metal="#c5bdb0";
  ctx.save();ctx.translate(f.x+f.width/2,f.y+f.height/2);ctx.rotate((f.rotation??0)*Math.PI/180);ctx.scale(f.width/(f.kind==="tripwire"?300:100),f.height/(f.kind==="tripwire"?50:100));
  ctx.lineJoin=ctx.lineCap="round";ctx.lineWidth=3;ctx.strokeStyle=ink;ctx.fillStyle=color;
  const line=(a,b)=>{ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();};
  const poly=(points,fill=true)=>{ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.closePath();if(fill)ctx.fill();ctx.stroke();};
  const circle=(x,y,r,fill=true)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill)ctx.fill();ctx.stroke();};
  if(f.kind==="pit"||f.kind==="spikes"){
    ctx.fillRect(-47,-47,94,94);ctx.strokeRect(-47,-47,94,94);ctx.fillStyle="#29272c";ctx.fillRect(-38,-38,76,76);ctx.strokeRect(-38,-38,76,76);
    ctx.strokeStyle="#72675e";for(let i=0;i<4;i++){line([-44+i*23,-47],[-44+i*23,-38]);line([-47,-44+i*23],[-38,-44+i*23]);}
    if(f.kind==="spikes"){ctx.fillStyle=metal;ctx.strokeStyle=ink;for(const x of [-24,0,24])for(const y of [-20,6,30])poly([[x-8,y+6],[x+1,y-14],[x+9,y+6]]);}
    else {ctx.strokeStyle="#625a58";line([-26,-22],[-31,22]);line([-23,28],[21,32]);}
  }else if(f.kind==="bearTrap"){
    ctx.fillStyle=color;circle(0,0,35);ctx.fillStyle="#383235";circle(0,0,24);
    ctx.fillStyle=metal;for(let i=0;i<12;i++){const a=i*Math.PI/6,p=(r,o=0)=>[Math.cos(a+o)*r,Math.sin(a+o)*r];poly([p(40,-.15),p(24),p(40,.15)]);}
    ctx.fillStyle=color;ctx.fillRect(-8,-11,16,22);ctx.strokeRect(-8,-11,16,22);ctx.lineWidth=4;line([30,29],[47,43]);circle(48,44,5,false);
  }else if(f.kind==="tripwire"){
    ctx.lineWidth=3;ctx.strokeStyle=metal;line([-140,0],[140,0]);ctx.strokeStyle=ink;ctx.lineWidth=1.5;line([-140,3],[140,3]);
    ctx.fillStyle=color;for(const x of [-142,142]){ctx.fillRect(x-4,-20,8,40);ctx.strokeRect(x-4,-20,8,40);}ctx.fillStyle="#c6a15c";poly([[-5,-10],[5,0],[-5,10]]);
  }else if(f.kind==="pressurePlate"){
    ctx.fillRect(-43,-43,86,86);ctx.strokeRect(-43,-43,86,86);ctx.strokeRect(-32,-32,64,64);
    ctx.fillStyle=metal;for(const x of [-36,36])for(const y of [-36,36])circle(x,y,3);ctx.fillStyle=color;poly([[0,-19],[19,0],[0,19],[-19,0]],false);
    ctx.strokeStyle="#ddd0b8";line([-23,-24],[24,-24]);
  }else{
    ctx.strokeStyle=color;ctx.lineWidth=4;circle(0,0,42,false);circle(0,0,33,false);
    const points=Array.from({length:5},(_,i)=>{const a=-Math.PI/2+i*Math.PI*4/5;return [Math.cos(a)*29,Math.sin(a)*29];});poly(points,false);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;line([Math.cos(a)*35,Math.sin(a)*35],[Math.cos(a)*40,Math.sin(a)*40]);}
    ctx.fillStyle=color;circle(0,0,5);
  }
  ctx.restore();
}

let markerRoot,markerKey,markerFrame,installed=false;
export function refreshTrapMarkers() {
  if(!game.user?.isGM)return;
  if(markerFrame)return;
  markerFrame=requestAnimationFrame(async()=>{
    markerFrame=null;if(!canvas.ready||!canvas.level||!canvas.controls)return;
    const scene=canvas.scene,level=canvas.level.id,model=canvas.dungeonSketch?.trapModel?.()??scene.getFlag(ID,level)?.model;
    const traps=model?.traps??[],key=`${scene.id}:${level}:${JSON.stringify(traps)}`;
    if(!markerRoot||markerRoot.destroyed){markerRoot=canvas.controls.addChild(new PIXI.Container());markerRoot.name="mds-traps";markerKey=null;}
    if(markerKey===key)return;
    markerKey=key;for(const child of markerRoot.removeChildren())child.destroy({children:true});
    for(const trap of traps){
      const hidden=trapHidden(trap),icon=new foundry.canvas.containers.ControlIcon({texture:hidden?"icons/svg/trap.svg":"icons/svg/eye.svg",size:32,tint:hidden?0xffd08a:0xa5edba,borderColor:hidden?0xe3b56c:0x82c697});
      icon.name=`trap:${trap.id}`;icon.trapId=trap.id;const at=trapMarkerPoint(trap,scene.getDimensions());icon.position.set(at.x,at.y);
      const label=`${trap.name||TRAPS[trap.kind]?.name||"Ловушка"} · ${hidden?"скрыта · нажмите, чтобы показать":"видна игрокам · нажмите, чтобы скрыть"}`;
      icon.on("pointerover",()=>{icon.border.visible=true;icon.tooltip.text=label;icon.tooltip.visible=true;});
      icon.on("pointerout",()=>{icon.border.visible=false;icon.tooltip.visible=false;});
      icon.on("pointerdown",event=>{if(event.button!==0)return;event.stopPropagation();if(canvas.scene?.id!==scene.id||canvas.level?.id!==level)return;Promise.resolve().then(()=>canvas.dungeonSketch.toggleTrap(trap.id)).catch(error=>ui.notifications.warn(error.message));});
      markerRoot.addChild(icon);await icon.draw();if(icon.destroyed||markerKey!==key)return;icon.border.visible=false;icon.bg.tint=hidden?0x5b4030:0x234633;
    }
  });
}
export function installTrapInteraction() {
  refreshTrapMarkers();if(installed)return;installed=true;
  for(const hook of ["updateScene","canvasReady"])Hooks.on(hook,refreshTrapMarkers);
  Hooks.on("canvasTearDown",()=>{markerKey=null;});
}
