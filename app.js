const CFG={
  store:"CareTreen",
  whatsapp:"27814024434",            // WhatsApp number (country code, no + or spaces)
  adminEmail:"cele4362@gmail.com",   // the admin account you created in Supabase (Authentication > Users)
  supabaseUrl:"https://rceyegrfgfzuebvybghh.supabase.co",
  supabaseKey:"sb_publishable_KC9LxNoWdhU68BVnrmBPPg_YOnibuEt",   // publishable key (safe to be public)
  bucket:"product-images",           // Supabase Storage bucket for product photos
  social:{                           // PUT YOUR SOCIAL MEDIA LINKS HERE
    facebook:"https://www.facebook.com/CareTreen",
    tiktok:"https://vm.tiktok.com/ZS9yGas8d2BdW-z2us2/",
    whatsapp:"https://wa.me/27814024434"
  }
};
document.title=CFG.store;

/* ================= DATA LAYER (Supabase). Everything that talks to the database is in this block ================= */
const sb=window.supabase?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey):null;
let adminFlag=false;
const isAdminSession=s=>!!s&&(s.user?.email||"").toLowerCase()===CFG.adminEmail.toLowerCase();
const rowToProduct=r=>({id:r.id,name:r.name,price:Number.isInteger(Number(r.price))?String(Number(r.price)):Number(r.price).toFixed(2),description:r.description||"",images:r.images||[]});
const pathOf=url=>String(url).split("/"+CFG.bucket+"/")[1];   // storage file path from its public URL
const need=()=>{if(!sb)throw new Error("Could not reach Supabase. Check your internet connection and refresh.")};
const nice=e=>/row-level security|permission/i.test(e?.message||"")?"Not allowed. Make sure you are logged in as the admin.":(e?.message||"Something went wrong. Try again.");
const DB={
  async init(){
    if(!sb)return;
    const {data}=await sb.auth.getSession();adminFlag=isAdminSession(data.session);
    sb.auth.onAuthStateChange((ev,s)=>{const was=adminFlag;adminFlag=isAdminSession(s);if(ev==="SIGNED_OUT"&&was)setTimeout(render,0)});   // refresh only if the admin got signed out (e.g. session expired)
  },
  async list(){
    need();
    const {data,error}=await sb.from("products").select("*").order("created_at",{ascending:false});
    if(error)throw error;
    return data.map(rowToProduct);
  },
  async add(p){   // p = {name,price,description,images:[dataURLs]}
    need();
    const urls=[],paths=[];
    try{
      for(const d of p.images){
        const blob=await (await fetch(d)).blob();
        const path=`${Date.now()}-${Math.random().toString(36).slice(2,10)}.jpg`;
        const {error}=await sb.storage.from(CFG.bucket).upload(path,blob,{contentType:"image/jpeg"});
        if(error)throw error;
        paths.push(path);urls.push(sb.storage.from(CFG.bucket).getPublicUrl(path).data.publicUrl);
      }
      const {error}=await sb.from("products").insert({name:p.name,price:Number(p.price),description:p.description,images:urls});
      if(error)throw error;
    }catch(e){
      if(paths.length)await sb.storage.from(CFG.bucket).remove(paths);   // don't leave orphan photos behind
      e.message=nice(e);throw e;
    }
  },
  async remove(id){
    need();
    const {data:row}=await sb.from("products").select("images").eq("id",id).maybeSingle();
    const {data,error}=await sb.from("products").delete().eq("id",id).select();
    if(error)throw new Error(nice(error));
    if(!data||!data.length)throw new Error("Not allowed. Make sure you are logged in as the admin.");
    const paths=(row?.images||[]).map(pathOf).filter(Boolean);
    if(paths.length)await sb.storage.from(CFG.bucket).remove(paths);
  },
  async login(email,password){   // returns null on success, or an error message
    if(!sb)return "Could not reach Supabase. Check your internet connection and refresh.";
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)return /invalid login/i.test(error.message)?"Wrong email or password. Try again.":error.message;
    if(!isAdminSession(data.session)){await sb.auth.signOut();return "This account is not the admin account."}
    adminFlag=true;return null;
  },
  isAdmin(){return adminFlag},
  async logout(){adminFlag=false;if(sb)await sb.auth.signOut()}
};
/* ------------------------------------------------------------ */

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isDesk=()=>matchMedia("(min-width:900px)").matches;
let products=[],sel=null,query="",imgs=[],showSearch=false;
let locked=false;   // true after clicking a product: hovering no longer changes the right panel
const MAX_IMAGES=5;
const imgsOf=p=>p.images||(p.image?[p.image]:[]);

