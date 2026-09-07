// Controlled native experiment: create a dedicated page, one MCU and four nets.
// Cleanup is a separate explicit command, scoped by the recorded page UUID.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {call,invoke} from './client.mjs';
import {prepare,planRows,audit} from './planner.mjs';
const journalUrl=new URL('./native-probe.json',import.meta.url);
const command=process.argv[2];
if(command==='create'||command==='resume'||command==='recovered'){
  // Refuse to overwrite a journal for an unfinished experiment.
  const old=await readFile(journalUrl,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return undefined;});
  assert.ok(command==='recovered'?old?.page&&old.phase==='placement-uncertain':command==='resume'?old?.page&&!old.placement&&!old.phase:!old||old.cleanedUp,'An unfinished probe already exists or cannot be resumed');
  const fixture=JSON.parse(await readFile(new URL('./live-fixture.json',import.meta.url),'utf8'));
  const ctx=await call('eda_context');
  const j=command==='resume'||command==='recovered'?old:{originalPage:ctx.currentDocumentInfo.uuid,schematicUuid:ctx.currentSchematicInfo.uuid,createdIds:[],createdAt:new Date().toISOString()};
  assert.equal(j.originalPage,fixture.context.documentUuid);
  const save=()=>writeFile(journalUrl,JSON.stringify(j,null,2));
  await save();
  if(!j.page){j.page=await invoke('eda.dmt_Schematic.createSchematicPage',[j.schematicUuid]);await save();}
  assert.ok(j.page&&j.page!==j.originalPage);
  const clientId=(await call('bridge_status')).clients[0].clientId;
  const target={targetClientId:clientId,targetDocumentUuid:j.page};
  await call('document_focus',{documentUuid:j.page,...target});
  await invoke('eda.dmt_Schematic.modifySchematicPageName',[j.page,'ROWS_LAYOUT_PROBE'],target);
  const original=fixture.parts.find(p=>p.designator==='U1');
  j.phase='placement-pending';await save();
  const placed=command==='recovered'?{ok:true,results:[{primitiveId:'371d9d971e2bbf62'}]}:await call('component_place',{components:[{...original.component,designator:'U901',x:600,y:500}],layout:{mode:'grid'},...target});
  if(command==='recovered') {
    const actual=await invoke('eda.sch_PrimitiveComponent.get',['371d9d971e2bbf62'],target);
    assert.equal((Array.isArray(actual)?actual[0]:actual).designator,'U901');
    j.recovery={clientId,previousRuntimeStopped:true,emptyPageReadbackBeforeFreshLibraryCreate:true,deviceUuid:'accfc2f6010745268febab2459577079'};
  }
  j.placement=placed;await save();assert.equal(placed.ok,true);
  j.phase='wiring';await save();
  j.componentId=placed.results[0].primitiveId;j.createdIds.push(j.componentId);await save();
  const pins=await invoke('eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId',[j.componentId],target);
  const part=prepare(fixture).find(p=>p.ref==='U1');
  part.pins=part.pins.map(p=>({...p,net:Number(p.number)<=4?`ROWS_PROBE_${p.number}_LONG_NET_NAME`:''}));
  const plan=planRows([part]);assert.equal(audit(plan).total,0);
  const cell=plan.cells[0];
  for(const route of cell.routes){
    const actual=pins.find(p=>p.pinNumber===route.pin);
    const dx=actual.x-route.line[0].x,dy=actual.y+route.line[0].y;
    const line=route.line.map(p=>({x:p.x+dx,y:dy-p.y}));
    const segments=Number(route.pin)<=2?[{points:line,net:route.net}]:line.slice(1).map((p,i)=>({points:[line[i],p],net:i===line.length-2?route.net:''}));
    for(const segment of segments){
      const wire=await invoke('eda.sch_PrimitiveWire.create',[segment.points.flatMap(p=>[p.x,p.y]),segment.net,null,null,null],target);
      const state=Array.isArray(wire)?wire[0]:wire;assert.ok(state?.primitiveId);j.createdIds.push(state.primitiveId);await save();
    }
  }
  j.review=await call('schematic_review',target);
  j.wires=await invoke('eda.sch_PrimitiveWire.getAll',[],target);
  const entry=JSON.parse(j.review.netlistText).components[j.componentId];
  j.actualNets=entry.pinInfoMap;j.connectionConfirmed=[1,2,3,4].every(i=>entry.pinInfoMap[i].net===`ROWS_PROBE_${i}_LONG_NET_NAME`);
  await save();
  await invoke('eda.sch_Document.navigateToRegion',[100,750,700,300],target);
  console.log(JSON.stringify({page:j.page,componentId:j.componentId,connectionConfirmed:j.connectionConfirmed,wires:j.wires.map(w=>({net:w.net,line:w.line}))},null,2));
} else if(command==='cleanup'){
  const j=JSON.parse(await readFile(journalUrl,'utf8'));
  assert.ok(j.page&&j.originalPage&&j.page!==j.originalPage&&!j.cleanedUp);
  const ctx=await call('eda_context');assert.equal(ctx.currentSchematicInfo.uuid,j.schematicUuid);
  const pages=await invoke('eda.dmt_Schematic.getCurrentSchematicAllSchematicPagesInfo');
  assert.ok(pages.some(p=>p.uuid===j.page&&p.name.toUpperCase()==='ROWS_LAYOUT_PROBE'));
  const clientId=(await call('bridge_status')).clients[0].clientId;
  await call('document_focus',{documentUuid:j.originalPage,targetClientId:clientId,targetDocumentUuid:ctx.currentDocumentInfo.uuid});
  j.cleanedUp=await invoke('eda.dmt_Schematic.deleteSchematicPage',[j.page],{targetDocumentUuid:j.originalPage,targetClientId:clientId});
  await writeFile(journalUrl,JSON.stringify(j,null,2));assert.equal(j.cleanedUp,true);
  console.log('Removed only the recorded temporary probe page; original P1 reactivated.');
}else throw new Error('Usage: node native-probe.mjs create|cleanup');
