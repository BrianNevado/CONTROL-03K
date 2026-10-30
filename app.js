/* CONTROL 03K — Aplicación integrada con Supabase
   Los datos de negocio se consultan y guardan en Supabase.
   Los permisos definitivos también se validan mediante RLS en la base de datos. */

const SUPABASE_URL = window.CONTROL03K_CONFIG?.supabaseUrl;
const SUPABASE_PUBLISHABLE_KEY = window.CONTROL03K_CONFIG?.supabasePublishableKey;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("Falta la configuración de Supabase en config.js");
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let isAdmin = false;
let members = [];
let activities = [];
let participations = [];
let movements = [];
let expectedContributions = [];
let selectedActivityId = "all";

const money = value => new Intl.NumberFormat("es-PE", {style:"currency",currency:"PEN"}).format(Number(value || 0));
const dateText = value => value ? new Date(value + (String(value).length === 10 ? "T12:00:00" : "")).toLocaleDateString("es-PE") : "Sin fecha";
const safe = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const setMessage = (id, text, error=false) => { const el=$(id); if(el){el.textContent=text;el.classList.toggle("error",error);} };

function showScreen(screen) {
  ["auth-screen","waiting-screen","rejected-screen","app-screen"].forEach(id => $(id).hidden = id !== screen);
  $("logout-button").hidden = screen === "auth-screen";
}
function setAuthTab(tab) {
  const login = tab === "login";
  $("login-form").hidden = !login;
  $("signup-form").hidden = login;
  $("show-login").classList.toggle("active", login);
  $("show-signup").classList.toggle("active", !login);
  setMessage("auth-message", "");
}
$("show-login").addEventListener("click", () => setAuthTab("login"));
$("show-signup").addEventListener("click", () => setAuthTab("signup"));

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  setMessage("auth-message", "Iniciando sesión...");
  const {error} = await supabaseClient.auth.signInWithPassword({
    email:$("login-email").value.trim(), password:$("login-password").value
  });
  button.disabled = false;
  if(error) setMessage("auth-message", error.message, true);
});
$("signup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  setMessage("auth-message", "Creando solicitud...");
  const {data,error} = await supabaseClient.auth.signUp({
    email:$("signup-email").value.trim(),
    password:$("signup-password").value,
    options:{data:{nombre:$("signup-name").value.trim()}}
  });
  button.disabled = false;
  if(error){setMessage("auth-message", error.message, true);return;}
  if(data.session) await checkAccess(data.session.user);
  else setMessage("auth-message","Cuenta creada. Confirma tu correo si Supabase lo solicita y luego inicia sesión. Tu acceso quedará pendiente de aprobación.");
});

async function signOut() {
  await supabaseClient.auth.signOut();
  currentUser=null;currentProfile=null;isAdmin=false;
  document.body.classList.remove("member-view");
  showScreen("auth-screen");
  $("connection-label").textContent="Sesión cerrada";
  setMessage("auth-message","Has cerrado sesión.");
}
$("logout-button").addEventListener("click", signOut);
$("waiting-logout").addEventListener("click", signOut);
$("rejected-logout").addEventListener("click", signOut);

