import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepare, planRows, audit, lineHits, bounds, paginate } from './planner.mjs';
const base = new URL('./', import.meta.url);
const fixture=JSON.parse(await readFile(new URL('live-fixture.json',base),'utf8'));
const parts=prepare(fixture), stress=prepare(fixture,true);
const cases=[];
for(const mode of ['bare','envelope','cells'])for(const font of [8,10,12,16])for(const useStress of [false,true]) {
  const plan=planRows(useStress?stress:parts,{mode,font});
  const checked=audit(plan);
  cases.push({mode,font,stress:useStress,parts:plan.cells.length,nets:plan.cells.reduce((n,c)=>n+c.routes.length,0),rows:plan.rows.length,width:plan.bounds.maxX-plan.bounds.minX,height:plan.bounds.maxY-plan.bounds.minY,...checked});
}
const near=bounds(fixture.parts.map(p=>p.geometry.box));
const nearWire=w=>lineHits(Array.from({length:w.line.length/2},(_,i)=>({x:w.line[i*2],y:w.line[i*2+1]})),near);
const measurements={
  capturedAt:fixture.capturedAt,parts:parts.length,pins:parts.reduce((n,p)=>n+p.pins.length,0),
  activePins:parts.reduce((n,p)=>n+p.pins.filter(p=>p.net).length,0),wireCount:fixture.wires.length,
  wiresOutsideComponentRegion:fixture.wires.filter(w=>!nearWire(w)).length,
  visibleAttributeBoxes:fixture.parts.flatMap(p=>p.attributes).filter(a=>a.box&&a.box.maxX>a.box.minX&&a.box.maxY>a.box.minY).length,
  nativeNetLabelSamples:fixture.labelSamples.length,
  wireBBoxIncludesText:fixture.wires.filter(w=>w.box&&(w.box.maxX-w.box.minX>Math.max(...w.line.filter((_,i)=>i%2===0))-Math.min(...w.line.filter((_,i)=>i%2===0))+1.1 || w.box.maxY-w.box.minY>Math.max(...w.line.filter((_,i)=>i%2===1))-Math.min(...w.line.filter((_,i)=>i%2===1))+1.1)).length,
  drcCheckPassed:fixture.review.drcCheckPassed,
};
const pagePlan=planRows(parts,{maxWidth:1000,font:10});
const pagination=paginate(pagePlan);
assert.equal(pagination.oversize.length,0);
assert.ok(pagination.pages.every(p=>p.height<=700));
const report={measurements,cases,pagination};
await writeFile(new URL('results.json',base),JSON.stringify(report,null,2));
console.log(JSON.stringify(measurements,null,2));
console.table(cases.map(({conflicts,counts,...c})=>({...c,...counts})));
// Required invariants beyond no overlaps: stable placement, finite orthogonal
// routes, unchanged pin-to-net assignments, every pin endpoint retained.
for(const useStress of [false,true])for(const font of [8,10,12,16])for(const maxWidth of [800,1200,2000]) {
  const source=useStress?stress:parts;
  const plan=planRows(source,{font,maxWidth});
  assert.deepEqual(plan,planRows(source,{font,maxWidth}));
  for(const c of plan.cells)for(const r of c.routes) {
    const pin=c.pins.find(p=>p.number===r.pin);
    assert.equal(pin.net,r.net);assert.deepEqual(r.line[0],{x:pin.x,y:pin.y});
    for(let i=1;i<r.line.length;i++) {
      const a=r.line[i-1],b=r.line[i];
      assert.ok([a.x,a.y,b.x,b.y].every(Number.isFinite));
      assert.ok(a.x===b.x||a.y===b.y);
    }
  }
  assert.equal(audit(plan).total,0,`cells stress=${useStress} font=${font} width=${maxWidth}`);
}
console.log('24 refined-layout scenarios: deterministic, orthogonal, pin/net-preserving, zero modeled collisions.');
let seed=20260907;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<100;i++) {
  const subset=stress.map(p=>({...p,pins:p.pins.map(pin=>({...pin,net:random()<0.55?pin.net:''}))}));
  const tested=planRows(subset,{font:8+i%9,maxWidth:[800,1200,2000][i%3]});
  assert.equal(audit(tested).total,0,`Sparse subset ${i}`);
}
console.log('100 seeded sparse-pin scenarios: zero modeled collisions.');
const planner=(await readFile(new URL('planner.mjs',base),'utf8')).replace(/^export /gm,'');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>分类行布局验证</title>
<style>body{font:15px system-ui;margin:24px;background:#f5f6f8;color:#172331}h1{font-size:24px}label{margin-right:18px}select,input{padding:5px}#summary{padding:14px;background:white;margin:16px 0}svg{background:white;border:1px solid #ddd;width:100%;height:auto}p{max-width:1000px;line-height:1.7}</style>
<h1>分类行布局：真实 STM32 页面几何验证</h1><p>15 个真实器件、89 个实际引脚。下图用实测符号边界与引脚绘制布局代理图，不是 EDA 原图截图。网络字框按可调的保守字体模型计算，尚未完成原生 NET 文字测量。原 P1 未改动。</p>
<label>方案 <select id="mode"><option value="bare">仅分类行 / 裸器件占位</option><option value="envelope">完整占位 / 保留原属性位置</option><option value="cells" selected>改进：独立单元 / 属性标题区 / 有序扇出</option></select></label>
<label>字高 <select id="font"><option>8</option><option selected>10</option><option>12</option><option>16</option></select></label>
<label>行宽 <select id="width"><option>800</option><option selected>1200</option><option>2000</option></select></label>
<label><input type="checkbox" id="stress">全部引脚 + 长网名压力测试</label><div id="summary"></div><div id="view"></div>
<script>${planner}
const source=${JSON.stringify(parts)},stressSource=${JSON.stringify(stress)};
const esc=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
function draw(){const p=planRows(document.querySelector('#stress').checked?stressSource:source,{mode:document.querySelector('#mode').value,font:Number(document.querySelector('#font').value),maxWidth:Number(document.querySelector('#width').value)});const a=audit(p);document.querySelector('#summary').textContent='行数 '+p.rows.length+' · 范围 '+Math.ceil(p.bounds.maxX-p.bounds.minX)+' × '+Math.ceil(p.bounds.maxY-p.bounds.minY)+' · 模型冲突 '+a.total+' · '+JSON.stringify(a.counts);let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+(p.bounds.minX-30)+' '+(p.bounds.minY-40)+' '+(p.bounds.maxX-p.bounds.minX+60)+' '+(p.bounds.maxY-p.bounds.minY+80)+'">';const rect=(b,color,fill,extra='')=>'<rect x="'+b.minX+'" y="'+b.minY+'" width="'+(b.maxX-b.minX)+'" height="'+(b.maxY-b.minY)+'" stroke="'+color+'" fill="'+fill+'" '+extra+'/>';for(const c of p.cells){s+=rect(c.envelope,'#ccd3df','none','stroke-dasharray="4 4"');s+=rect(c.body,'#a62020','#fff9f5');s+='<text x="'+((c.body.minX+c.body.maxX)/2)+'" y="'+((c.body.minY+c.body.maxY)/2)+'" font-size="8" text-anchor="middle">'+esc(c.ref)+'</text>';for(const pin of c.pins)s+='<circle cx="'+pin.x+'" cy="'+pin.y+'" r="1.2" fill="#a62020"/>';for(const r of c.routes)s+='<polyline points="'+r.line.map(pt=>pt.x+','+pt.y).join(' ')+'" fill="none" stroke="#168347" stroke-width="0.8"/>';for(const l of c.labels){s+=rect(l.box,'none',l.kind==='net'?'#edf1ff':'#fff0cf');const b=l.box;if(l.angle===90)s+='<text transform="translate('+(b.maxX-1)+','+b.minY+') rotate(90)" font-size="'+p.font+'" textLength="'+(b.maxY-b.minY)+'" lengthAdjust="spacingAndGlyphs" fill="#294dad">'+esc(l.text)+'</text>';else s+='<text x="'+b.minX+'" y="'+(b.maxY-1)+'" font-size="'+(l.kind==='net'?p.font:8)+'" textLength="'+(b.maxX-b.minX)+'" lengthAdjust="spacingAndGlyphs" fill="#294dad">'+esc(l.text)+'</text>';}}s+='</svg>';document.querySelector('#view').innerHTML=s;}document.querySelectorAll('select,input').forEach(e=>e.addEventListener('change',draw));draw();</script></html>`;
await writeFile(new URL('preview.html',base),html);
