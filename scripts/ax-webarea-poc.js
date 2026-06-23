// PoC: root the AX walk at AXWebArea (skip browser chrome) and measure time-to-composer.
function readProp(el,n){try{const v=el[n]();return v==null?'':String(v).replace(/[\t\r\n]+/g,' ').trim()}catch(_){return ''}}
function readAttr(el,n){try{const v=el.attributes.byName(n).value();return v==null?'':String(v)}catch(_){return ''}}
function kids(el){try{return el.uiElements()}catch(_){return []}}
function isComposer(el){
  const role=readProp(el,'role');
  const t=[role,readProp(el,'subrole'),readProp(el,'roleDescription'),readAttr(el,'AXPlaceholderValue'),readAttr(el,'AXDOMRole'),readAttr(el,'AXEditable')].join(' ').toLowerCase();
  return /textbox|textarea|textfield|searchfield|combobox|contenteditable|composer|ask|gemini|editable/.test(t);
}
const se=Application('System Events');
const procs=se.applicationProcesses.whose({frontmost:true})();
if(!procs.length){ JSON.stringify({error:'no_frontmost'}); }
else {
  const p=procs[0]; const app=readProp(p,'name');
  const t0=$.NSDate.date;
  // find AXWebArea via shallow descent from windows
  function findWebArea(root,depth){
    if(depth>12) return null;
    if(readProp(root,'role')==='AXWebArea') return root;
    for(const c of kids(root)){ const r=findWebArea(c,depth+1); if(r) return r; }
    return null;
  }
  let web=null;
  for(const w of p.windows()){ web=findWebArea(w,0); if(web) break; }
  const tFind=-t0.timeIntervalSinceNow*1000;
  if(!web){ JSON.stringify({app, webAreaFound:false, findMs:Math.round(tFind)}); }
  else {
    // BFS from AXWebArea, stop when composer found or budget hit
    const t1=$.NSDate.date;
    const q=[{el:web,d:0}]; let scanned=0; let hit=null;
    while(q.length && scanned<120){
      const it=q.shift(); scanned++;
      if(isComposer(it.el)){ hit={role:readProp(it.el,'role'),placeholder:readAttr(it.el,'AXPlaceholderValue'),scanned}; break; }
      if(it.d<12) for(const c of kids(it.el)) q.push({el:c,d:it.d+1});
    }
    const tScan=-t1.timeIntervalSinceNow*1000;
    JSON.stringify({app, webAreaFound:true, findMs:Math.round(tFind), scanMs:Math.round(tScan), nodesScanned:scanned, composer:hit});
  }
}
