import {ID, TITLE, STAIRS, STAIR_COLOR, PASSAGES, empty, rectangle, ellipse, brush, bounds, combine, distance, stairFromEdge, stairAt, stairLines, stairOutline, eraseObjects, generate, wallsFor} from "./model.mjs";
import {PRESETS, FLOOR_TEXTURES, WALL_TEXTURES, COLORS, drawMap, png} from "./art.mjs";
import {dimensions, owned, publish, publishDraft, read, styles, installStairGuard, hasLegacyImages, discardDeletedFloor} from "./publish.mjs";
import {chronicleMap,placePoint} from "./points.mjs";
import {FURNITURE, furnitureAt, drawFurniture, furnitureRasterSize, furnitureBounds, positionFurniture, stepFurnitureScale, wheelFurniture, openContainer, inventoryBackup, installContainerInteraction, installLootDragDrop, connectContainers, refreshContainerMarkers, requestLightSwitch} from "./furniture.mjs";
import {LIGHTS, LIGHT_COLORS, lightSource, lightFixture, drawLightFixture, installLightInteraction} from "./lights.mjs";
import {TRAPS,drawTrap,trapHidden,installTrapInteraction,refreshTrapMarkers} from "./traps.mjs";
import {orderedLevels,configureFloors,placeTokens,refreshFloorTile,refreshLevelContrast} from "./levels.mjs";

const PLACED={...FURNITURE,...TRAPS};
const placedItems=model=>[...(model.furniture??[]),...(model.traps??[])];
const placedAt=(model,point)=>furnitureAt({furniture:placedItems(model)},point);
const collection=(model,item)=>TRAPS[item.kind]?(model.traps??=[]):(model.furniture??=[]);

const NAME = "dungeonSketch";
const tools = {
  select: ["Указатель","fa-arrow-pointer"],
  rectangle: ["Прямоугольник","fa-vector-square"], ellipse: ["Эллипс","fa-circle"],
  polygon: ["Многоугольник · Enter завершает","fa-draw-polygon"], brush: ["Свободная кисть","fa-paintbrush"],
  wall: ["Внутренняя стена","fa-grip-lines"], invisible: ["Невидимая стена","fa-eye-slash"],
  ...Object.fromEntries(Object.entries(PASSAGES).map(([key,{name,icon}])=>[key,[name,icon]])),
  paint: ["Нанести стиль","fa-palette"], erase: ["Удалить объекты в области","fa-eraser"],
  ...Object.fromEntries(Object.entries(STAIRS).map(([key,{name,icon}])=>[key,[name,icon]])),
  opening:["Проём / обрыв","fa-square-dashed"],railing:["Перила","fa-fence"],
  journalPin:["Заметка Foundry","fa-book"],chroniclePin:["Локация Хроники","fa-images"],
  ...Object.fromEntries(Object.entries(TRAPS).map(([key,{name,icon}])=>[key,[name,icon]])),
  ...Object.fromEntries(Object.entries(LIGHTS).map(([key,{name,icon}])=>[key,[name,icon]])),
  ...Object.fromEntries(Object.entries(FURNITURE).map(([key,{name,icon}])=>[key,[name,icon]]))
};
const groups={pointer:{name:"Указатель",icon:"fa-arrow-pointer",tools:["select"]},structure:{name:"Стены и проходы",icon:"fa-dungeon",tools:["rectangle","ellipse","polygon","brush","wall","invisible",...Object.keys(PASSAGES),"paint","erase"]},
  levels:{name:"Этажи",icon:"fa-layer-group",tools:[...Object.keys(STAIRS),"opening","railing","erase"]},
  light:{name:"Свет",icon:"fa-lightbulb",tools:[...Object.keys(LIGHTS),"erase"]},
  furniture:{name:"Мебель",icon:"fa-chair",tools:[...Object.keys(FURNITURE),"erase"]},
  traps:{name:"Ловушки",icon:"fa-skull-crossbones",tools:[...Object.keys(TRAPS),"erase"]},
  points:{name:"Точки интереса",icon:"fa-map-pin",tools:["journalPin","chroniclePin"]},
  utilities:{name:"Инструменты",icon:"fa-hammer",tools:[]}};
const lineTools = new Set(["wall","invisible",...Object.keys(PASSAGES),"railing"]);
const edgeStairs=new Set(["stair","ladder","steps"]);
const dragTools = new Set(["rectangle","ellipse","brush",...lineTools,"paint","erase","opening",...Object.keys(STAIRS)]);
const drafts = new Map();
const preferences = {snap:true, cut:false, openingRailing:true,style:"stone", target:"", stairColor:STAIR_COLOR,tool:"rectangle",group:"structure",furnitureScale:1,furnitureRotation:0,furnitureColor:"#9b7351",container:true,lightScale:1,lightColor:LIGHTS.light.color,lightAnimated:true};
const STAIR_HINT="1. Проведите первую ступень и отпустите мышь. 2. Отведите курсор для длины; смещение к середине сужает лестницу. Клик или Enter — готово, Esc / ПКМ — отмена.";
const key = (key, ...modifiers) => ({key,modifiers});
const shortcuts = [
  ...Object.entries({select:key("KeyV"),rectangle:key("KeyR"),ellipse:key("KeyE"),polygon:key("KeyP"),brush:key("KeyB"),
    wall:key("KeyW"),invisible:key("KeyW","Shift"),door:key("KeyD"),secret:key("KeyD","Shift"),
    window:key("KeyO"),paint:key("KeyF"),erase:key("KeyX"),light:key("KeyL"),stair:key("KeyT")})
    .map(([tool,binding])=>({id:tool,name:tools[tool][0].split(" ·")[0],bindings:[binding],tool})),
  {id:"delete",name:"Удалить объекты областью",bindings:[key("Delete")]},
  {id:"backspace",name:"Убрать последнюю вершину / удалить областью",bindings:[key("Backspace")]},
  {id:"snap",name:"Переключить привязку к сетке",bindings:[key("KeyG")]},
  {id:"rotate",name:"Повернуть мебель / ловушку на 90°",bindings:[key("KeyQ")]},
  {id:"cut",name:"Переключить вырезание пола",bindings:[key("KeyH")]},
  {id:"undo",name:"Отменить действие",bindings:[key("KeyZ","Control")]},
  {id:"redo",name:"Повторить действие",bindings:[key("KeyY","Control"),key("KeyZ","Control","Shift")]},
  {id:"finish",name:"Завершить многоугольник / лестницу",bindings:[key("Enter"),key("NumpadEnter")]},
  {id:"cancel",name:"Отменить незавершённое рисование",bindings:[key("Escape")]},
  {id:"apply",name:"Сохранить сейчас / повторить сохранение",bindings:[key("KeyS","Control"),key("Enter","Control")]},
  {id:"export",name:"Экспорт PNG",bindings:[key("KeyE","Control","Shift")]},
  {id:"clear",name:"Очистить этаж с подтверждением",bindings:[key("Delete","Shift")]},
  {id:"help",name:"Памятка горячих клавиш",bindings:[key("F1"),key("Slash","Shift")]}
];
const shortcutLabel = id => game.keybindings.get(ID,id).map(binding=>
  [...(binding.modifiers ?? []).map(m=>m==="Control"?"Ctrl":m),
    ({Slash:"/",NumpadEnter:"Num Enter"})[binding.key] ?? binding.key.replace(/^(Key|Digit)/,"")].join("+")).join(" / ");
let editorWanted=false, editorPosition;
const dialog = () => foundry.applications.api.DialogV2;
const report = error => {ui.notifications.error(error.message); console.error(ID, error);};
const localCleanup = () => game.user.isGM && /Windows/.test(navigator.userAgent) &&
  ["localhost","127.0.0.1","[::1]"].includes(location.hostname) && /^[a-z0-9][a-z0-9-]*$/.test(game.world.id);
const session = (scene=canvas.scene,level=canvas.level) => {
  const key = `${scene.id}:${level.id}`;
  const saved = read(scene, level);
  let draft = drafts.get(key);
  if (!draft || (!draft.dirty && !draft.saving && draft.rev !== saved.rev)) {
    draft = {rev:saved.rev, model:structuredClone(saved.pending?.model ?? saved.model), dirty:false, undo:[], redo:[]};
    drafts.set(key,draft);
  }
  return {scene, level, draft, saved};
};

const blocked=({draft,saved})=>!draft.saving&&!!(saved.pending||draft.rev!==saved.rev);
let saveQueue=Promise.resolve();
function refreshDraft({scene,level}) {
  const layer=canvas?.[NAME];
  if(canvas?.scene?.id===scene.id&&canvas?.level?.id===level.id&&layer?.panel&&!layer.drag&&!layer.furnitureDrag&&!layer.wheelEdit)layer.refresh();
}
function scheduleSave(context=session(),delay=600) {
  const {scene,level,draft}=context;
  clearTimeout(draft.saveTimer);
  if(draft.manual||(!draft.dirty&&!draft.clear&&!read(scene,level).pending))return;
  draft.saveTimer=setTimeout(()=>saveNow(context).catch(error=>{if(draft.failures===1)report(error);}),delay);
}
function saveNow(context=session()) {
  const {scene,level,draft}=context;
  clearTimeout(draft.saveTimer);
  if(draft.queued)return draft.queued;
  draft.queued=saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    if(draft.manual||(!draft.dirty&&!draft.clear&&!read(scene,level).pending)){draft.queued=null;return;}
    draft.saving=true;refreshDraft(context);
    try {
      await publishDraft(scene,level,draft);
      draft.error=null;draft.failures=0;
    }catch(error){draft.error=error.message;draft.failures=(draft.failures??0)+1;throw error;}
    finally {
      draft.saving=false;draft.queued=null;refreshDraft(context);
      if(!draft.error)scheduleSave(context);
      else if(draft.failures<=3&&draft.rev===read(scene,level).rev)scheduleSave(context,1000*2**draft.failures);
    }
  });
  return draft.queued;
}

