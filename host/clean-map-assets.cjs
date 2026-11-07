// Run on the Foundry host. The native FilePicker has no delete operation.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");

const namePattern = /mjl-dungeon-sketch-(?:[a-z0-9]{16}-[a-z0-9]{16}-(?:live-[01]|[a-f0-9]{8,64}|map-[a-z0-9]{16,20})|trap-(?:[a-f0-9]{8,64}|image-[a-z0-9]{16,20}))\.(?:png|webp)/gi;
const managed = name => name.match(namePattern)?.[0] === name;
const databaseFile = /^(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|log))$/;

async function filesBelow(dir, entries) {
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await filesBelow(file, entries);
    else if (entry.isFile() && /^(?:CURRENT|[^.].*\.(?:db|json))$/.test(entry.name)) entries.push(file);
  }
}

async function signature(dir) {
  const files = (await fs.readdir(dir)).filter(name => databaseFile.test(name)).sort();
  return Promise.all(files.map(async name => {
    const stat = await fs.stat(path.join(dir, name), {bigint: true});
    return [name, stat.size.toString(), stat.mtimeNs.toString()];
  }));
}

async function clean(world, app, mode, minAge = 30 * 60_000, confirm = async () => true) {
  world = await fs.realpath(world);
  const worlds = path.dirname(world);
  if (path.basename(worlds) !== "worlds") throw Error("Expected a world under Data/worlds");
  const data = path.dirname(worlds);
  const {ClassicLevel} = require(path.join(app, "node_modules", "classic-level"));
  const candidates = new Map();
  for (const dir of [world, path.join(world, "mjl-dungeon-sketch")]) {
    try {
      if (await fs.realpath(dir) !== dir) throw Error(`Unexpected assets directory: ${dir}`);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
      if (!entry.isFile() || !managed(entry.name)) continue;
      const file = path.join(dir, entry.name);
      candidates.set(file, await fs.stat(file, {bigint: true}));
    }
  }
  if (!candidates.size) return [];
  const started = Date.now();
  const recent = stat => started - Number(stat.mtimeMs) < minAge;
  const names = new Set([...candidates]
    .filter(([,stat])=>mode!=="--apply"||!recent(stat))
    .map(([file])=>path.basename(file).toLowerCase()));
  if (!names.size) return [];
  const refs = new Map();
  const record = (value, source) => {
    for (const match of value.matchAll(namePattern)) {
      const name = match[0].toLowerCase();
      if (names.has(name) && !refs.has(name)) refs.set(name, path.relative(data, source));
    }
  };
  const snapshots = new Map();
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "mjl-sketch-"));
  try {
    async function scan(file, index) {
      if (path.basename(file) !== "CURRENT") {
        record(await fs.readFile(file, "utf8"), file);
        return;
      }
      const dir = path.dirname(file);
      const before = await signature(dir);
      const copy = path.join(scratch, String(index));
      await fs.mkdir(copy);
      for (const [name] of before) await fs.copyFile(path.join(dir, name), path.join(copy, name));
      const expected = JSON.stringify(before);
      if (expected !== JSON.stringify(await signature(dir))) throw Error(`Database changed during snapshot: ${dir}`);
      snapshots.set(dir, expected);
      const db = new ClassicLevel(copy, {createIfMissing: false});
      await db.open();
      try { for await (const [, value] of db.iterator()) record(value, dir); }
      finally { await db.close(); }
    }
    const primary = path.join(world,"data","scenes","CURRENT");
    if (await fs.stat(primary).then(stat=>stat.isFile(),error=>{
      if(error.code==="ENOENT")return false;
      throw error;
    })) await scan(primary,0);
    if (refs.size < names.size) {
      const records = [];
      for (const root of [worlds, path.join(data,"modules"), path.join(data,"systems")]) await filesBelow(root,records);
      const others=records.filter(file=>file!==primary);
      for(let i=0;i<others.length&&refs.size<names.size;i+=8){
        const batch=await Promise.allSettled(others.slice(i,i+8).map((file,j)=>scan(file,i+j+1)));
        const failure=batch.find(result=>result.status==="rejected");
        if(failure)throw failure.reason;
      }
    }
    const results = [...candidates].map(([file, stat]) => ({
      file, referencedBy: refs.get(path.basename(file).toLowerCase()),
      recent: recent(stat)
    }));
    if (mode !== "--apply") return results;
    const unused = results.filter(row=>!row.referencedBy&&!row.recent);
    if (!unused.length || !await confirm(unused)) return [];
    for (const [dir, expected] of snapshots) {
      if (expected !== JSON.stringify(await signature(dir))) throw Error(`Database changed during scan: ${dir}`);
    }
    const removed = [];
    for (const {file} of unused) {
      const before = candidates.get(file);
      const now = await fs.lstat(file, {bigint: true}).catch(error=>{
        if(error.code==="ENOENT")return null;
        throw error;
      });
      if (!now) continue;
      if (!now.isFile() || now.ino !== before.ino || now.mtimeNs !== before.mtimeNs || now.size !== before.size) continue;
      await fs.unlink(file);
      removed.push({file});
    }
    return removed;
  } finally {
    const actual = await fs.realpath(scratch);
    if (path.dirname(actual) === await fs.realpath(os.tmpdir()) && path.basename(actual).startsWith("mjl-sketch-")) {
      await fs.rm(actual, {recursive: true, force: true});
    }
  }
}

async function popup(message, buttons) {
  const quoted = message.replaceAll("'", "''");
  const script = `(New-Object -ComObject WScript.Shell).Popup('${quoted}',0,'Dungeon Sketch',${65536+buttons})`;
  const shell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const {stdout} = await promisify(execFile)(shell,["-NoProfile","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{windowsHide:true});
  return Number(stdout.trim());
}

async function interactive(world, app) {
  try {
    let cancelled=false;
    const removed=await clean(world,app,"--apply",30*60_000,async unused=>{
      const mb=(await Promise.all(unused.map(({file})=>fs.stat(file))))
        .reduce((sum,stat)=>sum+stat.size,0)/1024**2;
      cancelled=await popup(`Мир «${path.basename(world)}»\nНайдено файлов без ссылок: ${unused.length} (${mb.toFixed(2)} МБ).\n\nУдалить их с диска?`,292)!==6;
      return !cancelled;
    });
    if(!cancelled)await popup(removed.length?`Удалено файлов: ${removed.length}.`:"Файлов для очистки нет.",64);
  } catch(error) {
    await popup(`Очистка прервана.\n${error.message}`,48);
    throw error;
  }
}

module.exports = {clean};
if (require.main === module) {
  const [world, app, mode] = process.argv.slice(2);
  if (!world || !app || !["--audit", "--apply", "--prompt"].includes(mode)) {
    console.error("Usage: node clean-map-assets.cjs <Data/worlds/world> <Foundry/resources/app> --audit|--apply|--prompt");
    process.exitCode = 1;
  } else (mode==="--prompt"?interactive(world,app):clean(world,app,mode).then(results=>console.log(JSON.stringify(results,null,2)))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