/* Image slider (used in the side panel and the mobile detail view) */
function slider(p){
  const l=imgsOf(p);
  return `<div class="slider"><div class="track">${l.map(s=>`<img src="${s}" alt="${esc(p.name)}">`).join("")}</div>${l.length>1?`<button class="nav prev" data-a="prev" aria-label="Previous image">‹</button><button class="nav next" data-a="next" aria-label="Next image">›</button><div class="dots">${l.map((_,i)=>`<i class="${i?"":"on"}"></i>`).join("")}</div>`:""}</div>`;
}
/* Thumbnails shown in the upload form */
function thumbsHTML(){
  if(!imgs.length)return `<div class="drop" data-a="pick">Tap to add images (up to ${MAX_IMAGES})</div>`;
  return imgs.map((s,i)=>`<div class="th"><img src="${s}" alt="Image ${i+1}"><button class="del" data-a="rmimg" data-i="${i}" aria-label="Remove image ${i+1}">×</button></div>`).join("")+(imgs.length<MAX_IMAGES?`<button class="th add" data-a="pick" aria-label="Add another image">+</button>`:"");
}
/* Smooth swap of the right-hand panel content */
let swapT;
function updateSide(){
  const s=$("#sbody");if(!s)return;
  clearTimeout(swapT);s.classList.add("out");
  swapT=setTimeout(()=>{s.innerHTML=sideBody();s.classList.remove("out")},200);
}

/* Show a product in the right panel + highlight its card */
function select(id){
  if(id!==sel){sel=id;updateSide()}
  document.querySelectorAll(".card").forEach(c=>c.classList.toggle("sel",c.dataset.id===id));
}

function toast(m){const t=document.createElement("div");t.className="toast";t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2400)}

function header(admin){
  return `<header><div class="bar">
  <button class="burger" data-a="drawer" aria-label="Open menu">☰</button>
  <a class="logo" href="#home" aria-label="${esc(CFG.store)}"><img src="images/logo.png" alt="${esc(CFG.store)}" onerror="this.replaceWith(document.createTextNode(this.alt))"></a>
  <nav class="dnav"><button data-a="products">Products</button><button data-a="about">About us</button><button data-a="contacts">Contacts</button><button data-a="search">Search</button></nav>
  <div class="right">${admin
    ?`<button class="pill" data-a="products">Dashboard</button><button class="pill go" data-a="logout">Logout</button>`
    :`<button class="pill" data-a="loginmenu">Login</button><button class="pill go" data-a="signup">Sign up</button>
      <div class="menu" id="menu"><button data-a="adminlogin">Admin login</button><button data-a="clientlogin">Client login</button></div>`}
  <span class="avatar" aria-hidden="true">${admin?"A":"☺"}</span></div></div></header>`;
}
function drawer(){
  return `<div class="drawer" id="drawer"><div><button class="x" data-a="drawer" aria-label="Close menu" style="align-self:flex-end">✕</button>
  <button class="it" data-a="products">Products</button><button class="it" data-a="about">About us</button><button class="it" data-a="contacts">Contacts</button><button class="it" data-a="search">Search</button></div><i data-a="drawer"></i></div>`;
}
const footer=()=>`<footer>© ${new Date().getFullYear()} ${esc(CFG.store)}. All rights reserved.</footer>`;
const ICONS={
  facebook:'<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>',
  tiktok:'<path d="M12.525.02c1.31.01 2.61-.01 3.91.02.08 1.53.63 3.02 1.63 4.19 1.13 1.25 2.75 1.95 4.41 2.13v3.83c-1.39-.07-2.76-.51-3.92-1.31-.62-.44-1.15-.99-1.56-1.63v6.44c.03 2.12-.8 4.22-2.31 5.69-1.7 1.68-4.22 2.45-6.55 2.02-2.45-.42-4.58-2.22-5.32-4.59-.92-2.85.24-6.14 2.76-7.66.98-.6 2.11-.92 3.25-.93v3.86c-1.11.03-2.19.64-2.76 1.6-.68 1.1-.51 2.65.41 3.56.91.92 2.37 1.1 3.47.45.83-.48 1.34-1.38 1.32-2.34V0h.04z"/>',
  whatsapp:'<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>'
};

