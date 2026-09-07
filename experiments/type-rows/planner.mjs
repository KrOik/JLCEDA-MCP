// Experimental pure planner. Coordinates below are SVG/screen units (Y downward).
// Live EDA data are normalized once at the input boundary. No EDA writes.
export const rowOrder = ['switch', 'capacitor', 'crystal', 'resistor', 'connector', 'ic', 'other'];
export const box = (x, y, w, h) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
export const bounds = values => ({ minX: Math.min(...values.map(b => b.minX)), minY: Math.min(...values.map(b => b.minY)), maxX: Math.max(...values.map(b => b.maxX)), maxY: Math.max(...values.map(b => b.maxY)) });
export const shift = (b, x, y) => ({ minX: b.minX + x, maxX: b.maxX + x, minY: b.minY + y, maxY: b.maxY + y });
const width = b => b.maxX - b.minX, height = b => b.maxY - b.minY;
export const overlap = (a, b) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minY < b.maxY - 1e-6 && a.maxY > b.minY + 1e-6;
export function segments(line) { return line.slice(1).map((p, i) => [line[i], p]); }
export function intersects(a, b) {
  const [p, q] = a, [r, s] = b;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a, b, p) => Math.abs(cross(a,b,p)) < 1e-6 && p.x >= Math.min(a.x,b.x)-1e-6 && p.x <= Math.max(a.x,b.x)+1e-6 && p.y >= Math.min(a.y,b.y)-1e-6 && p.y <= Math.max(a.y,b.y)+1e-6;
  return on(p,q,r) || on(p,q,s) || on(r,s,p) || on(r,s,q) || cross(p,q,r)*cross(p,q,s)<0 && cross(r,s,p)*cross(r,s,q)<0;
}
export function lineHits(line, b) {
  return segments(line).some(([p,q]) => {
    let lo=0, hi=1;
    for(const [a,d,min,max] of [[p.x,q.x-p.x,b.minX+1e-5,b.maxX-1e-5],[p.y,q.y-p.y,b.minY+1e-5,b.maxY-1e-5]]) {
      if (d===0) { if(a<min || a>max) return false; }
      else { const u=(min-a)/d,v=(max-a)/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v)); }
      if(lo>hi) return false;
    }
    return true;
  });
}
export function classify(part, entry) {
  const name = `${entry?.props?.DeviceName ?? ''} ${entry?.props?.['Manufacturer Part'] ?? ''}`;
  if (/usb|header|h254|connector|母座|排针/i.test(name)) return 'connector';
  if (/^SW/i.test(part.designator)) return 'switch';
  if (/^C\d/i.test(part.designator)) return 'capacitor';
  if (/^[XY]\d/i.test(part.designator)) return 'crystal';
  if (/^[RL]\d/i.test(part.designator)) return 'resistor';
  if (/^[PJ]\d/i.test(part.designator)) return 'connector';
  if (/^U\d/i.test(part.designator)) return 'ic';
  return 'other';
}
export function prepare(fixture, stress = false) {
  const netlist = JSON.parse(fixture.review.netlistText);
  return fixture.parts.map(p => {
    const entry = netlist.components[p.uniqueId];
    const convert = b => ({ minX:b.minX-p.x,maxX:b.maxX-p.x,minY:p.y-b.maxY,maxY:p.y-b.minY });
    const attributes = p.attributes.filter(a => a.box && width(a.box)>0 && height(a.box)>0).map(a => ({ box:convert(a.box), text:a.key==='Designator'?p.designator:entry?.props?.DeviceName || a.value, kind:'attribute' }));
    return { id:p.primitiveId, ref:p.designator, row:classify(p,entry), body:convert(p.geometry.body), attributes,
      pins:p.pins.map(pin => ({ number:pin.pinNumber,x:pin.x-p.x,y:p.y-pin.y,angle:pin.rotation,
        net:stress?`TEST_${p.designator}_${pin.pinNumber}_VERY_LONG_NETWORK_NAME`:entry?.pinInfoMap?.[pin.pinNumber]?.net || '' })) };
  });
}
export function makeCell(part, mode='cells', font=10) {
  // Geometric orientation experiment only: native implementation must remeasure
  // after rotating a newly created symbol; attribute text remains horizontal.
  if(mode==='cells'&&['capacitor','resistor','crystal'].includes(part.row)&&part.pins.length===2&&part.pins.every(p=>p.angle===90||p.angle===270)) {
    part={...part,normalizedRotation:true,
      body:{minX:-part.body.maxY,maxX:-part.body.minY,minY:part.body.minX,maxY:part.body.maxX},
      pins:part.pins.map(p=>({...p,x:-p.y,y:p.x,angle:(p.angle+270)%360}))};
  }
  const routes=[], labels=[];
  const active=part.pins.filter(p=>p.net);
  const textWidth = text => [...text].reduce((n,c)=>n+(c.charCodeAt(0)>255?font:font*0.65),0);
  for (const angle of [0,90,180,270]) {
    const horizontal=angle===0||angle===180, sign=angle===0||angle===270?1:-1;
    const pins=active.filter(p=>p.angle===angle).sort((a,b)=>horizontal?a.y-b.y:a.x-b.x);
    const axis=p=>horizontal?p.y:p.x;
    const targets=pins.map(axis);
    if(mode==='cells') {
      const pitch=Math.ceil((font+6)/10)*10;
      // Expand away from the median pin, preserving sparse original gaps.
      // Re-centering the total span can reverse the movement of inner pins.
      const mid=Math.floor((targets.length-1)/2);
      for(let i=mid-1;i>=0;i--) targets[i]=Math.min(targets[i],targets[i+1]-pitch);
      for(let i=mid+1;i<targets.length;i++) targets[i]=Math.max(targets[i],targets[i-1]+pitch);
    }
    pins.forEach((p,i)=>{
      const target=targets[i], len=Math.max(40,textWidth(p.net)+12);
      // Outer pins turn first; inner pins turn farther from the body. A shared
      // elbow X/Y is invalid because expanded routes would overlap each other.
      const depth=20+Math.min(i,pins.length-1-i)*10;
      const labelLane=20+Math.floor((pins.length-1)/2)*10;
      const distance=mode==='cells'?labelLane+len:len;
      let line;
      if(mode==='cells' && Math.abs(target-axis(p))>1e-6) {
        line=horizontal?[p,{x:p.x+sign*depth,y:p.y},{x:p.x+sign*depth,y:target},{x:p.x+sign*distance,y:target}]
          :[p,{x:p.x,y:p.y+sign*depth},{x:target,y:p.y+sign*depth},{x:target,y:p.y+sign*distance}];
      } else line=[p,{x:p.x+(horizontal?sign*distance:0),y:p.y+(horizontal?0:sign*distance)}];
      const end=line.at(-1), w=textWidth(p.net);
      const label=horizontal?box(sign>0?end.x-w-3:end.x+3,end.y+2,w,font)
        :box(end.x+2,sign>0?end.y-w-3:end.y+3,font,w);
      routes.push({ pin:p.number,net:p.net,line:line.map(({x,y})=>({x,y})) });
      labels.push({box:label,text:p.net,kind:'net',pin:p.number,angle:horizontal?0:90});
    });
  }
  const rawBounds=bounds([part.body,...part.pins.map(p=>box(p.x,p.y,0,0)),...routes.flatMap(r=>r.line.map(p=>box(p.x,p.y,0,0))),...labels.map(l=>l.box)]);
  let attrs=part.attributes;
  if(mode==='cells') {
    let y=rawBounds.minY-12;
    attrs=[...part.attributes].reverse().map(a=>{y-=height(a.box);const b=box(rawBounds.minX,y,width(a.box),height(a.box));y-=4;return {...a,box:b};});
  }
  const envelope=bounds([rawBounds,...attrs.map(a=>a.box)]);
  const packing=mode==='bare'?bounds([part.body,...part.attributes.map(a=>a.box),...part.pins.map(p=>box(p.x,p.y,0,0))]):envelope;
  return {...part,routes,labels:[...labels,...attrs],envelope,packing};
}
export function planRows(parts,{mode='cells',font=10,maxWidth=1200,gap=40,rowGap=60}={}) {
  const cells=parts.map(p=>makeCell(p,mode,font));
  const placed=[], rows=[];
  let y=0;
  for(const category of rowOrder) {
    let x=0,h=0, row=[];
    const flush=()=>{if(!row.length)return;rows.push({category,y,height:h,refs:row});y+=h+rowGap;x=0;h=0;row=[];};
    for(const cell of cells.filter(c=>c.row===category).sort((a,b)=>a.ref.localeCompare(b.ref,undefined,{numeric:true}))) {
      if(x && x+width(cell.packing)>maxWidth) flush();
      const dx=Math.ceil((x-cell.packing.minX)/10)*10,dy=Math.ceil((y-cell.packing.minY)/10)*10;
      const move=b=>shift(b,dx,dy);
      const next={...cell,x:dx,y:dy,body:move(cell.body),envelope:move(cell.envelope),packing:move(cell.packing),
        pins:cell.pins.map(p=>({...p,x:p.x+dx,y:p.y+dy})),
        routes:cell.routes.map(r=>({...r,line:r.line.map(p=>({x:p.x+dx,y:p.y+dy}))})),labels:cell.labels.map(l=>({...l,box:move(l.box)}))};
      placed.push(next);row.push(cell.ref);x=next.packing.maxX+gap;h=Math.max(h,next.packing.maxY-y);
    }
    flush();
  }
  return {mode,font,maxWidth,cells:placed,rows,bounds:bounds(placed.map(c=>c.envelope))};
}
export function audit(plan) {
  const conflicts=[], add=(kind,a,b)=>conflicts.push({kind,a,b});
  const routes=plan.cells.flatMap(c=>c.routes.map(r=>({...r,id:`${c.ref}.${r.pin}`,ref:c.ref})));
  const labels=plan.cells.flatMap(c=>c.labels.map((l,i)=>({...l,id:`${c.ref}:${l.kind}:${l.pin??i}`,ref:c.ref})));
  for(let i=0;i<plan.cells.length;i++) for(let j=i+1;j<plan.cells.length;j++)
    if(overlap(plan.cells[i].envelope,plan.cells[j].envelope))add('cellOverlap',plan.cells[i].ref,plan.cells[j].ref);
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++) {
    if(routes[i].net!==routes[j].net && segments(routes[i].line).some(a=>segments(routes[j].line).some(b=>intersects(a,b)))) add('wireCrossing',routes[i].id,routes[j].id);
  }
  for(const r of routes) {
    for(const c of plan.cells)if(lineHits(r.line,c.body))add('wireBody',r.id,c.ref);
    for(const c of plan.cells)for(const pin of c.pins)if(`${c.ref}.${pin.number}`!==r.id&&pin.net!==r.net&&segments(r.line).some(s=>intersects(s,[pin,pin])))add('wirePin',r.id,`${c.ref}.${pin.number}`);
    for(const l of labels)if(!(l.ref===r.ref&&l.kind==='net'&&l.pin===r.pin)&&lineHits(r.line,l.box))add('wireText',r.id,l.id);
  }
  for(let i=0;i<labels.length;i++) {
    for(let j=i+1;j<labels.length;j++)if(overlap(labels[i].box,labels[j].box))add('textOverlap',labels[i].id,labels[j].id);
    for(const c of plan.cells)if(overlap(labels[i].box,c.body))add('textBody',labels[i].id,c.ref);
  }
  return {conflicts,total:conflicts.length,counts:Object.fromEntries(['cellOverlap','wireCrossing','wireBody','wirePin','wireText','textOverlap','textBody'].map(k=>[k,conflicts.filter(c=>c.kind===k).length]))};
}

export function paginate(plan,{usableWidth=1050,usableHeight=700}={}) {
  const pages=[];let page={rows:[],height:0};const oversize=[];
  for(const row of plan.rows) {
    const cells=plan.cells.filter(c=>row.refs.includes(c.ref));
    const b=bounds(cells.map(c=>c.envelope));
    if(width(b)>usableWidth||height(b)>usableHeight)oversize.push({refs:row.refs,width:width(b),height:height(b)});
    if(page.rows.length&&page.height+60+height(b)>usableHeight){pages.push(page);page={rows:[],height:0};}
    page.rows.push({refs:row.refs,offsetY:page.height+(page.rows.length?60:0)});
    page.height+=(page.rows.length>1?60:0)+height(b);
  }
  if(page.rows.length)pages.push(page);
  return {pages,oversize};
}