async function checkAccess(user) {
  currentUser=user;
  showScreen("auth-screen");
  $("connection-label").textContent="Verificando cuenta...";
  let profile=null, error=null;
  for(let attempt=0;attempt<5;attempt++){
    const result=await supabaseClient.from("perfiles").select("id,nombre,estado,rol").eq("id",user.id).maybeSingle();
    profile=result.data;error=result.error;
    if(profile || error) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(error || !profile){
    showScreen("auth-screen");
    setMessage("auth-message","No se pudo consultar tu perfil: "+(error?.message || "No existe el perfil. Revisa el trigger crear_perfil_nuevo."),true);
    return;
  }
  currentProfile=profile;
  if(profile.estado==="pendiente"){showScreen("waiting-screen");$("connection-label").textContent="Cuenta pendiente";return;}
  if(profile.estado!=="aprobado"){showScreen("rejected-screen");$("connection-label").textContent="Acceso rechazado";return;}

  isAdmin=profile.rol==="admin";
  document.body.classList.toggle("member-view",!isAdmin);
  showScreen("app-screen");
  const displayName=(profile.nombre || user.user_metadata?.nombre || user.email?.split("@")[0] || "integrante").trim();
  $("welcome-title").textContent=`¡Bienvenido, ${displayName}!`;
  $("role-chip").textContent=isAdmin?"Administrador":"Usuario aprobado · Solo lectura";
  $("connection-label").textContent=isAdmin?"Administrador conectado":"Usuario aprobado";
  $("approval-section").hidden=!isAdmin;
  await loadAllData();
  if(isAdmin) await loadApprovals();
}

async function loadApprovals(){
  const box=$("pending-users");box.innerHTML='<div class="empty">Cargando solicitudes...</div>';
  const {data,error}=await supabaseClient.from("perfiles").select("id,nombre,creado_en").eq("estado","pendiente").order("creado_en");
  if(error){box.textContent="No se pudieron cargar las solicitudes: "+error.message;return;}
  if(!data?.length){box.innerHTML='<div class="empty">No hay solicitudes pendientes.</div>';return;}
  box.replaceChildren();
  data.forEach(profile=>{
    const row=document.createElement("div");row.className="pending-user";
    const info=document.createElement("div");info.innerHTML=`<strong>${safe(profile.nombre || "Sin nombre")}</strong><small>Solicitud: ${dateText(profile.creado_en)}</small>`;
    const actions=document.createElement("div");actions.className="pending-actions";
    [["Aprobar","aprobado","primary"],["Rechazar","rechazado","secondary"]].forEach(([label,state,style])=>{
      const btn=document.createElement("button");btn.className=`button ${style}`;btn.textContent=label;
      btn.addEventListener("click",async()=>{
        btn.disabled=true;
        const {error:updateError}=await supabaseClient.from("perfiles").update({estado:state}).eq("id",profile.id);
        if(updateError){alert("No se pudo actualizar el usuario: "+updateError.message);btn.disabled=false;return;}
        await loadApprovals();
      });
      actions.append(btn);
    });
    row.append(info,actions);box.append(row);
  });
}
$("refresh-approvals").addEventListener("click",loadApprovals);

async function loadAllData(){
  $("connection-label").textContent="Cargando información...";
  const results=await Promise.all([
    supabaseClient.from("integrantes").select("*").order("nombre"),
    supabaseClient.from("actividades").select("*").order("creada_en",{ascending:false}),
    supabaseClient.from("participaciones").select("*"),
    supabaseClient.from("movimientos").select("*").order("fecha",{ascending:false}),
    supabaseClient.from("aportes_esperados").select("*")
  ]);
  const names=["integrantes","actividades","participaciones","movimientos"];
  const failed=results.find(r=>r.error);
  if(failed){
    setMessage("app-message","Error al cargar datos: "+failed.error.message+". Comprueba los permisos GRANT y las políticas RLS.",true);
    $("connection-label").textContent="Error de conexión";
    return;
  }
  [members,activities,participations,movements,expectedContributions]=results.map(r=>r.data || []);
  renderAll();
  $("connection-label").textContent=isAdmin?"Administrador conectado":"Usuario aprobado";
  setMessage("app-message","");
}

function renderAll(){
  renderMemberList();renderActivities();renderMovementList();refreshActivitySelectors();renderDashboard();
}
function renderMemberList(){
  const query=$("member-search").value.toLowerCase().trim(),filter=$("member-filter").value;
  const rows=members.filter(m=>(m.nombre||"").toLowerCase().includes(query)&&(filter==="all"||(filter==="active"&&m.activo)||(filter==="inactive"&&!m.activo)));
  const body=$("members-list");body.replaceChildren();
  if(!rows.length){body.innerHTML='<tr><td colspan="4" class="empty">No hay integrantes para mostrar.</td></tr>';return;}
  rows.forEach(m=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${safe(m.nombre)}</strong></td><td><span class="status ${m.activo?"active":"inactive"}">${m.activo?"Activo":"Inactivo"}</span></td><td>${dateText(m.creado_en)}</td><td class="actions admin-only"></td>`;
    if(isAdmin){
      const cell=tr.querySelector(".actions");
      cell.append(makeAction("Editar",()=>openMemberModal(m)));
      cell.append(makeAction("Eliminar",()=>deleteMember(m)));
    }
    body.append(tr);
  });
}
function renderActivities(){
  const box=$("activities-list");box.replaceChildren();
  if(!activities.length){box.innerHTML='<div class="empty">Todavía no hay actividades registradas.</div>';return;}
  activities.forEach(a=>{
    const item=document.createElement("article");item.className="activity-item";
    const count=participations.filter(p=>p.actividad_id===a.id).length;
    const income=movements.filter(m=>m.actividad_id===a.id&&m.tipo==="aporte").reduce((s,m)=>s+Number(m.monto),0);
    const expense=movements.filter(m=>m.actividad_id===a.id&&m.tipo==="gasto").reduce((s,m)=>s+Number(m.monto),0);
    item.innerHTML=`<span class="eyebrow">ACTIVIDAD</span><h3>${safe(a.nombre)}</h3><p>${safe(a.descripcion||"Sin descripción")}</p><div class="activity-meta"><span>${dateText(a.fecha)}</span><span>Presupuesto: ${money(a.presupuesto)}</span></div><div class="activity-meta"><span>${count} participantes</span><span>Saldo: ${money(income-expense)}</span></div>`;
    const actions=document.createElement("div");actions.className="activity-actions";actions.append(makeAction("Ver detalle",()=>openActivityDetail(a)));if(isAdmin){actions.append(makeAction("Editar actividad",()=>openActivityModal(a)),makeAction("Eliminar",()=>deleteActivity(a),true));}item.append(actions);
    box.append(item);
  });
}
function renderMovementList(){
  const activityFilter=$("movement-activity-filter").value,typeFilter=$("movement-type-filter").value;
  const body=$("movements-list");body.replaceChildren();
  const rows=movements.filter(m=>(activityFilter==="all"||m.actividad_id===activityFilter)&&(typeFilter==="all"||m.tipo===typeFilter));
  if(!rows.length){body.innerHTML='<tr><td colspan="7" class="empty">No hay movimientos registrados.</td></tr>';return;}
  rows.forEach(m=>{
    const activity=activities.find(a=>a.id===m.actividad_id),member=members.find(x=>x.id===m.integrante_id);
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${dateText(m.fecha)}</td><td>${safe(activity?.nombre||"General")}</td><td>${safe(member?.nombre||"—")}</td><td><span class="status ${m.tipo==="aporte"?"income":"expense"}">${m.tipo==="aporte"?"Aporte":"Gasto"}</span></td><td>${safe(m.concepto)}</td><td><strong>${money(m.monto)}</strong></td><td class="actions admin-only"></td>`;
    if(isAdmin)tr.querySelector(".actions").append(makeAction("Eliminar",()=>deleteMovement(m),true));
    body.append(tr);
  });
}
function refreshActivitySelectors(){
  const dash=$("dashboard-activity"),mov=$("movement-activity-filter");
  const previousDash=dash.value,previousMov=mov.value;
  dash.innerHTML='<option value="all">Todas las actividades</option>';
  mov.innerHTML='<option value="all">Todas las actividades</option>';
  activities.forEach(a=>{dash.add(new Option(a.nombre,a.id));mov.add(new Option(a.nombre,a.id));});
  if([...dash.options].some(o=>o.value===previousDash))dash.value=previousDash;
  if([...mov.options].some(o=>o.value===previousMov))mov.value=previousMov;
}
function renderDashboard(){
  const id=$("dashboard-activity").value||"all";
  const scoped=id==="all"?movements:movements.filter(m=>m.actividad_id===id);
  const activity=activities.find(a=>a.id===id);
  const budget=id==="all"?activities.reduce((s,a)=>s+Number(a.presupuesto),0):Number(activity?.presupuesto||0);
  const income=scoped.filter(m=>m.tipo==="aporte").reduce((s,m)=>s+Number(m.monto),0);
  const expense=scoped.filter(m=>m.tipo==="gasto").reduce((s,m)=>s+Number(m.monto),0);
  $("stat-budget").textContent=money(budget);$("stat-income").textContent=money(income);$("stat-expenses").textContent=money(expense);$("stat-balance").textContent=money(income-expense);
  $("dashboard-activity-name").textContent=activity?.nombre||(id==="all"?"Todas las actividades":"Actividad no encontrada");
  $("dashboard-activity-date").textContent=activity?dateText(activity.fecha):"Resumen acumulado";
  $("dashboard-activity-description").textContent=activity?.descripcion||"Resumen de los registros guardados en Supabase.";
  $("dashboard-activity-tag").textContent=activity?"Actividad seleccionada":"Vista general";
  const scopedParticipations=id==="all"?participations:participations.filter(p=>p.actividad_id===id);
  const participantIds=new Set(scopedParticipations.map(p=>p.integrante_id));
  const withPayments=new Set(scoped.filter(m=>m.tipo==="aporte"&&m.integrante_id).map(m=>m.integrante_id));
  $("stat-members").textContent=participantIds.size;
  $("stat-paid").textContent=[...participantIds].filter(pid=>withPayments.has(pid)).length;
  $("stat-pending").textContent=Math.max(0,participantIds.size-[...participantIds].filter(pid=>withPayments.has(pid)).length);
}
function makeAction(label,handler,danger=false){const b=document.createElement("button");b.className="action-btn"+(danger?" danger":"");b.textContent=label;b.addEventListener("click",handler);return b;}

