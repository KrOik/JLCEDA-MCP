import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {call,invoke} from './client.mjs';
const fixture=JSON.parse(await readFile(new URL('./live-fixture.json',import.meta.url),'utf8'));
const netlist=JSON.parse(fixture.review.netlistText);
const file=new URL('./production-e2e.json',import.meta.url);
const mode=process.argv[2]??'status';
const j=await readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return {operationId:'rows-real15-v1',components:[],searches:{}};});
const save=()=>writeFile(file,JSON.stringify(j,null,2));
if(mode==='resolve') {
  for(const p of fixture.parts) {
    const e=netlist.components[p.uniqueId]; const keyword=e.props.DeviceName;
    if(!j.searches[keyword]) { j.searches[keyword]=await call('component_select',{keyword,limit:3});await save(); }
    const c=j.searches[keyword].candidates.find(c=>c.name.toLowerCase()===keyword.toLowerCase());
    assert.ok(c?.uuid,`Exact library device unavailable: ${keyword}`);
    if(!j.components.some(c=>c.key===p.designator))j.components.push({key:p.designator,uuid:c.uuid,libraryUuid:c.libraryUuid,name:keyword,designator:p.designator.replace(/\d+$/,n=>String(Number(n)+1000)),
      row:/usb|header|h254|母座/i.test(keyword)?'connector':/^SW/.test(p.designator)?'switch':/^C/.test(p.designator)?'capacitor':/^X/.test(p.designator)?'crystal':/^R/.test(p.designator)?'resistor':'ic',
      nets:Object.fromEntries(Object.entries(e.pinInfoMap).filter(([,p])=>p.net).map(([n,p])=>[n,`QA_${p.net}`]))});
    await save();
  }
  console.log(JSON.stringify({resolved:j.components.length,pins:j.components.reduce((n,c)=>n+Object.keys(c.nets).length,0)}));
} else if(mode==='start') {
  assert.equal(j.components.length,15);
  j.start=await call('schematic_place_rows',{operationId:j.operationId,components:j.components});await save();console.log(JSON.stringify(j.start));
} else if(mode==='status') {
  j.status=await call('schematic_place_rows',{operationId:j.operationId,action:'status'},{allowError:true});await save();console.log(JSON.stringify(j.status));
} else if(mode==='cleanup-failed') {
  const status=await call('schematic_place_rows',{operationId:j.operationId,action:'status'},{allowError:true});
  assert.equal(status.state,'failed');
  const pages=await invoke('eda.dmt_Schematic.getCurrentSchematicAllSchematicPagesInfo');
  for(const id of status.pages) {
    assert.notEqual(id,fixture.context.documentUuid);
    assert.ok(pages.some(p=>p.uuid===id&&p.name.toLowerCase()===`ROWS_${j.operationId}_${status.pages.indexOf(id)+1}`.toLowerCase()));
    assert.equal(await invoke('eda.dmt_Schematic.deleteSchematicPage',[id]),true);
  }
  j.history??=[];j.history.push({operationId:j.operationId,status,removedPages:status.pages});
  j.operationId=j.operationId.replace(/v(\d+)$/,(_,n)=>`v${Number(n)+1}`);await save();
  console.log(JSON.stringify({removedPages:status.pages,nextIsFreshTest:j.operationId}));
} else if(mode==='verify-saved') {
  j.savedPages=[];j.pageSources={};
  for(const page of j.status.pages) {
    await call('document_focus',{documentUuid:page});
    await new Promise(r=>setTimeout(r,1200));
    assert.equal(await invoke('eda.sch_Document.save'),true);
    j.savedPages.push(page);j.pageSources[page]=await invoke('eda.sys_FileManager.getDocumentSource');await save();
  }
  j.review=await call('schematic_review');const n=JSON.parse(j.review.netlistText);
  let pins=0;
  for(const c of j.components) {
    const entry=Object.values(n.components).find(p=>p.props.Designator===c.designator);assert.ok(entry);
    for(const [pin,net] of Object.entries(c.nets)){assert.equal(entry.pinInfoMap[pin].net,net);pins++;}
  }
  await call('document_focus',{documentUuid:fixture.context.documentUuid});
  await new Promise(r=>setTimeout(r,1200));
  const original=await invoke('eda.sch_PrimitiveComponent.getAll',['part',false]);
  assert.equal(original.length,fixture.parts.length);
  for(const p of fixture.parts) {
    const a=original.find(a=>a.primitiveId===p.primitiveId);assert.ok(a);
    for(const key of ['x','y','rotation','designator'])assert.equal(a[key],p[key]);
  }
  j.savedVerification={pinsConfirmed:pins,originalPartIdsPositionsRotationsPreserved:true};await save();console.log(JSON.stringify(j.savedVerification));
} else if(mode==='capture') {
  j.review=await call('schematic_review');
  j.source=await invoke('eda.sys_FileManager.getDocumentSource');await save();
  console.log(JSON.stringify({drcCheckPassed:j.review.drcCheckPassed,sourceBytes:j.source.length}));
} else throw new Error('resolve|start|status|capture');
