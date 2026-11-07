import {ID} from "./model.mjs";

export const COINS={pp:"ПМ",gp:"ЗМ",ep:"ЭМ",sp:"СМ",cp:"ММ"};
export const PHYSICAL=new Set(["weapon","equipment","consumable","tool","loot","container"]);
export function currency(value={}) {
  const coins=Object.fromEntries(Object.keys(COINS).map(k=>[k,value?.[k]??0]));
  if(Object.values(coins).some(n=>!Number.isSafeInteger(n)||n<0))throw Error("Недопустимое количество монет.");
  return coins;
}
const sameCoins=(a,b)=>Object.keys(COINS).every(k=>a[k]===b[k]);
let tail=Promise.resolve();
// ponytail: one active GM and one world-wide inventory queue; split by container only if contention matters.
export function queueInventory(task) {const result=tail.then(task);tail=result.catch(()=>{});return result;}

const signature=r=>JSON.stringify([r.kind,r.index??null,r.uuid??null,r.quantity??null]);
const wizard=system=>system.identifier==="spell-scroll"&&!Object.keys(system.activities??{}).length ||
  Object.values(system.activities??{}).sort((a,b)=>(a.sort??0)-(b.sort??0))[0]?.type==="enchant"&&system.description?.value?.includes("@Embed[Compendium.ag-fifthpendium.dmg.JournalEntry.dmgFoundryRefere.JournalEntryPage.Ok4iCgD25ENgoRxE");

async function itemTree(root) {
  const nodes=[],seen=new Set(),todo=[{item:root,parent:null,depth:0}];
  while(todo.length){
    const node=todo.shift();
    if(seen.has(node.item.uuid))throw Error("Внутри предмета обнаружена циклическая ссылка.");
    seen.add(node.item.uuid);
    if(!PHYSICAL.has(node.item.type))throw Error(`«${node.item.name}» не относится к снаряжению.`);
    nodes.push(node);
    if(nodes.length>1000)throw Error("В одном предмете слишком много вложенных вещей. Разберите его на части.");
    if(node.item.type!=="container")continue;
    for(const item of [...(await node.item.system.contents)?.values()??[]]){
      if(item.system.container!==node.item.id)throw Error("Вложенность исходного предмета изменилась.");
      todo.push({item,parent:node.item.id,depth:node.depth+1});
    }
  }
  return nodes;
}

function itemData(item,quantity,id,parent,operation) {
  const data=item.toObject(),origin=item.pack?item.uuid:data._stats?.compendiumSource;
  delete data.folder;delete data.ownership;delete data._stats;
  data._id=id;data.system.quantity=quantity;data.system.container=parent;
  if("equipped" in data.system)data.system.equipped=false;
  if("attuned" in data.system)data.system.attuned=false;
  data.flags??={};data.flags[ID]={lootTransfer:operation};
  if(origin)data._stats={compendiumSource:origin};
  return data;
}

async function prepareItems(record,request,actor) {
  const selection=request.kind==="items"?record.items.map((item,index)=>({item,index,count:item.quantity})):
    [{item:record.items[request.index],index:request.index,count:request.quantity}];
  if(!selection.length)throw Error("В контейнере нет вещей.");
  const entries=[],after=structuredClone(record),used=new Set(actor.items.keys());
  for(const {item,index,count} of selection){
    if(!item||!Number.isSafeInteger(count)||count<1||count>item.quantity || request.kind==="item"&&item.uuid!==request.uuid)throw Error("Предмет или количество изменились. Обновите контейнер.");
    const source=await fromUuid(item.uuid);
    if(source?.documentName!=="Item")throw Error(`Не найден исходный предмет «${item.name}». Содержимое сохранено.`);
    const tree=await itemTree(source),copies=source.type==="container"?count:1;
    if(copies>50)throw Error("За одну передачу можно забрать до 50 экземпляров вложенного контейнера.");
    for(let copy=0;copy<copies;copy++){
      const ids=new Map(tree.map(({item})=>[item.id,foundry.utils.randomID()]));
      for(const node of tree){
        const id=ids.get(node.item.id),quantity=node.item.type==="container"?1:node.depth?node.item.system.quantity:count;
        if(used.has(id)||!Number.isSafeInteger(quantity)||quantity<0)throw Error("Не удалось подготовить уникальные предметы.");
        used.add(id);
        const data=itemData(node.item,quantity,id,node.parent?ids.get(node.parent):null,request.operation);
        entries.push({data,depth:node.depth,noHook:!!game.modules?.get("ag-fifthpendium")?.active&&!!wizard(data.system)});
        if(entries.length>1000)throw Error("За одну передачу доступно до 1000 документов предметов. Заберите вещи частями.");
      }
    }
    after.items[index].quantity-=count;
  }
  after.items=after.items.filter(i=>i.quantity>0);
  return {entries,after};
}

function confirm(item,entry,operation) {
  const data=entry.data;
  if(!item||item.id!==data._id||item.getFlag(ID,"lootTransfer")!==operation||item.system.quantity!==data.system.quantity||(item.system.container??null)!==data.system.container)
    throw Error("Предмет не подтверждён или изменён после выдачи. Передача сохранена для проверки мастером.");
}