const socials=()=>`<div class="socials">${Object.keys(ICONS).map(k=>`<a class="soc" href="${esc(CFG.social[k]||"#")}" target="_blank" rel="noopener" aria-label="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg></a>`).join("")}</div>`;

function formHTML(){
  return `<div class="thumbs" id="thumbs">${thumbsHTML()}</div>
  <input type="file" id="file" accept="image/*" multiple hidden>
  <input class="f" id="pname" placeholder="Product name" maxlength="80">
  <input class="f" id="pprice" placeholder="Product price (R)" inputmode="decimal">
  <textarea class="f" id="pdesc" placeholder="Product description"></textarea>
  <p class="err" id="ferr"></p>
  <button class="btn" data-a="submit">Upload</button>`;
}

function cardHTML(p,admin){
  return `<div style="position:relative"><button class="card ${sel===p.id?"sel":""}" data-id="${p.id}"><img src="${imgsOf(p)[0]}" alt="${esc(p.name)}">${imgsOf(p).length>1?`<em class="cnt">${imgsOf(p).length} photos</em>`:""}<b>${esc(p.name)}</b><span>R ${esc(p.price)}</span></button>${admin?`<button class="del" data-a="del" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">×</button>`:""}</div>`;
}
function gridHTML(admin){
  const q=query.trim().toLowerCase();
  const l=products.filter(p=>p.name.toLowerCase().includes(q));
  if(!l.length)return `<p class="empty">${products.length?"No products match your search.":(admin?"No products yet. Upload your first one.":"No products yet. Check back soon.")}</p>`;
  return `<div class="grid">${l.map(p=>cardHTML(p,admin)).join("")}</div>`;
}
/* Product card used in the right panel (desktop) and the popup (mobile) */
function detailHTML(p){
  return `<div class="pcard">${slider(p)}${p.description?`<div class="pdesc">${esc(p.description)}</div>`:""}<button class="get" data-a="get" data-id="${p.id}">Get</button></div>`;
}
function sideBody(){
  const p=products.find(x=>x.id===sel)||products[0];
  return p?detailHTML(p):`<div class="big">image</div>`;
}
function sideHTML(admin){
  if(admin)return `<h3>Upload products</h3><div class="panelbox">${formHTML()}</div>`;
  return `<h3>Products</h3><div id="sbody">${sideBody()}</div>`;
}

