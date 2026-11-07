import {ID} from "./model.mjs";

const CHRONICLE="mjl-campaign-journal";
export function chronicleMap(){
  const chronicle=game.modules.get(CHRONICLE);
  if(!chronicle?.active||!chronicle.version||foundry.utils.isNewerVersion("1.3.6",chronicle.version))return;
  const api=chronicle.api;
  if(typeof api?.mapLocations==="function"&&typeof api.prepareMapLocation==="function"&&typeof api.openMapLocation==="function")return api;
}

const selectEntries=(entries,description)=>entries.map(entry=>{
  const escape=foundry.utils.escapeHTML;
  return `<option value="${escape(entry.id)}">${escape(description(entry))}</option>`;
}).join("");

async function journalPoint(title){
  const journals=game.journal.filter(journal=>!journal.flags?.[CHRONICLE]?.entry)
    .sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  if(!journals.length)throw Error("Сначала создайте запись в журнале Foundry.");
  const result=await foundry.applications.api.DialogV2.input({
    window:{title,icon:"fa-solid fa-book"},classes:["mjl-brand"],rejectClose:false,
    content:`<label>Журнал<select name="entryId">${selectEntries(journals,entry=>entry.name)}</select></label>
      <label>Страница<select name="pageId"></select></label>`,
    render:event=>{
      const form=event.target.element.querySelector("form"),{entryId,pageId}=form.elements;
      const update=()=>{
        const pages=game.journal.get(entryId.value)?.pages.contents??[];
        pageId.replaceChildren(new Option("Вся запись",""),...pages.map(page=>new Option(page.name,page.id)));
      };
      update();
      entryId.addEventListener("change",update);
    },
    ok:{label:"Поставить точку"}
  });
  if(!result)return;
  const journal=game.journal.get(result.entryId);
  if(!journal||result.pageId&&!journal.pages.has(result.pageId))throw Error("Журнал или страница уже удалены.");
  return {entryId:journal.id,pageId:result.pageId||null};
}

async function chroniclePoint(title){
  const api=chronicleMap();
  if(!api?.prepareMapLocation)throw Error("Для этой точки нужна активная Хроника версии 1.3.6 или новее.");
  const result=await foundry.applications.api.DialogV2.input({
    window:{title,icon:"fa-solid fa-images"},classes:["mjl-brand"],rejectClose:false,
    content:`<label>Локация<select name="entryId"><option value="">Новая локация</option>
      ${selectEntries(api.mapLocations(),entry=>entry.visible?entry.name:`${entry.name} · скрыта`)}</select></label>
      <label data-location-name>Название новой локации<input type="text" name="name" maxlength="200" required></label>
      <p class="hint">Новая карточка скрыта от игроков. Добавьте арт в галерею Хроники и откройте карточку, когда будете готовы.</p>`,
    render:event=>{
      const form=event.target.element.querySelector("form"),{entryId,name}=form.elements;
      entryId.addEventListener("change",()=>{
        const creating=!entryId.value;
        name.closest("label").hidden=!creating;
        name.required=creating;
      });
    },
    ok:{label:"Поставить точку"}
  });
  if(!result)return;
  const name=result.entryId?"":result.name.trim();
  if(!result.entryId&&!name)throw Error("Укажите название локации.");
  return {entryId:await api.prepareMapLocation({id:result.entryId,name}),newLocation:!!name};
}

export async function placePoint(scene,level,{x,y},kind){
  if(!game.user.isGM)return;
  const chronicle=kind==="chronicle";
  const title=`${chronicle?"Локация Хроники":"Заметка Foundry"} · ${level.name}`;
  const link=await (chronicle?chroniclePoint(title):journalPoint(title));
  if(!link)return;
  if(!game.scenes.has(scene.id)||!scene.levels.has(level.id))throw Error("Этаж или сцена уже удалены.");
  const [note]=await scene.createEmbeddedDocuments("Note", [{
    x,y,entryId:link.entryId,pageId:link.pageId??null,author:game.user.id,
    elevation:level.elevation.base,levels:[level.id],
    texture:{src:chronicle?"icons/svg/mountain.svg":"icons/svg/book.svg"},
    flags:{[ID]:{poi:kind}}
  }]);
  if(note&&link.newLocation)chronicleMap()?.openMapLocation(link.entryId);
  return note;
}