export async function transferLoot(store,request,actor,user,key,access=()=>{}) {
  if(!game.users.activeGM?.isSelf)throw Error("Передачу выполняет активный мастер.");
  if(game.system.id!=="dnd5e"||!["character","npc"].includes(actor.type))throw Error("Выдача снаряжения и монет поддерживается для персонажей и существ dnd5e.");
  if(!/^[A-Za-z0-9]{16}$/.test(request.operation??"")||!["money","items","item"].includes(request.kind)||!Number.isSafeInteger(request.rev)||request.rev<0)throw Error("Некорректная передача.");
  if(request.actor!==actor.uuid)throw Error("Лист получателя должен принадлежать выбранному токену рядом с контейнером.");
  if(request.kind==="item"&&(!Number.isSafeInteger(request.index)||request.index<0||typeof request.uuid!=="string"||request.uuid.length>512||!Number.isSafeInteger(request.quantity)||request.quantity<1))throw Error("Некорректное количество предметов.");
  let state=store.getFlag(ID,"data");
  const receipt=state.receipts?.find(r=>r.id===request.operation);
  if(receipt){
    if(receipt.key!==key||receipt.actor!==actor.uuid||receipt.signature!==signature(request)||receipt.user!==user.id&&!user.isGM)throw Error("Этот ID передачи уже использован.");
    return;
  }
  let op=state.pending;
  if(op){
    if(op.id!==request.operation)throw Error("Есть незавершённая выдача. Сначала продолжите её тем же персонажем.");
    if(op.key!==key||op.actor!==actor.uuid||op.signature!==signature(request)||op.user!==user.id&&!user.isGM)throw Error("Эту передачу должен продолжить её получатель или мастер.");
  }else{
    const record=state.containers[key]??{rev:0,items:[],currency:currency()};
    if(record.rev!==request.rev)throw Error("Содержимое уже изменилось. Список обновлён; повторите действие.");
    op={id:request.operation,key,user:user.id,actor:actor.uuid,actorName:actor.name,signature:signature(request),request:structuredClone(request),before:record.rev,attempted:[]};
    if(request.kind==="money"){
      if(!actor.system.currency||Object.keys(COINS).some(k=>typeof actor.system.currency[k]!=="number"))throw Error("У получателя нет поддерживаемого кошелька dnd5e.");
      const amount=currency(record.currency);
      if(!Object.values(amount).some(Boolean))throw Error("В контейнере нет монет.");
      const before=currency(actor.system.currency),after=currency(Object.fromEntries(Object.keys(COINS).map(k=>[k,before[k]+amount[k]])));
      op.wallet={before,after};op.after={...structuredClone(record),currency:currency()};
    }else Object.assign(op,await prepareItems(record,request,actor));
    op.after.rev=record.rev+1;
    access();
    // Persist the reservation and stable destination IDs before touching the character.
    await store.setFlag(ID,"data",{...state,pending:op});
    if(store.getFlag(ID,"data").pending?.id!==op.id)throw Error("Не удалось зарезервировать содержимое контейнера.");
  }
  if(op.wallet){
    if(actor.getFlag(ID,"lootCredit")!==op.id){
      access();
      if(!sameCoins(currency(actor.system.currency),op.wallet.before))throw Error("Кошелёк персонажа изменился во время передачи. Нужна проверка мастера.");
      await actor.update({"system.currency":op.wallet.after,[`flags.${ID}.lootCredit`]:op.id});
      if(actor.getFlag(ID,"lootCredit")!==op.id||!sameCoins(currency(actor.system.currency),op.wallet.after))throw Error("Foundry не подтвердил монеты. Повторите ту же передачу.");
    }
  }else{
    for(const entry of op.entries){
      const item=actor.items.get(entry.data._id);
      if(item)confirm(item,entry,op.id);
      else if(op.attempted.includes(entry.data._id))throw Error("Начатая выдача не найдена в инвентаре. Автоматический повтор остановлен; мастер должен проверить предметы.");
    }
    for(const depth of [...new Set(op.entries.map(e=>e.depth))].sort((a,b)=>a-b))for(const noHook of [false,true]){
      const batch=op.entries.filter(e=>e.depth===depth&&e.noHook===noHook&&!actor.items.has(e.data._id));
      if(!batch.length)continue;
      access();
      op={...op,attempted:[...op.attempted,...batch.map(e=>e.data._id)]};
      state=store.getFlag(ID,"data");
      if(state.pending?.id!==op.id)throw Error("Журнал выдачи изменился.");
      await store.setFlag(ID,"data",{...state,pending:op});
      if(batch.some(e=>!store.getFlag(ID,"data").pending?.attempted.includes(e.data._id)))throw Error("Не удалось сохранить начало выдачи. Повторите действие.");
      if(!game.users.activeGM?.isSelf)throw Error("Сменился активный мастер. Продолжите выдачу у нового мастера.");
      await actor.createEmbeddedDocuments("Item",batch.map(e=>e.data),{keepId:true,...(noHook&&{noHook:true})});
      for(const entry of batch)confirm(actor.items.get(entry.data._id),entry,op.id);
    }
  }
  state=store.getFlag(ID,"data");
  if(!state.pending&&state.receipts?.some(r=>r.id===op.id))return;
  if(state.pending?.id!==op.id||state.containers[key]?.rev!==op.before)throw Error("Контейнер изменился во время выдачи. Нужна проверка мастера.");
  await store.setFlag(ID,"data",{...state,containers:{...state.containers,[key]:op.after},pending:null,
    receipts:[...(state.receipts??[]),{id:op.id,key,user:op.user,actor:op.actor,signature:op.signature,time:Date.now()}].slice(-100)});
  const done=store.getFlag(ID,"data");
  if(done.pending||!done.receipts?.some(r=>r.id===op.id))throw Error("Выдача выполнена; повторите запрос для подтверждения списания.");
}