function openModal(title,fields,onSave){
  $("modal-window").classList.remove("wide");
  $("modal-form").hidden=false;
  $("modal-title").textContent=title;
  const form=$("modal-form");form.replaceChildren();
  fields.forEach(field=>{
    const label=document.createElement("label");label.textContent=field.label;label.htmlFor=field.id;form.append(label);
    let input;
    if(field.type==="select"){
      input=document.createElement("select");
      field.options.forEach(opt=>input.add(new Option(opt.label,opt.value)));
    }else{input=document.createElement("input");input.type=field.type||"text";if(field.type==="number"){input.min=field.min??"0";input.step=field.step??"0.01";}if(field.maxlength)input.maxLength=field.maxlength;}
    input.id=field.id;input.required=field.required!==false;if(field.value!==undefined)input.value=field.value;if(field.placeholder)input.placeholder=field.placeholder;
    form.append(input);
  });
  const actions=document.createElement("div");actions.className="modal-actions";
  const cancel=document.createElement("button");cancel.type="button";cancel.className="button secondary";cancel.textContent="Cancelar";cancel.addEventListener("click",closeModal);
  const save=document.createElement("button");save.type="submit";save.className="button primary";save.textContent="Guardar";
  actions.append(cancel,save);form.append(actions);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await onSave(Object.fromEntries(fields.map(f=>[f.id,$(f.id).value])));closeModal();}catch(err){alert(err.message||String(err));}finally{save.disabled=false;}};
  $("modal-backdrop").hidden=false;
}
function closeModal(){$("modal-backdrop").hidden=true;$("modal-form").onsubmit=null;$("modal-window").classList.remove("wide");$("modal-form").hidden=false;}
$("modal-close").addEventListener("click",closeModal);
$("modal-backdrop").addEventListener("click",e=>{if(e.target===$("modal-backdrop"))closeModal();});