function options(select, values, chosen) {
  select.replaceChildren(...values.map(([value,label]) => new Option(label,value,false,value===chosen)));
}
function colorPalette(field,label,colors=COLORS) {
  return `<fieldset class="mds-colors"><legend>${label}</legend><input name="${field}" type="hidden"><div class="mds-color-swatches" role="group" aria-label="${label}">${colors.map(([name,color])=>`<button type="button" class="mds-color" data-color-field="${field}" data-color="${color}" style="background-color:${color}" title="${name}" aria-label="${name}" aria-pressed="false"></button>`).join("")}<input type="color" data-color-input="${field}" aria-label="Свой цвет · ${label}" title="Свой цвет"></div></fieldset>`;
}

function remember(draft) {
  draft.undo.push(draft.model);
  // ponytail: 30 complete snapshots; use geometry deltas if longer histories are needed.
  if (draft.undo.length>30) draft.undo.shift();
  draft.redo.length=0;
}

class SketchWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {id:ID,classes:["mjl-brand","mds-editor"],position:{width:330,height:"auto"},
    window:{title:`${TITLE} · Рисование`,icon:"fa-solid fa-dungeon",resizable:false}};
  constructor(owner,content) {
    super(editorPosition ? {position:editorPosition} : {});
    this.owner=owner;
    this.content=content;
  }
  async _renderHTML() {return this.content;}
  _replaceHTML(result,content) {content.replaceChildren(result);}
  async close(options) {
    editorPosition={left:this.position.left,top:this.position.top};
    if(this.owner.drawer===this) {
      this.owner.drawer=null;
      editorWanted=false;
      this.owner.close();
    }
    return super.close(options);
  }
}

