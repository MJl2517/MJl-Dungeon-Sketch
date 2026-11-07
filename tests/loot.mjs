import assert from "node:assert/strict";
import {ID} from "../scripts/model.mjs";
import {currency,queueInventory,transferLoot} from "../scripts/loot.mjs";
let sequence=0;
const random=()=>String(++sequence).padStart(16,"0"),sources=new Map();
globalThis.foundry={utils:{randomID:random}};
globalThis.game={users:{activeGM:{isSelf:true}},system:{id:"dnd5e"},modules:new Map()};
globalThis.fromUuid=async uuid=>sources.get(uuid);
const source=(type="loot",quantity=1)=>{
  const id=random(),item={id,uuid:`Item.${id}`,documentName:"Item",name:`Item ${id}`,type,system:{quantity,container:null},pack:null};
  item.toObject=()=>({name:item.name,type,system:Object.fromEntries(Object.entries(item.system).filter(([k])=>k!=="contents")),flags:{}});
  sources.set(item.uuid,item);return item;
};
class Store {
  constructor(record){this.state={version:1,containers:{scene_level_box:structuredClone(record)}};this.writes=0;}
  getFlag(){return this.state;}
  async setFlag(_scope,_key,data){this.state=structuredClone(data);this.writes++;if(this.loseCommit&&!data.pending){this.loseCommit=false;throw Error("commit ack lost");}}
}
class Actor {
  constructor(){this.uuid=`Actor.${random()}`;this.name="Hero";this.type="character";this.items=new Map();this.system={currency:currency({gp:10})};this.flags={};this.creates=0;this.updates=0;this.options=[];}
  getFlag(_scope,key){return this.flags[key];}
  async update(data){this.system.currency=structuredClone(data["system.currency"]);this.flags.lootCredit=data[`flags.${ID}.lootCredit`];this.updates++;if(this.loseMoney){this.loseMoney=false;throw Error("wallet ack lost");}}
  async createEmbeddedDocuments(_type,data,options){
    this.creates++;this.options.push(options);
    for(const entry of data){const item=structuredClone(entry);item.id=entry._id;item.getFlag=(scope,key)=>item.flags[scope][key];this.items.set(item.id,item);}
    if(this.loseItems){this.loseItems=false;throw Error("item ack lost");}
    return data.map(d=>this.items.get(d._id));
  }
}
const user={id:"player",isGM:false},key="scene_level_box";
const request=(actor,kind,rev=1)=>({scene:"scene",level:"level",id:"box",token:"token",actor:actor.uuid,operation:random(),rev,kind});
const row=(item,quantity)=>({uuid:item.uuid,name:item.name,quantity});