function page(route,admin){
  if(route==="login")return `<div class="auth"><div class="panelbox"><button class="x" data-a="home" aria-label="Close">✕</button>
    <h2 style="font:600 26px Fraunces,Georgia,serif;margin:6px 0 16px">Admin login</h2>
    <input class="f" id="u" type="email" placeholder="Admin email" autocomplete="username"><input class="f" id="pw" type="password" placeholder="Password" autocomplete="current-password">
    <p class="err" id="lerr"></p><button class="btn" data-a="dologin">Login</button></div></div>`;
  if(route==="upload")return `<div class="auth"><div class="panelbox"><button class="x" data-a="products" aria-label="Close">✕</button><div style="margin-top:8px">${formHTML()}</div></div></div>`;
  if(route==="products")return `<div class="shop"><div class="lhs"><div class="top"><h2>${admin?"Your products":"Welcome"}</h2>
    ${admin?`<button class="pill go mobOnly" data-a="goupload">Upload</button>`:""}</div>
    <input class="f" id="q" placeholder="Search products" value="${esc(query)}" style="display:${showSearch||query?"block":"none"}">
    <div id="grid">${gridHTML(admin)}</div></div><aside class="side" id="side"><div class="side-in">${sideHTML(admin)}</div></aside></div>`;
  return `<section class="landing"><div class="hero"><h1>Hair and skin, cared for.</h1><p>Browse our hair and skin products, then tap Get to order on WhatsApp.</p></div>
    <div class="landing-bottom">${socials()}<button class="explore" data-a="products">Explore products</button></div></section>`;
}

async function render(){
  const admin=DB.isAdmin();
  let r=(location.hash||"#home").slice(1);
  if(!["home","login","products","upload"].includes(r))r="home";
  if(r==="upload"&&!admin)r="login";
  if(r==="login"&&admin)r="products";
  if(r==="products"){try{products=await DB.list()}catch(e){products=[];toast(nice(e))}}
  if(!sel&&products[0])sel=products[0].id;
  locked=false;
  document.body.classList.toggle("home-page",r==="home");
  document.body.classList.toggle("shop-page",r==="products");
  const pager=`<div class="pager"><button data-a="back" aria-label="Go back">‹ Back</button><button data-a="fwd" aria-label="Go forward">Forward ›</button></div>`;
  $("#app").innerHTML=`<div class="topbar">${header(admin)}${pager}</div><main>${page(r,admin)}</main>${footer()}${drawer()}`;
  scrollTo(0,0);
}

