let id=0;
export async function call(name,args={},options={}) {
  const r=await fetch('http://127.0.0.1:7655/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:{...args,responseDetail:'full'}}}),signal:AbortSignal.timeout(60000)});
  const rpc=await r.json();if(rpc.error)throw new Error(JSON.stringify(rpc.error));
  if(rpc.result.isError&&!options.allowError)throw new Error(JSON.stringify(rpc.result));
  let d=rpc.result.structuredContent??JSON.parse(rpc.result.content.find(c=>c.type==='text').text);
  if(d.detailOmitted&&d.resultRef){let offset=0,s='';do{const p=await call('result_read',{resultRef:d.resultRef,offset,limit:12000});s+=p.text;offset=p.nextOffset;}while(offset!==null);d=JSON.parse(s);}
  return d;
}
export async function invoke(apiFullName,args=[],target={}) {return(await call('api_invoke',{apiFullName,args,...target})).result;}