{
 const actor=new Actor(),store=new Store({rev:1,items:[],currency:{gp:7,sp:3}}),r=request(actor,"money");actor.loseMoney=true;
 await assert.rejects(transferLoot(store,r,actor,user,key),/ack lost/);assert(store.state.pending);assert.equal(actor.system.currency.gp,17);
 await transferLoot(store,r,actor,user,key);await transferLoot(store,r,actor,user,key);
 assert.equal(actor.updates,1);assert.equal(store.state.pending,null);assert.equal(store.state.containers[key].currency.gp,0);assert.equal(actor.system.currency.sp,3);
}
{
 const item=source("equipment",8),actor=new Actor(),store=new Store({rev:1,items:[row(item,3)],currency:{gp:12}}),r=request(actor,"items");actor.loseItems=true;
 await assert.rejects(transferLoot(store,r,actor,user,key),/ack lost/);assert.equal(actor.items.size,1);assert.equal(store.state.containers[key].items[0].quantity,3);
 await transferLoot(store,r,actor,user,key);await transferLoot(store,r,actor,user,key);
 assert.equal(actor.creates,1);assert.equal(actor.items.values().next().value.system.quantity,3);assert.equal(item.system.quantity,8);assert.deepEqual(store.state.containers[key].items,[]);assert.equal(store.state.containers[key].currency.gp,12);
}
{
 const item=source(),actor=new Actor(),store=new Store({rev:1,items:[row(item,4)]}),r={...request(actor,"item"),index:0,uuid:item.uuid,quantity:2};store.loseCommit=true;
 await assert.rejects(transferLoot(store,r,actor,user,key),/commit ack lost/);await transferLoot(store,r,actor,user,key);
 assert.equal(actor.creates,1);assert.equal(store.state.containers[key].items[0].quantity,2);
 await assert.rejects(transferLoot(store,{...r,quantity:1},actor,user,key),/ID передачи/);
}
{
 const bag=source("container"),child=source("consumable",4);child.system.container=bag.id;bag.system.contents=new Map([[child.id,child]]);
 const actor=new Actor(),store=new Store({rev:1,items:[row(bag,2)]}),r=request(actor,"items");await transferLoot(store,r,actor,user,key);
 const bags=[...actor.items.values()].filter(i=>i.type==="container"),children=[...actor.items.values()].filter(i=>i.type==="consumable");
 assert.equal(bags.length,2);assert.equal(children.length,2);assert(children.every(i=>i.system.quantity===4&&bags.some(b=>b.id===i.system.container)));
}
{
 const item=source(),actor=new Actor(),store=new Store({rev:1,items:[row(item,1)]}),r=request(actor,"items");actor.loseItems=true;
 await assert.rejects(transferLoot(store,r,actor,user,key));actor.items.clear();await assert.rejects(transferLoot(store,r,actor,user,key),/Автоматический повтор остановлен/);
 assert.equal(actor.creates,1);assert.equal(store.state.containers[key].items.length,1);
}
{
 const item=source(),actor=new Actor(),other=new Actor(),store=new Store({rev:1,items:[row(item,1)]}),a=request(actor,"items"),b=request(other,"items");
 const results=await Promise.allSettled([queueInventory(()=>transferLoot(store,a,actor,user,key)),queueInventory(()=>transferLoot(store,b,other,user,key))]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(actor.items.size+other.items.size,1);
}
{
 const actor=new Actor(),store=new Store({rev:1,items:[{uuid:"Item.missing",name:"Missing",quantity:1}]}),r=request(actor,"items");
 await assert.rejects(transferLoot(store,r,actor,user,key),/Не найден/);assert.equal(store.writes,0);assert.equal(actor.items.size,0);
 await assert.rejects(transferLoot(store,{...r,actor:"Actor.other"},actor,user,key),/Лист получателя/);
 assert.throws(()=>currency({gp:-1}));
 assert.throws(()=>currency({gp:Number.MAX_SAFE_INTEGER+1}));
}
{
 const actor=new Actor(),store=new Store({rev:1,items:[],currency:{gp:1}}),r=request(actor,"money");
 actor.system.currency=currency({gp:Number.MAX_SAFE_INTEGER});await assert.rejects(transferLoot(store,r,actor,user,key));assert.equal(store.writes,0);
 actor.system.currency=undefined;await assert.rejects(transferLoot(store,r,actor,user,key),/кошелька/);assert.equal(store.writes,0);
}
{
 const item=source(),actor=new Actor(),store=new Store({rev:1,items:[row(item,1)]}),r=request(actor,"items");
 await assert.rejects(transferLoot(store,r,actor,user,key,()=>{throw Error("out of range");}),/out of range/);assert.equal(store.writes,0);assert.equal(actor.items.size,0);
}
{
 const item=source("consumable");item.system.identifier="spell-scroll";item.system.activities={};game.modules.set("ag-fifthpendium",{active:true});
 const actor=new Actor(),store=new Store({rev:1,items:[row(item,1)]});await transferLoot(store,request(actor,"items"),actor,user,key);assert.equal(actor.options[0].noHook,true);
}
console.log("OK: item/money withdrawal, partial quantities, nested bags, stale concurrent readers, wrong recipients, missing templates, AG wizard bypass; lost wallet/item/commit acknowledgements are idempotent; externally removed delivery pauses safely.");