function makeLayer() {
  return class DungeonSketchLayer extends foundry.canvas.layers.InteractionLayer {
    static get layerOptions() {return {...super.layerOptions,name:NAME};}

    static prepareSceneControls() {
      if (!game.user.isGM) return null;
      return {
        name:NAME, title:"Подземелье", order:10, icon:"fa-solid fa-dungeon",
        onChange:(_, active) => {if (active) canvas[NAME].activate();else editorWanted=false;},
        tools:{
          ...Object.fromEntries(Object.entries(groups).map(([key,group],order)=>[key,{name:key,title:group.name,order,icon:`fa-solid ${group.icon}`,button:true,
            onChange:()=>canvas[NAME].openGroup(key)}])),
          generate:{name:"generate",title:"Генерация",order:Object.keys(groups).length,icon:"fa-solid fa-wand-magic-sparkles",button:true,
            onChange:()=>{canvas[NAME].open();canvas[NAME].action("generate").catch(report);}},
          style:{name:"style",title:"Стиль всего этажа",order:Object.keys(groups).length+1,icon:"fa-solid fa-palette",button:true,
            onChange:()=>{canvas[NAME].open();canvas[NAME].theme(true).catch(report);}}
        }
      };
    }

    async _draw() {
      this.previewSprite = this.addChild(new PIXI.Sprite());
      this.furnitureSprite=this.addChild(new PIXI.Sprite());
      this.furnitureSprite.eventMode="none";this.furnitureSprite.alpha=0.65;this.furnitureSprite.anchor.set(0.5);this.furnitureSprite.visible=false;
      this.gestureGraphic = this.addChild(new PIXI.Graphics());
      this.previewSprite.eventMode = this.gestureGraphic.eventMode = "none";
      this.previewSprite.visible = false;
    }

    _activate() {refreshContainerMarkers();if (canvas.ready && editorWanted) this.open();}
    _deactivate() {this.close();refreshContainerMarkers();}
    async _tearDown() {await this.close(); await super._tearDown();}

    open() {
      if (!canvas.level || !this.previewSprite || !game.user.isGM) return;
      editorWanted=true;
      if(this.drawer) {this.drawer.bringToFront();this.refresh();return;}
      this.panel?.remove();
      const panel = this.panel = document.createElement("section");
      panel.className = "mjl-dungeon-panel";
      panel.innerHTML = `
        <header><i class="fa-solid fa-dungeon" aria-hidden="true"></i><div><strong>${TITLE}</strong><small data-level></small></div></header>
        <output data-status aria-live="polite"></output>
        <strong data-group-name></strong>
        <section data-levels hidden><button type="button" data-do="floorSetup" class="mds-primary">Настроить этажи</button><div class="mds-floor-list" data-level-list></div><small>Клик по названию — открыть этаж. Кнопка с существом размещает на нём токены с правильной высотой.</small><label class="mds-toggle"><input name="lowerFloorContrast" type="checkbox" role="switch"><span>Затемнять нижние этажи</span></label><small>Текущий этаж яркий, нижние темнее по глубине. Личная настройка отображения.</small></section>
        <p data-traps hidden>Только рисунки: без урона и срабатываний. Новая ловушка скрыта от игроков. Маркер у края переключает её видимость.</p>
        <div class="mds-draw-tools" role="group" aria-label="Инструменты рисования">${Object.entries(tools).map(([key,[title,icon]]) =>
          `<button type="button" data-draw-tool="${key}" title="${title}" aria-pressed="false"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${title.split(" ·")[0]}</span></button>`).join("")}</div>
        <p class="mds-tool-hint"></p>
        <div class="mds-pair"><label class="mds-toggle"><input type="checkbox" role="switch" name="snap"><span>К сетке</span></label><label class="mds-toggle"><input type="checkbox" role="switch" name="cut"><span>Вырезать пол</span></label></div>
        <label data-structure>Стиль кисти <select name="style"></select></label>
        <fieldset data-opening hidden><legend>Проём / обрыв</legend><label class="mds-toggle"><input name="openingRailing" type="checkbox" role="switch" checked><span>Поставить перила по краю</span></label><small>Обведите участок без пола. Обзор вниз включается в «Настроить этажи». Сплошное перекрытие закроет существ, находящихся под полом.</small></fieldset>
        <fieldset data-furniture hidden><legend data-placement-name>Размещение мебели</legend>
          <label>Размер × <input name="furnitureScale" type="number" min="0.5" max="4" step="0.1" value="1"></label>
          <label>Поворот <input name="furnitureRotation" type="number" min="0" max="359" step="15" value="0"> ° <button type="button" data-do="rotate" title="Q" aria-label="Повернуть объект на 90 градусов"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button></label>
          ${colorPalette("furnitureColor","Цвет")}
          <label class="mds-toggle" data-container><input name="container" type="checkbox" role="switch" checked><span>Инвентарь контейнера</span></label>
          <small>Alt + колесо — поворот на 15°, Shift + колесо — размер с шагом 0,1. Q — поворот на 90°, Shift при перемещении — без сетки. ПКМ — действия.</small>
        </fieldset>
        <fieldset data-light hidden><legend>Источник света</legend>
          <p data-light-summary></p>
          <label>Радиус × <input name="lightScale" type="number" min="0.25" max="4" step="0.25" value="1"></label>
          ${colorPalette("lightColor","Цвет света",LIGHT_COLORS)}
          <label class="mds-toggle"><input name="lightAnimated" type="checkbox" role="switch" checked><span>Анимация света</span></label>
          <small>Клик — поставить. Привязка — к центру клетки, Shift — свободное размещение. Изменения сохраняются автоматически.</small>
        </fieldset>
        <fieldset data-selection hidden><legend data-selection-name>Выбранная мебель</legend>
          <label>Название <input name="selectedName" type="text" maxlength="100"></label>
          <div class="mds-pair"><label>Ширина <input name="selectedWidth" type="number" min="0.25" max="20" step="any"></label><label>Длина <input name="selectedHeight" type="number" min="0.25" max="20" step="any"></label></div>
          <label>Поворот <input name="selectedRotation" type="number" min="0" max="359" step="15"> °</label>
          ${colorPalette("selectedColor","Цвет")}
          <label class="mds-toggle" data-selected-container><input name="selectedContainer" type="checkbox" role="switch"><span>Интерактивный контейнер</span></label>
          <label class="mds-toggle" data-selected-trap hidden><input name="selectedHidden" type="checkbox" role="switch"><span>Скрыта от игроков</span></label>
          <div class="mds-pair"><button type="button" data-do="selectedInventory">Содержимое</button><button type="button" data-do="selectedDelete">Удалить</button></div>
          <small>Перетащите объект для перемещения. Alt + колесо — поворот, Shift + колесо — размер. Q — 90°, Delete — удалить.</small>
        </fieldset>
        <button type="button" data-do="inventories" hidden>Контейнеры · JSON</button>
        <fieldset data-stair><legend>Переход между этажами</legend>
          ${colorPalette("stairColor","Цвет перехода")}
          <label>Переход <select name="target"></select></label>
          <small data-stair-gate></small>
        </fieldset>
        <fieldset data-stair-selection hidden><legend data-stair-name>Выбранный переход</legend>
          ${colorPalette("selectedStairColor","Цвет перехода")}
          <label>Переход <select name="selectedStairTarget"></select></label>
          <button type="button" data-do="selectedStairDelete">Удалить переход</button>
        </fieldset>
        <button type="button" data-do="theme">Настроить стиль кисти</button>
        <div class="mds-pair"><button type="button" data-do="undo">Отменить</button><button type="button" data-do="redo">Повторить</button></div>
        <button type="button" data-do="apply" class="mds-primary" hidden>Повторить сохранение</button>
        <div class="mds-pair"><button type="button" data-do="export">PNG</button><button type="button" data-do="background">Сделать фоном</button></div>
        <button type="button" data-do="cleanupAssets" hidden>Очистить файлы карт</button>
        <button type="button" data-do="clear" class="mds-clear">Очистить этаж</button>
        <button type="button" data-do="help">Горячие клавиши</button>`;
      this.drawer=new SketchWindow(this,panel);
      this.drawer.render({force:true});
      panel.querySelector("[name=snap]").checked = preferences.snap;
      panel.querySelector("[name=cut]").checked = preferences.cut;
      panel.addEventListener("change", event => {
        const {name,type,checked,value} = event.target;
        if(event.target.dataset.colorInput){
          const field=panel.querySelector(`[name=${event.target.dataset.colorInput}]`);field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));return;
        }
        if(name==="lowerFloorContrast"){game.settings.set(ID,name,checked).catch(report);return;}
        this.finishWheelEdit();
        if(name==="selectedStairColor"||name==="selectedStairTarget"){
          const stair=this.selectedStair();if(!stair)return;
          this.change(model=>{const item=model.stairs.find(s=>s.id===stair.id);if(name==="selectedStairColor")item.color=value;else item.target=value;});return;
        }
        if(name.startsWith("selected")) {
          const f=this.selected();if(!f)return;
          this.change(model=>{
            const item=collection(model,f).find(i=>i.id===f.id),size=dimensions(canvas.scene).size;
            const before={...item};
            if(name==="selectedName")item.name=value.trim().slice(0,100);
            if(name==="selectedColor")item.color=value;
            if(name==="selectedContainer")item.container=!!PLACED[item.kind].container&&checked;
            if(name==="selectedHidden"&&TRAPS[item.kind])item.hidden=checked;
            if(name==="selectedRotation")item.rotation=((Number(value)||0)%360+360)%360;
            if(name==="selectedWidth"||name==="selectedHeight")item[name==="selectedWidth"?"width":"height"]=Math.max(0.25,Math.min(20,Number(value)||1))*size;
            if(["selectedRotation","selectedWidth","selectedHeight"].includes(name))Object.assign(item,this.alignFurniture(item,undefined,before));
          });return;
        }
        preferences[name] = type === "checkbox" ? checked : value;
        if (["furnitureScale","furnitureRotation"].includes(name)) {
          const numeric=Number(value);
          preferences[name]=name==="furnitureScale" ? Math.min(4,Math.max(0.5,numeric||1)) : ((numeric||0)%360+360)%360;
        }
        if(name==="lightScale")preferences.lightScale=Math.max(0.25,Math.min(4,Number(value)||1));
        this.syncColorPalettes();
        if (name.startsWith("furniture") || name.startsWith("light") || name==="snap" || name==="stairColor") this.hoverStair(canvas.mousePosition);
        if(name.startsWith("light"))this.updateLightSummary();
      });
      panel.addEventListener("click", event => {
        const view=event.target.closest("[data-view-level]");if(view){this.finishWheelEdit();this.cancel();canvas.scene.view({level:view.dataset.viewLevel}).catch(report);return;}
        const send=event.target.closest("[data-send-level]");if(send){placeTokens(canvas.scene,canvas.scene.levels.get(send.dataset.sendLevel)).catch(report);return;}
        const color=event.target.closest("[data-color-field]");
        if(color){const field=panel.querySelector(`[name=${color.dataset.colorField}]`);field.value=color.dataset.color;field.dispatchEvent(new Event("change",{bubbles:true}));return;}
        const tool=event.target.closest("[data-draw-tool]")?.dataset.drawTool;
        if(tool) {this.selectTool(tool);return;}
        const name = event.target.closest("[data-do]")?.dataset.do;
        if (name) this.action(name).catch(report);
      });
      this.refresh();
      const context=session();
      if(!blocked(context)&&context.draft.model.stairs.some(s=>!s.color||!s.kind))this.change(model=>{for(const stair of model.stairs){stair.color??=STAIR_COLOR;stair.kind??="stair";}});
      scheduleSave();
    }

    openGroup(group) {
      this.finishWheelEdit();
      const previous=preferences.tool;
      preferences.group=group;
      preferences.tool=groups[group].tools.includes(preferences.tool) ? preferences.tool : groups[group].tools[0]??null;
      if(LIGHTS[preferences.tool]&&preferences.tool!==previous){preferences.lightColor=LIGHTS[preferences.tool].color;preferences.lightScale=1;}
      this.cancel();this.open();this.refresh();
    }

    selectTool(tool) {
      this.finishWheelEdit();
      preferences.tool=tool;
      if(LIGHTS[tool]){preferences.lightColor=LIGHTS[tool].color;preferences.lightScale=1;}
      if (tool!=="erase") preferences.group=tool==="select"?"pointer":groups.points.tools.includes(tool)?"points":TRAPS[tool]?"traps":FURNITURE[tool]?"furniture":LIGHTS[tool]?"light":STAIRS[tool]||["opening","railing"].includes(tool)?"levels":"structure";
      this.cancel();this.refresh();
    }

    selected() {return placedItems(session().draft.model).find(f=>f.id===this.selectedId);}
    selectedStair() {return session().draft.model.stairs.find(s=>s.id===this.selectedStairId);}
    trapModel() {return session().draft.model;}
    toggleTrap(id) {
      if(!game.user.isGM||!game.users.activeGM?.isSelf)throw Error("Видимость меняет активный мастер.");
      this.finishWheelEdit();this.change(model=>{const trap=model.traps?.find(t=>t.id===id);if(!trap)throw Error("Ловушка удалена.");trap.hidden=!trapHidden(trap);});
      return saveNow();
    }

    syncColorPalettes() {
      if(!this.panel)return;
      for(const button of this.panel.querySelectorAll("[data-color-field]"))button.setAttribute("aria-pressed",String(button.dataset.color===this.panel.querySelector(`[name=${button.dataset.colorField}]`).value));
      for(const input of this.panel.querySelectorAll("[data-color-input]")){
        const color=this.panel.querySelector(`[name=${input.dataset.colorInput}]`).value;if(/^#[0-9a-f]{6}$/i.test(color))input.value=color;
      }
    }

    updateLightSummary() {
      if(!LIGHTS[this.tool]||!this.panel)return;
      const source=this.makeLight([0,0]),units=canvas.scene.grid.units||"ft";
      this.panel.querySelector("[data-light-summary]").textContent=`${LIGHTS[this.tool].name} · яркий ${source.bright} ${units}, слабый ${source.dim} ${units}`;
    }
    makeLight(at) {return lightSource(this.tool,at,canvas.scene.grid,{scale:preferences.lightScale,color:preferences.lightColor,animated:preferences.lightAnimated});}

    furnitureWheel(event) {
      if(!this.active||!this.panel||this.busy||(!event.altKey&&!event.shiftKey)||event.ctrlKey||event.metaKey)return false;
      const delta=event.deltaY||event.deltaX;if(!delta)return false;
      const {scene,level,draft,saved}=session();if(blocked({draft,saved}))return false;
      const direction=delta<0?1:-1,resize=!event.altKey,size=dimensions(scene).size;
      const snapEvent=resize?{shiftKey:false}:event;
      if(this.furnitureDrag){
        this.updateFurnitureDrag(wheelFurniture(this.furnitureDrag.preview,direction,resize,size),snapEvent);
      }else if(PLACED[this.tool]){
        if(resize)preferences.furnitureScale=stepFurnitureScale(preferences.furnitureScale,direction);
        else preferences.furnitureRotation=(preferences.furnitureRotation+direction*15+360)%360;
        for(const name of ["furnitureScale","furnitureRotation"])this.panel.querySelector(`[name=${name}]`).value=preferences[name];
        this.hoverStair(canvas.mousePosition,snapEvent);
      }else if(this.tool==="select"&&this.selected()){
        if(!this.wheelEdit){this.wheelEdit={id:this.selectedId,scene:scene.id,level:level.id,preview:{...this.selected()}};this.renderPreview({omit:this.selectedId}).catch(report);}
        const before=this.wheelEdit.preview;
        this.wheelEdit.preview=this.alignFurniture(wheelFurniture(before,direction,resize,size),snapEvent,before);this.showFurniture(this.wheelEdit.preview);
        const f=this.wheelEdit.preview;
        for(const [name,value] of Object.entries({selectedWidth:f.width/size,selectedHeight:f.height/size,selectedRotation:f.rotation}))this.panel.querySelector(`[name=${name}]`).value=Math.round(value*1000)/1000;
        clearTimeout(this.wheelTimer);this.wheelTimer=setTimeout(()=>{try{this.finishWheelEdit();}catch(error){report(error);}},180);
      }else return false;
      return true;
    }

    finishWheelEdit() {
      clearTimeout(this.wheelTimer);const edit=this.wheelEdit;if(!edit)return;
      this.wheelEdit=null;
      if(!canvas.scene||!canvas.level){this.furnitureSprite.visible=false;return;}
      const {scene,level,draft}=session();
      if(scene.id!==edit.scene||level.id!==edit.level){this.furnitureSprite.visible=false;return;}
      this.wheelCommitPending=true;
      this.change(model=>{const f=placedItems(model).find(f=>f.id===edit.id);if(f)Object.assign(f,edit.preview);});
      this.renderPreview().catch(report);
    }
    endWheelGhost() {
      if(this.wheelCommitPending&&!this.wheelEdit&&!this.furnitureDrag){this.wheelCommitPending=false;this.furnitureSprite.visible=false;}
    }

    shortcut({id,tool}) {
      if (this.busy || (blocked(session()) && !["apply","help","cancel","clear"].includes(id))) return true;
      if(id!=="cancel")this.finishWheelEdit();
      if (tool) this.selectTool(tool);
      else if(id==="rotate") {
        if(this.tool==="select"&&this.selected()){
          if(this.furnitureDrag){const f=this.furnitureDrag.preview;this.updateFurnitureDrag({...f,rotation:(f.rotation+90)%360});}
          else this.change(model=>{const f=collection(model,this.selected()).find(f=>f.id===this.selectedId);Object.assign(f,this.alignFurniture({...f,rotation:(f.rotation+90)%360},undefined,f));});
          return true;
        }
        if(!PLACED[this.tool])return false;
        preferences.furnitureRotation=(Number(preferences.furnitureRotation)+90)%360;
        this.panel.querySelector("[name=furnitureRotation]").value=preferences.furnitureRotation;
        this.hoverStair(canvas.mousePosition);
      }
      else if (id === "backspace" && this.tool === "polygon" && this.points?.length) {
        this.points.pop(); this.ghost=null; this.gestureGraphic.clear();
        this.drawGesture(this.points);
      } else if (["delete","backspace"].includes(id)) {
        if(this.tool==="select"&&this.selected())this.change(model=>{const items=collection(model,this.selected()),index=items.findIndex(f=>f.id===this.selectedId);if(index>=0)items.splice(index,1);});
        else if(this.tool==="select"&&this.selectedStair())this.change(model=>{model.stairs=model.stairs.filter(s=>s.id!==this.selectedStairId);});
        else this.selectTool("erase");
      }
      else if (["snap","cut"].includes(id)) {
        preferences[id]=!preferences[id];
        this.panel.querySelector(`[name=${id}]`).checked=preferences[id];
        if (id==="snap") this.hoverStair(canvas.mousePosition);
      } else if (id === "finish") {
        if (this.stairDraft?.shape) this.finishStair();
        else if (this.points?.length>=3) this.finishPolygon();
        else return false;
      } else if (id === "cancel") {
        if (this.points?.length || this.drag || this.stairDraft || this.furnitureDrag || this.wheelEdit) {this.cancel();this.renderPreview().catch(report);}
        else return false;
      } else this.action(id).catch(report);
      return true;
    }

    close() {
      this.finishWheelEdit();
      if(canvas.scene&&canvas.level){const context=session();if(context.draft.dirty&&!context.draft.error)saveNow(context).catch(report);}
      const drawer=this.drawer;
      this.drawer=null;
      const closing=drawer?.close();
      this.panel?.remove(); this.panel = null;
      this.cancel();
      this.drawnModel=null;
      if(this.furnitureSprite){
        if(this.furnitureSprite.texture!==PIXI.Texture.EMPTY)this.furnitureSprite.texture.destroy(true);
        this.furnitureSprite.texture=PIXI.Texture.EMPTY;this.furnitureArt=null;
      }
      this.unhide();
      this.previewEpoch = (this.previewEpoch ?? 0) + 1;
      if (this.previewSprite) {
        this.previewSprite.visible = false;
        if (this.previewSprite.texture !== PIXI.Texture.EMPTY) this.previewSprite.texture.destroy(true);
        this.previewSprite.texture = PIXI.Texture.EMPTY;
      }
      return closing;
    }

    unhide() {
      for(const [mesh,renderable] of this.hiddenMeshes??[])if(!mesh.destroyed)mesh.renderable=renderable;
      this.hiddenMeshes=[];
    }
    hidePublished() {
      if(!this.panel||!canvas.ready||!canvas.level)return;
      const {scene,level,draft,saved}=session();this.unhide();
      if(saved.pending&&!draft.saving)return;
      const meshes=owned(scene,"Tile",level.id).map(t=>t.object?.mesh).filter(Boolean);
      if(saved.mode==="background"&&level.background.src===saved.asset&&canvas.primary.background)meshes.push(canvas.primary.background);
      for(const mesh of meshes){this.hiddenMeshes.push([mesh,mesh.renderable]);mesh.renderable=false;}
    }

    refresh() {
      if (!this.panel || !canvas.ready || !canvas.level) return;
      const {scene,level,draft,saved} = session();
      const locked=blocked({draft,saved});
      const group=groups[preferences.group];
      this.panel.querySelector("[data-levels]").hidden=preferences.group!=="levels";
      this.panel.querySelector("[name=lowerFloorContrast]").checked=game.settings.get(ID,"lowerFloorContrast");
      if(preferences.group==="levels"){
        const escape=foundry.utils.escapeHTML,units=escape(scene.grid.units||"ft");
        this.panel.querySelector("[data-level-list]").innerHTML=orderedLevels(scene).map(l=>`<div class="mds-floor-card"><button type="button" data-view-level="${l.id}" aria-pressed="${l.id===level.id}">${escape(l.name)}</button><button type="button" data-send-level="${l.id}" title="Разместить существ на этом этаже" aria-label="Разместить существ на этаже ${escape(l.name)}"><i class="fa-solid fa-person-arrow-up-from-line" aria-hidden="true"></i></button><small>Пол: ${l.elevation.base} ${units}${l.visibility.levels.size?" · видит другие этажи":" · отдельный этаж"}</small></div>`).join("");
      }
      if(this.panel.dataset.group!==preferences.group){
        const grid=this.panel.querySelector(".mds-draw-tools");for(const tool of group.tools)grid.append(this.panel.querySelector(`[data-draw-tool=${tool}]`));this.panel.dataset.group=preferences.group;
      }
      this.panel.querySelector(".mds-draw-tools").hidden=preferences.group==="pointer"||!group.tools.length;
      const selected=this.tool==="select"&&this.selected();
      const selectedStair=this.tool==="select"&&this.selectedStair();
      this.panel.querySelector("[data-stair-selection]").hidden=!selectedStair;
      if(selectedStair){
        this.panel.querySelector("[data-stair-name]").textContent=STAIRS[selectedStair.kind??"stair"]?.name??"Переход";
        this.panel.querySelector("[name=selectedStairColor]").value=selectedStair.color??STAIR_COLOR;
      }
      this.panel.querySelector("[data-selection]").hidden=!selected;
      if(selected){
        this.panel.querySelector("[data-selection-name]").textContent=TRAPS[selected.kind]?"Выбранная ловушка":"Выбранная мебель";
        this.panel.querySelector("[data-selected-trap]").hidden=!TRAPS[selected.kind];
        this.panel.querySelector("[name=selectedHidden]").checked=trapHidden(selected);
        for(const [name,value] of Object.entries({selectedName:selected.name||PLACED[selected.kind].name,selectedWidth:selected.width/dimensions(scene).size,selectedHeight:selected.height/dimensions(scene).size,selectedRotation:selected.rotation??0,selectedColor:selected.color??"#9b7351"}))this.panel.querySelector(`[name=${name}]`).value=typeof value==="number"?Math.round(value*1000)/1000:value;
        this.panel.querySelector("[name=selectedContainer]").checked=selected.container;
        this.panel.querySelector("[data-selected-container]").hidden=!PLACED[selected.kind].container;
        this.panel.querySelector("[data-do=selectedInventory]").hidden=!selected.container;
      }
      for(const name of ["export","background","help","inventories"])this.panel.querySelector(`[data-do=${name}]`).hidden=preferences.group!=="utilities";
      this.panel.querySelector("[data-do=cleanupAssets]").hidden=preferences.group!=="utilities"||!localCleanup();
      this.panel.querySelector("[data-do=theme]").hidden=preferences.group!=="structure";
      this.panel.querySelector("[name=snap]").closest(".mds-pair").hidden=preferences.group==="utilities";
      this.panel.querySelector("[data-group-name]").textContent=group.name;
      this.panel.querySelector("[data-traps]").hidden=preferences.group!=="traps";
      this.panel.querySelector("[data-furniture]").hidden=!PLACED[this.tool];
      this.panel.querySelector("[data-placement-name]").textContent=TRAPS[this.tool]?"Размещение ловушки":"Размещение мебели";
      this.panel.querySelector("[data-light]").hidden=!LIGHTS[this.tool];
      this.panel.querySelector("[data-container]").hidden=!PLACED[this.tool]?.container;
      this.panel.querySelector("[data-structure]").hidden=preferences.group!=="structure";
      this.panel.querySelector("[data-opening]").hidden=this.tool!=="opening";this.panel.querySelector("[name=openingRailing]").checked=preferences.openingRailing;
      this.panel.querySelector("[name=cut]").closest("label").hidden=preferences.group!=="structure";
      for(const name of ["furnitureScale","furnitureRotation","furnitureColor","lightScale","lightColor","stairColor"])
        this.panel.querySelector(`[name=${name}]`).value=preferences[name];
      for(const field of this.panel.querySelectorAll("input,select,[data-color-field]"))field.disabled=!!this.busy||locked;
      this.panel.querySelector("[name=lightAnimated]").checked=preferences.lightAnimated&&!!LIGHTS[this.tool]?.animation;
      this.panel.querySelector("[name=lightAnimated]").disabled||=!LIGHTS[this.tool]?.animation;
      this.syncColorPalettes();this.updateLightSummary();
      this.panel.querySelector("[name=container]").checked=preferences.container;
      this.panel.querySelector("[data-level]").textContent = level.name;
      for(const button of this.panel.querySelectorAll("[data-draw-tool]")) {
        button.setAttribute("aria-pressed",String(button.dataset.drawTool===preferences.tool));
        button.hidden=!group.tools.includes(button.dataset.drawTool);
        button.title=tools[button.dataset.drawTool][0]+(shortcuts.some(s=>s.id===button.dataset.drawTool)?` · ${shortcutLabel(button.dataset.drawTool)}`:"");
        button.disabled=!!this.busy || locked;
        if(button.dataset.drawTool==="chroniclePin"&&!chronicleMap()){
          button.disabled=true;
          button.title="Требуется активная Хроника версии 1.3.6 или новее";
        }
      }
      this.panel.querySelector(".mds-tool-hint").textContent =
        preferences.group==="points" ? "Выберите тип точки и нажмите на карте. Двойной клик открывает запись. Перемещение и удаление доступны на штатном слое заметок Foundry." :
        preferences.group==="traps"&&this.tool!=="erase" ? "Наведите и нажмите для размещения. Alt + колесо — поворот, Shift + колесо — размер. Маркеры видны только мастеру." :
        preferences.group==="utilities" ? "Экспорт карты, резервные копии и памятка управления." :
        this.tool==="select" ? "Клик по мебели, ловушке или переходу — настройки. Мебель и ловушки можно перетаскивать." :
        PLACED[this.tool] ? "Наведите на карту и нажмите для размещения. Q поворачивает следующую вещь; ПКМ по уже поставленной — действия." :
        preferences.tool==="polygon" ? "Кликайте по вершинам. Enter завершает фигуру." :
        edgeStairs.has(this.tool) ? (this.stairDraft ? "Первая сторона закреплена. Отведите курсор: дальше — длиннее, к середине — уже. Клик / Enter — готово; Esc / ПКМ — отмена." : STAIR_HINT) :
        this.tool==="hatch" ? "Обведите прямоугольник люка. Привязка — к сетке, Shift — свободный размер. Для перехода выберите другой этаж." :
        this.tool==="opening" ? "Обведите проём прямоугольником. Нижний этаж будет виден через него при включённом обзоре вниз." :
        this.tool==="railing" ? "Проведите перила от начала до конца. Они не пропускают движение и позволяют видеть вниз." :
        PASSAGES[preferences.tool] ? "Проведите от начала до конца проёма. Привязки к стенам нет; Shift отключает сетку." :
        LIGHTS[this.tool] ? "Выберите вариант и нажмите на карту. Силуэт и источник привязываются к центру клетки; Shift отключает сетку." :
        preferences.tool==="erase" ? "Обведите область: стены, двери, окна, свет, лестницы, ловушки и мебель будут удалены. Для пола включите «Вырезать пол»." :
        "Зажмите левую кнопку мыши и проведите по карте.";
      for (const name of ["snap","cut"]) this.panel.querySelector(`[name=${name}]`).title=shortcutLabel(name);
      for (const button of this.panel.querySelectorAll("[data-do]"))
        if (shortcuts.some(s=>s.id===button.dataset.do)) button.title=shortcutLabel(button.dataset.do);
      this.panel.querySelector("[data-status]").textContent = this.busy ? "Сохранение…" : draft.saving ? "Сохранение… · можно продолжать рисовать" :
        draft.error ? `Не удалось сохранить: ${draft.error}` :
        saved.pending ? "Восстановление сохранения…" :
        draft.rev !== saved.rev ? "Есть более новая версия · откройте её заново" :
        draft.dirty ? "Ожидает автосохранения…" : saved.rev ? "Все изменения сохранены" : "Автосохранение включено";
      const presets = {...PRESETS,...styles()};
      options(this.panel.querySelector("[name=style]"), Object.entries(presets).map(([key,s])=>[key,s.name]),preferences.style);
      const levels = scene.levels.filter(l => l.id !== level.id).map(l => [l.id,l.name]);
      if (preferences.target && !levels.some(([id])=>id===preferences.target)) preferences.target = "";
      this.panel.querySelector("[data-stair]").hidden = !STAIRS[this.tool];
      this.panel.querySelector("[data-stair-gate]").textContent=this.tool==="hatch"?"Переход срабатывает при входе на люк. Без выбранного этажа это только рисунок.":"Переход — только у жирного края со стрелкой. До него токен остаётся на текущем этаже.";
      options(this.panel.querySelector("[name=target]"),[["","Только рисунок"],...levels],preferences.target);
      options(this.panel.querySelector("[name=selectedStairTarget]"),[["","Только рисунок"],...levels],selectedStair?.target??"");
      const apply = this.panel.querySelector("[data-do=apply]");
      apply.hidden=!draft.error;apply.textContent="Повторить сохранение";
      for (const button of this.panel.querySelectorAll("[data-do]"))
        button.disabled = button.dataset.do!=="help" && (!!this.busy || (locked && !["apply","clear"].includes(button.dataset.do)));
      this.panel.querySelector("[data-do=undo]").disabled ||= !draft.undo.length;
      this.panel.querySelector("[data-do=redo]").disabled ||= !draft.redo.length;
      if(selected&&!this.furnitureDrag)this.drawGesture(stairOutline(selected),true);
      else if(selectedStair)this.drawGesture(stairOutline(selectedStair),true);
      this.renderPreview().catch(report);
      refreshContainerMarkers();
      refreshTrapMarkers();
    }

    async renderPreview({omit=null}={}) {
      const {scene,level,draft,saved} = session(),levelKey=`${scene.id}:${level.id}`;
      const requested=this.previewRequested;
      if(requested?.model===draft.model&&requested.level===levelKey&&requested.omit===omit&&requested.pending===!!saved.pending&&requested.epoch===this.previewEpoch)return;
      const epoch = this.previewEpoch = (this.previewEpoch ?? 0) + 1;
      this.previewRequested={model:draft.model,level:levelKey,omit,pending:!!saved.pending,epoch};
      if(this.drawnModel===draft.model&&this.drawnLevel===levelKey&&this.drawnOmit===omit&&this.drawnPending===!!saved.pending){this.hidePublished();this.endWheelGhost();return;}
      const size = dimensions(scene);
      const hasShape = draft.model.floor.length || draft.model.walls.length || draft.model.doors.length || draft.model.stairs.length || draft.model.lights.length || draft.model.furniture?.length || draft.model.traps?.length;
      const model=omit?{...draft.model,furniture:(draft.model.furniture??[]).filter(f=>f.id!==omit),traps:(draft.model.traps??[]).filter(f=>f.id!==omit)}:draft.model;
      const image = hasShape ? await drawMap(model,size,styles(),{preview:true}) : null;
      if (this.previewEpoch !== epoch || !this.panel || !this.previewSprite || this.previewSprite.destroyed) return;
      this.hidePublished();
      if (this.previewSprite.texture !== PIXI.Texture.EMPTY) this.previewSprite.texture.destroy(true);
      this.previewSprite.texture = image ? PIXI.Texture.from(image) : PIXI.Texture.EMPTY;
      this.previewSprite.position.set(size.x,size.y);
      this.previewSprite.width = size.width; this.previewSprite.height = size.height;
      this.previewSprite.visible = !!image;
      this.drawnModel=draft.model;this.drawnLevel=`${scene.id}:${level.id}`;this.drawnOmit=omit;this.drawnPending=!!saved.pending;
      this.endWheelGhost();
    }

    change(mutate) {
      const context=session(),{draft,saved} = context;
      if (this.busy || blocked(context)) throw Error("Сначала завершите сохранение или откройте актуальную карту.");
      const next = structuredClone(draft.model);
      mutate(next);
      if (JSON.stringify(next) === JSON.stringify(draft.model)) return;
      remember(draft);
      draft.model = next; draft.dirty = true;
      draft.error=null;draft.failures=0;scheduleSave(context);
      this.refresh();
      refreshTrapMarkers();
    }

    history(redo) {
      const context=session(),{draft,saved} = context;
      if (this.busy || blocked(context)) return;
      const [from,to] = redo ? [draft.redo,draft.undo] : [draft.undo,draft.redo];
      if (!from.length) return;
      to.push(draft.model);
      draft.model = from.pop(); draft.dirty = true;
      draft.error=null;draft.failures=0;scheduleSave(context);
      this.cancel(); this.refresh();refreshTrapMarkers();
    }

    cancel() {
      clearTimeout(this.wheelTimer);this.wheelEdit=null;this.wheelCommitPending=false;
      this.furnitureDrag=null;
      if(this.furnitureSprite)this.furnitureSprite.visible=false;
      this.drag=null; this.points=[]; this.stairDraft=null; this.ghost=null; this.gestureGraphic?.clear();
      if (this.panel && edgeStairs.has(this.tool)) this.panel.querySelector(".mds-tool-hint").textContent=STAIR_HINT;
    }

    hoverStair(point,event={shiftKey:game.keyboard.isModifierActive("SHIFT")}) {
      if(this.wheelEdit){this.showFurniture(this.wheelEdit.preview);return;}
      if(this.active&&this.panel&&!this.busy&&this.furnitureDrag&&point){
        this.furnitureDrag.preview=this.furnitureDragShape(point,event);this.showFurniture(this.furnitureDrag.preview);return;
      }
      if(this.active&&this.panel&&!this.busy&&this.tool==="select"&&!this.furnitureDrag){if(!this.wheelCommitPending)this.furnitureSprite.visible=false;return;}
      if(this.active&&this.panel&&!this.busy&&!this.drag&&LIGHTS[this.tool]&&!blocked(session())&&point){
        this.showFurniture(lightFixture({kind:this.tool,at:this.point(point,event,preferences.snap,CONST.GRID_SNAPPING_MODES.CENTER),color:preferences.lightColor},dimensions(canvas.scene).size));return;
      }
      if (this.active && this.panel && !this.busy && !this.drag && PLACED[this.tool] && !blocked(session()) && point) {
        const at=this.point(point,event);
        this.showFurniture(this.furnitureShape(at));return;
      }
      if (!this.active || !this.panel || this.busy || this.drag || !this.stairDraft) return;
      const at=this.point(point,event);
      const {a,b}=this.stairDraft;
      const geometry=stairFromEdge(a,b,at);
      const shape=this.stairDraft.shape=geometry?{...geometry,kind:this.stairDraft.kind,color:preferences.stairColor}:null;
      this.drawGesture(shape?.points ?? [a,b],!!shape,shape);
    }

    finishStair(at) {
      const draft=this.stairDraft;
      if (!draft) return;
      const shape=at ? stairFromEdge(draft.a,draft.b,at) : draft.shape;
      if (!shape) return;
      this.cancel();
      this.change(model=>model.stairs.push({...shape,kind:draft.kind,color:preferences.stairColor,id:foundry.utils.randomID(),target:preferences.target}));
    }

    point(point, event, snap = preferences.snap, mode=CONST.GRID_SNAPPING_MODES.VERTEX) {
      if (!point) return null;
      const size = dimensions(canvas.scene);
      const p = snap && !event.shiftKey ? canvas.grid.getSnappedPoint(point,{mode}) : point;
      return [Math.round(Math.max(0,Math.min(size.width,p.x-size.x))),
        Math.round(Math.max(0,Math.min(size.height,p.y-size.y)))];
    }

    get tool() {return preferences.tool;}

    showFurniture(f) {
        if(!this.panel||!this.furnitureSprite||this.furnitureSprite.destroyed||(!PLACED[this.tool]&&!LIGHTS[this.tool]&&!this.furnitureDrag&&!this.wheelEdit))return;
        const key=`${f.kind}:${f.color}:${f.width}:${f.height}`;
        if(this.furnitureArt!==key){
          const raster=furnitureRasterSize(f),image=document.createElement("canvas");image.width=raster.width;image.height=raster.height;
          const ctx=image.getContext("2d");ctx.scale(raster.scale,raster.scale);
          (LIGHTS[f.kind]?drawLightFixture:TRAPS[f.kind]?drawTrap:drawFurniture)(ctx,{...f,x:0,y:0,rotation:0});
          const old=this.furnitureSprite.texture;this.furnitureSprite.texture=PIXI.Texture.from(image);
          if(old!==PIXI.Texture.EMPTY)old.destroy(true);this.furnitureArt=key;
        }
        const size=dimensions(canvas.scene),sprite=this.furnitureSprite;
        sprite.position.set(f.x+f.width/2+size.x,f.y+f.height/2+size.y);sprite.width=f.width;sprite.height=f.height;sprite.angle=f.rotation;sprite.visible=true;
    }

    furnitureDragShape(point,event) {
      const drag=this.furnitureDrag,at=this.point({x:point.x+drag.offset[0],y:point.y+drag.offset[1]},event,false);
      return this.alignFurniture({...drag.preview,x:at[0],y:at[1]},event);
    }

    alignFurniture(f,event={shiftKey:game.keyboard.isModifierActive("SHIFT")},anchor=f) {
      if(!preferences.snap||event.shiftKey)return f;
      const size=dimensions(canvas.scene),box=furnitureBounds(anchor);
      return positionFurniture(f,this.point({x:box.x+size.x,y:box.y+size.y},{shiftKey:false}));
    }

    updateFurnitureDrag(f,event={shiftKey:game.keyboard.isModifierActive("SHIFT")}) {
      const drag=this.furnitureDrag,at=this.point(canvas.mousePosition,event,false);
      drag.preview=this.alignFurniture(f,event,drag.preview);drag.offset=[drag.preview.x-at[0],drag.preview.y-at[1]];this.showFurniture(drag.preview);
    }

    furnitureShape([x,y]) {
      const kind=PLACED[this.tool],size=dimensions(canvas.scene).size*Number(preferences.furnitureScale);
      return positionFurniture({kind:this.tool,x:0,y:0,width:kind.width*size,height:kind.height*size,rotation:Number(preferences.furnitureRotation),color:preferences.furnitureColor,container:!!kind.container&&preferences.container,...(TRAPS[this.tool]&&{hidden:true})},[x,y]);
    }

    _onClickLeft(event) {
      this.finishWheelEdit();
      if (!this.panel || this.busy || blocked(session())) return;
      if(groups.points.tools.includes(this.tool)){
        if(this.placingPoint)return;
        const {scene,level}=canvas,size=dimensions(scene);
        const at=this.point(event.interactionData.origin,event,preferences.snap,CONST.GRID_SNAPPING_MODES.CENTER);
        if(!at)return;
        this.placingPoint=placePoint(scene,level,{x:at[0]+size.x,y:at[1]+size.y},this.tool==="chroniclePin"?"chronicle":"journal")
          .catch(report).finally(()=>{this.placingPoint=null;});
        return;
      }
      const at = this.point(event.interactionData.origin,event,!PASSAGES[this.tool] && !["light","brush"].includes(this.tool) && preferences.snap);
      if (!at) return;
      try {
        if(this.tool==="select"){
          const model=session().draft.model,point=this.point(event.interactionData.origin,event,false);
          this.selectedId=placedAt(model,point)?.id;this.selectedStairId=this.selectedId?null:stairAt(model,point)?.id;
          this.gestureGraphic.clear();this.refresh();
        }
        else if (PLACED[this.tool])this.change(model=>{const item={...this.furnitureShape(at),id:foundry.utils.randomID()};collection(model,item).push(item);});
        else if (edgeStairs.has(this.tool) && this.stairDraft) this.finishStair(at);
        else if (this.tool === "polygon") {
          if (!this.points?.length || distance(this.points.at(-1),at)>1) (this.points ??= []).push(at);
          this.drawGesture(this.points);
        } else if (LIGHTS[this.tool]) {
          const source=this.makeLight(this.point(event.interactionData.origin,event,preferences.snap,CONST.GRID_SNAPPING_MODES.CENTER));
          this.change(model => model.lights.push({...source,id:foundry.utils.randomID()}));
        }
      } catch (error) {report(error);}
    }

    _onClickLeft2(event) {
      if (edgeStairs.has(this.tool) && this.stairDraft) return this._onClickLeft(event);
      if (this.tool === "polygon" && this.points?.length >= 3) try {this.finishPolygon();} catch(error) {report(error);}
    }

    _onClickRight(event) {
      this.finishWheelEdit();
      const unfinished=this.drag||this.points?.length||this.stairDraft;
      this.cancel();
      if(unfinished || !this.panel || this.busy || blocked(session()))return;
      const p=event?.interactionData?.origin??canvas.mousePosition,at=this.point(p,{shiftKey:true},false);
      const {scene,level,draft}=session(),f=at&&placedAt(draft.model,at);
      if(!f){const stair=at&&stairAt(draft.model,at);if(stair){this.selectedId=null;this.selectedStairId=stair.id;this.openGroup("pointer");}return;}
      dialog().wait({window:{title:PLACED[f.kind].name,icon:"fa-solid fa-dungeon"},classes:["mjl-brand"],content:TRAPS[f.kind]?"Действие с ловушкой":"Действие с выбранной мебелью",rejectClose:false,buttons:[
        {action:"rotate",label:"Повернуть 90°",callback:()=>this.change(model=>{const item=collection(model,f).find(i=>i.id===f.id);Object.assign(item,this.alignFurniture({...item,rotation:(item.rotation+90)%360},undefined,item));})},
        {action:"delete",label:"Удалить",callback:()=>this.change(model=>{const items=collection(model,f),index=items.findIndex(i=>i.id===f.id);if(index>=0)items.splice(index,1);})},
        ...(TRAPS[f.kind]?[{action:"visibility",label:trapHidden(f)?"Показать игрокам":"Скрыть от игроков",callback:()=>this.toggleTrap(f.id)}]:[]),
        ...(f.container?[{action:"inventory",label:"Содержимое",callback:()=>openContainer(scene,level.id,f)}]:[])
      ]}).catch(report);
    }

    finishPolygon() {const ring = this.points; this.cancel(); this.floor([ring]);}

    floor(paths) {
      const size = dimensions(canvas.scene);
      this.change(model => {
        const geometry = combine(model.floor,paths,preferences.cut ? "ctDifference" : "ctUnion");
        model.floor = combine(geometry,[rectangle([0,0],[size.width,size.height])],"ctIntersection");
        // Drop anchors no longer carried by the floor edge or an interior wall.
        const activeDoors = new Set(wallsForDoors(model));
        model.doors = model.doors.filter(d => activeDoors.has(doorKey(d)));
      });
    }

    async floorSetup() {
      const scene=canvas.scene;
      return configureFloors(scene,{
        beforeSave:async()=>{
          this.finishWheelEdit();this.cancel();await saveQueue.catch(()=>{});
          for(const level of scene.levels){const context=session(scene,level);if(context.draft.dirty||context.saved.pending)await saveNow(context);}
        },
        afterSave:async()=>{
          for(const level of scene.levels){
            const context=session(scene,level);if(!context.saved.rev&&!owned(scene,"Region",level.id).length)continue;
            context.draft.saving=true;
            try{await publishDraft(scene,level,context.draft);}finally{context.draft.saving=false;refreshDraft(context);}
          }
          if(canvas.scene?.id===scene.id)canvas[NAME]?.refresh();
        }
      });
    }

    _onDragLeftStart(event) {
      this.finishWheelEdit();
      if(this.tool==="select"&&this.panel&&!this.busy&&!blocked(session())){
        const at=this.point(event.interactionData.origin,event,false),f=placedAt(session().draft.model,at);
        if(!f)return;
        this.selectedId=f.id;this.selectedStairId=null;this.furnitureDrag={id:f.id,original:f,preview:{...f},offset:[f.x-at[0],f.y-at[1]]};
        this.renderPreview({omit:f.id}).catch(report);this.showFurniture(f);return;
      }
      if (!this.panel || this.busy || blocked(session()) || !dragTools.has(this.tool)) return;
      if (edgeStairs.has(this.tool) && this.stairDraft) return;
      const a = this.point(event.interactionData.origin,event,preferences.snap && this.tool!=="brush");
      if (a) this.drag = {a, points:[a], tool:this.tool};
    }

    _onDragLeftMove(event) {
      if(this.furnitureDrag)return; // The high-priority ticker consumes the latest pointer once per rendered frame.
      const drag = this.drag;
      if (!drag) return;
      const b = this.point(event.interactionData.destination,event,preferences.snap && drag.tool!=="brush");
      if (!b) return;
      if(drag.tool==="hatch"){const shape={points:rectangle(drag.a,b),kind:"hatch",color:preferences.stairColor};this.drawGesture(shape.points,true,shape);return;}
      // ponytail: cap a gesture at 800 samples; resample for equally detailed longer strokes.
      if (drag.tool === "brush" && distance(drag.points.at(-1),b)>8 && drag.points.length<800) drag.points.push(b);
      this.drawGesture(drag.tool === "brush" ? [...drag.points,b] :
        drag.tool === "ellipse" ? ellipse(drag.a,b) :
        lineTools.has(drag.tool) || edgeStairs.has(drag.tool) ? [drag.a,b] : rectangle(drag.a,b),
      drag.tool!=="brush" && !edgeStairs.has(drag.tool) && !lineTools.has(drag.tool));
    }

    _onDragLeftDrop(event) {
      if(this.furnitureDrag){
        const drag=this.furnitureDrag,point=event.interactionData.destination;
        const placed=this.furnitureDragShape(point,event);
        this.furnitureDrag=null;this.furnitureSprite.visible=false;
        this.change(model=>{const f=placedItems(model).find(f=>f.id===drag.id);Object.assign(f,placed);});
        this.renderPreview().catch(report);return;
      }
      const drag = this.drag;
      if (!drag) return;
      this.drag = null; this.ghost = null; this.gestureGraphic.clear();
      const {a,tool,points} = drag;
      const b = this.point(event.interactionData.destination,event,preferences.snap && tool!=="brush");
      if (!b || distance(a,b)<2 && tool!=="brush") return;
      const box = bounds(a,b);
      try {
        if (tool === "brush") this.floor(brush([...points,b],Math.max(5,dimensions(canvas.scene).size*0.16)));
        else if (["wall","invisible","railing"].includes(tool)) this.change(model => model.walls.push({a,b,kind:tool}));
        else if (PASSAGES[tool]) this.change(model => model.doors.push({a,b,kind:tool,free:true}));
        else if (edgeStairs.has(tool)) {
          this.stairDraft={a,b,kind:tool,shape:null};
          this.drawGesture([a,b]);this.refresh();
        }
        else if (box.width < 2 || box.height < 2) return;
        else if(tool==="opening")this.change(model=>{
          const points=rectangle([box.x,box.y],[box.x+box.width,box.y+box.height]);
          model.floor=combine(model.floor,[points],"ctDifference");(model.openings??=[]).push({points,railing:preferences.openingRailing});
        });
        else if(tool==="hatch")this.change(model=>model.stairs.push({points:rectangle([box.x,box.y],[box.x+box.width,box.y+box.height]),kind:tool,color:preferences.stairColor,target:preferences.target,id:foundry.utils.randomID()}));
        else if (tool === "erase") this.change(model => eraseObjects(model,box));
        else if (tool === "paint") this.change(model => model.paint.push({shape:[rectangle(a,b)],style:preferences.style}));
        else this.floor([tool === "ellipse" ? ellipse(a,b) : rectangle(a,b)]);
      } catch (error) {report(error);}
    }

    _onDragLeftCancel() {
      // Foundry also calls cancellation after a successful drop; retain the confirmed first edge.
      if (this.stairDraft && canvas.mouseInteractionManager.state===canvas.mouseInteractionManager.states.DROP) return;
      this.cancel();
      if(this.panel)this.renderPreview().catch(report);
      if(this.tool==="select"&&this.selected())this.drawGesture(stairOutline(this.selected()),true);
      else if(this.tool==="select"&&this.selectedStair())this.drawGesture(stairOutline(this.selectedStair()),true);
    }

    drawGesture(points, closed = false, stair = null) {
      if (!this.gestureGraphic || !points.length) return;
      this.ghost = {points,closed,stair};
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (!this.panel || !this.gestureGraphic || this.gestureGraphic.destroyed || !this.ghost) return;
        const size = dimensions(canvas.scene);
        const g = this.gestureGraphic;
        g.clear();g.lineStyle({width:this.drag?.tool === "brush" ? Math.max(10,size.size*0.32) : 3,color:preferences.cut ? 0xe87368 : 0x6bc7c0,alpha:0.85,cap:PIXI.LINE_CAP.ROUND,join:PIXI.LINE_JOIN.ROUND});
        const {points,closed} = this.ghost;
        if(this.ghost.stair)g.beginFill(parseInt((this.ghost.stair.color??STAIR_COLOR).slice(1),16),1);
        g.moveTo(points[0][0]+size.x,points[0][1]+size.y);
        for (const [x,y] of points.slice(1)) g.lineTo(x+size.x,y+size.y);
        if (closed) g.closePath();
        if(this.ghost.stair)g.endFill();
        if (this.ghost.stair&&this.ghost.stair.kind!=="hatch") for (const [a,b] of stairLines(this.ghost.stair,Math.max(12,size.size*(this.ghost.stair.kind==="steps"?.5:.18)),this.ghost.stair.kind==="steps"?1:4)) {
          g.moveTo(a[0]+size.x,a[1]+size.y);g.lineTo(b[0]+size.x,b[1]+size.y);
        }
      });
    }

    async action(name) {
      this.finishWheelEdit();
      if(name==="selectedStairDelete"&&this.selectedStair())return this.shortcut({id:"delete"});
      if(name==="selectedInventory"&&this.selected())return openContainer(canvas.scene,canvas.level.id,this.selected());
      if(name==="selectedDelete"&&this.selected())return this.shortcut({id:"delete"});
      if(name==="rotate")return this.shortcut({id:"rotate"});
      if(name==="inventories")return inventoryBackup();
      if(name==="floorSetup")return this.floorSetup();
      if(name==="cleanupAssets"&&localCleanup()){
        const world=game.world.id;
        if(/Electron\//.test(navigator.userAgent)){
          window.open(foundry.utils.getRoute(`modules/${ID}/host/launch-cleanup-${world}.svg`),"_blank","noopener");
        }else{
          ui.notifications.info("Проверка может занять несколько минут. Подтверждение появится в окне Windows.");
          location.assign(`mjl-dungeon-sketch-cleanup-${world}://run`);
        }
        return;
      }
      if (name === "help") {
        return dialog().prompt({window:{title:`${TITLE} · Горячие клавиши`,icon:"fa-solid fa-keyboard"},classes:["mjl-brand","mds-hotkeys-dialog"],position:{width:600},
          content:`<p>Работают при открытом редакторе в категории «Подземелье». При вводе текста и в диалогах команды редактора не выполняются. Буквы указаны для английской раскладки.</p>
          <div class="mds-hotkeys-list"><table><thead><tr><th>Клавиши</th><th>Действие</th></tr></thead><tbody>
          <tr><td>Shift (удерживать)</td><td>Временно рисовать без привязки к сетке</td></tr>
          <tr><td>Alt + колесо</td><td>Поворот мебели на 15° за шаг</td></tr><tr><td>Shift + колесо</td><td>Пропорциональное изменение размера мебели</td></tr>
          ${shortcuts.map(s=>`<tr><td>${foundry.utils.escapeHTML(shortcutLabel(s.id))||"Не назначено"}</td><td>${s.name}</td></tr>`).join("")}</tbody></table></div>
          <p>Удаление областью включает ластик: обведите объекты мышью. Для пола включите «Вырезать пол» и нарисуйте вырез. Завершённые действия автоматически сохраняются и становятся видны игрокам.</p>
          <p>Изменить сочетания: Настройки игры → Настройка управления → ${TITLE}.</p>`,
          modal:true,rejectClose:false,ok:{label:"Понятно"}});
      }
      if (this.busy) return;
      if (name === "undo" || name === "redo") return this.history(name === "redo");
      if(name==="apply")return saveNow();
      const {scene,level,draft,saved} = session();
      const clearing=name==="clear" || saved.pending?.operation==="clear";
      if (name === "clear") {
        if (!await dialog().confirm({window:{title:"Очистить этаж",icon:"fa-solid fa-dungeon"},classes:["mjl-brand"],content:"Сразу удалить опубликованный рисунок, стены, двери, свет и переходы Dungeon Sketch на текущем этаже для всех участников? Незавершённая публикация этого этажа будет отменена. Объекты других этажей и созданные вручную сохранятся.",modal:true,rejectClose:false})) return;
        this.cancel();
      }
      if (name === "generate") return this.generateMap();
      if (name === "theme") return this.theme();
      if (name === "background" && !await dialog().confirm({window:{title:"Заменить фон этажа",icon:"fa-solid fa-image"},classes:["mjl-brand"],
        content:"Текущий фон этого этажа будет заменён изображением подземелья.",modal:true,rejectClose:false})) return;
      draft.manual=true;clearTimeout(draft.saveTimer);
      this.busy=true; this.refresh();
      try {
        await draft.queued?.catch(()=>{});
        if(name==="clear"){
          draft.clear=true;
          if(JSON.stringify(draft.model)!==JSON.stringify(empty())){remember(draft);draft.model=empty();draft.dirty=true;}
        }
        if (name === "export") {
          const blob = await png(await drawMap(draft.model,dimensions(scene),styles()));
          foundry.utils.saveDataToFile(blob, "image/png", `dungeon-${scene.id}-${level.id}.png`);
        } else {
          const result = await publish(scene,level,draft.model,draft.rev,name==="background" ? "background" : read(scene,level).mode,{clear:name==="clear"});
          if (clearing && JSON.stringify(draft.model)!==JSON.stringify(result.model)) remember(draft);
          Object.assign(draft,{rev:result.rev,model:structuredClone(result.model),dirty:false});
          draft.error=null;draft.failures=0;draft.clear=false;
          ui.notifications.info(clearing ? "Этаж очищен: рисунок и объекты Dungeon Sketch удалены." : "Подземелье опубликовано.");
        }
      } finally {draft.manual=false;this.busy=false;this.refresh();scheduleSave({scene,level,draft});}
    }

    async generateMap() {
      const form = await dialog().input({window:{title:"Генератор подземелий",icon:"fa-solid fa-dungeon"},classes:["mjl-brand"],modal:true,rejectClose:false,
        content:`<p>Генератор заменит черновик этажа. Его результат можно отменить.</p>
        <label>Тип <select name="mode"><option value="rooms">Комнаты и коридоры</option><option value="loop">Кольцевые маршруты</option><option value="cave">Пещеры</option></select></label>
        <label>Seed <input name="seed" value="dungeon-1" maxlength="80"></label>
        <label>Цель по комнатам <input name="count" type="number" value="12" min="1" max="40" step="1"></label>`});
      if (!form) return;
      const size=dimensions(canvas.scene);
      const floor=generate({...size,...form});
      this.change(model=>Object.assign(model,empty(),{floor,style:preferences.style}));
    }

    async theme(entireFloor=false) {
      if (this.busy || blocked(session())) throw Error("Сначала завершите сохранение.");
      const selected=entireFloor ? session().draft.model.style : preferences.style;
      const style = ({...PRESETS,...styles()})[selected] ?? PRESETS.stone;
      const section = (kind, label) => `<fieldset><legend>${label}</legend>
        <label>Рисунок<select name="${kind}Pattern"></select></label>
        <label data-custom="${kind}">Свой файл<file-picker name="${kind}Texture" type="image"></file-picker></label>
        <div class="mds-colors" role="group" aria-label="Цвет · ${label}">${COLORS.map(([name,color]) =>
          `<button type="button" class="mds-color" data-color="${color}" data-kind="${kind}" style="background-color:${color}" title="${name}" aria-label="${name}" aria-pressed="false"></button>`).join("")}</div>
        <label>Свой цвет<input name="${kind}" type="color" aria-label="Цвет · ${label}"></label></fieldset>`;
      const form = await dialog().input({window:{title:entireFloor ? "Стиль всего этажа" : "Стиль кисти",icon:"fa-solid fa-palette"},classes:["mjl-brand","mds-theme-dialog"],
        position:{width:600},modal:true,rejectClose:false,
        content:`<label>Название стиля<input name="name" maxlength="50" required></label>
        <div class="mds-materials">${section("floor","Пол")}${section("wall","Стены")}</div>
        <label>Толщина стен<input name="width" type="number" min="1" max="36" step="1" required></label>
        <div class="mds-style-preview-host"></div>
        <p class="mds-texture-error" role="status" hidden></p>
        <p>${entireFloor ? "Стиль заменит оформление всего текущего этажа, включая ранее окрашенные области. Изменение можно отменить; оно сохранится автоматически." : "Стиль используется для кисти оформления. Стиль всего этажа настраивается кнопкой палитры слева."}</p>`,
        buttons:[{action:"cancel",label:"Отмена",callback:()=>false}],
        ok:{label:"Сохранить стиль"},
        render:(_event,app)=>{
          const root = app.element;
          const canvas=document.createElement("canvas");
          canvas.className="mds-style-preview";
          canvas.width=512;canvas.height=180;
          canvas.setAttribute("role","img");
          canvas.setAttribute("aria-label","Предпросмотр выбранного пола и стен");
          root.querySelector(".mds-style-preview-host").replaceChildren(canvas);
          for(const [key,value] of Object.entries(style)) {
            const field=root.querySelector(`[name="${key}"]`);
            if(field) field.value=value;
          }
          for (const [kind, textures] of [["floor",FLOOR_TEXTURES],["wall",WALL_TEXTURES]]) {
            const src = style[`${kind}Texture`] ?? "";
            options(root.querySelector(`[name="${kind}Pattern"]`),[...textures,["custom","Свой файл…"]],
              textures.some(([path])=>path===src) ? src : "custom");
            root.querySelector(`[data-custom="${kind}"]`).hidden = textures.some(([path])=>path===src);
          }
          let epoch=0;
          const sample = {...empty(),style:"sample",floor:[rectangle([14,14],[498,166])],
            walls:[{a:[290,14],b:[290,110],kind:"wall"}]};
          const preview = async () => {
            const current=++epoch;
            for (const swatch of root.querySelectorAll("[data-color]"))
              swatch.setAttribute("aria-pressed",String(swatch.dataset.color===root.querySelector(`[name="${swatch.dataset.kind}"]`).value));
            const values = Object.fromEntries(["floor","wall","width","floorTexture","wallTexture"].map(key =>
              [key,root.querySelector(`[name="${key}"]`).value]));
            values.width=Math.min(36,Math.max(1,Number(values.width)||7));
            const error=root.querySelector(".mds-texture-error");
            try {
              const image=await drawMap(sample,{width:512,height:180},{sample:values});
              if(current!==epoch || !root.isConnected) return;
              const ctx=canvas.getContext("2d");
              ctx.clearRect(0,0,512,180);ctx.drawImage(image,0,0);
              error.hidden=true;
            } catch (exception) {
              if(current!==epoch) return;
              error.textContent=exception.message;error.hidden=false;
            }
          };
          root.addEventListener("click",event=>{
            const swatch=event.target.closest("[data-color]");
            if(!swatch) return;
            root.querySelector(`[name="${swatch.dataset.kind}"]`).value=swatch.dataset.color;
            preview();
          });
          root.addEventListener("change",event=>{
            const kind=event.target.name==="floorPattern" ? "floor" : event.target.name==="wallPattern" ? "wall" : null;
            if(kind) {
              const custom=event.target.value==="custom";
              root.querySelector(`[data-custom="${kind}"]`).hidden=!custom;
              if(!custom) root.querySelector(`[name="${kind}Texture"]`).value=event.target.value;
            }
            preview();
          });
          root.addEventListener("input",preview);
          preview();
        }});
      if (!form) return;
      const name = String(form.name ?? "").trim();
      if (!name) throw Error("Укажите название стиля.");
      // Copy styles so changing this floor never recolors another floor or an old paint patch.
      const key = foundry.utils.randomID();
      const {floor,wall,floorTexture,wallTexture}=form;
      const next={name,floor,wall,floorTexture,wallTexture,width:Math.min(36,Math.max(1,Number(form.width)||7))};
      await game.settings.set(ID,"styles",{...styles(),[key]:next});
      preferences.style=key;
      if (entireFloor) this.change(model=>{model.style=key;model.paint=[];});
      this.refresh();
    }
  };
}

