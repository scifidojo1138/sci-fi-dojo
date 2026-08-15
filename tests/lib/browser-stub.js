// Executes rent.html's real app script against a stub DOM with NO token,
// which is the exact path that was throwing.
// Minimal browser stub: runs a page's inline scripts and reports what
// happened. Deliberately tiny -- it exists to catch load-order faults
// (a top-level IIFE dereferencing a `var` assigned further down the
// file), not to be a real DOM.
const fs=require('fs'), vm=require('vm');
function loadPage(path, search) {
const re=/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
const html=fs.readFileSync(path,'utf8');
let m, blocks=[]; while((m=re.exec(html))) blocks.push(m[1]);

const shown=[]; const els={};
const el=(id)=>els[id]||(els[id]={id,className:'',textContent:'',innerHTML:'',style:{},
  classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},
  contains(c){return this._s.has(c)}},focus(){},addEventListener(){},querySelectorAll:()=>[],
  querySelector:()=>null,remove(){},appendChild(){},setAttribute(){},getAttribute:()=>null});
const doc={hidden:false,getElementById:el,querySelector:(s)=>s==='.screen.active'?
    {id:shown[shown.length-1]||''}:null,
  querySelectorAll:()=>[],addEventListener(){},createElement:()=>el('tmp'),body:el('body'),
  documentElement:el('html')};
const ctx={console,document:doc,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
  URLSearchParams,location:{search:search||'',pathname:'/rent',href:'x'},history:{replaceState(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  sessionStorage:{getItem:()=>null,setItem(){}},
  navigator:{userAgent:'test',onLine:true},fetch:()=>new Promise(()=>{}),
  AbortController:function(){this.signal={};this.abort=()=>{}},
  matchMedia:()=>({matches:false,addEventListener(){}}),Promise,JSON,Math,Date,
  encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isNaN,String,Number,Object,Array,RegExp,Error};
ctx.scrollTo=()=>{}; ctx.requestAnimationFrame=(f)=>f&&0; ctx.window=ctx; ctx.globalThis=ctx;
vm.createContext(ctx);

// capture which screen got shown
let err=null;
try{ for(const b of blocks) vm.runInContext(b,ctx); }catch(e){ err=e; }

return {
  error: err ? err.message : null,
  ctx, els,
  headerText: els.acctStatusText ? els.acctStatusText.textContent : undefined,
  screenActive: (id) => !!(els[id] && els[id].classList.contains('active')),
};
}
module.exports = { loadPage };
