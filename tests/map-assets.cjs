const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {clean} = require("../host/clean-map-assets.cjs");

async function test(app) {
  const {ClassicLevel} = require(path.join(app, "node_modules", "classic-level"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "mjl-map-test-"));
  try {
    const world = path.join(data, "worlds", "test");
    const assets = path.join(world, "mjl-dungeon-sketch");
    for (const dir of [assets, path.join(world,"data"), path.join(data,"modules","library"), path.join(data,"systems")]) {
      await fs.mkdir(dir, {recursive: true});
    }
    const map = hash => `mjl-dungeon-sketch-defaultLevel0000-defaultLevel0000-map-${hash.repeat(20)}.webp`;
    const legacy = "mjl-dungeon-sketch-defaultLevel0000-defaultLevel0000-live-0.webp";
    const trap = `mjl-dungeon-sketch-trap-image-${"a".repeat(20)}.webp`;
    const names = [map("a"),map("b"),map("c"),map("d"),trap,legacy,"outside.webp"];
    for (const name of names) {
      const file = path.join(name === legacy ? world : assets,name);
      await fs.writeFile(file, "");
      if (name !== map("d")) await fs.utimes(file, new Date(0), new Date(0));
    }
    const db = new ClassicLevel(path.join(world,"data","scenes"),{valueEncoding:"json"});
    await db.open();
    await db.put("!scenes!scene", {flags: {pending:{asset:`worlds/test/mjl-dungeon-sketch/${map("a")}?v=1`}}});
    await db.put("!scenes.tiles!scene.shared", {texture:{src:trap}});
    await db.close();
    await fs.writeFile(path.join(data,"modules","library","scenes.db"),JSON.stringify({img:map("b")}));
    const audit = await clean(world,app,"--audit");
    assert.equal(audit.filter(row=>row.referencedBy).length,3);
    let preview;
    assert.deepEqual(await clean(world,app,"--apply",undefined,async unused=>{
      preview=unused.map(row=>path.basename(row.file)).sort();
      return false;
    }),[]);
    assert.deepEqual(preview,[legacy,map("c")].sort());
    assert.equal((await fs.readdir(assets)).length,names.length-1);
    const removed = await clean(world,app,"--apply");
    assert.deepEqual(removed.map(row=>path.basename(row.file)).sort(),[legacy,map("c")].sort());
    assert.deepEqual((await fs.readdir(assets)).sort(),[map("a"),map("b"),map("d"),trap,"outside.webp"].sort());
    console.log("OK: collector keeps pending, compendium and shared images, recent uploads and unmanaged files; removes only abandoned files.");
  } finally {
    const resolved = await fs.realpath(data);
    if(path.dirname(resolved)===await fs.realpath(os.tmpdir())&&path.basename(resolved).startsWith("mjl-map-test-")) {
      await fs.rm(resolved,{recursive:true,force:true});
    }
  }
}

test(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