const doorKey = ({a,b,kind}) => `${kind}:${[a.join(","),b.join(",")].sort().join(":")}`;
const wallsForDoors = model => wallsFor(model).filter(w=>PASSAGES[w.kind]).map(doorKey);

Hooks.once("init",()=>{
  installLootDragDrop();
  installStairGuard();
  game.settings.register(ID,"styles",{scope:"world",config:false,type:Object,default:{}});
  game.settings.register(ID,"lowerFloorContrast",{name:"Затемнять нижние этажи",hint:"Видимая карта нижних этажей темнее по глубине. Текущий этаж сохраняет исходные цвета.",scope:"client",config:true,type:Boolean,default:true,onChange:()=>{refreshLevelContrast();canvas?.[NAME]?.refresh();}});
  Hooks.on("drawTile",refreshFloorTile);
  Hooks.on("refreshTile",refreshFloorTile);
  Hooks.on("drawPrimaryCanvasGroup",refreshLevelContrast);
  Hooks.on("canvasReady",refreshLevelContrast);
  CONFIG.Canvas.layers[NAME]={layerClass:makeLayer(),group:"interface"};
  for (const shortcut of shortcuts) game.keybindings.register(ID,shortcut.id,{
    name:shortcut.name,hint:"При открытом редакторе Dungeon Sketch. Не действует в полях ввода и диалогах.",
    editable:shortcut.bindings,restricted:true,precedence:CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown:()=>{
      const layer=canvas?.[NAME];
      if (!canvas?.ready || !layer?.active || !layer.panel || document.querySelector("dialog[open]") ||
        (document.activeElement?.closest?.(".application") && !layer.drawer?.element?.contains(document.activeElement))) return false;
      try {return layer.shortcut(shortcut);} catch(error) {report(error);return true;}
    }
  });
});
Hooks.on("canvasReady",()=>{
  connectContainers();
  installContainerInteraction();
  installTrapInteraction();
  installLightInteraction(requestLightSwitch);
  const layer=canvas[NAME];
  if (game.user.isGM && editorWanted && ui.controls.control?.name===NAME) {
    if (!layer.active) layer.activate();
    else layer.open();
  }
});
Hooks.once("socketlib.ready",connectContainers);
Hooks.once("ready",()=>{
  if(game.modules.get("socketlib")?.active)connectContainers();
  if(!game.users.activeGM?.isSelf)return;
  for(const scene of game.scenes){
    for(const levelId of Object.keys(scene.flags[ID]??{})){
      if(!scene.levels.has(levelId))discardDeletedFloor(scene,levelId).catch(report);
    }
    for(const level of scene.levels){
      if(!hasLegacyImages(scene,level))continue;
      const context=session(scene,level);
      context.draft.dirty=true;
      saveNow(context).catch(report);
    }
  }
});
Hooks.on("deleteLevel",level=>{
  if(game.users.activeGM?.isSelf){
    saveQueue=saveQueue.catch(()=>{}).then(()=>discardDeletedFloor(level.parent,level.id)).catch(report);
  }
});
Hooks.once("canvasReady",()=>{
  Hooks.on("drawTile",tile=>{if(tile.document.getFlag(ID,"level")===canvas.level?.id)canvas[NAME]?.hidePublished();});
  let pointer,dirty=false;
  window.addEventListener("beforeunload",event=>{
    if([...drafts.values()].some(d=>d.dirty||d.saving||d.clear)){event.preventDefault();event.returnValue="";}
  });
  window.addEventListener("pointermove",event=>{
    const layer=canvas?.[NAME];
    if(event.target!==canvas.app.view){
      pointer=null;dirty=false;if(layer?.furnitureSprite)layer.furnitureSprite.visible=false;return;
    }
    if(!canvas.ready||!layer?.active||!layer.panel||layer.busy)return;
    pointer={x:event.clientX,y:event.clientY,shiftKey:event.shiftKey};dirty=true;
  },{passive:true});
  window.addEventListener("wheel",event=>{
    if(event.target!==canvas.app.view)return;
    try{if(canvas[NAME]?.furnitureWheel(event)){event.preventDefault();event.stopImmediatePropagation();}}
    catch(error){event.preventDefault();event.stopImmediatePropagation();report(error);}
  },{capture:true,passive:false});
  for(const type of ["keydown","keyup"])window.addEventListener(type,event=>{
    if(event.key==="Shift"&&pointer){pointer.shiftKey=event.shiftKey;dirty=true;}
  });
  Hooks.on("canvasPan",()=>{if(pointer)dirty=true;});
  // Foundry's registered mouse-move handlers are throttled to 100ms. Update before this frame's render instead.
  canvas.app.ticker.add(()=>{
    if(!dirty||!pointer||!canvas.ready)return;
    dirty=false;const layer=canvas[NAME];
    if(layer?.active&&layer.panel&&!layer.busy)layer.hoverStair(canvas.canvasCoordinatesFromClient(pointer),pointer);
  },undefined,PIXI.UPDATE_PRIORITY.HIGH);
});