function openDetail(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  const o=document.createElement("div");o.className="ov";o.id="detail";
  o.innerHTML=`<button class="x" data-a="closedetail" aria-label="Close">✕</button><div style="margin-top:12px">${detailHTML(p)}</div>`;
  document.body.appendChild(o);
}
function info(title,html){
  const o=document.createElement("div");o.className="ov";o.id="detail";
  o.innerHTML=`<button class="x" data-a="closedetail" aria-label="Close">✕</button><h2 style="font:600 30px Fraunces,Georgia,serif">${title}</h2><p style="max-width:50ch">${html}</p>`;
  document.body.appendChild(o);
}
function compress(file){
  return new Promise((ok,no)=>{const fr=new FileReader();fr.onerror=no;fr.onload=()=>{const im=new Image();im.onerror=no;im.onload=()=>{
    const s=Math.min(1,1200/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=im.width*s;c.height=im.height*s;
    c.getContext("2d").drawImage(im,0,0,c.width,c.height);ok(c.toDataURL("image/jpeg",.8))};im.src=fr.result};fr.readAsDataURL(file)});
}
const go=h=>{if(location.hash==="#"+h)render();else location.hash=h};

document.addEventListener("click",async e=>{
  if(!e.target.closest("#menu,[data-a=loginmenu]"))$("#menu")?.classList.remove("open");   // click elsewhere closes the login dropdown
  const t=e.target.closest("[data-a],.card");
  if(!t){   // clicked empty space: hovering works again
    if(!e.target.closest(".pcard,input,textarea,a,label"))locked=false;
    return;
  }
  if(t.classList.contains("card")&&!t.dataset.a){   // clicked a product
    if(!isDesk()){sel=t.dataset.id;openDetail(sel)}
    else if(!DB.isAdmin()){locked=true;select(t.dataset.id)}   // lock the right panel on this product
    return;
  }
  const a=t.dataset.a,id=t.dataset.id;
  if(a==="drawer")$("#drawer").classList.toggle("open");
  else if(a==="loginmenu")$("#menu").classList.toggle("open");
  else if(a==="adminlogin")go("login");
  else if(a==="clientlogin"||a==="signup"){$("#menu")?.classList.remove("open");toast("Client accounts are coming soon. You can browse without one.")}
  else if(a==="back")history.back();
  else if(a==="fwd")history.forward();
  else if(a==="home")go("home");
  else if(a==="products"){$("#drawer")?.classList.remove("open");go("products")}
  else if(a==="goupload")go("upload");
  else if(a==="about"||a==="contacts"||a==="search"){
    $("#drawer")?.classList.remove("open");
    if(a==="about")info("About us",`${esc(CFG.store)} sells hair and skin products. Browse what is in stock and tap Get to order on WhatsApp.`);
    else if(a==="contacts")info("Contacts",`WhatsApp: <a href="https://wa.me/${CFG.whatsapp}" style="color:var(--acc)">081 402 4434</a>`);
    else{showSearch=true;if((location.hash||"#home")!=="#products")go("products");else{render().then(()=>$("#q")?.focus())}}}
  else if(a==="logout"){await DB.logout();go("home")}
  else if(a==="dologin"){
    t.disabled=true;t.textContent="Logging in…";
    const err=await DB.login($("#u").value.trim(),$("#pw").value);
    if(!err)go("products");else{$("#lerr").textContent=err;t.disabled=false;t.textContent="Login"}
  }
  else if(a==="pick")$("#file").click();
  else if(a==="rmimg"){imgs.splice(Number(t.dataset.i),1);$("#thumbs").innerHTML=thumbsHTML()}
  else if(a==="prev"||a==="next"){const tr=t.closest(".slider").querySelector(".track");tr.scrollBy({left:(a==="next"?1:-1)*tr.clientWidth,behavior:"smooth"})}
  else if(a==="submit"){
    const n=$("#pname").value.trim(),pr=$("#pprice").value.trim().replace(/^R\s*/i,""),d=$("#pdesc").value.trim(),er=$("#ferr");
    if(!imgs.length)return er.textContent="Add at least one product image.";
    if(!n)return er.textContent="Enter a product name.";
    if(!pr||isNaN(Number(pr)))return er.textContent="Enter a price using numbers only.";
    er.textContent="";t.disabled=true;t.textContent="Uploading…";
    try{await DB.add({name:n,price:pr,description:d,images:imgs})}
    catch(x){t.disabled=false;t.textContent="Upload";return er.textContent="Upload failed: "+(x.message||"try again.")}
    imgs=[];toast("Product uploaded");go("home");
  }
  else if(a==="del"){if(confirm("Delete this product?")){try{await DB.remove(id);render()}catch(x){toast(x.message)}}}
  else if(a==="get"){const p=products.find(x=>x.id===id);if(p)open(`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(`Hi, I’d like to get ${p.name} (R ${p.price}).`)}`,"_blank")}
  else if(a==="closedetail")$("#detail")?.remove();
});
document.addEventListener("change",async e=>{
  if(e.target.id!=="file"||!e.target.files.length)return;
  const files=[...e.target.files].slice(0,MAX_IMAGES-imgs.length);
  try{for(const f of files)imgs.push(await compress(f));$("#thumbs").innerHTML=thumbsHTML()}catch(x){toast("Could not read that image.")}
  e.target.value="";
});
document.addEventListener("input",e=>{
  if(e.target.id==="q"){query=e.target.value;$("#grid").innerHTML=gridHTML(DB.isAdmin())}
});
document.addEventListener("mouseover",e=>{
  const c=e.target.closest(".card");
  if(!c||locked||!isDesk()||DB.isAdmin()||sel===c.dataset.id)return;   // locked = ignore hover
  select(c.dataset.id);
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="pw")document.querySelector('[data-a="dologin"]').click()});
document.addEventListener("scroll",e=>{
  const tr=e.target;if(!tr.classList||!tr.classList.contains("track"))return;
  const i=Math.round(tr.scrollLeft/tr.clientWidth);
  tr.parentNode.querySelectorAll(".dots i").forEach((d,k)=>d.classList.toggle("on",k===i));
},true);
addEventListener("hashchange",render);
DB.init().catch(()=>{}).then(render);