function openMemberModal(member=null){
  if(!isAdmin)return;
  openModal(member?"Editar integrante":"Añadir integrante",[
    {id:"f-name",label:"Nombre completo",value:member?.nombre||"",maxlength:100},
    {id:"f-active",label:"Estado",type:"select",value:String(member?.activo??true),options:[{label:"Activo",value:"true"},{label:"Inactivo",value:"false"}]}
  ],async v=>{
    const payload={nombre:v["f-name"].trim(),activo:v["f-active"]==="true"};
    if(!payload.nombre)throw new Error("Escribe el nombre del integrante.");
    const query=member?supabaseClient.from("integrantes").update(payload).eq("id",member.id):supabaseClient.from("integrantes").insert(payload);
    const {error}=await query;if(error)throw error;await loadAllData();
  });
}
async function deleteMember(member){
  if(!isAdmin||!confirm(`¿Eliminar a ${member.nombre}? Los movimientos asociados conservarán el registro, pero su integrante quedará vacío.`))return;
  const {error}=await supabaseClient.from("integrantes").delete().eq("id",member.id);
  if(error){alert(error.message);return;}await loadAllData();
}
function openActivityModal(activity=null){
  if(!isAdmin)return;
  openModal(activity?"Editar actividad":"Nueva actividad",[
    {id:"f-title",label:"Nombre de la actividad",value:activity?.nombre||"",maxlength:120},
    {id:"f-date",label:"Fecha",type:"date",value:activity?.fecha||"",required:false},
    {id:"f-budget",label:"Presupuesto (S/)",type:"number",value:activity?.presupuesto??0,min:"0"},
    {id:"f-description",label:"Descripción",value:activity?.descripcion||"",required:false}
  ],async v=>{
    const payload={nombre:v["f-title"].trim(),fecha:v["f-date"]||null,presupuesto:Number(v["f-budget"]),descripcion:v["f-description"].trim()||null};
    if(!payload.nombre||!Number.isFinite(payload.presupuesto)||payload.presupuesto<0)throw new Error("Revisa el nombre y el presupuesto.");
    const query=activity?supabaseClient.from("actividades").update(payload).eq("id",activity.id):supabaseClient.from("actividades").insert(payload);
    const {error}=await query;if(error)throw error;await loadAllData();
  });
}
async function deleteActivity(activity){
  if(!isAdmin||!confirm(`¿Eliminar la actividad "${activity.nombre}" y sus participaciones/movimientos asociados?`))return;
  const {error}=await supabaseClient.from("actividades").delete().eq("id",activity.id);
  if(error){alert(error.message);return;}await loadAllData();
}
function contributionFor(activityId, memberId){
  return expectedContributions.find(x=>x.actividad_id===activityId&&x.integrante_id===memberId)?.monto_esperado ?? 0;
}
function paidFor(activityId, memberId){
  return movements.filter(m=>m.actividad_id===activityId&&m.integrante_id===memberId&&m.tipo==="aporte").reduce((sum,m)=>sum+Number(m.monto||0),0);
}
function paymentState(target, paid){
  if(paid<=0)return {label:"Pendiente",className:"pending"};
  if(paid+0.00001<target)return {label:"Pago parcial",className:"partial"};
  return {label:"Pagado",className:"paid"};
}
function openActivityDetail(activity){
  const content=$("activity-detail-inline");
  content.hidden=false;content.replaceChildren();
  const heading=document.createElement("div");heading.className="detail-inline-head";
  const title=document.createElement("div");title.innerHTML=`<span class="eyebrow">DETALLE DE ACTIVIDAD</span><h2>${safe(activity.nombre)}</h2>`;
  const close=makeAction("Ocultar detalles",()=>{content.hidden=true;content.replaceChildren();});
  heading.append(title,close);content.append(heading);
  const activityParticipations=participations.filter(p=>p.actividad_id===activity.id);
  const people=activityParticipations.map(p=>members.find(m=>m.id===p.integrante_id)).filter(Boolean);
  const income=movements.filter(m=>m.actividad_id===activity.id&&m.tipo==="aporte").reduce((s,m)=>s+Number(m.monto||0),0);
  const expenses=movements.filter(m=>m.actividad_id===activity.id&&m.tipo==="gasto").reduce((s,m)=>s+Number(m.monto||0),0);
  const targetTotal=people.reduce((s,m)=>s+Number(contributionFor(activity.id,m.id)),0);
  const remaining=Math.max(0,targetTotal-income);
  const summary=document.createElement("div");summary.className="detail-summary";
  [["Presupuesto",money(activity.presupuesto)],["Aportes recaudados",money(income)],["Gastos",money(expenses)],["Saldo disponible",money(income-expenses)]].forEach(([label,value])=>{const card=document.createElement("div");card.className="detail-stat";card.innerHTML=`<span>${label}</span><strong>${value}</strong>`;summary.append(card);});
  content.append(summary);
  const info=document.createElement("p");info.className="muted";info.textContent=`${people.length} integrantes · Aportes asignados: ${money(targetTotal)} · Falta recaudar: ${money(remaining)}`;content.append(info);
  const toolbar=document.createElement("div");toolbar.className="detail-toolbar";
  if(isAdmin){const add=makeAction("+ Añadir integrante",()=>openParticipationModal(activity));toolbar.append(add);const expense=makeAction("+ Registrar gasto",()=>openMovementModalFor(activity,null,"gasto"));toolbar.append(expense);}
  content.append(toolbar);
  const tableWrap=document.createElement("div");tableWrap.className="table-wrap";
  const table=document.createElement("table");table.className="detail-table";
  table.innerHTML='<thead><tr><th>Integrante</th><th>Debe aportar</th><th>Pagado</th><th>Falta</th><th>Estado</th><th>Acciones</th></tr></thead><tbody></tbody>';
  const tbody=table.querySelector("tbody");
  if(!people.length){tbody.innerHTML='<tr><td colspan="6" class="empty">Todavía no hay integrantes en esta actividad.</td></tr>';}
  people.forEach(person=>{
    const target=Number(contributionFor(activity.id,person.id));const paid=paidFor(activity.id,person.id);const due=Math.max(0,target-paid);const state=paymentState(target,paid);
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><span class="detail-person">${safe(person.nombre)}</span></td><td>${money(target)}</td><td>${money(paid)}</td><td>${money(due)}</td><td><span class="status ${state.className}">${state.label}</span></td><td class="actions"></td>`;
    const actions=tr.querySelector(".actions");
    if(isAdmin){actions.append(makeAction("Editar monto",()=>editExpectedContribution(activity,person)));actions.append(makeAction("Registrar pago",()=>openMovementModalFor(activity,person.id,"aporte")));actions.append(makeAction("Pagos",()=>showMemberPaymentHistory(activity,person)));actions.append(makeAction("Retirar",()=>removeParticipation(activity,person),true));}
    else actions.append(makeAction("Ver pagos",()=>showMemberPaymentHistory(activity,person)));
    tbody.append(tr);
  });
  tableWrap.append(table);content.append(tableWrap);
  const history=document.createElement("div");history.className="detail-history";
  const h=document.createElement("h3");h.textContent="Historial de movimientos de esta actividad";history.append(h);
  const list=movements.filter(m=>m.actividad_id===activity.id).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  if(!list.length){const empty=document.createElement("p");empty.className="muted";empty.textContent="Todavía no hay aportes ni gastos.";history.append(empty);}
  else {const wrap=document.createElement("div");wrap.className="table-wrap";const t=document.createElement("table");t.innerHTML='<thead><tr><th>Fecha</th><th>Integrante</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Acciones</th></tr></thead><tbody></tbody>';
    list.forEach(m=>{const person=members.find(x=>x.id===m.integrante_id);const tr=document.createElement("tr");tr.innerHTML=`<td>${dateText(m.fecha)}</td><td>${safe(person?.nombre||"—")}</td><td>${m.tipo==="aporte"?"Aporte":"Gasto"}</td><td>${safe(m.concepto)}</td><td>${money(m.monto)}</td><td class="actions"></td>`;if(isAdmin){tr.querySelector(".actions").append(makeAction("Editar",()=>editMovement(m,activity)));tr.querySelector(".actions").append(makeAction("Eliminar",async()=>{await deleteMovement(m);openActivityDetail(activities.find(a=>a.id===activity.id)||activity);},true));}t.querySelector("tbody").append(tr);});wrap.append(t);history.append(wrap);}
  content.append(history);
}
function openParticipationModal(activity){
  if(!isAdmin)return;
  const current=new Set(participations.filter(p=>p.actividad_id===activity.id).map(p=>p.integrante_id));
  const options=members.filter(m=>m.activo&&!current.has(m.id)).map(m=>({label:m.nombre,value:m.id}));
  if(!options.length){alert("No hay integrantes activos disponibles para añadir.");return;}
  openModal("Añadir integrante a: "+activity.nombre,[
    {id:"f-member",label:"Integrante",type:"select",options:[{label:"Selecciona un integrante",value:""},...options]},
    {id:"f-expected",label:"Aporte que le corresponde (S/)",type:"number",value:0,min:"0"}
  ],async v=>{
    const memberId=v["f-member"];const amount=Number(v["f-expected"]);
    if(!memberId||!Number.isFinite(amount)||amount<0)throw new Error("Selecciona un integrante e ingresa un monto válido.");
    const {error}=await supabaseClient.from("participaciones").insert({actividad_id:activity.id,integrante_id:memberId});if(error)throw error;
    const {error:quotaError}=await supabaseClient.from("aportes_esperados").upsert({actividad_id:activity.id,integrante_id:memberId,monto_esperado:amount},{onConflict:"actividad_id,integrante_id"});if(quotaError)throw quotaError;
    await loadAllData();setTimeout(()=>openActivityDetail(activities.find(a=>a.id===activity.id)||activity),0);
  });
}
async function editExpectedContribution(activity,person){
  const current=Number(contributionFor(activity.id,person.id));
  openModal("Aporte asignado · "+person.nombre,[{id:"f-expected",label:"Monto que debe aportar (S/)",type:"number",value:current,min:"0"}],async v=>{
    const amount=Number(v["f-expected"]);if(!Number.isFinite(amount)||amount<0)throw new Error("Ingresa un monto válido.");
    const {error}=await supabaseClient.from("aportes_esperados").upsert({actividad_id:activity.id,integrante_id:person.id,monto_esperado:amount},{onConflict:"actividad_id,integrante_id"});if(error)throw error;
    await loadAllData();setTimeout(()=>openActivityDetail(activities.find(a=>a.id===activity.id)||activity),0);
  });
}
async function removeParticipation(activity,person){
  if(!isAdmin||!confirm(`¿Retirar a ${person.nombre} de esta actividad? El historial de pagos se conservará.`))return;
  const {error}=await supabaseClient.from("participaciones").delete().eq("actividad_id",activity.id).eq("integrante_id",person.id);if(error){alert(error.message);return;}
  await supabaseClient.from("aportes_esperados").delete().eq("actividad_id",activity.id).eq("integrante_id",person.id);
  await loadAllData();setTimeout(()=>openActivityDetail(activities.find(a=>a.id===activity.id)||activity),0);
}
function showMemberPaymentHistory(activity,person){
  const list=movements.filter(m=>m.actividad_id===activity.id&&m.integrante_id===person.id&&m.tipo==="aporte").sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  alert(list.length?`Pagos de ${person.nombre} · ${activity.nombre}\n\n${list.map(m=>`${dateText(m.fecha)} — ${money(m.monto)} — ${m.concepto}`).join("\n")}\n\nTotal pagado: ${money(paidFor(activity.id,person.id))}`:`${person.nombre} todavía no registra pagos en esta actividad.`);
}
function openMovementModalFor(activity,memberId,type){
  if(!isAdmin)return;
  openMovementModal({activityId:activity.id,memberId,type});
}
function openMovementModal(prefill={}){
  if(!isAdmin)return;
  if(!activities.length){alert("Primero crea una actividad.");return;}
  const activeMembers=members.filter(m=>m.activo);
  openModal("Registrar movimiento",[
    {id:"f-type",label:"Tipo de movimiento",type:"select",value:prefill.type||"aporte",options:[{label:"Aporte / ingreso",value:"aporte"},{label:"Gasto",value:"gasto"}]},
    {id:"f-activity",label:"Actividad",type:"select",value:prefill.activityId||activities[0]?.id,options:activities.map(a=>({label:a.nombre,value:a.id}))},
    {id:"f-member",label:"Integrante (opcional)",type:"select",value:prefill.memberId||"",required:false,options:[{label:"No asignar",value:""},...activeMembers.map(m=>({label:m.nombre,value:m.id}))]},
    {id:"f-concept",label:"Concepto",value:prefill.type==="aporte"?"Aporte de integrante":"",maxlength:150},
    {id:"f-amount",label:"Monto (S/)",type:"number",min:"0.01"},
    {id:"f-date",label:"Fecha y hora",type:"datetime-local",value:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)},
    {id:"f-note",label:"Observación",value:"",required:false}
  ],async v=>{
    const amount=Number(v["f-amount"]);
    if(!v["f-concept"].trim()||!Number.isFinite(amount)||amount<=0)throw new Error("Completa el concepto e ingresa un monto mayor que cero.");
    const payload={tipo:v["f-type"],actividad_id:v["f-activity"],integrante_id:v["f-member"]||null,concepto:v["f-concept"].trim(),monto:amount,fecha:new Date(v["f-date"]).toISOString(),observacion:v["f-note"].trim()||null,registrado_por:currentUser.id};
    const {error}=await supabaseClient.from("movimientos").insert(payload);if(error)throw error;await loadAllData();
  });
}
function editMovement(movement,activity){
  if(!isAdmin)return;
  openModal("Editar movimiento",[
    {id:"f-type",label:"Tipo",type:"select",value:movement.tipo,options:[{label:"Aporte",value:"aporte"},{label:"Gasto",value:"gasto"}]},
    {id:"f-member",label:"Integrante",type:"select",value:movement.integrante_id||"",required:false,options:[{label:"No asignar",value:""},...members.map(m=>({label:m.nombre,value:m.id}))]},
    {id:"f-concept",label:"Concepto",value:movement.concepto,maxlength:150},
    {id:"f-amount",label:"Monto (S/)",type:"number",value:movement.monto,min:"0.01"},
    {id:"f-date",label:"Fecha y hora",type:"datetime-local",value:new Date(new Date(movement.fecha).getTime()-new Date(movement.fecha).getTimezoneOffset()*60000).toISOString().slice(0,16)},
    {id:"f-note",label:"Observación",value:movement.observacion||"",required:false}
  ],async v=>{
    const amount=Number(v["f-amount"]);if(!v["f-concept"].trim()||!Number.isFinite(amount)||amount<=0)throw new Error("Revisa el concepto y el monto.");
    const {error}=await supabaseClient.from("movimientos").update({tipo:v["f-type"],integrante_id:v["f-member"]||null,concepto:v["f-concept"].trim(),monto:amount,fecha:new Date(v["f-date"]).toISOString(),observacion:v["f-note"].trim()||null}).eq("id",movement.id);
    if(error)throw error;await loadAllData();setTimeout(()=>openActivityDetail(activities.find(a=>a.id===activity.id)||activity),0);
  });
}
async function deleteMovement(movement){
  if(!isAdmin||!confirm("¿Eliminar este movimiento?"))return;
  const {error}=await supabaseClient.from("movimientos").delete().eq("id",movement.id);
  if(error){alert(error.message);return;}await loadAllData();
}

$("add-member").addEventListener("click",()=>openMemberModal());
$("add-activity").addEventListener("click",()=>openActivityModal());
$("add-movement").addEventListener("click",openMovementModal);
$("member-search").addEventListener("input",renderMemberList);
$("member-filter").addEventListener("change",renderMemberList);
$("dashboard-activity").addEventListener("change",renderDashboard);
$("movement-activity-filter").addEventListener("change",renderMovementList);
$("movement-type-filter").addEventListener("change",renderMovementList);
document.querySelectorAll(".tab").forEach(button=>button.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===button));
  document.querySelectorAll(".tab-panel").forEach(panel=>{const active=panel.id===`tab-${button.dataset.tab}`;panel.classList.toggle("active",active);panel.hidden=!active;});
}));
supabaseClient.auth.onAuthStateChange((event,session)=>{
  if(session?.user) setTimeout(()=>checkAccess(session.user),0);
  else if(event==="SIGNED_OUT"){currentUser=null;currentProfile=null;isAdmin=false;showScreen("auth-screen");}
});
(async()=>{
  $("connection-label").textContent="Conectando con Supabase...";
  const {data,error}=await supabaseClient.auth.getSession();
  if(error){showScreen("auth-screen");setMessage("auth-message",error.message,true);}
  else if(data.session?.user) await checkAccess(data.session.user);
  else showScreen("auth-screen");
})();
