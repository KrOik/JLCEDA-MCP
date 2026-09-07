import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {call,invoke} from './client.mjs';
const file=new URL('./outer-net-e2e.json',import.meta.url);
const old=await readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return undefined;});
if(process.argv[2]==='cleanup-failed') {
  assert.equal(old?.phase,'inspect-failure');
  const target={targetClientId:old.clientId};
  const ctx=await call('eda_context',target);assert.equal(ctx.currentSchematicInfo.uuid,old.schematic);
  const pages=await invoke('eda.dmt_Schematic.getCurrentSchematicAllSchematicPagesInfo',[],target);
  assert.ok(pages.some(p=>p.uuid===old.page&&p.name.toUpperCase()==='OUTER_NET_170_TEST'));
  assert.notEqual(old.page,old.originalPage);
  await call('document_focus',{...target,documentUuid:old.originalPage});await new Promise(r=>setTimeout(r,1200));
  assert.equal(await invoke('eda.dmt_Schematic.deleteSchematicPage',[old.page],target),true);
  old.cleanedUp=true;await writeFile(file,JSON.stringify(old,null,2));console.log('Removed only recorded failed test page; original page retained.');process.exit(0);
}
assert.ok(!old||old.cleanedUp,'Existing test journal: inspect instead of replaying writes');
const client=(await call('bridge_status')).clients.find(c=>c.active);
assert.ok(client);
const target={targetClientId:client.clientId};
const ctx=await call('eda_context',target);
assert.equal(ctx.hotUpdate.revision,(await (await fetch('http://127.0.0.1:7655/ota/manifest')).json()).sha256,'Wait for the published module before writing');
const j={clientId:client.clientId,originalPage:ctx.currentDocumentInfo.uuid,schematic:ctx.currentSchematicInfo.uuid,phase:'create-page-intent',...(old?{previous:old}:{}),revision:ctx.hotUpdate.revision};
const save=()=>writeFile(file,JSON.stringify(j,null,2));await save();
j.page=await invoke('eda.dmt_Schematic.createSchematicPage',[j.schematic],target);await save();assert.ok(j.page);
for(let n=0;n<40;n++) {
  if((await call('bridge_status')).clients.find(c=>c.clientId===client.clientId)?.context?.documentUuid===j.page)break;
  await new Promise(r=>setTimeout(r,150));
}
target.targetDocumentUuid=j.page;
await invoke('eda.dmt_Schematic.modifySchematicPageName',[j.page,'OUTER_NET_170_TEST'],target);
j.phase='place-intent';await save();
j.placement=await call('component_place',{...target,layout:{mode:'grid'},components:[{uuid:'accfc2f6010745268febab2459577079',libraryUuid:'0819f05c4eef4c71ace90d822a990e87',designator:'U2901',x:600,y:400}]});await save();
assert.equal(j.placement.ok,true);j.componentId=j.placement.results[0].primitiveId;
j.assignments=['1','2','3','4','45','46','47','48'].map(pinNumber=>({componentId:j.componentId,pinNumber,netName:`LABEL_TEST_${pinNumber}`}));
j.phase='wire-intent';await save();
j.connection=await call('pin_net_configure',{...target,routing:'staircase',netLabelPlacement:'outer',assignments:j.assignments},{allowError:true});await save();
j.phase=j.connection.ok?'done':'inspect-failure';await save();
console.log(JSON.stringify(j.connection));
assert.equal(j.connection.ok,true);assert.equal(j.connection.connectionVerification.confirmed,8);assert.equal(j.connection.textGeometryVerified,true);
j.saved=await invoke('eda.sch_Document.save',[],target);await save();assert.equal(j.saved,true);
